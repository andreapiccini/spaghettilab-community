#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/config.h>
#include <spaghetti/discovery.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/topology.h>

#include "fake_providers.h"
#include "identity_record_util.h"

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
};

static struct spaghetti_port fake_port = {
	.id = 0U,
	.capabilities = SPAGHETTI_PORT_CAP_I2C | SPAGHETTI_PORT_CAP_ADC |
			SPAGHETTI_PORT_CAP_W1,
};

static const struct spaghetti_flow_descriptor fake_flow = {
	.id = 7U,
	.port_id = 0U,
	.direction = SPAGHETTI_FLOW_BIDIRECTIONAL,
	.signal_count = SPAGHETTI_FLOW_SIGNAL_COUNT,
	.function_bay_count = 2U,
};

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	return (id == fake_port.id) ? &fake_port : NULL;
}

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				   uint32_t capabilities)
{
	if ((port == NULL) || (capabilities == 0U)) {
		return false;
	}

	return (port->capabilities & capabilities) == capabilities;
}

const struct spaghetti_flow_descriptor *spaghetti_topology_flow_for_port(
	spaghetti_port_id_t port_id)
{
	return (port_id == fake_flow.port_id) ? &fake_flow : NULL;
}

static struct spaghetti_discovery_scan_policy read_only_policy(void)
{
	return (struct spaghetti_discovery_scan_policy){
		.allow_read_only = true,
		.allow_state_changing = false,
		.timeout_per_provider = K_MSEC(20),
	};
}

static struct spaghetti_discovery_scan_policy permissive_policy(void)
{
	return (struct spaghetti_discovery_scan_policy){
		.allow_read_only = true,
		.allow_state_changing = true,
		.timeout_per_provider = K_MSEC(20),
	};
}

static void *suite_setup(void)
{
	zassert_ok(spaghetti_discovery_init());
	return NULL;
}

static void before_test(void *fixture)
{
	struct spaghetti_discovery_scan_policy policy = read_only_policy();

	ARG_UNUSED(fixture);
	discovery_test_harness_reset();
	zassert_ok(spaghetti_discovery_scan_port(0U, &policy));
}

static struct spaghetti_property_set make_u64_props(uint16_t field_id,
						    uint64_t value)
{
	struct spaghetti_property_set props = {0};

	props.field_count = 1U;
	props.fields[0].field_id = field_id;
	props.fields[0].type = SPAGHETTI_VALUE_UINT64;
	props.fields[0].data.unsigned_integer = value;
	return props;
}

ZTEST(discovery_providers, test_identity_record_roundtrip_and_errors)
{
	uint8_t identity[] = {0x01U, 0x02U, 0x03U, 0x04U};
	struct spaghetti_property_set props = make_u64_props(3U, 0x40U);
	uint8_t encoded[128];
	size_t encoded_size = 0U;
	struct spaghetti_discovery_candidate decoded;
	uint8_t broken[128];

	zassert_ok(discovery_test_identity_record_encode(
		identity, sizeof(identity), "ina219", 1U, 2U, &props, encoded,
		sizeof(encoded), &encoded_size));
	zassert_true(encoded_size > 12U);

	zassert_equal(spaghetti_identity_record_decode(NULL, encoded_size,
						       &decoded),
		      -EINVAL);
	zassert_equal(spaghetti_identity_record_decode(encoded, 4U, &decoded),
		      -EMSGSIZE);
	zassert_ok(spaghetti_identity_record_decode(encoded, encoded_size,
						    &decoded));
	zassert_equal(decoded.identity_size, sizeof(identity));
	zassert_mem_equal(decoded.identity, identity, sizeof(identity));
	zassert_str_equal(decoded.suggested_type_id, "ina219");
	zassert_equal(decoded.bay_id, 1U);
	zassert_equal(decoded.power_rail_id, 2U);
	zassert_equal(decoded.suggested_properties.field_count, 1U);
	zassert_equal(decoded.suggested_properties.fields[0].data.unsigned_integer,
		      0x40U);

	memcpy(broken, encoded, encoded_size);
	broken[0] ^= 0xFFU;
	zassert_equal(spaghetti_identity_record_decode(broken, encoded_size,
						       &decoded),
		      -EBADMSG);

	memcpy(broken, encoded, encoded_size);
	broken[encoded_size - 1U] ^= 0xFFU;
	zassert_equal(spaghetti_identity_record_decode(broken, encoded_size,
						       &decoded),
		      -EBADMSG);

	memcpy(broken, encoded, encoded_size);
	broken[4] = 99U;
	zassert_equal(spaghetti_identity_record_decode(broken, encoded_size,
						       &decoded),
		      -ENOTSUP);
}

