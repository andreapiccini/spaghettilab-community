#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/driver_registry.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/schema.h>
#include <spaghetti/topology.h>

enum {
	FAKE_CONFIG_ADDRESS = 1U,
	FAKE_CONFIG_INIT_ERROR = 2U,
	FAKE_FIELD_BUS = 1U,
	FAKE_COMMAND_SET = 1U,
	FAKE_COMMAND_FIELD_ON = 1U,
};

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
};

struct fake_driver_context {
	bool used;
	uint8_t i2c_address;
	bool output_on;
};

static const struct spaghetti_port fake_port = {
	.id = 0U,
	.capabilities = SPAGHETTI_PORT_CAP_I2C,
};

static struct fake_driver_context fake_contexts[CONFIG_SPAGHETTI_MAX_MODULES];

static const struct spaghetti_field_descriptor fake_config_fields[] = {
	{
		.field_id = FAKE_CONFIG_ADDRESS,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0U,
		.unsigned_maximum = 0x7FU,
		.name = "address",
		.description = "Fake I2C address",
		.unit = "",
	},
	{
		.field_id = FAKE_CONFIG_INIT_ERROR,
		.type = SPAGHETTI_VALUE_INT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_WRITABLE,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "init_error",
		.description = "Optional init failure injection",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor fake_config_schema = {
	.schema_id = "spaghetti.fake.config",
	.version = 1U,
	.fields = fake_config_fields,
	.field_count = ARRAY_SIZE(fake_config_fields),
};

static const struct spaghetti_field_descriptor fake_sample_fields[] = {
	{
		.field_id = FAKE_FIELD_BUS,
		.type = SPAGHETTI_VALUE_INT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "bus",
		.description = "Fake bus measurement",
		.unit = "uV",
	},
};

static const struct spaghetti_schema_descriptor fake_sample_schema = {
	.schema_id = "spaghetti.fake.sample",
	.version = 1U,
	.fields = fake_sample_fields,
	.field_count = ARRAY_SIZE(fake_sample_fields),
};

static const struct spaghetti_schema_descriptor *const fake_record_schemas[] = {
	&fake_sample_schema,
};

static const struct spaghetti_field_descriptor fake_set_fields[] = {
	{
		.field_id = FAKE_COMMAND_FIELD_ON,
		.type = SPAGHETTI_VALUE_BOOL,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.name = "on",
		.description = "Desired output state",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor fake_set_schema = {
	.schema_id = "spaghetti.fake.set",
	.version = 1U,
	.fields = fake_set_fields,
	.field_count = ARRAY_SIZE(fake_set_fields),
};

static const struct spaghetti_command_descriptor fake_commands[] = {
	{
		.command_id = FAKE_COMMAND_SET,
		.name = "set",
		.argument_schema = &fake_set_schema,
	},
};

static int fake_validate_config(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &fake_config_schema);
}

static int fake_describe_endpoint(const struct spaghetti_property_set *config,
				  struct spaghetti_module_endpoint *out)
{
	const struct spaghetti_value *address;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = fake_validate_config(config);
	if (err < 0) {
		return err;
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

static int fake_describe_exclusive_endpoint(
	const struct spaghetti_property_set *config,
	struct spaghetti_module_endpoint *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = fake_validate_config(config);
	if (err < 0) {
		return err;
	}

	*out = (struct spaghetti_module_endpoint){
		.kind = SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE,
		.value_size = 0U,
	};
	return 0;
}

static int fake_init(struct spaghetti_module *module,
		     const struct spaghetti_property_set *config)
{
	const struct spaghetti_value *address;
	const struct spaghetti_value *init_error;
	int err = fake_validate_config(config);

	if ((err < 0) || (module == NULL) || (module->context != NULL)) {
		return (err < 0) ? err : -EINVAL;
	}

	init_error = spaghetti_property_find(config, FAKE_CONFIG_INIT_ERROR);
	if ((init_error != NULL) &&
	    (init_error->type == SPAGHETTI_VALUE_INT64) &&
	    (init_error->data.signed_integer < 0)) {
		return (int)init_error->data.signed_integer;
	}

	address = spaghetti_property_find(config, FAKE_CONFIG_ADDRESS);
	if ((address == NULL) || (address->type != SPAGHETTI_VALUE_UINT64)) {
		return -EINVAL;
	}

	for (size_t context_idx = 0U; context_idx < ARRAY_SIZE(fake_contexts);
	     ++context_idx) {
		if (!fake_contexts[context_idx].used) {
			fake_contexts[context_idx].used = true;
			fake_contexts[context_idx].i2c_address =
				(uint8_t)address->data.unsigned_integer;
			module->context = &fake_contexts[context_idx];
			return 0;
		}
	}

	return -ENOMEM;
}

static int fake_read(struct spaghetti_module *module,
		     struct spaghetti_record_payload *out)
{
	const struct fake_driver_context *context;

	if ((module == NULL) || (out == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	memset(out, 0, sizeof(*out));
	out->kind = SPAGHETTI_RECORD_SAMPLE;
	out->schema_version = 1U;
	strncpy(out->schema_id, fake_sample_schema.schema_id,
		sizeof(out->schema_id) - 1U);
	out->values.field_count = 1U;
	out->values.fields[0] = (struct spaghetti_value){
		.field_id = FAKE_FIELD_BUS,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = (int64_t)context->i2c_address * 1000,
	};
	return 0;
}

static int fake_command(struct spaghetti_module *module,
			const struct spaghetti_module_command *command)
{
	struct fake_driver_context *context;
	const struct spaghetti_value *on_field;

	if ((module == NULL) || (command == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}
	if (command->command_id != FAKE_COMMAND_SET) {
		return -ENOTSUP;
	}

	on_field = spaghetti_property_find(&command->arguments,
					   FAKE_COMMAND_FIELD_ON);
	if ((on_field == NULL) || (on_field->type != SPAGHETTI_VALUE_BOOL)) {
		return -EINVAL;
	}

	context = module->context;
	context->output_on = on_field->data.boolean;
	return 0;
}

static int fake_deinit(struct spaghetti_module *module)
{
	struct fake_driver_context *context;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	memset(context, 0, sizeof(*context));
	module->context = NULL;
	return 0;
}

static const struct spaghetti_module_driver_ops fake_ops = {
	.validate_config = fake_validate_config,
	.describe_endpoint = fake_describe_endpoint,
	.init = fake_init,
	.read = fake_read,
	.command = fake_command,
	.deinit = fake_deinit,
};

static const struct spaghetti_module_driver fake_driver = {
	.type_id = "fake",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.power_requirement = { .declared = false },
	.config_schema = &fake_config_schema,
	.record_schemas = fake_record_schemas,
	.record_schema_count = ARRAY_SIZE(fake_record_schemas),
	.commands = fake_commands,
	.command_count = ARRAY_SIZE(fake_commands),
	.ops = &fake_ops,
};

static const struct spaghetti_module_driver_ops fake_exclusive_ops = {
	.validate_config = fake_validate_config,
	.describe_endpoint = fake_describe_exclusive_endpoint,
	.init = fake_init,
	.read = fake_read,
	.command = fake_command,
	.deinit = fake_deinit,
};

static const struct spaghetti_module_driver fake_exclusive_driver = {
	.type_id = "fake-exclusive",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.power_requirement = { .declared = false },
	.config_schema = &fake_config_schema,
	.record_schemas = fake_record_schemas,
	.record_schema_count = ARRAY_SIZE(fake_record_schemas),
	.commands = fake_commands,
	.command_count = ARRAY_SIZE(fake_commands),
	.ops = &fake_exclusive_ops,
};

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	return (id == fake_port.id) ? &fake_port : NULL;
}

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				   uint32_t capabilities)
{
	return (port != NULL) && (capabilities != 0U) &&
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
	ARG_UNUSED(port_id);
	return NULL;
}

int spaghetti_topology_bay_get(
	spaghetti_flow_id_t flow_id,
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
	if ((type_id != NULL) && (strcmp(type_id, fake_driver.type_id) == 0)) {
		return &fake_driver;
	}
	if ((type_id != NULL) &&
	    (strcmp(type_id, fake_exclusive_driver.type_id) == 0)) {
		return &fake_exclusive_driver;
	}

	return NULL;
}

static void fill_fake_config(struct spaghetti_property_set *out,
			     uint8_t i2c_address, int init_error)
{
	memset(out, 0, sizeof(*out));
	out->field_count = (init_error != 0) ? 2U : 1U;
	out->fields[0] = (struct spaghetti_value){
		.field_id = FAKE_CONFIG_ADDRESS,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = i2c_address,
	};
	if (init_error != 0) {
		out->fields[1] = (struct spaghetti_value){
			.field_id = FAKE_CONFIG_INIT_ERROR,
			.type = SPAGHETTI_VALUE_INT64,
			.data.signed_integer = init_error,
		};
	}
}

static int configure_fake(spaghetti_module_key_t key, uint8_t i2c_address,
			  int init_error, spaghetti_module_id_t *out_id)
{
	struct spaghetti_property_set config;
	struct spaghetti_module_request request;

	fill_fake_config(&config, i2c_address, init_error);
	memset(&request, 0, sizeof(request));
	request.key = key;
	request.port_id = 0U;
	request.type_id = "fake";
	request.config = &config;
	request.placement.bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	request.placement.power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	request.revision = 1U;

	return spaghetti_module_manager_configure(&request, out_id);
}

static int configure_fake_exclusive(spaghetti_module_key_t key,
				    spaghetti_module_id_t *out_id)
{
	struct spaghetti_property_set config;
	struct spaghetti_module_request request;

	fill_fake_config(&config, 0U, 0);
	memset(&request, 0, sizeof(request));
	request.key = key;
	request.port_id = 0U;
	request.type_id = "fake-exclusive";
	request.config = &config;
	request.placement.bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	request.placement.power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	request.revision = 1U;

	return spaghetti_module_manager_configure(&request, out_id);
}

ZTEST(module_manager, test_shared_port_lifecycle)
{
	struct spaghetti_module_snapshot snapshots[CONFIG_SPAGHETTI_MAX_MODULES];
	struct spaghetti_module_snapshot snapshot;
	struct spaghetti_record record;
	struct spaghetti_module_command relay_on = {
		.command_id = FAKE_COMMAND_SET,
		.arguments = {
			.field_count = 1U,
			.fields = {
				{
					.field_id = FAKE_COMMAND_FIELD_ON,
					.type = SPAGHETTI_VALUE_BOOL,
					.data.boolean = true,
				},
			},
		},
	};
	const struct spaghetti_value *bus;
	spaghetti_module_id_t id_10;
	spaghetti_module_id_t id_11;
	spaghetti_module_id_t id_12;
	spaghetti_module_id_t id_13;
	spaghetti_module_id_t filler_ids[CONFIG_SPAGHETTI_MAX_MODULES];
	spaghetti_module_id_t ignored_id = UINT8_MAX;
	size_t filler_count = 0U;
	size_t module_count;
	int err;

	zassert_ok(spaghetti_module_manager_init());
	zassert_ok(configure_fake(10U, 0x40U, 0, &id_10));
	zassert_ok(configure_fake(11U, 0x41U, 0, &id_11));
	zassert_ok(configure_fake(12U, 0x44U, 0, &id_12));

	zassert_ok(spaghetti_module_manager_list_by_port(0U, NULL, 0U, &module_count));
	zassert_equal(module_count, 3U);
	zassert_ok(spaghetti_module_manager_list_by_port(
		0U, snapshots, ARRAY_SIZE(snapshots), &module_count));
	zassert_equal(module_count, 3U);
	zassert_equal(snapshots[0].key, 10U);
	zassert_equal(snapshots[1].key, 11U);
	zassert_equal(snapshots[2].key, 12U);
	zassert_ok(spaghetti_module_manager_get_by_id(id_11, &snapshot));
	zassert_equal(snapshot.key, 11U);
	zassert_equal(snapshot.endpoint.value_size, 1U);
	zassert_equal(snapshot.endpoint.value[0], 0x41U);
	zassert_equal(snapshot.power_admission,
		      SPAGHETTI_POWER_ADMISSION_NOT_REQUIRED);

	snapshot.key = 99U;
	err = spaghetti_module_manager_list_by_port(0U, &snapshot, 1U, &module_count);
	zassert_equal(err, -ENOSPC);
	zassert_equal(module_count, 3U);
	zassert_equal(snapshot.key, 99U);

	zassert_equal(configure_fake(10U, 0x42U, 0, &ignored_id), -EEXIST);
	zassert_equal(configure_fake(13U, 0x40U, 0, &ignored_id), -EADDRINUSE);
	zassert_equal(configure_fake_exclusive(20U, &ignored_id), -EADDRINUSE);
	zassert_equal(configure_fake(13U, 0x42U, -EIO, &ignored_id), -EIO);
	zassert_equal(spaghetti_module_manager_get_by_key(13U, &snapshot), -ENOENT);

	zassert_ok(configure_fake(13U, 0x42U, 0, &id_13));
	for (size_t slot_idx = 4U; slot_idx < CONFIG_SPAGHETTI_MAX_MODULES;
	     slot_idx++) {
		zassert_ok(configure_fake((uint16_t)(10U + slot_idx),
					  (uint8_t)(0x50U + slot_idx), 0,
					  &filler_ids[filler_count]));
		filler_count++;
	}
	zassert_equal(configure_fake(100U, 0x70U, 0, &ignored_id), -ENOSPC);
	for (size_t filler_idx = 0U; filler_idx < filler_count; filler_idx++) {
		zassert_ok(spaghetti_module_manager_remove(filler_ids[filler_idx],
							   1U));
	}

	zassert_ok(spaghetti_module_manager_read(id_10, &record));
	bus = spaghetti_property_find(&record.payload.values, FAKE_FIELD_BUS);
	zassert_not_null(bus);
	zassert_equal(bus->type, SPAGHETTI_VALUE_INT64);
	zassert_equal(bus->data.signed_integer, 0x40 * 1000);
	zassert_equal(record.sequence, 1U);
	zassert_equal(spaghetti_module_manager_command(id_10, NULL), -EINVAL);
	zassert_ok(spaghetti_module_manager_command(id_10, &relay_on));
	zassert_true(fake_contexts[id_10].output_on);
	zassert_equal(spaghetti_module_manager_remove(id_10, 2U), -ESTALE);
	zassert_ok(spaghetti_module_manager_remove(id_11, 1U));
	zassert_equal(spaghetti_module_manager_get_by_key(11U, &snapshot), -ENOENT);
	zassert_equal(spaghetti_module_manager_read(id_11, &record), -ENOENT);
	zassert_ok(spaghetti_module_manager_get_by_key(10U, &snapshot));
	zassert_equal(snapshot.state, SPAGHETTI_MODULE_READY);
	zassert_ok(spaghetti_module_manager_get_by_key(12U, &snapshot));
	zassert_equal(snapshot.state, SPAGHETTI_MODULE_READY);

	zassert_ok(spaghetti_module_manager_list_by_port(0U, NULL, 0U, &module_count));
	zassert_equal(module_count, 3U);
	zassert_ok(spaghetti_module_manager_remove(id_10, 1U));
	zassert_ok(spaghetti_module_manager_remove(id_12, 1U));
	zassert_ok(spaghetti_module_manager_remove(id_13, 1U));

	zassert_ok(configure_fake_exclusive(20U, &id_10));
	zassert_equal(configure_fake(21U, 0x40U, 0, &ignored_id), -EADDRINUSE);
	zassert_ok(spaghetti_module_manager_remove(id_10, 1U));
}

ZTEST_SUITE(module_manager, NULL, NULL, NULL, NULL, NULL);
