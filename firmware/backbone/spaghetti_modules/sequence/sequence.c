/* Nonblocking sequence source. The existing runtime schedule clocks it; no
 * thread, workqueue sleep, or ISR callback is added. Program: <=8 x 8-byte rows. */
#include <errno.h>
#include <spaghetti/device_profile.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/schema.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/util.h>

struct sequence_context {
	uint8_t program[64];
	uint8_t count, index;
	bool running, paused, repeat, waiting, waiting_motion;
	int64_t deadline, paused_at;
	uint32_t motion_completed;
};
#define TEXT_FIELD(n)                                                                              \
	{.field_id = n,                                                                            \
	 .type = SPAGHETTI_VALUE_TEXT,                                                             \
	 .flags = SPAGHETTI_FIELD_REQUIRED,                                                        \
	 .name = "program",                                                                        \
	 .unit = "",                                                                               \
	 .description = ""}
#define BOOL_FIELD(n, label)                                                                       \
	{.field_id = n,                                                                            \
	 .type = SPAGHETTI_VALUE_BOOL,                                                             \
	 .flags = SPAGHETTI_FIELD_REQUIRED,                                                        \
	 .name = label,                                                                            \
	 .unit = "",                                                                               \
	 .description = ""}
static const struct spaghetti_field_descriptor config_fields[] = {
    TEXT_FIELD(1), TEXT_FIELD(2),	    TEXT_FIELD(3),
    TEXT_FIELD(4), BOOL_FIELD(5, "repeat"), BOOL_FIELD(6, "autostart"),
    TEXT_FIELD(7),
};
static const struct spaghetti_schema_descriptor config_schema = {
    .schema_id = "spaghetti.sequence.config",
    .version = 1,
    .fields = config_fields,
    .field_count = ARRAY_SIZE(config_fields),
};
static const struct spaghetti_field_descriptor event_fields[] = {
    {.field_id = 1,
     .type = SPAGHETTI_VALUE_BOOL,
     .name = "completed",
     .unit = "",
     .description = ""},
    {.field_id = 2,
     .type = SPAGHETTI_VALUE_INT64,
     .signed_minimum = INT64_MIN,
     .signed_maximum = INT64_MAX,
     .name = "error",
     .unit = "",
     .description = ""},
};
static const struct spaghetti_schema_descriptor event_schema = {
    .schema_id = "spaghetti.sequence.event",
    .version = 1,
    .fields = event_fields,
    .field_count = ARRAY_SIZE(event_fields),
};
static const struct spaghetti_schema_descriptor *const schemas[] = {&event_schema};
static const struct spaghetti_field_descriptor empty_fields[1];
static const struct spaghetti_schema_descriptor empty_schema = {
    .schema_id = "spaghetti.sequence.command",
    .version = 1,
    .fields = empty_fields,
    .field_count = 0,
};
static const struct spaghetti_command_descriptor commands[] = {
    {.command_id = 1, .name = "start", .argument_schema = &empty_schema},
    {.command_id = 2, .name = "pause", .argument_schema = &empty_schema},
    {.command_id = 3, .name = "stop", .argument_schema = &empty_schema},
};
static int hex_digit(char c)
{
	if (c >= '0' && c <= '9')
		return c - '0';
	if (c >= 'a' && c <= 'f')
		return c - 'a' + 10;
	return -1;
}
static int decode_program(const struct spaghetti_property_set *config, uint8_t *program,
			  uint8_t *count)
{
	size_t total = 0;
	for (unsigned f = 1; f <= 4; f++) {
		const struct spaghetti_text_value *text =
		    &spaghetti_property_find(config, f)->data.text;
		if (text->size > 32 || text->size % 16)
			return -EINVAL;
		for (size_t i = 0; i < text->size; i += 2) {
			int high = hex_digit(text->text[i]), low = hex_digit(text->text[i + 1]);
			if (high < 0 || low < 0)
				return -EINVAL;
			program[total++] = (high << 4) | low;
		}
	}
	if (!total || total > 64)
		return -EINVAL;
	for (size_t i = 0; i < total; i += 8) {
		const uint8_t *row = program + i;
		if (row[0] > 2)
			return -EINVAL;
		if (row[0] == 0) {
			uint32_t delay = sys_get_le32(row + 4);
			if (!delay || delay > 60000 || row[1] || row[2] || row[3])
				return -EINVAL;
		} else if (!row[1] || !row[2] || row[2] > 8 || row[3] > 8 ||
			   (row[0] == 2 && sys_get_le32(row + 4) > 360))
			return -EINVAL;
	}
	*count = total / 8;
	return 0;
}
static int validate(const struct spaghetti_property_set *config)
{
	int err = spaghetti_property_validate(config, &config_schema);
	if (err)
		return err;
	uint8_t program[64], count;
	return decode_program(config, program, &count);
}
static int endpoint(const struct spaghetti_property_set *config,
		    struct spaghetti_module_endpoint *out)
{
	int err = validate(config);
	if (!err && out)
		*out = (struct spaghetti_module_endpoint){.kind = SPAGHETTI_ENDPOINT_LOGICAL};
	return out ? err : -EINVAL;
}
static int init(struct spaghetti_module *module, const struct spaghetti_property_set *config)
{
	int err = validate(config);
	if (err)
		return err;
	struct sequence_context *ctx = k_calloc(1, sizeof(*ctx));
	if (!ctx)
		return -ENOMEM;
	err = decode_program(config, ctx->program, &ctx->count);
	if (err) {
		k_free(ctx);
		return err;
	}
	ctx->repeat = spaghetti_property_find(config, 5)->data.boolean;
	ctx->running = spaghetti_property_find(config, 6)->data.boolean;
	module->context = ctx;
	return 0;
}
static void control_motors(struct sequence_context *ctx, unsigned command)
{
	for (unsigned i = 0; i < ctx->count; i++) {
		const uint8_t *row = ctx->program + i * 8;
		if (!row[0])
			continue;
		if (command == 3)
			(void)spaghetti_device_profile_motion_stop(row[1]);
		else
			(void)spaghetti_device_profile_motion_pause(row[1], command == 2);
	}
}
static int command(struct spaghetti_module *module, const struct spaghetti_module_command *cmd)
{
	struct sequence_context *ctx = module->context;
	if (!ctx || cmd->update_only)
		return -EINVAL;
	switch (cmd->command_id) {
	case 1:
		if (ctx->paused) {
			ctx->deadline += k_uptime_get() - ctx->paused_at;
			control_motors(ctx, 1);
		} else if (!ctx->running) {
			ctx->index = 0;
			ctx->waiting = false;
		}
		ctx->paused = false;
		ctx->running = true;
		return 0;
	case 2:
		if (ctx->running && !ctx->paused) {
			ctx->paused = true;
			ctx->paused_at = k_uptime_get();
			control_motors(ctx, 2);
		}
		return 0;
	case 3:
		ctx->running = false;
		ctx->paused = false;
		ctx->index = 0;
		ctx->waiting = false;
		control_motors(ctx, 3);
		return 0;
	default:
		return -ENOTSUP;
	}
}
static int stop(struct spaghetti_module *module)
{
	const struct spaghetti_module_command cmd = {.command_id = 3};
	return command(module, &cmd);
}
static int event(struct spaghetti_record_payload *out, int error)
{
	memset(out, 0, sizeof(*out));
	strcpy(out->schema_id, event_schema.schema_id);
	out->schema_version = 1;
	out->kind = SPAGHETTI_RECORD_EVENT;
	out->values.field_count = 1;
	out->values.fields[0].field_id = error ? 2 : 1;
	out->values.fields[0].type = error ? SPAGHETTI_VALUE_INT64 : SPAGHETTI_VALUE_BOOL;
	if (error)
		out->values.fields[0].data.signed_integer = error;
	else
		out->values.fields[0].data.boolean = true;
	return 0;
}
static int read(struct spaghetti_module *module, struct spaghetti_record_payload *out)
{
	struct sequence_context *ctx = module->context;
	if (!ctx->running || ctx->paused)
		return -EAGAIN;
	const uint8_t *row = ctx->program + ctx->index * 8;
	int64_t now = k_uptime_get();
	int err = 0;
	if (ctx->waiting) {
		if (ctx->waiting_motion) {
			struct spaghetti_motion_status status;
			err = spaghetti_device_profile_motion_status(row[1], &status);
			if (err)
				goto fail;
			if (status.error) {
				err = status.error;
				goto fail;
			}
			if (status.completed == ctx->motion_completed) {
				if (!status.busy && !status.paused) {
					err = -ECANCELED;
					goto fail;
				}
				if (now >= ctx->deadline) {
					err = -ETIMEDOUT;
					goto fail;
				}
				return -EAGAIN;
			}
		} else if (now < ctx->deadline)
			return -EAGAIN;
		ctx->waiting = false;
		ctx->index++;
	} else if (!row[0]) {
		ctx->waiting = true;
		ctx->waiting_motion = false;
		ctx->deadline = now + sys_get_le32(row + 4);
		return -EAGAIN;
	} else {
		struct spaghetti_module_snapshot target;
		err = spaghetti_module_manager_get_by_key(row[1], &target);
		if (err)
			goto fail;
		if (row[0] == 2) {
			struct spaghetti_motion_status status;
			err = spaghetti_device_profile_motion_status(row[1], &status);
			if (err)
				goto fail;
			ctx->motion_completed = status.completed;
		}
		struct spaghetti_module_command *cmd = k_calloc(1, sizeof(*cmd));
		if (!cmd) {
			err = -ENOMEM;
			goto fail;
		}
		cmd->command_id = row[2];
		if (row[3]) {
			cmd->arguments.field_count = 1;
			cmd->arguments.fields[0].field_id = row[3];
			cmd->arguments.fields[0].type = SPAGHETTI_VALUE_UINT64;
			cmd->arguments.fields[0].data.unsigned_integer = sys_get_le32(row + 4);
		}
		err = spaghetti_module_manager_command(target.id, cmd);
		k_free(cmd);
		if (err)
			goto fail;
		if (row[0] == 2) {
			ctx->waiting = true;
			ctx->waiting_motion = true;
			ctx->deadline = now + 60000;
			return -EAGAIN;
		}
		ctx->index++;
	}
	if (ctx->index == ctx->count) {
		ctx->index = 0;
		ctx->running = ctx->repeat;
		return event(out, 0);
	}
	return -EAGAIN;
fail:
	(void)stop(module);
	return event(out, err);
}
static int deinit(struct spaghetti_module *module)
{
	(void)stop(module);
	k_free(module->context);
	module->context = NULL;
	return 0;
}
static const struct spaghetti_module_driver_ops ops = {
    .validate_config = validate,
    .describe_endpoint = endpoint,
    .init = init,
    .read = read,
    .command = command,
    .stop = NULL,
    .deinit = deinit,
};
SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_sequence_driver) = {
    .type_id = "sequence",
    .api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
    .transport = SPAGHETTI_PORT_TRANSPORT_I2C,
    .config_schema = &config_schema,
    .record_schemas = schemas,
    .record_schema_count = 1,
    .commands = commands,
    .command_count = ARRAY_SIZE(commands),
    .ops = &ops,
};
