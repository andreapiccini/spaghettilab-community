#include <on_boot.h>

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

LOG_MODULE_REGISTER(spaghetti_on_boot, CONFIG_SPAGHETTI_ON_BOOT_LOG_LEVEL);

/*
 * On Boot has no hardware of its own to own: required_capabilities = 0 means
 * describe_endpoint alone decides the Port transport actually acquired (see
 * module_manager.c's transport_for_endpoint()). 0x00 is the I2C General Call
 * address, reserved by the I2C specification and never assigned to a real
 * peripheral, so binding here can never collide with a genuine I2C device —
 * and because I2C is a shareable transport, other Modules keep using the same
 * Port. On Boot never actually issues an I2C transfer.
 */
#define SPAGHETTI_ON_BOOT_RESERVED_I2C_ADDRESS 0x00U

struct spaghetti_on_boot_context {
	bool running;
};

K_MEM_SLAB_DEFINE(on_boot_context_slab,
		  sizeof(struct spaghetti_on_boot_context),
		  CONFIG_SPAGHETTI_ON_BOOT_MAX_INSTANCES,
		  __alignof__(struct spaghetti_on_boot_context));

static const struct spaghetti_field_descriptor on_boot_config_fields[1];

static const struct spaghetti_schema_descriptor on_boot_config_schema = {
	.schema_id = "spaghetti.on_boot.config",
	.version = 1U,
	.fields = on_boot_config_fields,
	.field_count = 0U,
};

static int on_boot_validate_config(const struct spaghetti_property_set *config)
{
	if (config == NULL) {
		return -EINVAL;
	}

	return spaghetti_property_validate(config, &on_boot_config_schema);
}

static int on_boot_describe_endpoint(const struct spaghetti_property_set *config,
				     struct spaghetti_module_endpoint *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = on_boot_validate_config(config);
	if (err < 0) {
		return err;
	}

	const struct spaghetti_module_endpoint endpoint = {
		.kind = SPAGHETTI_ENDPOINT_I2C_ADDRESS,
		.value_size = 1U,
		.value = {SPAGHETTI_ON_BOOT_RESERVED_I2C_ADDRESS},
	};

	*out = endpoint;
	return 0;
}

static void on_boot_free_context(struct spaghetti_on_boot_context *context)
{
	memset(context, 0, sizeof(*context));
	k_mem_slab_free(&on_boot_context_slab, context);
}

static int on_boot_init(struct spaghetti_module *module,
			const struct spaghetti_property_set *config)
{
	struct spaghetti_on_boot_context *context;
	void *context_block;
	int err;

	if ((module == NULL) || (module->context != NULL)) {
		return -EINVAL;
	}

	err = on_boot_validate_config(config);
	if (err < 0) {
		return err;
	}

	err = k_mem_slab_alloc(&on_boot_context_slab, &context_block, K_NO_WAIT);
	if (err < 0) {
		return -ENOMEM;
	}

	context = context_block;
	memset(context, 0, sizeof(*context));
	module->context = context;
	return 0;
}

static int on_boot_start(struct spaghetti_module *module,
			 spaghetti_module_event_cb_t emit,
			 void *emit_user_data)
{
	struct spaghetti_on_boot_context *context;
	struct spaghetti_record_payload payload = {0};

	if ((module == NULL) || (module->context == NULL) || (emit == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	if (context->running) {
		return -EALREADY;
	}
	context->running = true;

	payload.kind = SPAGHETTI_RECORD_EVENT;
	(void)snprintf(payload.schema_id, sizeof(payload.schema_id),
		      "spaghetti.on_boot.event");
	payload.schema_version = 1U;
	payload.values.field_count = 0U;

	return emit(&payload, emit_user_data);
}

static int on_boot_stop(struct spaghetti_module *module)
{
	struct spaghetti_on_boot_context *context;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	context->running = false;
	return 0;
}

static int on_boot_deinit(struct spaghetti_module *module)
{
	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	on_boot_free_context(module->context);
	module->context = NULL;
	module->state = SPAGHETTI_MODULE_UNINITIALIZED;
	return 0;
}

static const struct spaghetti_module_driver_ops on_boot_ops = {
	.validate_config = on_boot_validate_config,
	.describe_endpoint = on_boot_describe_endpoint,
	.init = on_boot_init,
	.read = NULL,
	.command = NULL,
	.start = on_boot_start,
	.stop = on_boot_stop,
	.deinit = on_boot_deinit,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_on_boot_driver) = {
	.type_id = "on_boot",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = 0U,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.power_requirement = { .declared = false },
	.config_schema = &on_boot_config_schema,
	.record_schemas = NULL,
	.record_schema_count = 0U,
	.commands = NULL,
	.command_count = 0U,
	.ops = &on_boot_ops,
};
