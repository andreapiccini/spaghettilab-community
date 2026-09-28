#include <relay.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/module.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

LOG_MODULE_REGISTER(spaghetti_relay, CONFIG_SPAGHETTI_RELAY_LOG_LEVEL);

struct spaghetti_relay_context {
	struct spaghetti_relay_config config;
	bool logical_on;
	bool initialized;
};

K_MEM_SLAB_DEFINE(relay_context_slab,
		  sizeof(struct spaghetti_relay_context),
		  CONFIG_SPAGHETTI_RELAY_MAX_INSTANCES,
		  __alignof__(struct spaghetti_relay_context));

static const struct spaghetti_field_descriptor relay_config_fields[] = {
	{
		.field_id = SPAGHETTI_RELAY_CONFIG_ACTIVE_HIGH,
		.type = SPAGHETTI_VALUE_BOOL,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.name = "active_high",
		.description = "True when electrical high means logical ON",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_RELAY_CONFIG_SAFE_ON,
		.type = SPAGHETTI_VALUE_BOOL,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.name = "safe_on",
		.description = "Logical state imposed during init and deinit",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor relay_config_schema = {
	.schema_id = "spaghetti.relay.config",
	.version = 1U,
	.fields = relay_config_fields,
	.field_count = ARRAY_SIZE(relay_config_fields),
};

static const struct spaghetti_field_descriptor relay_set_fields[] = {
	{
		.field_id = SPAGHETTI_RELAY_COMMAND_FIELD_ON,
		.type = SPAGHETTI_VALUE_BOOL,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.name = "on",
		.description = "Desired logical relay state",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor relay_set_schema = {
	.schema_id = "spaghetti.relay.set",
	.version = 1U,
	.fields = relay_set_fields,
	.field_count = ARRAY_SIZE(relay_set_fields),
};

static const struct spaghetti_command_descriptor relay_commands[] = {
	{
		.command_id = SPAGHETTI_RELAY_COMMAND_SET,
		.name = "set",
		.argument_schema = &relay_set_schema,
	},
};

int spaghetti_relay_config_to_properties(
	const struct spaghetti_relay_config *in,
	struct spaghetti_property_set *out)
{
	if ((in == NULL) || (out == NULL)) {
		return -EINVAL;
	}

	memset(out, 0, sizeof(*out));
	out->field_count = 2U;
	out->fields[0] = (struct spaghetti_value){
		.field_id = SPAGHETTI_RELAY_CONFIG_ACTIVE_HIGH,
		.type = SPAGHETTI_VALUE_BOOL,
		.data.boolean = in->active_high,
	};
	out->fields[1] = (struct spaghetti_value){
		.field_id = SPAGHETTI_RELAY_CONFIG_SAFE_ON,
		.type = SPAGHETTI_VALUE_BOOL,
		.data.boolean = in->safe_on,
	};
	return 0;
}

int spaghetti_relay_config_from_properties(
	const struct spaghetti_property_set *in,
	struct spaghetti_relay_config *out)
{
	const struct spaghetti_value *active_high;
	const struct spaghetti_value *safe_on;

	if ((in == NULL) || (out == NULL)) {
		return -EINVAL;
	}

	active_high = spaghetti_property_find(in, SPAGHETTI_RELAY_CONFIG_ACTIVE_HIGH);
	safe_on = spaghetti_property_find(in, SPAGHETTI_RELAY_CONFIG_SAFE_ON);
	if ((active_high == NULL) || (active_high->type != SPAGHETTI_VALUE_BOOL) ||
	    (safe_on == NULL) || (safe_on->type != SPAGHETTI_VALUE_BOOL)) {
		return -EINVAL;
	}

	out->active_high = active_high->data.boolean;
	out->safe_on = safe_on->data.boolean;
	return 0;
}

static int relay_validate_config(const struct spaghetti_property_set *config)
{
	struct spaghetti_relay_config ignored;
	int err;

	if (config == NULL) {
		return -EINVAL;
	}

	err = spaghetti_property_validate(config, &relay_config_schema);
	if (err < 0) {
		return err;
	}

	return spaghetti_relay_config_from_properties(config, &ignored);
}

static int relay_describe_endpoint(const struct spaghetti_property_set *config,
				   struct spaghetti_module_endpoint *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = relay_validate_config(config);
	if (err < 0) {
		return err;
	}

	const struct spaghetti_module_endpoint endpoint = {
		.kind = SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE,
		.value_size = 0U,
	};

	*out = endpoint;
	return 0;
}

static bool relay_electrical_level(
	const struct spaghetti_relay_context *context,
	bool logical_on)
{
	return logical_on == context->config.active_high;
}

static int relay_set_state(struct spaghetti_module *module,
			   struct spaghetti_relay_context *context,
			   bool logical_on)
{
	int err = spaghetti_port_set_output(
		module->port, relay_electrical_level(context, logical_on));

	if (err == 0) {
		context->logical_on = logical_on;
	}

	return err;
}

static void relay_free_context(struct spaghetti_relay_context *context)
{
	memset(context, 0, sizeof(*context));
	k_mem_slab_free(&relay_context_slab, context);
}

static int relay_init(struct spaghetti_module *module,
		      const struct spaghetti_property_set *config)
{
	struct spaghetti_relay_config relay_config;
	struct spaghetti_relay_context *context;
	void *context_block;
	int err;

	if ((module == NULL) || (module->port == NULL) ||
	    (module->context != NULL)) {
		return -EINVAL;
	}

	err = relay_validate_config(config);
	if (err < 0) {
		return err;
	}

	err = spaghetti_relay_config_from_properties(config, &relay_config);
	if (err < 0) {
		return err;
	}

	err = k_mem_slab_alloc(&relay_context_slab, &context_block, K_NO_WAIT);
	if (err < 0) {
		return -ENOMEM;
	}

	context = context_block;
	memset(context, 0, sizeof(*context));
	context->config = relay_config;
	err = relay_set_state(module, context, relay_config.safe_on);
	if (err < 0) {
		relay_free_context(context);
		return err;
	}

	context->initialized = true;
	module->context = context;
	return 0;
}

static int relay_command(struct spaghetti_module *module,
			 const struct spaghetti_module_command *command)
{
	struct spaghetti_relay_context *context;
	const struct spaghetti_value *on_field;

	if ((module == NULL) || (command == NULL) ||
	    (module->state != SPAGHETTI_MODULE_READY) ||
	    (module->context == NULL)) {
		return -EINVAL;
	}
	if (command->command_id != SPAGHETTI_RELAY_COMMAND_SET) {
		return -ENOTSUP;
	}

	on_field = spaghetti_property_find(&command->arguments,
					   SPAGHETTI_RELAY_COMMAND_FIELD_ON);
	if ((on_field == NULL) || (on_field->type != SPAGHETTI_VALUE_BOOL)) {
		return -EINVAL;
	}

	context = module->context;
	if (!context->initialized) {
		return -EINVAL;
	}

	return relay_set_state(module, context, on_field->data.boolean);
}

static int relay_deinit(struct spaghetti_module *module)
{
	struct spaghetti_relay_context *context;
	int err;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	if (!context->initialized) {
		return -EINVAL;
	}

	err = relay_set_state(module, context, context->config.safe_on);
	context->initialized = false;
	relay_free_context(context);
	module->context = NULL;
	module->state = SPAGHETTI_MODULE_UNINITIALIZED;
	return err;
}

static const struct spaghetti_module_driver_ops relay_ops = {
	.validate_config = relay_validate_config,
	.describe_endpoint = relay_describe_endpoint,
	.init = relay_init,
	.read = NULL,
	.command = relay_command,
	.start = NULL,
	.stop = NULL,
	.deinit = relay_deinit,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_relay_driver) = {
	.type_id = "relay",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT,
	.transport = SPAGHETTI_PORT_TRANSPORT_GPIO,
	.power_requirement = { .declared = false },
	.config_schema = &relay_config_schema,
	.record_schemas = NULL,
	.record_schema_count = 0U,
	.commands = relay_commands,
	.command_count = ARRAY_SIZE(relay_commands),
	.ops = &relay_ops,
};
