#include "fake_providers.h"

#include <errno.h>
#include <string.h>

#include <zephyr/kernel.h>

#include <spaghetti/discovery.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/topology.h>

static struct discovery_test_harness harness;

void discovery_test_harness_reset(void)
{
	memset(&harness, 0, sizeof(harness));
}

struct discovery_test_harness *discovery_test_harness_get(void)
{
	return &harness;
}

static int emit_basic(spaghetti_discovery_emit_candidate_cb_t emit,
		      void *emit_user_data,
		      const uint8_t *identity, uint8_t identity_size,
		      const char *type_id,
		      const struct spaghetti_property_set *properties,
		      spaghetti_bay_id_t bay_id,
		      spaghetti_power_rail_id_t rail_id)
{
	struct spaghetti_discovery_candidate candidate;

	memset(&candidate, 0, sizeof(candidate));
	candidate.bay_id = bay_id;
	candidate.power_rail_id = rail_id;
	candidate.identity_size = identity_size;
	if (identity_size > 0U) {
		memcpy(candidate.identity, identity, identity_size);
	}
	if (type_id != NULL) {
		strncpy(candidate.suggested_type_id, type_id,
			sizeof(candidate.suggested_type_id) - 1U);
	}
	if (properties != NULL) {
		candidate.suggested_properties = *properties;
	}

	return emit(&candidate, emit_user_data);
}

static int fake_eeprom_scan(const struct spaghetti_port *port,
			    spaghetti_discovery_emit_candidate_cb_t emit,
			    void *emit_user_data, k_timeout_t timeout)
{
	struct spaghetti_discovery_candidate decoded;
	int err;

	ARG_UNUSED(port);
	ARG_UNUSED(timeout);

	if (!harness.eeprom_enabled || (harness.eeprom_size == 0U)) {
		return 0;
	}

	memset(&decoded, 0, sizeof(decoded));
	err = spaghetti_identity_record_decode(harness.eeprom_bytes,
					       harness.eeprom_size, &decoded);
	if (err < 0) {
		return err;
	}

	return emit(&decoded, emit_user_data);
}

static const struct spaghetti_discovery_provider_ops fake_eeprom_ops = {
	.scan = fake_eeprom_scan,
};

SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(fake_eeprom_provider) = {
	.provider_id = "test.eeprom",
	.api_version = SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION,
	.method = SPAGHETTI_DISCOVERY_METHOD_EEPROM,
	.confidence = SPAGHETTI_DISCOVERY_AUTHORITATIVE,
	.probe_flags = SPAGHETTI_DISCOVERY_PROBE_READ_ONLY,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.ops = &fake_eeprom_ops,
};

static int fake_analog_scan(const struct spaghetti_port *port,
			    spaghetti_discovery_emit_candidate_cb_t emit,
			    void *emit_user_data, k_timeout_t timeout)
{
	struct spaghetti_property_set props = {0};

	ARG_UNUSED(port);
	ARG_UNUSED(timeout);

	if (!harness.analog_enabled) {
		return 0;
	}

	props.field_count = 1U;
	props.fields[0].field_id = 1U;
	props.fields[0].type = SPAGHETTI_VALUE_UINT64;
	props.fields[0].data.unsigned_integer = 1200U;

	return emit_basic(emit, emit_user_data, harness.analog_identity,
			  harness.analog_identity_size, harness.analog_type_id,
			  &props, SPAGHETTI_BAY_ID_UNSPECIFIED,
			  SPAGHETTI_POWER_RAIL_UNSPECIFIED);
}

static const struct spaghetti_discovery_provider_ops fake_analog_ops = {
	.scan = fake_analog_scan,
};

SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(fake_analog_provider) = {
	.provider_id = "test.analog",
	.api_version = SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION,
	.method = SPAGHETTI_DISCOVERY_METHOD_ANALOG,
	.confidence = SPAGHETTI_DISCOVERY_HEURISTIC,
	.probe_flags = SPAGHETTI_DISCOVERY_PROBE_READ_ONLY,
	.required_capabilities = SPAGHETTI_PORT_CAP_ADC,
	.ops = &fake_analog_ops,
};

static int fake_i2c_register_scan(const struct spaghetti_port *port,
				  spaghetti_discovery_emit_candidate_cb_t emit,
				  void *emit_user_data, k_timeout_t timeout)
{
	struct spaghetti_property_set props = {0};

	ARG_UNUSED(port);
	ARG_UNUSED(timeout);

	if (!harness.i2c_register_enabled) {
		return 0;
	}

	props.field_count = 1U;
	props.fields[0].field_id = 10U;
	props.fields[0].type = SPAGHETTI_VALUE_UINT64;
	props.fields[0].data.unsigned_integer = 0x40U;

	return emit_basic(emit, emit_user_data, harness.i2c_identity,
			  harness.i2c_identity_size, harness.i2c_type_id, &props,
			  SPAGHETTI_BAY_ID_UNSPECIFIED,
			  SPAGHETTI_POWER_RAIL_UNSPECIFIED);
}

static const struct spaghetti_discovery_provider_ops fake_i2c_register_ops = {
	.scan = fake_i2c_register_scan,
};

SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(fake_i2c_register_provider) = {
	.provider_id = "test.i2c_register",
	.api_version = SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION,
	.method = SPAGHETTI_DISCOVERY_METHOD_I2C_REGISTER,
	.confidence = SPAGHETTI_DISCOVERY_HEURISTIC,
	.probe_flags = SPAGHETTI_DISCOVERY_PROBE_READ_ONLY,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.ops = &fake_i2c_register_ops,
};

