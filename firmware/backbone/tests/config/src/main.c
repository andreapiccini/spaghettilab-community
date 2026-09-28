#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/config.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/port.h>
#include <spaghetti/processing.h>
#include <spaghetti/rule_driver.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/runtime.h>
#include <spaghetti/schema.h>
#include <spaghetti/service.h>
#include <spaghetti/topology.h>

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
};

enum {
	FAKE_CONFIG_ADDRESS = 1,
	FAKE_RULE_FIELD = 1,
};

static const struct spaghetti_field_descriptor fake_config_fields[] = {
	{
		.field_id = FAKE_CONFIG_ADDRESS,
		.type = SPAGHETTI_VALUE_UINT64,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_minimum = 0U,
		.unsigned_maximum = 0x7FU,
		.name = "address",
		.description = "I2C address",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor fake_config_schema = {
	.schema_id = "spaghetti.fake.config",
	.version = 1U,
	.fields = fake_config_fields,
	.field_count = ARRAY_SIZE(fake_config_fields),
};

static const struct spaghetti_schema_descriptor fake_record_schema = {
	.schema_id = "spaghetti.fake.sample",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static const struct spaghetti_schema_descriptor *const fake_record_schemas[] = {
	&fake_record_schema,
};

static const struct spaghetti_field_descriptor fake_rule_fields[] = {
	{
		.field_id = FAKE_RULE_FIELD,
		.type = SPAGHETTI_VALUE_BOOL,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.name = "enabled",
		.description = "Rule enabled",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor fake_rule_schema = {
	.schema_id = "spaghetti.fake.rule",
	.version = 1U,
	.fields = fake_rule_fields,
	.field_count = ARRAY_SIZE(fake_rule_fields),
};

struct fake_driver_context {
	bool used;
	uint8_t address;
};

static struct fake_driver_context fake_contexts[CONFIG_SPAGHETTI_MAX_MODULES];
static struct spaghetti_runtime_schedule_config fake_runtime_schedules[SPAGHETTI_CONFIG_MAX_SCHEDULES];
static size_t fake_runtime_schedule_count;
static size_t fake_runtime_rule_count;
static bool fake_runtime_running;
static uint32_t fake_storage_write_count;
static struct spaghetti_config fake_stored_config;
static int fake_storage_error;
static enum spaghetti_connectivity_policy fake_connectivity_policy =
	SPAGHETTI_CONNECTIVITY_ONLINE;
static struct spaghetti_mqtt_config fake_mqtt_config;
static enum spaghetti_service_state fake_service_state =
	SPAGHETTI_SERVICE_STOPPED;

static const struct spaghetti_port fake_port = {
	.id = 0U,
	.capabilities = SPAGHETTI_PORT_CAP_I2C,
};

static const struct spaghetti_flow_descriptor fake_flow = {
	.id = 0U,
	.port_id = 0U,
	.direction = SPAGHETTI_FLOW_BIDIRECTIONAL,
	.signal_count = SPAGHETTI_FLOW_SIGNAL_COUNT,
	.function_bay_count = 2U,
};

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t port_id)
{
	return (port_id == fake_port.id) ? &fake_port : NULL;
}

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				   uint32_t capabilities)
{
	return (port != NULL) &&
	       ((port->capabilities & capabilities) == capabilities);
}

int spaghetti_port_acquire(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner,
	enum spaghetti_port_transport transport)
{
	ARG_UNUSED(transport);
	return ((port != NULL) && (owner != 0U)) ? 0 : -EINVAL;
}

int spaghetti_port_release(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner)
{
	return ((port != NULL) && (owner != 0U)) ? 0 : -EINVAL;
}

const struct spaghetti_flow_descriptor *spaghetti_topology_flow_for_port(
	spaghetti_port_id_t port_id)
{
	return (port_id == fake_flow.port_id) ? &fake_flow : NULL;
}

int spaghetti_topology_bay_get(spaghetti_flow_id_t flow_id,
			       spaghetti_bay_id_t bay_id,
			       struct spaghetti_bay_descriptor *out)
{
	if ((out == NULL) || (flow_id != fake_flow.id) || (bay_id > 1U)) {
		return -ENOENT;
	}
	*out = (struct spaghetti_bay_descriptor){
		.flow_id = flow_id,
		.id = bay_id,
		.ordinal_from_field = bay_id,
	};
	return 0;
}

int spaghetti_storage_write_config(const struct spaghetti_config *config)
{
	if (fake_storage_error < 0) {
		return fake_storage_error;
	}
	if (config == NULL) {
		return -EINVAL;
	}
	fake_stored_config = *config;
	++fake_storage_write_count;
	return 0;
}

int spaghetti_runtime_configure(
	const struct spaghetti_runtime_schedule_config *schedules,
	size_t schedule_count,
	const struct spaghetti_rule_config *rules,
	size_t rule_count)
{
	if (((schedules == NULL) && (schedule_count > 0U)) ||
	    ((rules == NULL) && (rule_count > 0U)) ||
	    (schedule_count > SPAGHETTI_CONFIG_MAX_SCHEDULES) ||
	    (rule_count > SPAGHETTI_CONFIG_MAX_RULES)) {
		return -EINVAL;
	}
	if (fake_runtime_running) {
		return -EBUSY;
	}
	fake_runtime_schedule_count = schedule_count;
	fake_runtime_rule_count = rule_count;
	if (schedule_count > 0U) {
		memcpy(fake_runtime_schedules, schedules,
		       schedule_count * sizeof(schedules[0]));
	}
	return 0;
}

int spaghetti_processing_configure(
	const struct spaghetti_block_config *blocks,
	size_t block_count,
	const struct spaghetti_edge_config *edges,
	size_t edge_count)
{
	if (((blocks == NULL) && (block_count > 0U)) ||
	    ((edges == NULL) && (edge_count > 0U)) ||
	    (block_count > SPAGHETTI_CONFIG_MAX_BLOCKS) ||
	    (edge_count > SPAGHETTI_CONFIG_MAX_EDGES)) {
		return -EINVAL;
	}
	return 0;
}

int spaghetti_processing_validate_graph(
	const struct spaghetti_block_config *blocks,
	size_t block_count,
	const struct spaghetti_edge_config *edges,
	size_t edge_count,
	const struct spaghetti_module_config *modules,
	size_t module_count)
{
	ARG_UNUSED(modules);
	ARG_UNUSED(module_count);
	if (((blocks == NULL) && (block_count > 0U)) ||
	    ((edges == NULL) && (edge_count > 0U)) ||
	    (block_count > SPAGHETTI_CONFIG_MAX_BLOCKS) ||
	    (edge_count > SPAGHETTI_CONFIG_MAX_EDGES)) {
		return -EINVAL;
	}
	return 0;
}

int spaghetti_runtime_start(void)
{
	if (fake_runtime_running) {
		return -EALREADY;
	}
	if ((fake_runtime_schedule_count == 0U) &&
	    (fake_runtime_rule_count == 0U)) {
		return -ENOENT;
	}
	fake_runtime_running = true;
	return 0;
}

int spaghetti_runtime_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	if (!fake_runtime_running) {
		return -EALREADY;
	}
	fake_runtime_running = false;
	return 0;
}

int spaghetti_mqtt_init(const struct spaghetti_mqtt_config *config)
{
	if (config == NULL) {
		return -EINVAL;
	}
	fake_mqtt_config = *config;
	return 0;
}

int spaghetti_service_get_state(const char *id,
				enum spaghetti_service_state *out)
{
	ARG_UNUSED(id);
	if (out == NULL) {
		return -EINVAL;
	}
	*out = fake_service_state;
	return 0;
}

int spaghetti_service_stop(const char *id, k_timeout_t timeout)
{
	ARG_UNUSED(id);
	ARG_UNUSED(timeout);
	fake_service_state = SPAGHETTI_SERVICE_STOPPED;
	return 0;
}

int spaghetti_service_start(const char *id)
{
	ARG_UNUSED(id);
	fake_service_state = SPAGHETTI_SERVICE_RUNNING;
	return 0;
}

int spaghetti_connectivity_set_policy(enum spaghetti_connectivity_policy policy)
{
	if ((policy != SPAGHETTI_CONNECTIVITY_LOW_ENERGY) &&
	    (policy != SPAGHETTI_CONNECTIVITY_ONLINE)) {
		return -EINVAL;
	}
	fake_connectivity_policy = policy;
	return 0;
}

static int fake_validate_config(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &fake_config_schema);
}

static int fake_describe_endpoint(const struct spaghetti_property_set *config,
				  struct spaghetti_module_endpoint *out)
{
	const struct spaghetti_value *address;

	if (out == NULL) {
		return -EINVAL;
	}
	address = spaghetti_property_find(config, FAKE_CONFIG_ADDRESS);
	if ((address == NULL) || (address->type != SPAGHETTI_VALUE_UINT64)) {
		return -EINVAL;
	}
	*out = (struct spaghetti_module_endpoint){
		.kind = SPAGHETTI_ENDPOINT_I2C_ADDRESS,
		.value_size = 1U,
		.value = {(uint8_t)address->data.unsigned_integer},
	};
	return 0;
}

static int fake_init(struct spaghetti_module *module,
		     const struct spaghetti_property_set *config)
{
	const struct spaghetti_value *address =
		spaghetti_property_find(config, FAKE_CONFIG_ADDRESS);

	if ((module == NULL) || (module->context != NULL) || (address == NULL)) {
		return -EINVAL;
	}
	for (size_t idx = 0U; idx < ARRAY_SIZE(fake_contexts); ++idx) {
		if (!fake_contexts[idx].used) {
			fake_contexts[idx].used = true;
			fake_contexts[idx].address =
				(uint8_t)address->data.unsigned_integer;
			module->context = &fake_contexts[idx];
			return 0;
		}
	}
	return -ENOMEM;
}

static int fake_read(struct spaghetti_module *module,
		     struct spaghetti_record_payload *out)
{
	ARG_UNUSED(module);
	ARG_UNUSED(out);
	return 0;
}

static int fake_deinit(struct spaghetti_module *module)
{
	struct fake_driver_context *context;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}
	context = module->context;
	context->used = false;
	module->context = NULL;
	return 0;
}

