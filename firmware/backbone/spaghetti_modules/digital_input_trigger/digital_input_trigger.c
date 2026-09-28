#include <digital_input_trigger.h>

#include <errno.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/module.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

LOG_MODULE_REGISTER(spaghetti_digital_input_trigger,
		    CONFIG_SPAGHETTI_DIGITAL_INPUT_TRIGGER_LOG_LEVEL);

#define SPAGHETTI_DIGITAL_INPUT_TRIGGER_CHANNEL_MAX 4U
#define SPAGHETTI_DIGITAL_INPUT_TRIGGER_POLL_MS \
	CONFIG_SPAGHETTI_DIGITAL_INPUT_TRIGGER_POLL_MS

struct spaghetti_digital_input_trigger_context {
	struct spaghetti_module *module;
	uint8_t channel;
	bool trigger_high;
	bool armed;
	bool running;
	spaghetti_module_event_cb_t emit;
	void *emit_user_data;
	struct k_work_delayable work;
};

K_MEM_SLAB_DEFINE(digital_input_trigger_context_slab,
		  sizeof(struct spaghetti_digital_input_trigger_context),
		  CONFIG_SPAGHETTI_DIGITAL_INPUT_TRIGGER_MAX_INSTANCES,
		  __alignof__(struct spaghetti_digital_input_trigger_context));

static const struct spaghetti_field_descriptor digital_input_trigger_config_fields[] = {
	{
		.field_id = SPAGHETTI_DIGITAL_INPUT_TRIGGER_CONFIG_CHANNEL,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0U,
		.unsigned_maximum = SPAGHETTI_DIGITAL_INPUT_TRIGGER_CHANNEL_MAX,
		.name = "channel",
		.description = "Connector signal index (0..4) to read",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_DIGITAL_INPUT_TRIGGER_CONFIG_TRIGGER_HIGH,
		.type = SPAGHETTI_VALUE_BOOL,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.name = "trigger_high",
		.description = "True fires on electrical high, false fires on electrical low",
		.unit = "",
	},
};

/* schema_id must fit SPAGHETTI_SCHEMA_ID_SIZE (32), including NUL. */
BUILD_ASSERT(sizeof("spaghetti.di_trig.config") <= SPAGHETTI_SCHEMA_ID_SIZE,
	     "digital_input_trigger config schema_id is too long");

static const struct spaghetti_schema_descriptor digital_input_trigger_config_schema = {
	.schema_id = "spaghetti.di_trig.config",
	.version = 1U,
	.fields = digital_input_trigger_config_fields,
	.field_count = ARRAY_SIZE(digital_input_trigger_config_fields),
};

static int digital_input_trigger_parse_config(
	const struct spaghetti_property_set *in,
	uint8_t *out_channel,
	bool *out_trigger_high)
{
	const struct spaghetti_value *channel;
	const struct spaghetti_value *trigger_high;

	channel = spaghetti_property_find(
		in, SPAGHETTI_DIGITAL_INPUT_TRIGGER_CONFIG_CHANNEL);
	trigger_high = spaghetti_property_find(
		in, SPAGHETTI_DIGITAL_INPUT_TRIGGER_CONFIG_TRIGGER_HIGH);

	if ((channel == NULL) || (channel->type != SPAGHETTI_VALUE_UINT64) ||
	    (channel->data.unsigned_integer > SPAGHETTI_DIGITAL_INPUT_TRIGGER_CHANNEL_MAX) ||
	    (trigger_high == NULL) ||
	    (trigger_high->type != SPAGHETTI_VALUE_BOOL)) {
		return -EINVAL;
	}

	*out_channel = (uint8_t)channel->data.unsigned_integer;
	*out_trigger_high = trigger_high->data.boolean;
	return 0;
}

static int digital_input_trigger_validate_config(
	const struct spaghetti_property_set *config)
{
	uint8_t channel;
	bool trigger_high;
	int err;

	if (config == NULL) {
		return -EINVAL;
	}

	err = spaghetti_property_validate(config, &digital_input_trigger_config_schema);
	if (err < 0) {
		return err;
	}

	return digital_input_trigger_parse_config(config, &channel, &trigger_high);
}

static int digital_input_trigger_describe_endpoint(
	const struct spaghetti_property_set *config,
	struct spaghetti_module_endpoint *out)
{
	uint8_t channel;
	bool trigger_high;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = digital_input_trigger_validate_config(config);
	if (err < 0) {
		return err;
	}
	(void)digital_input_trigger_parse_config(config, &channel, &trigger_high);

	const struct spaghetti_module_endpoint endpoint = {
		.kind = SPAGHETTI_ENDPOINT_GPIO_LINE,
		.value_size = 1U,
		.value = {channel},
	};

	*out = endpoint;
	return 0;
}

