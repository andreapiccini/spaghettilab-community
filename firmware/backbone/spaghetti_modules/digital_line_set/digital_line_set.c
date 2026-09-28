#include <digital_line_set.h>

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

LOG_MODULE_REGISTER(spaghetti_digital_line_set,
		    CONFIG_SPAGHETTI_DIGITAL_LINE_SET_LOG_LEVEL);

#define SPAGHETTI_DIGITAL_LINE_SET_CHANNEL_MAX 4U

struct spaghetti_digital_line_set_context {
	uint8_t channel;
	bool safe_high;
	bool logical_high;
	bool initialized;
};

K_MEM_SLAB_DEFINE(digital_line_set_context_slab,
		  sizeof(struct spaghetti_digital_line_set_context),
		  CONFIG_SPAGHETTI_DIGITAL_LINE_SET_MAX_INSTANCES,
		  __alignof__(struct spaghetti_digital_line_set_context));

static const struct spaghetti_field_descriptor digital_line_set_config_fields[] = {
	{
		.field_id = SPAGHETTI_DIGITAL_LINE_SET_CONFIG_CHANNEL,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0U,
		.unsigned_maximum = SPAGHETTI_DIGITAL_LINE_SET_CHANNEL_MAX,
		.name = "channel",
		.description = "Connector signal index (0..4) to drive",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_DIGITAL_LINE_SET_CONFIG_SAFE_HIGH,
		.type = SPAGHETTI_VALUE_BOOL,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.name = "safe_high",
		.description = "Electrical level imposed during init and deinit",
		.unit = "",
	},
};

/* schema_id must fit SPAGHETTI_SCHEMA_ID_SIZE (32), including NUL. */
BUILD_ASSERT(sizeof("spaghetti.dline.config") <= SPAGHETTI_SCHEMA_ID_SIZE,
	     "digital_line_set config schema_id is too long");

static const struct spaghetti_schema_descriptor digital_line_set_config_schema = {
	.schema_id = "spaghetti.dline.config",
	.version = 1U,
	.fields = digital_line_set_config_fields,
	.field_count = ARRAY_SIZE(digital_line_set_config_fields),
};