ZTEST(discovery_providers, test_eeprom_analog_i2c_w1_and_accept)
{
	struct discovery_test_harness *harness = discovery_test_harness_get();
	struct spaghetti_discovery_scan_policy policy = read_only_policy();
	struct spaghetti_property_set props = make_u64_props(3U, 0x41U);
	uint8_t identity[] = {0xA1U, 0xB2U, 0xC3U, 0xD4U};
	struct spaghetti_discovery_candidate listed[8];
	size_t count = 0U;
	struct spaghetti_module_config accepted;
	struct spaghetti_module_config manual = {
		.key = 99U,
		.port_id = 0U,
		.bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED,
		.power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED,
		.type_id = "manual-relay",
	};
	spaghetti_discovery_candidate_id_t eeprom_id = 0U;
	spaghetti_discovery_candidate_id_t analog_id = 0U;
	uint32_t eeprom_generation = 0U;
	uint32_t analog_generation = 0U;

	manual.properties = make_u64_props(7U, 1U);

	zassert_ok(discovery_test_identity_record_encode(
		identity, sizeof(identity), "ina219", 1U,
		SPAGHETTI_POWER_RAIL_UNSPECIFIED, &props, harness->eeprom_bytes,
		sizeof(harness->eeprom_bytes), &harness->eeprom_size));
	harness->eeprom_enabled = true;

	harness->analog_enabled = true;
	harness->analog_identity[0] = 0x55U;
	harness->analog_identity_size = 1U;
	strcpy(harness->analog_type_id, "ntc-probe");

	harness->i2c_register_enabled = true;
	harness->i2c_identity[0] = 0x40U;
	harness->i2c_identity_size = 1U;
	strcpy(harness->i2c_type_id, "ina219");

	harness->w1_enabled = true;
	harness->w1_rom_count = 2U;
	memset(harness->w1_roms[0], 0x11, sizeof(harness->w1_roms[0]));
	memset(harness->w1_roms[1], 0x22, sizeof(harness->w1_roms[1]));

	zassert_ok(spaghetti_discovery_scan_port(0U, &policy));
	zassert_ok(spaghetti_discovery_list(listed, ARRAY_SIZE(listed), &count));
	zassert_equal(count, 5U);

	for (size_t idx = 0U; idx < count; ++idx) {
		zassert_equal(listed[idx].port_id, 0U);
		zassert_equal(listed[idx].flow_id, fake_flow.id);
		if (strcmp(listed[idx].provider_id, "test.eeprom") == 0) {
			eeprom_id = listed[idx].id;
			eeprom_generation = listed[idx].generation;
			zassert_equal(listed[idx].confidence,
				      SPAGHETTI_DISCOVERY_AUTHORITATIVE);
			zassert_equal(listed[idx].method,
				      SPAGHETTI_DISCOVERY_METHOD_EEPROM);
			zassert_equal(listed[idx].bay_id, 1U);
		} else if (strcmp(listed[idx].provider_id, "test.analog") ==
			   0) {
			analog_id = listed[idx].id;
			analog_generation = listed[idx].generation;
			zassert_equal(listed[idx].confidence,
				      SPAGHETTI_DISCOVERY_HEURISTIC);
			zassert_equal(listed[idx].bay_id,
				      SPAGHETTI_BAY_ID_UNSPECIFIED);
		} else if (strcmp(listed[idx].provider_id, "test.w1") == 0) {
			zassert_equal(listed[idx].identity_size, 8U);
			zassert_equal(listed[idx].method,
				      SPAGHETTI_DISCOVERY_METHOD_W1_ROM);
		} else {
			zassert_str_equal(listed[idx].provider_id,
					  "test.i2c_register");
		}
	}
	zassert_not_equal(eeprom_id, 0U);
	zassert_not_equal(analog_id, 0U);

	zassert_ok(spaghetti_discovery_accept(eeprom_id, 10U, eeprom_generation,
					      &accepted));
	zassert_equal(accepted.key, 10U);
	zassert_str_equal(accepted.type_id, "ina219");
	zassert_equal(accepted.bay_id, 1U);
	zassert_equal(accepted.properties.fields[0].data.unsigned_integer,
		      0x41U);
	zassert_equal(manual.key, 99U);
	zassert_str_equal(manual.type_id, "manual-relay");

	zassert_ok(spaghetti_discovery_accept(analog_id, 11U, analog_generation,
					      &accepted));
	zassert_str_equal(accepted.type_id, "ntc-probe");
	zassert_equal(accepted.bay_id, SPAGHETTI_BAY_ID_UNSPECIFIED);
}