static void digital_input_trigger_free_context(
	struct spaghetti_digital_input_trigger_context *context)
{
	memset(context, 0, sizeof(*context));
	k_mem_slab_free(&digital_input_trigger_context_slab, context);
}

static void digital_input_trigger_poll(struct k_work *work)
{
	struct k_work_delayable *dwork = k_work_delayable_from_work(work);
	struct spaghetti_digital_input_trigger_context *context =
		CONTAINER_OF(dwork, struct spaghetti_digital_input_trigger_context, work);
	bool level;
	int err;

	if (!context->running) {
		return;
	}

	err = spaghetti_port_digital_input_get(context->module->port,
					       context->channel, &level);
	if (err == 0) {
		if (level == context->trigger_high) {
			if (context->armed) {
				struct spaghetti_record_payload payload = {0};

				payload.kind = SPAGHETTI_RECORD_EVENT;
				(void)snprintf(payload.schema_id,
					      sizeof(payload.schema_id),
					      "spaghetti.digital_input.event");
				payload.schema_version = 1U;
				payload.values.field_count = 1U;
				payload.values.fields[0] = (struct spaghetti_value){
					.field_id = 1U,
					.type = SPAGHETTI_VALUE_BOOL,
					.data.boolean = level,
				};
				(void)context->emit(&payload, context->emit_user_data);
				context->armed = false;
			}
		} else {
			context->armed = true;
		}
	} else {
		LOG_WRN("channel=%u poll error=%d", context->channel, err);
	}

	if (context->running) {
		(void)k_work_reschedule(&context->work,
					K_MSEC(SPAGHETTI_DIGITAL_INPUT_TRIGGER_POLL_MS));
	}
}

static int digital_input_trigger_init(
	struct spaghetti_module *module,
	const struct spaghetti_property_set *config)
{
	struct spaghetti_digital_input_trigger_context *context;
	void *context_block;
	uint8_t channel;
	bool trigger_high;
	bool level;
	int err;

	if ((module == NULL) || (module->port == NULL) ||
	    (module->context != NULL)) {
		return -EINVAL;
	}

	err = digital_input_trigger_validate_config(config);
	if (err < 0) {
		return err;
	}
	(void)digital_input_trigger_parse_config(config, &channel, &trigger_high);

	err = spaghetti_port_digital_input_get(module->port, channel, &level);
	if (err < 0) {
		return err;
	}

	err = k_mem_slab_alloc(&digital_input_trigger_context_slab,
			       &context_block, K_NO_WAIT);
	if (err < 0) {
		return -ENOMEM;
	}

	context = context_block;
	memset(context, 0, sizeof(*context));
	context->module = module;
	context->channel = channel;
	context->trigger_high = trigger_high;
	context->armed = (level != trigger_high);
	context->running = false;
	k_work_init_delayable(&context->work, digital_input_trigger_poll);

	module->context = context;
	return 0;
}

static int digital_input_trigger_start(
	struct spaghetti_module *module,
	spaghetti_module_event_cb_t emit,
	void *emit_user_data)
{
	struct spaghetti_digital_input_trigger_context *context;

	if ((module == NULL) || (module->context == NULL) || (emit == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	if (context->running) {
		return -EALREADY;
	}

	context->emit = emit;
	context->emit_user_data = emit_user_data;
	context->running = true;
	(void)k_work_reschedule(&context->work,
				K_MSEC(SPAGHETTI_DIGITAL_INPUT_TRIGGER_POLL_MS));
	return 0;
}

static int digital_input_trigger_stop(struct spaghetti_module *module)
{
	struct spaghetti_digital_input_trigger_context *context;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	context->running = false;
	(void)k_work_cancel_delayable(&context->work);
	return 0;
}

static int digital_input_trigger_deinit(struct spaghetti_module *module)
{
	struct spaghetti_digital_input_trigger_context *context;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	context->running = false;
	(void)k_work_cancel_delayable(&context->work);
	digital_input_trigger_free_context(context);
	module->context = NULL;
	module->state = SPAGHETTI_MODULE_UNINITIALIZED;
	return 0;
}

static const struct spaghetti_module_driver_ops digital_input_trigger_ops = {
	.validate_config = digital_input_trigger_validate_config,
	.describe_endpoint = digital_input_trigger_describe_endpoint,
	.init = digital_input_trigger_init,
	.read = NULL,
	.command = NULL,
	.start = digital_input_trigger_start,
	.stop = digital_input_trigger_stop,
	.deinit = digital_input_trigger_deinit,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_digital_input_trigger_driver) = {
	.type_id = "digital_input_trigger",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_DIGITAL_INPUT,
	.transport = SPAGHETTI_PORT_TRANSPORT_GPIO,
	.power_requirement = { .declared = false },
	.config_schema = &digital_input_trigger_config_schema,
	.record_schemas = NULL,
	.record_schema_count = 0U,
	.commands = NULL,
	.command_count = 0U,
	.ops = &digital_input_trigger_ops,
};
