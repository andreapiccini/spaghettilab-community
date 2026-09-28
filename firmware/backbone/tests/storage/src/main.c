#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/settings/settings.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <ina219.h>
#include <relay.h>

#include <spaghetti/config.h>
#include <spaghetti/config_codec.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/storage.h>
#include <spaghetti/topology.h>

#include "storage_legacy_v3.h"

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
};

#define SPAGHETTI_TEST_SETTINGS_CAPACITY 8192U

extern const struct settings_handler_static
	settings_handler_spaghetti_storage;
extern const struct settings_handler_static
	settings_handler_spaghetti_maintenance;

static uint8_t persistent_bytes[SPAGHETTI_TEST_SETTINGS_CAPACITY];
static size_t persistent_size;
static bool persistent_present;
static int fake_read_error;
static int fake_save_error;
static int fake_delete_error;
static uint8_t maintenance_marker;
static bool maintenance_marker_present;
static uint32_t validation_passthrough;

static const struct spaghetti_port fake_port = {
	.id = 0U,
	.capabilities = SPAGHETTI_PORT_CAP_I2C | SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT,
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
	if ((type_id != NULL) && (strcmp(type_id, "relay") == 0)) {
		return &spaghetti_relay_driver;
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
	++validation_passthrough;
	if ((candidate == NULL) ||
	    (candidate->version != SPAGHETTI_CONFIG_VERSION)) {
		return -EINVAL;
	}
	return 0;
}

static ssize_t fake_settings_read(void *cb_arg, void *data, size_t len)
{
	const size_t *available = cb_arg;

	if (fake_read_error < 0) {
		return fake_read_error;
	}
	if (len > *available) {
		return -EINVAL;
	}
	memcpy(data, persistent_bytes, len);
	return (ssize_t)len;
}

int spaghetti_test_settings_subsys_init(void)
{
	return 0;
}

int spaghetti_test_settings_load_subtree(const char *subtree)
{
	if (strcmp(subtree, "maintenance") == 0) {
		if (!maintenance_marker_present) {
			return 0;
		}
		const size_t marker_size = sizeof(maintenance_marker);

		return settings_handler_spaghetti_maintenance.h_set(
			"boot_once", marker_size, fake_settings_read,
			(void *)&marker_size);
	}
	if (strcmp(subtree, SPAGHETTI_STORAGE_CONFIG_KEY) != 0) {
		return -ENOENT;
	}
	if (!persistent_present) {
		return 0;
	}
	return settings_handler_spaghetti_storage.h_set(
		NULL, persistent_size, fake_settings_read, &persistent_size);
}

int spaghetti_test_settings_save_one(const char *name, const void *value,
				     size_t val_len)
{
	if (fake_save_error < 0) {
		return fake_save_error;
	}
	if (strcmp(name, SPAGHETTI_STORAGE_MAINTENANCE_BOOT_ONCE_KEY) == 0) {
		if ((value == NULL) || (val_len != sizeof(maintenance_marker))) {
			return -EINVAL;
		}
		memcpy(&maintenance_marker, value, sizeof(maintenance_marker));
		maintenance_marker_present = true;
		return 0;
	}
	if ((strcmp(name, SPAGHETTI_STORAGE_CONFIG_KEY) != 0) ||
	    (value == NULL) || (val_len > sizeof(persistent_bytes))) {
		return -EINVAL;
	}
	memcpy(persistent_bytes, value, val_len);
	persistent_size = val_len;
	persistent_present = true;
	return 0;
}

int spaghetti_test_settings_delete(const char *name)
{
	if (fake_delete_error < 0) {
		return fake_delete_error;
	}
	if (strcmp(name, SPAGHETTI_STORAGE_MAINTENANCE_BOOT_ONCE_KEY) == 0) {
		maintenance_marker_present = false;
		maintenance_marker = 0U;
		return 0;
	}
	if (strcmp(name, SPAGHETTI_STORAGE_CONFIG_KEY) == 0) {
		if (!persistent_present) {
			return -ENOENT;
		}
		persistent_present = false;
		persistent_size = 0U;
		memset(persistent_bytes, 0, sizeof(persistent_bytes));
		return 0;
	}
	return -ENOENT;
}

static struct spaghetti_config make_config(void)
{
	struct spaghetti_ina219_config ina219 = {
		.i2c_address = 0x40U,
		.shunt_milliohm = 100U,
		.current_lsb_microamp = 200U,
	};
	struct spaghetti_config config = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.module_count = 1U,
		.schedule_count = 1U,
		.schedules = {
			{
				.enabled = true,
				.source_key = 10U,
				.period_ms = 1000U,
			},
		},
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_OFF,
		},
		.mqtt = {
			.enabled = true,
			.host = "broker.local",
			.port = 1883U,
			.base_topic = "spaghetti/test",
		},
	};

	config.modules[0].key = 10U;
	config.modules[0].port_id = 0U;
	config.modules[0].bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	config.modules[0].power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	memcpy(config.modules[0].type_id, "ina219", sizeof("ina219"));
	zassert_ok(spaghetti_ina219_config_to_properties(
		&ina219, &config.modules[0].properties));
	return config;
}