ZTEST(discovery_providers, test_duplicate_timeout_invasive_stale_pool)
{
	struct discovery_test_harness *harness = discovery_test_harness_get();
	struct spaghetti_discovery_scan_policy policy = read_only_policy();
	struct spaghetti_discovery_candidate listed[8];
	size_t count = 0U;
	struct spaghetti_module_config accepted;
	spaghetti_discovery_candidate_id_t candidate_id;
	uint32_t generation;

	harness->duplicate_emit_enabled = true;
	zassert_ok(spaghetti_discovery_scan_port(0U, &policy));
	zassert_ok(spaghetti_discovery_list(NULL, 0U, &count));
	zassert_equal(count, 1U);

	discovery_test_harness_reset();
	harness->timeout_enabled = true;
	zassert_equal(spaghetti_discovery_scan_port(0U, &policy), -ETIMEDOUT);

	discovery_test_harness_reset();
	harness->invasive_enabled = true;
	harness->invasive_ran = false;
	zassert_ok(spaghetti_discovery_scan_port(0U, &policy));
	zassert_false(harness->invasive_ran);
	zassert_ok(spaghetti_discovery_list(NULL, 0U, &count));
	zassert_equal(count, 0U);

	policy = permissive_policy();
	harness->invasive_ran = false;
	zassert_ok(spaghetti_discovery_scan_port(0U, &policy));
	zassert_true(harness->invasive_ran);
	zassert_ok(spaghetti_discovery_list(listed, ARRAY_SIZE(listed), &count));
	zassert_equal(count, 1U);
	candidate_id = listed[0].id;
	generation = listed[0].generation;
	zassert_equal(spaghetti_discovery_accept(candidate_id, 20U,
						 generation + 1U, &accepted),
		      -ESTALE);
	zassert_equal(spaghetti_discovery_reject(candidate_id, generation + 1U),
		      -ESTALE);
	zassert_ok(spaghetti_discovery_reject(candidate_id, generation));
	zassert_ok(spaghetti_discovery_list(NULL, 0U, &count));
	zassert_equal(count, 0U);

	discovery_test_harness_reset();
	policy = read_only_policy();
	harness->flood_enabled = true;
	harness->flood_count = (size_t)CONFIG_SPAGHETTI_DISCOVERY_MAX_RESULTS + 1U;
	zassert_equal(spaghetti_discovery_scan_port(0U, &policy), -ENOSPC);
}

ZTEST_SUITE(discovery_providers, NULL, suite_setup, before_test, NULL, NULL);
