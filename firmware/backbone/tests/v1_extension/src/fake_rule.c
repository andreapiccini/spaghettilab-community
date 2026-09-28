/**
 * @file
 * @brief Fake rule: observe INT64 field and emit PWM duty command.
 */

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/sys/util.h>

#include <spaghetti/rule_driver.h>
#include <spaghetti/schema.h>

enum {
	FAKE_RULE_CFG_SOURCE_KEY = 1U,
	FAKE_RULE_CFG_FIELD_ID = 2U,
	FAKE_RULE_CFG_PWM_KEY = 3U,
	FAKE_RULE_CFG_THRESHOLD = 4U,
	FAKE_PWM_CMD_SET_DUTY = 1U,
	FAKE_PWM_CMD_FIELD_DUTY = 1U,
};

struct fake_rule_context {
	bool used;
	spaghetti_module_key_t source_key;
	uint16_t field_id;
	spaghetti_module_key_t pwm_key;
	int64_t threshold;
	uint32_t actions_emitted;
};

static struct fake_rule_context contexts[CONFIG_SPAGHETTI_MAX_RULES];
static uint32_t last_actions_emitted;

static const struct spaghetti_field_descriptor config_fields[] = {
	{
		.field_id = FAKE_RULE_CFG_SOURCE_KEY,
		.type = SPAGHETTI_VALUE_UINT64,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT64_MAX,
		.name = "source_key",
		.description = "Observed Module key",
		.unit = "",
	},
	{
		.field_id = FAKE_RULE_CFG_FIELD_ID,
		.type = SPAGHETTI_VALUE_UINT64,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT16_MAX,
		.name = "field_id",
		.description = "Observed field",
		.unit = "",
	},
	{
		.field_id = FAKE_RULE_CFG_PWM_KEY,
		.type = SPAGHETTI_VALUE_UINT64,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT64_MAX,
		.name = "pwm_key",
		.description = "PWM Module key",
		.unit = "",
	},
	{
		.field_id = FAKE_RULE_CFG_THRESHOLD,
		.type = SPAGHETTI_VALUE_INT64,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "threshold",
		.description = "Trip threshold",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor config_schema = {
	.schema_id = "spaghetti.fake_rule.config",
	.version = 1U,
	.fields = config_fields,
	.field_count = ARRAY_SIZE(config_fields),
};

static int validate_config(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &config_schema);
}

static int init_rule(const struct spaghetti_property_set *config,
		     void **out_context)
{
	const struct spaghetti_value *source;
	const struct spaghetti_value *field;
	const struct spaghetti_value *pwm;
	const struct spaghetti_value *threshold;

	if ((config == NULL) || (out_context == NULL)) {
		return -EINVAL;
	}
	source = spaghetti_property_find(config, FAKE_RULE_CFG_SOURCE_KEY);
	field = spaghetti_property_find(config, FAKE_RULE_CFG_FIELD_ID);
	pwm = spaghetti_property_find(config, FAKE_RULE_CFG_PWM_KEY);
	threshold = spaghetti_property_find(config, FAKE_RULE_CFG_THRESHOLD);
	if ((source == NULL) || (field == NULL) || (pwm == NULL) ||
	    (threshold == NULL)) {
		return -EINVAL;
	}
	for (size_t idx = 0U; idx < ARRAY_SIZE(contexts); ++idx) {
		if (!contexts[idx].used) {
			memset(&contexts[idx], 0, sizeof(contexts[idx]));
			contexts[idx].used = true;
			contexts[idx].source_key =
				(spaghetti_module_key_t)source->data.unsigned_integer;
			contexts[idx].field_id =
				(uint16_t)field->data.unsigned_integer;
			contexts[idx].pwm_key =
				(spaghetti_module_key_t)pwm->data.unsigned_integer;
			contexts[idx].threshold =
				threshold->data.signed_integer;
			*out_context = &contexts[idx];
			return 0;
		}
	}
	return -ENOMEM;
}

static int on_record(void *context, const struct spaghetti_record *record,
		     spaghetti_rule_emit_action_cb_t emit,
		     void *emit_user_data)
{
	struct fake_rule_context *ctx = context;
	const struct spaghetti_value *value;
	struct spaghetti_rule_action action;

	if ((ctx == NULL) || (record == NULL) || (emit == NULL)) {
		return -EINVAL;
	}
	if (record->source_key != ctx->source_key) {
		return 0;
	}
	value = spaghetti_property_find(&record->payload.values, ctx->field_id);
	if ((value == NULL) || (value->type != SPAGHETTI_VALUE_INT64) ||
	    (value->data.signed_integer < ctx->threshold)) {
		return 0;
	}

	memset(&action, 0, sizeof(action));
	action.target_key = ctx->pwm_key;
	action.command.command_id = FAKE_PWM_CMD_SET_DUTY;
	action.command.arguments.field_count = 1U;
	action.command.arguments.fields[0] = (struct spaghetti_value){
		.field_id = FAKE_PWM_CMD_FIELD_DUTY,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 500U,
	};
	++ctx->actions_emitted;
	last_actions_emitted = ctx->actions_emitted;
	return emit(&action, emit_user_data);
}

static int deinit_rule(void *context)
{
	struct fake_rule_context *ctx = context;

	if (ctx == NULL) {
		return -EINVAL;
	}
	ctx->used = false;
	return 0;
}

uint32_t fake_rule_last_actions_emitted(void)
{
	return last_actions_emitted;
}

static const struct spaghetti_rule_driver_ops ops = {
	.validate_config = validate_config,
	.init = init_rule,
	.on_record = on_record,
	.deinit = deinit_rule,
};

SPAGHETTI_RULE_DRIVER_DEFINE(spaghetti_fake_rule_driver) = {
	.type_id = "fake_rule",
	.api_version = SPAGHETTI_RULE_DRIVER_API_VERSION,
	.config_schema = &config_schema,
	.ops = &ops,
};