static const struct spaghetti_module_driver_ops fake_ops = {
	.validate_config = fake_validate_config,
	.describe_endpoint = fake_describe_endpoint,
	.init = fake_init,
	.read = fake_read,
	.deinit = fake_deinit,
};

static const struct spaghetti_module_driver fake_driver = {
	.type_id = "fake",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.config_schema = &fake_config_schema,
	.record_schemas = fake_record_schemas,
	.record_schema_count = ARRAY_SIZE(fake_record_schemas),
	.ops = &fake_ops,
};

static int fake_rule_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &fake_rule_schema);
}

static int fake_rule_init(const struct spaghetti_property_set *config,
			  void **out_context)
{
	ARG_UNUSED(config);
	static int context;

	*out_context = &context;
	return 0;
}

static int fake_rule_on_record(void *context,
			       const struct spaghetti_record *record,
			       spaghetti_rule_emit_action_cb_t emit,
			       void *emit_user_data)
{
	ARG_UNUSED(context);
	ARG_UNUSED(record);
	ARG_UNUSED(emit);
	ARG_UNUSED(emit_user_data);
	return 0;
}

static int fake_rule_deinit(void *context)
{
	ARG_UNUSED(context);
	return 0;
}

static const struct spaghetti_rule_driver_ops fake_rule_ops = {
	.validate_config = fake_rule_validate,
	.init = fake_rule_init,
	.on_record = fake_rule_on_record,
	.deinit = fake_rule_deinit,
};

