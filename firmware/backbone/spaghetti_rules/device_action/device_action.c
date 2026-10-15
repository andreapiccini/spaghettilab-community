#include <errno.h>
#include <spaghetti/rule_driver.h>
#include <spaghetti/schema.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

struct action_context {
  uint32_t source, target;
  uint16_t source_action, command, source_field, argument;
  uint8_t mode;
  bool previous, has_constant;
  uint64_t constant;
};
#define UINT_FIELD(id, label, max, required)                                   \
  {.field_id = id,                                                             \
   .type = SPAGHETTI_VALUE_UINT64,                                             \
   .name = label,                                                              \
   .description = "",                                                          \
   .unit = "",                                                                 \
   .flags = required,                                                          \
   .unsigned_maximum = max}
static const struct spaghetti_field_descriptor fields[] = {
    {.field_id = 1,
     .type = SPAGHETTI_VALUE_UINT64,
     .name = "source_key",
     .description = "",
     .unit = "",
     .flags = SPAGHETTI_FIELD_REQUIRED,
     .unsigned_minimum = 1,
     .unsigned_maximum = UINT32_MAX,
	 .semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
     .reference_group = 0},
    UINT_FIELD(2, "source_action", 8, 0),
    {.field_id = 3,
     .type = SPAGHETTI_VALUE_UINT64,
     .name = "target_key",
     .description = "",
     .unit = "",
     .flags = SPAGHETTI_FIELD_REQUIRED,
     .unsigned_minimum = 1,
     .unsigned_maximum = UINT32_MAX,
     .semantic = SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF,
     .reference_group = 2},
    {.field_id = 4,
     .type = SPAGHETTI_VALUE_UINT64,
     .name = "command_id",
     .description = "",
     .unit = "",
     .flags = SPAGHETTI_FIELD_REQUIRED,
     .unsigned_minimum = 1,
     .unsigned_maximum = 8,
     .semantic = SPAGHETTI_FIELD_SEMANTIC_COMMAND_REF,
     .reference_group = 2},
    UINT_FIELD(5, "source_field", UINT16_MAX, 0),
    UINT_FIELD(6, "argument_id", 8, 0),
    UINT_FIELD(7, "constant", UINT64_MAX, 0),
	UINT_FIELD(8, "trigger", 4, 0),
};
static const struct spaghetti_schema_descriptor schema = {
    .schema_id = "spaghetti.action.config",
    .version = 1,
    .fields = fields,
    .field_count = ARRAY_SIZE(fields),
};
static uint64_t number(const struct spaghetti_property_set *config, uint16_t id)
{
  const struct spaghetti_value *v = spaghetti_property_find(config, id);
  return v ? v->data.unsigned_integer : 0;
}
static int validate(const struct spaghetti_property_set *config)
{
  int err = spaghetti_property_validate(config, &schema);
	if (err < 0) {
    return err;
	}
	if ((number(config, 8) == 1 || number(config, 8) == 2) && !number(config, 5)) {
    return -EINVAL;
	}
	if (number(config, 6) && !number(config, 5) && spaghetti_property_find(config, 7) == NULL) {
    return -EINVAL;
	}
	if (number(config, 8) >= 3 && !number(config, 6)) {
		return -EINVAL;
	}
  return 0;
}
static int init(const struct spaghetti_property_set *config, void **out)
{
	if (out == NULL) {
    return -EINVAL;
	}
  int err = validate(config);
	if (err < 0) {
    return err;
	}
  struct action_context *context = k_calloc(1, sizeof(*context));
	if (context == NULL) {
    return -ENOMEM;
	}
	*context =
		(struct action_context){.source = number(config, 1),
      .source_action = number(config, 2),
      .target = number(config, 3),
      .command = number(config, 4),
      .source_field = number(config, 5),
      .argument = number(config, 6),
      .constant = number(config, 7),
      .mode = number(config, 8),
      .has_constant = spaghetti_property_find(config, 7) != NULL};
  *out = context;
  return 0;
}
static int on_record(void *opaque, const struct spaghetti_record *record,
		     spaghetti_rule_emit_action_cb_t emit, void *user)
{
	if (opaque == NULL || record == NULL || emit == NULL) {
    return -EINVAL;
	}
  struct action_context *context = opaque;
  if (record->source_key != context->source ||
	    (context->source_action && record->payload.action_id != context->source_action)) {
    return 0;
	}
  const struct spaghetti_value *value =
		context->source_field
			? spaghetti_property_find(&record->payload.values, context->source_field)
                            : NULL;
	if (context->source_field && value == NULL) {
    return 0;
	}
  bool level = false;
  if (value) {
		if (value->type == SPAGHETTI_VALUE_BOOL) {
      level = value->data.boolean;
		} else if (value->type == SPAGHETTI_VALUE_INT64) {
      level = value->data.signed_integer != 0;
		} else if (value->type == SPAGHETTI_VALUE_UINT64) {
      level = value->data.unsigned_integer != 0;
		} else if (context->mode == 1 || context->mode == 2) {
      return -ENOTSUP;
  }
	}
  bool fires =
		context->mode == 0 || context->mode >= 3 ||
		(context->mode == 1 ? level && !context->previous : !level && context->previous);
  if (!fires) {
    context->previous = level;
    return 0;
  }
  struct spaghetti_rule_action *action = k_calloc(1, sizeof(*action));
	if (action == NULL) {
    return -ENOMEM;
	}
  action->target_key = context->target;
  action->command.command_id = context->command;
  if (context->argument) {
    action->command.arguments.field_count = 1;
    struct spaghetti_value *argument = &action->command.arguments.fields[0];
    if (context->has_constant) {
      argument->type = SPAGHETTI_VALUE_UINT64;
      argument->data.unsigned_integer = context->constant;
		} else {
      *argument = *value;
		}
    argument->field_id = context->argument;
  }
	action->command.update_only = context->mode >= 3;
	action->command.trigger_pending = context->mode <= 2;
  int err = emit(action, user);
	if (err == 0 && context->mode == 4) {
		action->command.update_only = false;
		action->command.arguments.field_count = 0;
		err = emit(action, user);
		if (err == -ENOENT) {
			err = 0; /* Waiting for another required input. */
		}
	}
  k_free(action);
	if (err == 0) {
    context->previous = level;
	}
  return err;
}
static int deinit(void *context)
{
	if (context == NULL) {
    return -EINVAL;
	}
  k_free(context);
  return 0;
}
static const struct spaghetti_rule_driver_ops ops = {
    .validate_config = validate,
    .init = init,
    .on_record = on_record,
    .deinit = deinit,
};
SPAGHETTI_RULE_DRIVER_DEFINE(spaghetti_device_action_rule_driver) = {
    .type_id = "device-action",
    .api_version = SPAGHETTI_RULE_DRIVER_API_VERSION,
    .config_schema = &schema,
    .ops = &ops,
};