ZTEST(storage, test_v2_round_trip_crc_and_legacy)
{
	struct spaghetti_config unchanged = {
		.version = 99U,
	};
	struct spaghetti_config output = unchanged;
	struct spaghetti_config config = make_config();
	struct spaghetti_storage_legacy_record legacy = {
		.magic = SPAGHETTI_STORAGE_RECORD_MAGIC_V3,
		.version = 3U,
		.config = {
			.version = 3U,
			.module_count = 1U,
			.sampling = {
				.enabled = true,
				.source_key = 10U,
				.period_ms = 1000U,
			},
			.threshold_rule = {
				.enabled = true,
				.source_key = 10U,
				.lower_current_microamps = 1,
				.upper_current_microamps = 2,
				.relay_key = 11U,
				.relay_on_above = true,
			},
			.mqtt = {
				.enabled = true,
				.host = "legacy",
				.port = 1883U,
				.base_topic = "legacy/topic",
			},
		},
	};
	struct spaghetti_ina219_config ina219 = {
		.i2c_address = 0x40U,
		.shunt_milliohm = 100U,
		.current_lsb_microamp = 200U,
	};
	uint8_t valid_record[SPAGHETTI_TEST_SETTINGS_CAPACITY];
	size_t valid_size;

	legacy.config.modules[0].key = 10U;
	legacy.config.modules[0].port_id = 0U;
	memcpy(legacy.config.modules[0].type_id, "ina219", sizeof("ina219"));
	legacy.config.modules[0].driver_config_size = sizeof(ina219);
	memcpy(legacy.config.modules[0].driver_config, &ina219, sizeof(ina219));

	zassert_equal(spaghetti_storage_read_config(&output), -EACCES);
	zassert_ok(spaghetti_storage_init());
	zassert_equal(spaghetti_storage_read_config(&output), -ENOENT);

	zassert_ok(spaghetti_storage_write_config(&config));
	zassert_ok(spaghetti_storage_read_config(&output));
	zassert_equal(output.module_count, 1U);
	zassert_equal(output.schedules[0].period_ms, 1000U);
	zassert_true(output.mqtt.enabled);

	valid_size = persistent_size;
	memcpy(valid_record, persistent_bytes, valid_size);
	persistent_bytes[sizeof(uint32_t) + sizeof(uint16_t) + sizeof(uint16_t)] ^=
		0xFFU;
	zassert_ok(settings_handler_spaghetti_storage.h_set(
		NULL, persistent_size, fake_settings_read, &persistent_size));
	output = unchanged;
	zassert_equal(spaghetti_storage_read_config(&output), -EBADMSG);

	memcpy(persistent_bytes, valid_record, valid_size);
	persistent_size = valid_size;
	zassert_ok(settings_handler_spaghetti_storage.h_set(
		NULL, persistent_size, fake_settings_read, &persistent_size));

	memcpy(persistent_bytes, &legacy, sizeof(legacy));
	persistent_size = sizeof(legacy);
	persistent_present = true;
	zassert_ok(settings_handler_spaghetti_storage.h_set(
		NULL, persistent_size, fake_settings_read, &persistent_size));
	zassert_ok(spaghetti_storage_read_config(&output));
	zassert_equal(output.module_count, 1U);
	zassert_equal(output.schedule_count, 1U);
	zassert_equal(output.rule_count, 1U);
	zassert_equal(strcmp(output.rules[0].type_id, "threshold"), 0);
	zassert_equal(output.rules[0].properties.field_count, 8U);
	zassert_equal(strcmp(output.mqtt.host, "legacy"), 0);

	zassert_ok(spaghetti_storage_write_config(&config));
	zassert_ok(spaghetti_storage_delete_config());
	zassert_equal(spaghetti_storage_read_config(&output), -ENOENT);
	zassert_false(persistent_present);
	zassert_equal(spaghetti_storage_delete_config(), -ENOENT);
}

ZTEST_SUITE(storage, NULL, NULL, NULL, NULL, NULL);
