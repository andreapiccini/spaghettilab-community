#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <ina219.h>

#include <spaghetti/config.h>
#include <spaghetti/config_codec.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/topology.h>

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
};

static uint32_t validation_count;

static const struct spaghetti_port fake_port = {
	.id = 0U,
	.capabilities = SPAGHETTI_PORT_CAP_I2C,
};

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t port_id)
{
	return (port_id == 0U) ? &fake_port : NULL;
}

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				   uint32_t capabilities)
{
	return (port != NULL) &&
	       ((port->capabilities & capabilities) == capabilities);
}

const struct spaghetti_flow_descriptor *spaghetti_topology_flow_for_port(
	spaghetti_port_id_t port_id)
{
	ARG_UNUSED(port_id);
	return NULL;
}

int spaghetti_topology_bay_get(spaghetti_flow_id_t flow_id,
			       spaghetti_bay_id_t bay_id,
			       struct spaghetti_bay_descriptor *out)
{
	ARG_UNUSED(flow_id);
	ARG_UNUSED(bay_id);
	ARG_UNUSED(out);
	return -ENOENT;
}

const struct spaghetti_module_driver *spaghetti_driver_registry_find(
	const char *type_id)
{
	if ((type_id != NULL) && (strcmp(type_id, "ina219") == 0)) {
		return &spaghetti_ina219_driver;
	}
	return NULL;
}

const struct spaghetti_rule_driver *spaghetti_rule_registry_find(
	const char *type_id)
{
	ARG_UNUSED(type_id);
	return NULL;
}

int spaghetti_config_validate(const struct spaghetti_config *candidate,
			      struct spaghetti_config_failure *failure)
{
	ARG_UNUSED(failure);
	++validation_count;
	if ((candidate == NULL) ||
	    (candidate->version != SPAGHETTI_CONFIG_VERSION) ||
	    (candidate->module_count > SPAGHETTI_CONFIG_MAX_MODULES) ||
	    (candidate->schedule_count > SPAGHETTI_CONFIG_MAX_SCHEDULES)) {
		return -EINVAL;
	}

	for (size_t module_idx = 0U; module_idx < candidate->module_count;
	     ++module_idx) {
		const struct spaghetti_module_config *module =
			&candidate->modules[module_idx];
		struct spaghetti_ina219_config ina219_config;
		int err;

		if (strcmp(module->type_id, "ina219") != 0) {
			return -ENOTSUP;
		}
		err = spaghetti_ina219_config_from_properties(&module->properties,
							      &ina219_config);
		if (err < 0) {
			return err;
		}
		for (size_t previous_idx = 0U; previous_idx < module_idx;
		     ++previous_idx) {
			struct spaghetti_ina219_config previous;

			if (candidate->modules[previous_idx].key == module->key) {
				return -EEXIST;
			}
			zassert_ok(spaghetti_ina219_config_from_properties(
				&candidate->modules[previous_idx].properties,
				&previous));
			if ((candidate->modules[previous_idx].port_id ==
			     module->port_id) &&
			    (previous.i2c_address == ina219_config.i2c_address)) {
				return -EADDRINUSE;
			}
		}
	}

	for (size_t schedule_idx = 0U; schedule_idx < candidate->schedule_count;
	     ++schedule_idx) {
		bool found = false;

		for (size_t module_idx = 0U; module_idx < candidate->module_count;
		     ++module_idx) {
			if (candidate->modules[module_idx].key ==
			    candidate->schedules[schedule_idx].source_key) {
				found = true;
				break;
			}
		}
		if (!found) {
			return -EINVAL;
		}
	}

	return 0;
}

static const uint8_t legacy_v0_payload[] = {
	0xA3U, 0x00U, 0x01U, 0x01U, 0x82U,
	0xA4U, 0x00U, 0x0AU, 0x01U, 0x00U, 0x02U, 0x66U,
	'i', 'n', 'a', '2', '1', '9',
	0x03U, 0xA3U, 0x00U, 0x18U, 0x40U, 0x01U, 0x18U, 0x64U,
	0x02U, 0x18U, 0xC8U,
	0xA4U, 0x00U, 0x0BU, 0x01U, 0x00U, 0x02U, 0x66U,
	'i', 'n', 'a', '2', '1', '9',
	0x03U, 0xA3U, 0x00U, 0x18U, 0x41U, 0x01U, 0x18U, 0x64U,
	0x02U, 0x18U, 0xC8U,
	0x02U, 0xA3U, 0x00U, 0x0AU, 0x01U, 0x19U, 0x03U, 0xE8U,
	0x02U, 0xF5U,
};

static void assert_decode_failure(const uint8_t *payload, size_t payload_size,
				  int expected_error)
{
	const struct spaghetti_config sentinel = {
		.version = UINT32_MAX,
		.module_count = 1U,
	};
	struct spaghetti_config output = sentinel;

	zassert_equal(spaghetti_config_decode_cbor(payload, payload_size, &output),
		      expected_error);
	zassert_mem_equal(&output, &sentinel, sizeof(output));
}

ZTEST(config_codec, test_legacy_and_round_trip)
{
	struct spaghetti_config decoded;
	struct spaghetti_ina219_config first_config;
	struct spaghetti_ina219_config second_config;
	uint8_t encoded[SPAGHETTI_CONFIG_CBOR_MAX_SIZE];
	size_t written = 0U;
	struct spaghetti_config round_trip;

	validation_count = 0U;
	zassert_ok(spaghetti_config_decode_cbor(legacy_v0_payload,
						sizeof(legacy_v0_payload),
						&decoded));
	zassert_equal(validation_count, 1U);
	zassert_equal(decoded.version, SPAGHETTI_CONFIG_VERSION);
	zassert_equal(decoded.module_count, 2U);
	zassert_equal(decoded.schedule_count, 1U);
	zassert_true(decoded.schedules[0].enabled);
	zassert_equal(decoded.schedules[0].source_key, 10U);
	zassert_equal(decoded.schedules[0].period_ms, 1000U);
	zassert_equal(decoded.rule_count, 0U);

	zassert_ok(spaghetti_ina219_config_from_properties(
		&decoded.modules[0].properties, &first_config));
	zassert_ok(spaghetti_ina219_config_from_properties(
		&decoded.modules[1].properties, &second_config));
	zassert_equal(first_config.i2c_address, 0x40U);
	zassert_equal(second_config.i2c_address, 0x41U);

	decoded.schedule_count = 2U;
	decoded.schedules[1] = decoded.schedules[0];
	decoded.schedules[1].source_key = 11U;
	decoded.schedules[1].period_ms = 2000U;
	decoded.schedules[1].enabled = false;

	zassert_ok(spaghetti_config_encode_cbor(&decoded, encoded,
						sizeof(encoded), &written));
	zassert_true(written > 0U);
	zassert_ok(spaghetti_config_decode_cbor(encoded, written, &round_trip));
	zassert_equal(round_trip.module_count, 2U);
	zassert_equal(round_trip.schedule_count, 2U);
	zassert_equal(round_trip.schedules[1].source_key, 11U);
	zassert_false(round_trip.schedules[1].enabled);

	assert_decode_failure(legacy_v0_payload, sizeof(legacy_v0_payload) - 1U,
			      -EBADMSG);
	zassert_equal(spaghetti_config_decode_cbor(NULL, 1U, &decoded), -EINVAL);
	zassert_equal(spaghetti_config_encode_cbor(NULL, encoded, sizeof(encoded),
						   &written),
		      -EINVAL);
}

ZTEST_SUITE(config_codec, NULL, NULL, NULL, NULL, NULL);
