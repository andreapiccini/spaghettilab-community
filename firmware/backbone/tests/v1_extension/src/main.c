/**
 * @file
 * @brief V1 extension proof: fake plug-ins only under tests/v1_extension/.
 *
 * Does not patch driver_registry/, rule_registry/, config/, data/, runtime/,
 * communication/, or services/mqtt/.
 */

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/block_registry.h>
#include <spaghetti/config.h>
#include <spaghetti/data.h>
#include <spaghetti/device_profile.h>
#include <spaghetti/discovery.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/processing.h>
#include <spaghetti/record_delivery.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/schema.h>
#include <spaghetti/topology.h>

#include "harness.h"
#include "topology_internal.h"

int fake_button_inject_press(void);
uint64_t fake_pwm_last_duty_permille(void);
uint32_t fake_rule_last_actions_emitted(void);

SPAGHETTI_RECORD_CONSUMER_DEFINE(v1_mqtt_fake_consumer) = {
	.id = SPAGHETTI_RECORD_CONSUMER_ID_MQTT,
	.name = "mqtt_fake",
};

SPAGHETTI_RECORD_CONSUMER_DEFINE(v1_ble_fake_consumer) = {
	.id = SPAGHETTI_RECORD_CONSUMER_ID_BLE,
	.name = "ble_fake",
};

static void fill_temp(struct spaghetti_module_config *module,
		      spaghetti_module_key_t key, spaghetti_port_id_t port,
		      uint8_t address, spaghetti_bay_id_t bay,
		      spaghetti_power_rail_id_t rail)
{
	memset(module, 0, sizeof(*module));
	module->key = key;
	module->port_id = port;
	module->bay_id = bay;
	module->power_rail_id = rail;
	memcpy(module->type_id, "fake_temperature", sizeof("fake_temperature"));
	module->properties.field_count = 1U;
	module->properties.fields[0].field_id = 1U;
	module->properties.fields[0].type = SPAGHETTI_VALUE_UINT64;
	module->properties.fields[0].data.unsigned_integer = address;
}

static void fill_pwm(struct spaghetti_module_config *module,
		     spaghetti_module_key_t key, spaghetti_port_id_t port,
		     uint8_t line)
{
	memset(module, 0, sizeof(*module));
	module->key = key;
	module->port_id = port;
	module->bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	module->power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	memcpy(module->type_id, "fake_pwm", sizeof("fake_pwm"));
	module->properties.field_count = 1U;
	module->properties.fields[0].field_id = 1U;
	module->properties.fields[0].type = SPAGHETTI_VALUE_UINT64;
	module->properties.fields[0].data.unsigned_integer = line;
}

static void fill_button(struct spaghetti_module_config *module,
			spaghetti_module_key_t key, spaghetti_port_id_t port,
			uint8_t line)
{
	memset(module, 0, sizeof(*module));
	module->key = key;
	module->port_id = port;
	module->bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	module->power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	memcpy(module->type_id, "fake_button", sizeof("fake_button"));
	module->properties.field_count = 1U;
	module->properties.fields[0].field_id = 1U;
	module->properties.fields[0].type = SPAGHETTI_VALUE_UINT64;
	module->properties.fields[0].data.unsigned_integer = line;
}

static struct spaghetti_config make_platform_config(void)
{
	struct spaghetti_config config = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.module_count = 3U,
		.schedule_count = 2U,
		.rule_count = 1U,
		.block_count = 1U,
		.edge_count = 1U,
		.schedules = {
			{ .enabled = true, .source_key = 10U, .period_ms = 100U },
			{ .enabled = true, .source_key = 11U, .period_ms = 200U },
		},
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_OFF,
		},
	};

	/* Two I2C modules on the same Port; one bay known, one unspecified. */
	fill_temp(&config.modules[0], 10U, 0U, 0x48U, 0U, 0U);
	fill_temp(&config.modules[1], 11U, 0U, 0x49U,
		  SPAGHETTI_BAY_ID_UNSPECIFIED, SPAGHETTI_POWER_RAIL_UNSPECIFIED);
	fill_pwm(&config.modules[2], 20U, 1U, 0U);

	memcpy(config.rules[0].type_id, "fake_rule", sizeof("fake_rule"));
	config.rules[0].key = 30U;
	config.rules[0].properties.field_count = 4U;
	config.rules[0].properties.fields[0] = (struct spaghetti_value){
		.field_id = 1U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 10U,
	};
	config.rules[0].properties.fields[1] = (struct spaghetti_value){
		.field_id = 2U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 1U,
	};
	config.rules[0].properties.fields[2] = (struct spaghetti_value){
		.field_id = 3U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 20U,
	};
	config.rules[0].properties.fields[3] = (struct spaghetti_value){
		.field_id = 4U,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = 20000,
	};

	config.blocks[0].key = 40U;
	memcpy(config.blocks[0].type_id, "fake_processing_block",
	       sizeof("fake_processing_block"));
	config.blocks[0].min_version = 1U;
	config.edges[0] = (struct spaghetti_edge_config){
		.source_key = 10U,
		.source_port_or_field = 1U,
		.target_key = 40U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_MODULE,
	};

	return config;
}