SPAGHETTI_RULE_DRIVER_DEFINE(spaghetti_fake_rule_driver) = {
	.type_id = "fake-rule",
	.api_version = SPAGHETTI_RULE_DRIVER_API_VERSION,
	.config_schema = &fake_rule_schema,
	.ops = &fake_rule_ops,
};

const struct spaghetti_module_driver *spaghetti_driver_registry_find(
	const char *type_id)
{
	if ((type_id != NULL) && (strcmp(type_id, "fake") == 0)) {
		return &fake_driver;
	}
	return NULL;
}

static void fill_module(struct spaghetti_module_config *module,
			spaghetti_module_key_t key, uint8_t address)
{
	memset(module, 0, sizeof(*module));
	module->key = key;
	module->port_id = 0U;
	module->bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	module->power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	memcpy(module->type_id, "fake", sizeof("fake"));
	module->properties.field_count = 1U;
	module->properties.fields[0].field_id = FAKE_CONFIG_ADDRESS;
	module->properties.fields[0].type = SPAGHETTI_VALUE_UINT64;
	module->properties.fields[0].data.unsigned_integer = address;
}

static struct spaghetti_config make_config(uint8_t first_address,
					   uint8_t second_address)
{
	struct spaghetti_config config = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.module_count = 2U,
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
	};

	fill_module(&config.modules[0], 10U, first_address);
	fill_module(&config.modules[1], 11U, second_address);
	return config;
}

static void *config_setup(void)
{
	zassert_ok(spaghetti_module_manager_init());
	return NULL;
}

