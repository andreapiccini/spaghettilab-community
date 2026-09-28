#include "threshold.h"

#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

LOG_MODULE_REGISTER(spaghetti_threshold, CONFIG_SPAGHETTI_THRESHOLD_LOG_LEVEL);

struct spaghetti_threshold_context {
	spaghetti_module_key_t source_key;
	uint16_t source_field_id;
	int64_t lower;
	int64_t upper;
	spaghetti_module_key_t target_key;
	uint16_t command_id;
	uint16_t command_field_id;
	bool above_value;
	bool has_state;
	bool last_above;
};

K_MEM_SLAB_DEFINE(threshold_context_slab,
		  sizeof(struct spaghetti_threshold_context),
		  CONFIG_SPAGHETTI_THRESHOLD_MAX_INSTANCES,
		  __alignof__(struct spaghetti_threshold_context));

static const struct spaghetti_field_descriptor threshold_config_fields[] = {
	{
		.field_id = SPAGHETTI_THRESHOLD_SOURCE_KEY,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF,
		.reference_group = 1U,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT32_MAX,
		.name = "source_key",
		.description = "Module key that produces observed records",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_THRESHOLD_SOURCE_FIELD_ID,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_RECORD_FIELD_REF,
		.reference_group = 1U,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT16_MAX,
		.name = "source_field_id",
		.description = "Numeric record field observed by the rule",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_THRESHOLD_LOWER,
		.type = SPAGHETTI_VALUE_INT64,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "lower",
		.description = "Strict lower hysteresis boundary",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_THRESHOLD_UPPER,
		.type = SPAGHETTI_VALUE_INT64,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "upper",
		.description = "Strict upper hysteresis boundary",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_THRESHOLD_TARGET_KEY,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF,
		.reference_group = 2U,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT32_MAX,
		.name = "target_key",
		.description = "Module key that receives emitted commands",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_THRESHOLD_COMMAND_ID,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_COMMAND_REF,
		.reference_group = 2U,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT16_MAX,
		.name = "command_id",
		.description = "Command ID applied on the target Module",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_THRESHOLD_COMMAND_FIELD_ID,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_RECORD_FIELD_REF,
		.reference_group = 2U,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT16_MAX,
		.name = "command_field_id",
		.description = "BOOL argument field ID of the emitted command",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_THRESHOLD_ABOVE_VALUE,
		.type = SPAGHETTI_VALUE_BOOL,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.name = "above_value",
		.description = "BOOL command value when the observed field is above upper",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor threshold_config_schema = {
	.schema_id = "spaghetti.rule.threshold",
	.version = 1U,
	.fields = threshold_config_fields,
	.field_count = ARRAY_SIZE(threshold_config_fields),
};

static int read_u16_field(const struct spaghetti_property_set *config,
			  uint16_t field_id,
			  uint16_t *out)
{
	const struct spaghetti_value *value =
		spaghetti_property_find(config, field_id);

	if ((value == NULL) || (value->type != SPAGHETTI_VALUE_UINT64) ||
	    (value->data.unsigned_integer == 0U) ||
	    (value->data.unsigned_integer > UINT16_MAX)) {
		return -EINVAL;
	}

	*out = (uint16_t)value->data.unsigned_integer;
	return 0;
}

static int read_key_field(const struct spaghetti_property_set *config,
			  uint16_t field_id,
			  spaghetti_module_key_t *out)
{
	const struct spaghetti_value *value =
		spaghetti_property_find(config, field_id);

	if ((value == NULL) || (value->type != SPAGHETTI_VALUE_UINT64) ||
	    (value->data.unsigned_integer == 0U) ||
	    (value->data.unsigned_integer > UINT32_MAX)) {
		return -EINVAL;
	}

	*out = (spaghetti_module_key_t)value->data.unsigned_integer;
	return 0;
}

static int threshold_validate_config(const struct spaghetti_property_set *config)
{
	const struct spaghetti_value *lower;
	const struct spaghetti_value *upper;
	int err;

	err = spaghetti_property_validate(config, &threshold_config_schema);
	if (err < 0) {
		return err;
	}

	lower = spaghetti_property_find(config, SPAGHETTI_THRESHOLD_LOWER);
	upper = spaghetti_property_find(config, SPAGHETTI_THRESHOLD_UPPER);
	if ((lower == NULL) || (upper == NULL) ||
	    (lower->type != SPAGHETTI_VALUE_INT64) ||
	    (upper->type != SPAGHETTI_VALUE_INT64) ||
	    (lower->data.signed_integer > upper->data.signed_integer)) {
		return -EINVAL;
	}

	return 0;
}

static int threshold_init(const struct spaghetti_property_set *config,
			  void **out_context)
{
	struct spaghetti_threshold_context *context;
	const struct spaghetti_value *lower;
	const struct spaghetti_value *upper;
	const struct spaghetti_value *above;
	int err;

	if ((config == NULL) || (out_context == NULL)) {
		return -EINVAL;
	}

	err = threshold_validate_config(config);
	if (err < 0) {
		return err;
	}

	err = k_mem_slab_alloc(&threshold_context_slab, (void **)&context,
			       K_NO_WAIT);
	if (err < 0) {
		return -ENOMEM;
	}

	memset(context, 0, sizeof(*context));
	err = read_key_field(config, SPAGHETTI_THRESHOLD_SOURCE_KEY,
			     &context->source_key);
	if (err == 0) {
		err = read_u16_field(config, SPAGHETTI_THRESHOLD_SOURCE_FIELD_ID,
				     &context->source_field_id);
	}
	if (err == 0) {
		err = read_key_field(config, SPAGHETTI_THRESHOLD_TARGET_KEY,
				     &context->target_key);
	}
	if (err == 0) {
		err = read_u16_field(config, SPAGHETTI_THRESHOLD_COMMAND_ID,
				     &context->command_id);
	}
	if (err == 0) {
		err = read_u16_field(config,
				     SPAGHETTI_THRESHOLD_COMMAND_FIELD_ID,
				     &context->command_field_id);
	}
	if (err < 0) {
		k_mem_slab_free(&threshold_context_slab, (void *)context);
		return err;
	}

	lower = spaghetti_property_find(config, SPAGHETTI_THRESHOLD_LOWER);
	upper = spaghetti_property_find(config, SPAGHETTI_THRESHOLD_UPPER);
	above = spaghetti_property_find(config, SPAGHETTI_THRESHOLD_ABOVE_VALUE);
	context->lower = lower->data.signed_integer;
	context->upper = upper->data.signed_integer;
	context->above_value = above->data.boolean;
	*out_context = context;
	return 0;
}

static int value_as_int64(const struct spaghetti_value *value, int64_t *out)
{
	if (value->type == SPAGHETTI_VALUE_INT64) {
		*out = value->data.signed_integer;
		return 0;
	}
	if (value->type == SPAGHETTI_VALUE_UINT64) {
		if (value->data.unsigned_integer >
		    (uint64_t)INT64_MAX) {
			return -ERANGE;
		}
		*out = (int64_t)value->data.unsigned_integer;
		return 0;
	}

	return -EINVAL;
}

static int threshold_on_record(void *context,
			       const struct spaghetti_record *record,
			       spaghetti_rule_emit_action_cb_t emit,
			       void *emit_user_data)
{
	struct spaghetti_threshold_context *rule = context;
	const struct spaghetti_value *field;
	struct spaghetti_rule_action action;
	int64_t sample;
	bool desired_above;
	bool must_command;
	int err;

	if ((rule == NULL) || (record == NULL) || (emit == NULL)) {
		return -EINVAL;
	}
	if (record->source_key != rule->source_key) {
		return 0;
	}

	field = spaghetti_property_find(&record->payload.values,
					rule->source_field_id);
	if (field == NULL) {
		return 0;
	}

	err = value_as_int64(field, &sample);
	if (err < 0) {
		return 0;
	}

	must_command = true;
	if (sample > rule->upper) {
		desired_above = true;
	} else if (sample < rule->lower) {
		desired_above = false;
	} else {
		must_command = false;
		desired_above = false;
	}

	if (!must_command ||
	    (rule->has_state && (rule->last_above == desired_above))) {
		return 0;
	}

	memset(&action, 0, sizeof(action));
	action.target_key = rule->target_key;
	action.command.command_id = rule->command_id;
	action.command.arguments.field_count = 1U;
	action.command.arguments.fields[0].field_id = rule->command_field_id;
	action.command.arguments.fields[0].type = SPAGHETTI_VALUE_BOOL;
	action.command.arguments.fields[0].data.boolean =
		desired_above ? rule->above_value : !rule->above_value;

	err = emit(&action, emit_user_data);
	if (err == 0) {
		rule->has_state = true;
		rule->last_above = desired_above;
	}

	return err;
}

static int threshold_deinit(void *context)
{
	if (context == NULL) {
		return -EINVAL;
	}

	memset(context, 0, sizeof(struct spaghetti_threshold_context));
	k_mem_slab_free(&threshold_context_slab, context);
	return 0;
}

static const struct spaghetti_rule_driver_ops threshold_ops = {
	.validate_config = threshold_validate_config,
	.init = threshold_init,
	.on_record = threshold_on_record,
	.deinit = threshold_deinit,
};

SPAGHETTI_RULE_DRIVER_DEFINE(spaghetti_threshold_rule_driver) = {
	.type_id = "threshold",
	.api_version = SPAGHETTI_RULE_DRIVER_API_VERSION,
	.config_schema = &threshold_config_schema,
	.ops = &threshold_ops,
};