static const struct spaghetti_field_descriptor digital_line_set_set_fields[] = {
	{
		.field_id = SPAGHETTI_DIGITAL_LINE_SET_COMMAND_FIELD_HIGH,
		.type = SPAGHETTI_VALUE_BOOL,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.name = "high",
		.description = "Desired electrical level",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor digital_line_set_set_schema = {
	.schema_id = "spaghetti.digital_line_set.set",
	.version = 1U,
	.fields = digital_line_set_set_fields,
	.field_count = ARRAY_SIZE(digital_line_set_set_fields),
};

static const struct spaghetti_command_descriptor digital_line_set_commands[] = {
	{
		.command_id = SPAGHETTI_DIGITAL_LINE_SET_COMMAND_SET,
		.name = "set",
		.argument_schema = &digital_line_set_set_schema,
	},
};

static int digital_line_set_parse_config(
	const struct spaghetti_property_set *in,
	uint8_t *out_channel,
	bool *out_safe_high)
{
	const struct spaghetti_value *channel;
	const struct spaghetti_value *safe_high;

	channel = spaghetti_property_find(
		in, SPAGHETTI_DIGITAL_LINE_SET_CONFIG_CHANNEL);
	safe_high = spaghetti_property_find(
		in, SPAGHETTI_DIGITAL_LINE_SET_CONFIG_SAFE_HIGH);

	if ((channel == NULL) || (channel->type != SPAGHETTI_VALUE_UINT64) ||
	    (channel->data.unsigned_integer > SPAGHETTI_DIGITAL_LINE_SET_CHANNEL_MAX) ||
	    (safe_high == NULL) || (safe_high->type != SPAGHETTI_VALUE_BOOL)) {
		return -EINVAL;
	}

	*out_channel = (uint8_t)channel->data.unsigned_integer;
	*out_safe_high = safe_high->data.boolean;
	return 0;
}

static int digital_line_set_validate_config(
	const struct spaghetti_property_set *config)
{
	uint8_t channel;
	bool safe_high;
	int err;

	if (config == NULL) {
		return -EINVAL;
	}

	err = spaghetti_property_validate(config, &digital_line_set_config_schema);
	if (err < 0) {
		return err;
	}

	return digital_line_set_parse_config(config, &channel, &safe_high);
}

static int digital_line_set_describe_endpoint(
	const struct spaghetti_property_set *config,
	struct spaghetti_module_endpoint *out)
{
	uint8_t channel;
	bool safe_high;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = digital_line_set_validate_config(config);
	if (err < 0) {
		return err;
	}
	(void)digital_line_set_parse_config(config, &channel, &safe_high);

	const struct spaghetti_module_endpoint endpoint = {
		.kind = SPAGHETTI_ENDPOINT_GPIO_LINE,
		.value_size = 1U,
		.value = {channel},
	};

	*out = endpoint;
	return 0;
}

static int digital_line_set_write(struct spaghetti_module *module,
				  struct spaghetti_digital_line_set_context *context,
				  bool high)
{
	int err = spaghetti_port_digital_output_set(module->port, context->channel,
						    high);

	if (err == 0) {
		context->logical_high = high;
	}

	return err;
}

static void digital_line_set_free_context(
	struct spaghetti_digital_line_set_context *context)
{
	memset(context, 0, sizeof(*context));
	k_mem_slab_free(&digital_line_set_context_slab, context);
}

static int digital_line_set_init(struct spaghetti_module *module,
				 const struct spaghetti_property_set *config)
{
	struct spaghetti_digital_line_set_context *context;
	void *context_block;
	uint8_t channel;
	bool safe_high;
	int err;

	if ((module == NULL) || (module->port == NULL) ||
	    (module->context != NULL)) {
		return -EINVAL;
	}

	err = digital_line_set_validate_config(config);
	if (err < 0) {
		return err;
	}
	(void)digital_line_set_parse_config(config, &channel, &safe_high);

	err = k_mem_slab_alloc(&digital_line_set_context_slab, &context_block,
			       K_NO_WAIT);
	if (err < 0) {
		return -ENOMEM;
	}

	context = context_block;
	memset(context, 0, sizeof(*context));
	context->channel = channel;
	context->safe_high = safe_high;
	err = digital_line_set_write(module, context, safe_high);
	if (err < 0) {
		digital_line_set_free_context(context);
		return err;
	}

	context->initialized = true;
	module->context = context;
	return 0;
}

static int digital_line_set_command(struct spaghetti_module *module,
				    const struct spaghetti_module_command *command)
{
	struct spaghetti_digital_line_set_context *context;
	const struct spaghetti_value *high_field;

	if ((module == NULL) || (command == NULL) ||
	    (module->state != SPAGHETTI_MODULE_READY) ||
	    (module->context == NULL)) {
		return -EINVAL;
	}
	if (command->command_id != SPAGHETTI_DIGITAL_LINE_SET_COMMAND_SET) {
		return -ENOTSUP;
	}

	high_field = spaghetti_property_find(
		&command->arguments, SPAGHETTI_DIGITAL_LINE_SET_COMMAND_FIELD_HIGH);
	if ((high_field == NULL) || (high_field->type != SPAGHETTI_VALUE_BOOL)) {
		return -EINVAL;
	}

	context = module->context;
	if (!context->initialized) {
		return -EINVAL;
	}

	return digital_line_set_write(module, context, high_field->data.boolean);
}

static int digital_line_set_deinit(struct spaghetti_module *module)
{
	struct spaghetti_digital_line_set_context *context;
	int err;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	if (!context->initialized) {
		return -EINVAL;
	}

	err = digital_line_set_write(module, context, context->safe_high);
	context->initialized = false;
	digital_line_set_free_context(context);
	module->context = NULL;
	module->state = SPAGHETTI_MODULE_UNINITIALIZED;
	return err;
}

static const struct spaghetti_module_driver_ops digital_line_set_ops = {
	.validate_config = digital_line_set_validate_config,
	.describe_endpoint = digital_line_set_describe_endpoint,
	.init = digital_line_set_init,
	.read = NULL,
	.command = digital_line_set_command,
	.start = NULL,
	.stop = NULL,
	.deinit = digital_line_set_deinit,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_digital_line_set_driver) = {
	.type_id = "digital_line_set",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT,
	.transport = SPAGHETTI_PORT_TRANSPORT_GPIO,
	.power_requirement = { .declared = false },
	.config_schema = &digital_line_set_config_schema,
	.record_schemas = NULL,
	.record_schema_count = 0U,
	.commands = digital_line_set_commands,
	.command_count = ARRAY_SIZE(digital_line_set_commands),
	.ops = &digital_line_set_ops,
};
