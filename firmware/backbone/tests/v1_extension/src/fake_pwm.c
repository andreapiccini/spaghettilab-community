/**
 * @file
 * @brief Fake PWM Module: output config, UINT64 duty permille command.
 */

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/sys/util.h>

#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

enum {
	FAKE_PWM_CFG_LINE = 1U,
	FAKE_PWM_CMD_SET_DUTY = 1U,
	FAKE_PWM_CMD_FIELD_DUTY = 1U,
};

struct fake_pwm_context {
	bool used;
	uint8_t line;
	uint64_t duty_permille;
};

static struct fake_pwm_context contexts[CONFIG_SPAGHETTI_MAX_MODULES];
static uint64_t last_duty_permille;

static const struct spaghetti_field_descriptor config_fields[] = {
	{
		.field_id = FAKE_PWM_CFG_LINE,
		.type = SPAGHETTI_VALUE_UINT64,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0U,
		.unsigned_maximum = 4U,
		.name = "line",
		.description = "PWM connector signal",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor config_schema = {
	.schema_id = "spaghetti.fake_pwm.config",
	.version = 1U,
	.fields = config_fields,
	.field_count = ARRAY_SIZE(config_fields),
};

static const struct spaghetti_field_descriptor duty_fields[] = {
	{
		.field_id = FAKE_PWM_CMD_FIELD_DUTY,
		.type = SPAGHETTI_VALUE_UINT64,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_minimum = 0U,
		.unsigned_maximum = 1000U,
		.name = "duty_permille",
		.description = "Duty cycle in permille",
		.unit = "permille",
	},
};

static const struct spaghetti_schema_descriptor duty_schema = {
	.schema_id = "spaghetti.fake_pwm.set_duty",
	.version = 1U,
	.fields = duty_fields,
	.field_count = ARRAY_SIZE(duty_fields),
};

static const struct spaghetti_command_descriptor commands[] = {
	{
		.command_id = FAKE_PWM_CMD_SET_DUTY,
		.name = "set_duty",
		.argument_schema = &duty_schema,
	},
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
	line = spaghetti_property_find(config, FAKE_PWM_CFG_LINE);
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
		spaghetti_property_find(config, FAKE_PWM_CFG_LINE);

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

static int command_module(struct spaghetti_module *module,
			  const struct spaghetti_module_command *command)
{
	struct fake_pwm_context *ctx;
	const struct spaghetti_value *duty;

	if ((module == NULL) || (module->context == NULL) || (command == NULL)) {
		return -EINVAL;
	}
	if (command->command_id != FAKE_PWM_CMD_SET_DUTY) {
		return -ENOTSUP;
	}
	duty = spaghetti_property_find(&command->arguments,
				       FAKE_PWM_CMD_FIELD_DUTY);
	if ((duty == NULL) || (duty->type != SPAGHETTI_VALUE_UINT64) ||
	    (duty->data.unsigned_integer > 1000U)) {
		return -EINVAL;
	}
	ctx = module->context;
	ctx->duty_permille = duty->data.unsigned_integer;
	last_duty_permille = ctx->duty_permille;
	return 0;
}

static int deinit_module(struct spaghetti_module *module)
{
	struct fake_pwm_context *ctx;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}
	ctx = module->context;
	ctx->used = false;
	module->context = NULL;
	return 0;
}

uint64_t fake_pwm_last_duty_permille(void)
{
	return last_duty_permille;
}

static const struct spaghetti_module_driver_ops ops = {
	.validate_config = validate_config,
	.describe_endpoint = describe_endpoint,
	.init = init_module,
	.command = command_module,
	.deinit = deinit_module,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_fake_pwm_driver) = {
	.type_id = "fake_pwm",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT,
	.transport = SPAGHETTI_PORT_TRANSPORT_GPIO,
	.power_requirement = { .declared = false },
	.config_schema = &config_schema,
	.record_schemas = NULL,
	.record_schema_count = 0U,
	.commands = commands,
	.command_count = ARRAY_SIZE(commands),
	.ops = &ops,
};