static void *v1_setup(void)
{
	const struct spaghetti_config empty = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_OFF,
		},
	};

	v1_harness_reset();
	v1_port_reset();
	spaghetti_topology_reset();
	zassert_ok(spaghetti_topology_init());
	zassert_ok(spaghetti_power_init());
	zassert_ok(spaghetti_driver_registry_init());
	zassert_ok(spaghetti_rule_registry_init());
	zassert_ok(spaghetti_block_registry_init());
	zassert_ok(spaghetti_device_profile_init());
	zassert_ok(spaghetti_module_manager_init());
	zassert_ok(spaghetti_processing_init());
	zassert_ok(spaghetti_data_init());
	zassert_ok(spaghetti_record_delivery_init(1U));
	zassert_ok(spaghetti_discovery_init());
	zassert_ok(spaghetti_config_init(&empty));
	return NULL;
}

static void v1_before(void *fixture)
{
	struct spaghetti_config empty = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_OFF,
		},
	};
	struct spaghetti_config snapshot;
	struct spaghetti_config_revision revision;
	struct spaghetti_config_commit_result result;

	ARG_UNUSED(fixture);
	v1_harness_reset();
	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	zassert_ok(spaghetti_config_apply(&empty, revision.generation, &result));
	v1_port_reset();
	(void)spaghetti_record_delivery_init(k_uptime_get() + 1);
}

ZTEST(v1_extension, test_plugins_register_without_central_patches)
{
	zassert_not_null(spaghetti_driver_registry_find("fake_temperature"));
	zassert_not_null(spaghetti_driver_registry_find("fake_button"));
	zassert_not_null(spaghetti_driver_registry_find("fake_pwm"));
	zassert_not_null(spaghetti_driver_registry_find("declarative-device"));
	zassert_not_null(spaghetti_rule_registry_find("fake_rule"));
	zassert_not_null(spaghetti_block_registry_find("fake_processing_block"));
	zassert_not_null(spaghetti_device_profile_find("fake-register-a", 1U,
						       NULL));
	zassert_not_null(spaghetti_device_profile_find("fake-register-b", 1U,
						       NULL));
	zassert_true(spaghetti_driver_registry_count() >= 4U);
}

ZTEST(v1_extension, test_two_flows_rails_and_power_admission)
{
	const struct spaghetti_flow_descriptor *flow0;
	const struct spaghetti_flow_descriptor *flow1;
	const struct spaghetti_power_binding controlled = {
		.flow_id = 0U,
		.bay_id = 0U,
		.rail_id = 0U,
	};
	const struct spaghetti_power_binding passive = {
		.flow_id = 0U,
		.bay_id = 1U,
		.rail_id = 1U,
	};
	const struct spaghetti_module_power_requirement need = {
		.declared = true,
		.min_microvolts = 3000000U,
		.max_microvolts = 3600000U,
		.max_microamps = 10000U,
	};
	enum spaghetti_power_admission_state admission;

	zassert_equal(spaghetti_topology_flow_count(), 2U);
	flow0 = spaghetti_topology_flow_get(0U);
	flow1 = spaghetti_topology_flow_get(1U);
	zassert_not_null(flow0);
	zassert_not_null(flow1);
	zassert_equal(flow0->signal_count, SPAGHETTI_FLOW_SIGNAL_COUNT);
	zassert_equal(flow1->signal_count, SPAGHETTI_FLOW_SIGNAL_COUNT);

	zassert_ok(spaghetti_power_validate_binding(&controlled, &need,
						    &admission));
	zassert_equal(admission, SPAGHETTI_POWER_ADMISSION_ENFORCED);

	zassert_ok(spaghetti_power_validate_binding(&passive, &need,
						    &admission));
	zassert_equal(admission, SPAGHETTI_POWER_ADMISSION_UNVERIFIED);
}

