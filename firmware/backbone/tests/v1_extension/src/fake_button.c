/**
 * @file
 * @brief Fake button Module: GPIO config, BOOL event, async start/stop.
 */

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/sys/util.h>

#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

enum {
	FAKE_BUTTON_CFG_LINE = 1U,
	FAKE_BUTTON_FIELD_PRESSED = 1U,
};

struct fake_button_context {
	bool used;
	uint8_t line;
	spaghetti_module_event_cb_t emit;
	void *emit_user_data;
	bool armed;
};

static struct fake_button_context contexts[CONFIG_SPAGHETTI_MAX_MODULES];
static struct fake_button_context *last_armed;

static const struct spaghetti_field_descriptor config_fields[] = {
	{
		.field_id = FAKE_BUTTON_CFG_LINE,
		.type = SPAGHETTI_VALUE_UINT64,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0U,
		.unsigned_maximum = 4U,
		.name = "line",
		.description = "Connector signal index",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor config_schema = {
	.schema_id = "spaghetti.fake_button.config",
	.version = 1U,
	.fields = config_fields,
	.field_count = ARRAY_SIZE(config_fields),
};

static const struct spaghetti_field_descriptor event_fields[] = {
	{
		.field_id = FAKE_BUTTON_FIELD_PRESSED,
		.type = SPAGHETTI_VALUE_BOOL,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.name = "pressed",
		.description = "Button pressed event",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor event_schema = {
	.schema_id = "spaghetti.fake_button.event",
	.version = 1U,
	.fields = event_fields,
	.field_count = ARRAY_SIZE(event_fields),
};

static const struct spaghetti_schema_descriptor *const record_schemas[] = {
	&event_schema,
};

static int validate_config(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &config_schema);
}

static int describe_endpoint(const struct spaghetti_property_set *config,
			     struct spaghetti_module_endpoint *out)
{
	const struct spaghetti_value *line;

	if (out == NULL) {
		return -EINVAL;
	}
	line = spaghetti_property_find(config, FAKE_BUTTON_CFG_LINE);
	if ((line == NULL) || (line->type != SPAGHETTI_VALUE_UINT64)) {
		return -EINVAL;
	}
	*out = (struct spaghetti_module_endpoint){
		.kind = SPAGHETTI_ENDPOINT_GPIO_LINE,
		.value_size = 1U,
		.value = {(uint8_t)line->data.unsigned_integer},
	};
	return 0;
}

static int init_module(struct spaghetti_module *module,
		       const struct spaghetti_property_set *config)
{
	const struct spaghetti_value *line =
		spaghetti_property_find(config, FAKE_BUTTON_CFG_LINE);

	if ((module == NULL) || (module->context != NULL) || (line == NULL)) {
		return -EINVAL;
	}
	for (size_t idx = 0U; idx < ARRAY_SIZE(contexts); ++idx) {
		if (!contexts[idx].used) {
			memset(&contexts[idx], 0, sizeof(contexts[idx]));
			contexts[idx].used = true;
			contexts[idx].line =
				(uint8_t)line->data.unsigned_integer;
			module->context = &contexts[idx];
			return 0;
		}
	}
	return -ENOMEM;
}

static int start_module(struct spaghetti_module *module,
			spaghetti_module_event_cb_t emit,
			void *emit_user_data)
{
	struct fake_button_context *ctx;

	if ((module == NULL) || (module->context == NULL) || (emit == NULL)) {
		return -EINVAL;
	}
	ctx = module->context;
	ctx->emit = emit;
	ctx->emit_user_data = emit_user_data;
	ctx->armed = true;
	last_armed = ctx;
	return 0;
}

static int read_module(struct spaghetti_module *module,
		       struct spaghetti_record_payload *out)
{
	if ((module == NULL) || (module->context == NULL) || (out == NULL)) {
		return -EINVAL;
	}
	memset(out, 0, sizeof(*out));
	out->kind = SPAGHETTI_RECORD_EVENT;
	out->schema_version = 1U;
	strncpy(out->schema_id, event_schema.schema_id,
		sizeof(out->schema_id) - 1U);
	out->values.field_count = 1U;
	out->values.fields[0] = (struct spaghetti_value){
		.field_id = FAKE_BUTTON_FIELD_PRESSED,
		.type = SPAGHETTI_VALUE_BOOL,
		.data.boolean = false,
	};
	return 0;
}

static int stop_module(struct spaghetti_module *module)
{
	struct fake_button_context *ctx;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}
	ctx = module->context;
	ctx->armed = false;
	ctx->emit = NULL;
	ctx->emit_user_data = NULL;
	if (last_armed == ctx) {
		last_armed = NULL;
	}
	return 0;
}

static int deinit_module(struct spaghetti_module *module)
{
	struct fake_button_context *ctx;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}
	(void)stop_module(module);
	ctx = module->context;
	ctx->used = false;
	module->context = NULL;
	return 0;
}

int fake_button_inject_press(void)
{
	struct spaghetti_record_payload payload;

	if ((last_armed == NULL) || !last_armed->armed ||
	    (last_armed->emit == NULL)) {
		return -ENOENT;
	}
	memset(&payload, 0, sizeof(payload));
	payload.kind = SPAGHETTI_RECORD_EVENT;
	payload.schema_version = 1U;
	strncpy(payload.schema_id, event_schema.schema_id,
		sizeof(payload.schema_id) - 1U);
	payload.values.field_count = 1U;
	payload.values.fields[0] = (struct spaghetti_value){
		.field_id = FAKE_BUTTON_FIELD_PRESSED,
		.type = SPAGHETTI_VALUE_BOOL,
		.data.boolean = true,
	};
	return last_armed->emit(&payload, last_armed->emit_user_data);
}

static const struct spaghetti_module_driver_ops ops = {
	.validate_config = validate_config,
	.describe_endpoint = describe_endpoint,
	.init = init_module,
	.read = read_module,
	.start = start_module,
	.stop = stop_module,
	.deinit = deinit_module,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_fake_button_driver) = {
	.type_id = "fake_button",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_DIGITAL_INPUT,
	.transport = SPAGHETTI_PORT_TRANSPORT_GPIO,
	.power_requirement = { .declared = false },
	.config_schema = &config_schema,
	.record_schemas = record_schemas,
	.record_schema_count = ARRAY_SIZE(record_schemas),
	.ops = &ops,
};