static int fake_w1_scan(const struct spaghetti_port *port,
			spaghetti_discovery_emit_candidate_cb_t emit,
			void *emit_user_data, k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(timeout);

	if (!harness.w1_enabled) {
		return 0;
	}

	for (size_t rom_idx = 0U; rom_idx < harness.w1_rom_count; ++rom_idx) {
		int err = emit_basic(emit, emit_user_data, harness.w1_roms[rom_idx],
				     8U, "", NULL, SPAGHETTI_BAY_ID_UNSPECIFIED,
				     SPAGHETTI_POWER_RAIL_UNSPECIFIED);

		if (err < 0) {
			return err;
		}
	}

	return 0;
}

static const struct spaghetti_discovery_provider_ops fake_w1_ops = {
	.scan = fake_w1_scan,
};

SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(fake_w1_provider) = {
	.provider_id = "test.w1",
	.api_version = SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION,
	.method = SPAGHETTI_DISCOVERY_METHOD_W1_ROM,
	.confidence = SPAGHETTI_DISCOVERY_AUTHORITATIVE,
	.probe_flags = SPAGHETTI_DISCOVERY_PROBE_READ_ONLY,
	.required_capabilities = SPAGHETTI_PORT_CAP_W1,
	.ops = &fake_w1_ops,
};

static int fake_timeout_scan(const struct spaghetti_port *port,
			     spaghetti_discovery_emit_candidate_cb_t emit,
			     void *emit_user_data, k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(emit);
	ARG_UNUSED(emit_user_data);
	ARG_UNUSED(timeout);

	if (!harness.timeout_enabled) {
		return 0;
	}

	return -ETIMEDOUT;
}

static const struct spaghetti_discovery_provider_ops fake_timeout_ops = {
	.scan = fake_timeout_scan,
};

SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(fake_timeout_provider) = {
	.provider_id = "test.timeout",
	.api_version = SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION,
	.method = SPAGHETTI_DISCOVERY_METHOD_CUSTOM,
	.confidence = SPAGHETTI_DISCOVERY_HEURISTIC,
	.probe_flags = SPAGHETTI_DISCOVERY_PROBE_READ_ONLY,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.ops = &fake_timeout_ops,
};

static int fake_invasive_scan(const struct spaghetti_port *port,
			      spaghetti_discovery_emit_candidate_cb_t emit,
			      void *emit_user_data, k_timeout_t timeout)
{
	uint8_t identity[1] = {0xAAU};

	ARG_UNUSED(port);
	ARG_UNUSED(timeout);

	harness.invasive_ran = true;
	if (!harness.invasive_enabled) {
		return 0;
	}

	return emit_basic(emit, emit_user_data, identity, 1U, "invasive", NULL,
			  SPAGHETTI_BAY_ID_UNSPECIFIED,
			  SPAGHETTI_POWER_RAIL_UNSPECIFIED);
}

static const struct spaghetti_discovery_provider_ops fake_invasive_ops = {
	.scan = fake_invasive_scan,
};

SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(fake_invasive_provider) = {
	.provider_id = "test.invasive",
	.api_version = SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION,
	.method = SPAGHETTI_DISCOVERY_METHOD_CUSTOM,
	.confidence = SPAGHETTI_DISCOVERY_HEURISTIC,
	.probe_flags = SPAGHETTI_DISCOVERY_PROBE_MAY_CHANGE_STATE,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.ops = &fake_invasive_ops,
};

static int fake_flood_scan(const struct spaghetti_port *port,
			   spaghetti_discovery_emit_candidate_cb_t emit,
			   void *emit_user_data, k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(timeout);

	if (harness.duplicate_emit_enabled) {
		uint8_t identity[1] = {0x42U};
		int err = emit_basic(emit, emit_user_data, identity, 1U, "dup",
				     NULL, SPAGHETTI_BAY_ID_UNSPECIFIED,
				     SPAGHETTI_POWER_RAIL_UNSPECIFIED);

		if (err < 0) {
			return err;
		}
		return emit_basic(emit, emit_user_data, identity, 1U, "dup",
				  NULL, SPAGHETTI_BAY_ID_UNSPECIFIED,
				  SPAGHETTI_POWER_RAIL_UNSPECIFIED);
	}

	if (!harness.flood_enabled) {
		return 0;
	}

	for (size_t idx = 0U; idx < harness.flood_count; ++idx) {
		uint8_t identity[1] = {(uint8_t)(idx + 1U)};
		char type_id[] = "flood";
		int err = emit_basic(emit, emit_user_data, identity, 1U, type_id,
				     NULL, SPAGHETTI_BAY_ID_UNSPECIFIED,
				     SPAGHETTI_POWER_RAIL_UNSPECIFIED);

		if (err < 0) {
			return err;
		}
	}

	return 0;
}

static const struct spaghetti_discovery_provider_ops fake_flood_ops = {
	.scan = fake_flood_scan,
};

SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(fake_flood_provider) = {
	.provider_id = "test.flood",
	.api_version = SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION,
	.method = SPAGHETTI_DISCOVERY_METHOD_CUSTOM,
	.confidence = SPAGHETTI_DISCOVERY_HEURISTIC,
	.probe_flags = SPAGHETTI_DISCOVERY_PROBE_READ_ONLY,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.ops = &fake_flood_ops,
};