ZTEST(config, test_transaction_snapshot_cas_and_rules)
{
	struct spaghetti_config snapshot;
	struct spaghetti_config_revision revision;
	struct spaghetti_config_revision revision_b;
	struct spaghetti_config_commit_result result;
	struct spaghetti_config_failure failure;
	const struct spaghetti_config defaults = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_OFF,
		},
	};
	struct spaghetti_config baseline = make_config(0x40U, 0x41U);
	struct spaghetti_config candidate;
	struct spaghetti_config second = make_config(0x42U, 0x43U);
	uint32_t writes_before;

	zassert_equal(spaghetti_config_get_snapshot(&snapshot, &revision),
		      -EACCES);
	zassert_ok(spaghetti_config_init(&defaults));
	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	zassert_equal(revision.generation, 1U);

	zassert_ok(spaghetti_config_validate(&baseline, NULL));
	zassert_equal(spaghetti_config_apply(&baseline, 99U, NULL), -ESTALE);

	writes_before = fake_storage_write_count;
	zassert_ok(spaghetti_config_apply(&baseline, revision.generation,
					  &result));
	zassert_true(result.changed);
	zassert_equal(result.revision.generation, 2U);
	zassert_equal(fake_storage_write_count, writes_before + 1U);

	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	revision_b = revision;
	writes_before = fake_storage_write_count;
	zassert_ok(spaghetti_config_apply(&snapshot, revision.generation,
					  &result));
	zassert_false(result.changed);
	zassert_equal(result.revision.generation, revision.generation);
	zassert_equal(fake_storage_write_count, writes_before);

	candidate = baseline;
	fill_module(&candidate.modules[1], 10U, 0x42U);
	zassert_equal(spaghetti_config_validate(&candidate, &failure), -EEXIST);

	candidate = baseline;
	fill_module(&candidate.modules[1], 12U, 0x40U);
	zassert_equal(spaghetti_config_validate(&candidate, NULL), -EADDRINUSE);

	candidate = baseline;
	candidate.rule_count = 1U;
	candidate.rules[0].key = 1U;
	memcpy(candidate.rules[0].type_id, "fake-rule", sizeof("fake-rule"));
	candidate.rules[0].properties.field_count = 1U;
	candidate.rules[0].properties.fields[0].field_id = FAKE_RULE_FIELD;
	candidate.rules[0].properties.fields[0].type = SPAGHETTI_VALUE_BOOL;
	candidate.rules[0].properties.fields[0].data.boolean = true;
	zassert_ok(spaghetti_config_validate(&candidate, NULL));
	zassert_ok(spaghetti_config_apply(&candidate, revision.generation,
					  &result));
	zassert_true(result.changed);
	zassert_equal(fake_runtime_rule_count, 1U);

	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	revision_b = revision;
	zassert_ok(spaghetti_config_apply(&second, revision_b.generation, NULL));
	zassert_equal(spaghetti_config_apply(&baseline, revision_b.generation,
					     NULL),
		      -ESTALE);
	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	zassert_ok(spaghetti_config_apply(&baseline, revision.generation, NULL));

	fake_storage_error = -ENOSPC;
	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	candidate = baseline;
	candidate.schedules[0].period_ms = 2000U;
	zassert_equal(spaghetti_config_apply(&candidate, revision.generation,
					     NULL),
		      -ENOSPC);
	zassert_ok(spaghetti_config_get_snapshot(&snapshot, &revision));
	zassert_equal(snapshot.schedules[0].period_ms, 1000U);
}

ZTEST(config, test_radio_mutex_rejects_inconsistent_policies)
{
	struct spaghetti_config_failure failure;
	const struct spaghetti_config wifi_and_ble = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_ADVERTISING,
		},
	};
	const struct spaghetti_config ble_and_mqtt = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_LOW_ENERGY,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_ADVERTISING,
		},
		.mqtt = {
			.enabled = true,
			.host = "broker.local",
			.port = 1883U,
			.base_topic = "spaghetti",
			.credential_id = 1U,
		},
	};
	const struct spaghetti_config wifi_only = {
		.version = SPAGHETTI_CONFIG_VERSION,
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_OFF,
		},
	};

	zassert_equal(spaghetti_config_validate(&wifi_and_ble, &failure),
		      -EINVAL);
	zassert_equal(failure.field, SPAGHETTI_CONFIG_FAILURE_ENERGY);
	zassert_equal(spaghetti_config_validate(&ble_and_mqtt, &failure),
		      -EINVAL);
	zassert_equal(failure.field, SPAGHETTI_CONFIG_FAILURE_MQTT);
	zassert_ok(spaghetti_config_validate(&wifi_only, NULL));
}

ZTEST_SUITE(config, NULL, config_setup, NULL, NULL, NULL);