ZTEST(v1_extension, test_config_apply_schedules_rule_graph_rollback)
{
	struct spaghetti_config candidate = make_platform_config();
	struct spaghetti_config snapshot;
	struct spaghetti_config_revision revision;
	struct spaghetti_config_commit_result result;
	struct spaghetti_module_snapshot mod;
	struct v1_harness *h = v1_harness_get();
	uint32_t writes_before;

	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	writes_before = h->storage_writes;
	zassert_ok(spaghetti_config_apply(&candidate, revision.generation,
					  &result));
	zassert_true(result.changed);
	zassert_equal(h->storage_writes, writes_before + 1U);
	zassert_equal(h->runtime_schedule_count, 2U);
	zassert_equal(h->runtime_rule_count, 1U);
	zassert_ok(spaghetti_module_manager_get_by_key(10U, &mod));
	zassert_ok(spaghetti_module_manager_get_by_key(11U, &mod));
	zassert_ok(spaghetti_module_manager_get_by_key(20U, &mod));

	/* Identical apply is a no-op (no generation bump / storage write). */
	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	writes_before = h->storage_writes;
	zassert_ok(spaghetti_config_apply(&snapshot, revision.generation,
					  &result));
	zassert_false(result.changed);
	zassert_equal(h->storage_writes, writes_before);

	/* Empty Config rolls back modules. */
	{
		struct spaghetti_config empty = {
			.version = SPAGHETTI_CONFIG_VERSION,
			.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
			.energy_policy = {
				.ble_availability = SPAGHETTI_BLE_OFF,
			},
		};

		zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
		zassert_ok(spaghetti_config_apply(&empty, revision.generation,
						  &result));
		zassert_equal(spaghetti_module_manager_get_by_key(10U, &mod),
			      -ENOENT);
		zassert_equal(spaghetti_module_manager_get_by_key(11U, &mod),
			      -ENOENT);
		zassert_equal(spaghetti_module_manager_get_by_key(20U, &mod),
			      -ENOENT);
	}
}

static int button_capture(const struct spaghetti_record_payload *payload,
			  void *user_data)
{
	int *count = user_data;

	ARG_UNUSED(payload);
	if (count != NULL) {
		++(*count);
	}
	return 0;
}

ZTEST(v1_extension, test_temperature_pwm_data_and_consumers)
{
	struct spaghetti_config candidate = make_platform_config();
	struct spaghetti_config_revision revision;
	struct spaghetti_config_commit_result result;
	struct spaghetti_config snapshot;
	struct spaghetti_module_snapshot mod;
	struct spaghetti_record record;
	struct spaghetti_record_cursor cursor;
	struct spaghetti_module_command command;

	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	zassert_ok(spaghetti_config_apply(&candidate, revision.generation,
					  &result));

	zassert_ok(spaghetti_module_manager_get_by_key(10U, &mod));
	zassert_ok(spaghetti_module_manager_read(mod.id, &record));
	zassert_equal(record.payload.values.fields[0].type,
		      SPAGHETTI_VALUE_INT64);

	zassert_ok(spaghetti_module_manager_get_by_key(20U, &mod));
	memset(&command, 0, sizeof(command));
	command.command_id = 1U;
	command.arguments.field_count = 1U;
	command.arguments.fields[0] = (struct spaghetti_value){
		.field_id = 1U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 250U,
	};
	zassert_ok(spaghetti_module_manager_command(mod.id, &command));
	zassert_equal(fake_pwm_last_duty_permille(), 250U);

	record.boot_id = 1U;
	record.timestamp_ms = 1;
	record.sequence = 1U;
	zassert_ok(spaghetti_record_delivery_set_consumer_active(
		SPAGHETTI_RECORD_CONSUMER_ID_MQTT, true));
	zassert_ok(spaghetti_record_delivery_set_consumer_active(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, true));
	zassert_ok(spaghetti_data_publish(&record, K_NO_WAIT));

	zassert_ok(spaghetti_record_delivery_peek(
		SPAGHETTI_RECORD_CONSUMER_ID_MQTT, &record, &cursor));
	zassert_ok(spaghetti_record_delivery_ack(
		SPAGHETTI_RECORD_CONSUMER_ID_MQTT, &cursor));
	/* BLE cursor is independent — still pending after MQTT ACK. */
	zassert_ok(spaghetti_record_delivery_peek(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, &record, &cursor));
	zassert_equal(record.sequence, 1U);
	zassert_ok(spaghetti_record_delivery_ack(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, &cursor));
}

ZTEST(v1_extension, test_button_event_and_i2c_owners_transport_reject)
{
	struct spaghetti_config config = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.module_count = 2U,
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_OFF,
		},
	};
	struct spaghetti_config_revision revision;
	struct spaghetti_config_commit_result result;
	struct spaghetti_config snapshot;
	struct spaghetti_module_snapshot mod;
	const struct spaghetti_port *port0 = spaghetti_port_get(0U);
	enum spaghetti_port_transport transport;
	size_t owners;
	int events = 0;

	fill_temp(&config.modules[0], 10U, 0U, 0x48U,
		  SPAGHETTI_BAY_ID_UNSPECIFIED, SPAGHETTI_POWER_RAIL_UNSPECIFIED);
	fill_temp(&config.modules[1], 11U, 0U, 0x49U,
		  SPAGHETTI_BAY_ID_UNSPECIFIED, SPAGHETTI_POWER_RAIL_UNSPECIFIED);

	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	zassert_ok(spaghetti_config_apply(&config, revision.generation,
					  &result));
	zassert_ok(spaghetti_port_get_active_transport(port0, &transport,
						       &owners));
	zassert_equal(transport, SPAGHETTI_PORT_TRANSPORT_I2C);
	zassert_equal(owners, 2U);

	/* Incompatible transport while I2C is active must be rejected. */
	zassert_equal(spaghetti_port_acquire(port0, 99U,
					     SPAGHETTI_PORT_TRANSPORT_UART),
		      -EBUSY);

	/* Button on Port 1. */
	{
		struct spaghetti_config button = {
			.version = SPAGHETTI_CONFIG_VERSION,
			.module_count = 1U,
			.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
			.energy_policy = {
				.ble_availability = SPAGHETTI_BLE_OFF,
			},
		};

		fill_button(&button.modules[0], 21U, 1U, 2U);
		zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
		zassert_ok(spaghetti_config_apply(&button, revision.generation,
						  &result));
		zassert_ok(spaghetti_module_manager_get_by_key(21U, &mod));
		zassert_ok(spaghetti_module_manager_start_events(
			mod.id, button_capture, &events));
		zassert_ok(fake_button_inject_press());
		zassert_equal(events, 1);
		zassert_ok(spaghetti_module_manager_stop_events(mod.id));
	}
}

ZTEST(v1_extension, test_discovery_profiles_and_catalog)
{
	struct spaghetti_discovery_scan_policy policy = {
		.allow_read_only = true,
		.allow_state_changing = false,
		.timeout_per_provider = K_MSEC(10),
	};
	struct spaghetti_discovery_candidate listed[8];
	size_t count = 0U;
	bool saw_eeprom = false;
	bool saw_analog = false;
	bool saw_temp = false;
	bool saw_decl = false;

	zassert_ok(spaghetti_discovery_scan_port(0U, &policy));
	zassert_ok(spaghetti_discovery_list(listed, ARRAY_SIZE(listed), &count));
	zassert_true(count >= 2U);
	for (size_t idx = 0U; idx < count; ++idx) {
		if (listed[idx].confidence ==
		    SPAGHETTI_DISCOVERY_AUTHORITATIVE) {
			saw_eeprom = true;
		}
		if (listed[idx].confidence == SPAGHETTI_DISCOVERY_HEURISTIC) {
			saw_analog = true;
		}
	}
	zassert_true(saw_eeprom);
	zassert_true(saw_analog);

	for (size_t idx = 0U; idx < spaghetti_driver_registry_count(); ++idx) {
		const struct spaghetti_module_driver *driver =
			spaghetti_driver_registry_get(idx);

		if (strcmp(driver->type_id, "fake_temperature") == 0) {
			saw_temp = true;
		}
		if (strcmp(driver->type_id, "declarative-device") == 0) {
			saw_decl = true;
		}
	}
	zassert_true(saw_temp);
	zassert_true(saw_decl);
	zassert_not_null(spaghetti_device_profile_find("fake-register-a", 1U,
						       NULL));
	zassert_not_null(spaghetti_device_profile_find("fake-register-b", 1U,
						       NULL));
}

ZTEST_SUITE(v1_extension, NULL, v1_setup, v1_before, NULL, NULL);
