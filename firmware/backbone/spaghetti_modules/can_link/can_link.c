#include <errno.h>
#include <math.h>
#include <spaghetti/can_link.h>
#include <spaghetti/module_driver.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/byteorder.h>
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN)
#include "../../subsys/services/ota/field_update_internal.h"
#include <spaghetti/field_update.h>
#endif

#define SPAGHETTI_CAN_SIGNAL_MAX                                                                   \
	(5U + MAX(8U, MAX(SPAGHETTI_VALUE_BYTES_MAX, SPAGHETTI_VALUE_TEXT_MAX)))
struct can_link_context {
	struct can_link_context *next;
	uint32_t peer;
	uint16_t route;
	uint8_t tx_sequence, rx_sequence, received, expected;
	bool seen;
	uint8_t bytes[SPAGHETTI_CAN_SIGNAL_MAX];
	spaghetti_module_event_cb_t emit;
	void *user;
};
static K_MUTEX_DEFINE(links_lock);
static struct can_link_context *links;
static const struct spaghetti_field_descriptor config_fields[] = {
    {.field_id = 1,
     .type = SPAGHETTI_VALUE_UINT64,
     .flags = SPAGHETTI_FIELD_REQUIRED,
     .unsigned_minimum = 1,
     .unsigned_maximum = 0xffffff,
     .name = "peer",
     .description = "",
     .unit = ""},
    {.field_id = 2,
     .type = SPAGHETTI_VALUE_UINT64,
     .flags = SPAGHETTI_FIELD_REQUIRED,
     .unsigned_minimum = 1,
     .unsigned_maximum = 65535,
     .name = "route",
     .description = "",
     .unit = ""},
};
static const struct spaghetti_schema_descriptor config_schema = {
    .schema_id = "flow.can.config",
    .version = 1,
    .fields = config_fields,
    .field_count = ARRAY_SIZE(config_fields),
};
static const struct spaghetti_field_descriptor empty_fields[1];
static const struct spaghetti_schema_descriptor argument_schema = {
    .schema_id = "flow.can.value", .version = 1, .fields = empty_fields};
static const struct spaghetti_schema_descriptor event_schema = {
    .schema_id = "flow.can", .version = 1, .fields = empty_fields};
static const struct spaghetti_schema_descriptor *const event_schemas[] = {&event_schema};
static const struct spaghetti_command_descriptor commands[] = {
    {.command_id = 1, .name = "send", .argument_schema = &argument_schema}};
static int validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &config_schema);
}
static int endpoint(const struct spaghetti_property_set *config,
                    struct spaghetti_module_endpoint *out)
{
	int err = validate(config);
	if (err) {
		return err;
	}
	*out = (struct spaghetti_module_endpoint){.kind = SPAGHETTI_ENDPOINT_LOGICAL};
	return 0;
}
static int init(struct spaghetti_module *module, const struct spaghetti_property_set *config)
{
	struct can_link_context *ctx = k_calloc(1, sizeof(*ctx));
	if (!ctx) {
		return -ENOMEM;
	}
	ctx->peer = spaghetti_property_find(config, 1)->data.unsigned_integer;
	ctx->route = spaghetti_property_find(config, 2)->data.unsigned_integer;
	module->context = ctx;
	k_mutex_lock(&links_lock, K_FOREVER);
	ctx->next = links;
	links = ctx;
	k_mutex_unlock(&links_lock);
	return 0;
}
static int validate_command(struct spaghetti_module *module,
                            const struct spaghetti_module_command *command)
{
	ARG_UNUSED(module);
	if (command->command_id != 1 || command->update_only ||
	    command->arguments.field_count != 1 || command->arguments.fields[0].field_id != 1) {
		return -EINVAL;
	}
	const struct spaghetti_value *v = &command->arguments.fields[0];
	if (v->type > SPAGHETTI_VALUE_FLOAT ||
	    (v->type == SPAGHETTI_VALUE_TEXT && v->data.text.size > SPAGHETTI_VALUE_TEXT_MAX) ||
	    (v->type == SPAGHETTI_VALUE_BYTES && v->data.bytes.size > SPAGHETTI_VALUE_BYTES_MAX) ||
	    (v->type == SPAGHETTI_VALUE_FLOAT && !isfinite(v->data.decimal))) {
		return -EINVAL;
	}
	return 0;
}
static int command(struct spaghetti_module *module, const struct spaghetti_module_command *command)
{
	int err = validate_command(module, command);
	if (err) {
		return err;
	}
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN)
	struct can_link_context *ctx = module->context;
	const struct spaghetti_value *v = &command->arguments.fields[0];
	uint8_t bytes[SPAGHETTI_CAN_SIGNAL_MAX] = {0};
	size_t size = 0;
	sys_put_be24(spaghetti_field_update_local_node_id(), bytes);
	bytes[3] = v->type;
	switch (v->type) {
	case SPAGHETTI_VALUE_BOOL:
		size = 1;
		bytes[5] = v->data.boolean ? 1 : 0;
		break;
	case SPAGHETTI_VALUE_UINT64:
		size = 8;
		sys_put_le64(v->data.unsigned_integer, bytes + 5);
		break;
	case SPAGHETTI_VALUE_INT64:
		size = 8;
		sys_put_le64((uint64_t)v->data.signed_integer, bytes + 5);
		break;
	case SPAGHETTI_VALUE_FLOAT: {
		uint64_t raw;
		memcpy(&raw, &v->data.decimal, 8);
		size = 8;
		sys_put_le64(raw, bytes + 5);
		break;
	}
	case SPAGHETTI_VALUE_TEXT:
		size = v->data.text.size;
		memcpy(bytes + 5, v->data.text.text, size);
		break;
	case SPAGHETTI_VALUE_BYTES:
		size = v->data.bytes.size;
		memcpy(bytes + 5, v->data.bytes.bytes, size);
		break;
	default:
		return -EINVAL;
	}
	bytes[4] = size;
	size += 5;
	uint8_t sequence = ++ctx->tx_sequence;
	for (size_t offset = 0; offset < size; offset += 3) {
		uint8_t data[7] = {ctx->route >> 8, ctx->route, sequence, offset};
		size_t count = MIN(3U, size - offset);
		memcpy(data + 4, bytes + offset, count);
		err = spaghetti_field_update_can_ctrl(ctx->peer, SPAGHETTI_CAN_LINK_COMMAND, data,
		                                      4 + count);
		if (err) {
			return err;
		}
	}
	return 0;
#else
	return -ENOTSUP;
#endif
}
static int start(struct spaghetti_module *module, spaghetti_module_event_cb_t emit, void *user)
{
	struct can_link_context *ctx = module->context;
	k_mutex_lock(&links_lock, K_FOREVER);
	ctx->emit = emit;
	ctx->user = user;
	ctx->received = 0;
	ctx->seen = false;
	k_mutex_unlock(&links_lock);
	return 0;
}
static int stop(struct spaghetti_module *module)
{
	struct can_link_context *ctx = module->context;
	k_mutex_lock(&links_lock, K_FOREVER);
	ctx->emit = NULL;
	ctx->user = NULL;
	k_mutex_unlock(&links_lock);
	return 0;
}
static int deinit(struct spaghetti_module *module)
{
	struct can_link_context *ctx = module->context;
	k_mutex_lock(&links_lock, K_FOREVER);
	struct can_link_context **next = &links;
	while (*next && *next != ctx) {
		next = &(*next)->next;
	}
	if (*next) {
		*next = ctx->next;
	}
	k_mutex_unlock(&links_lock);
	k_free(ctx);
	module->context = NULL;
	return 0;
}
static int read(struct spaghetti_module *module, struct spaghetti_record_payload *out)
{
	ARG_UNUSED(module);
	ARG_UNUSED(out);
	return -EAGAIN;
}
void spaghetti_can_link_receive(const uint8_t *frame, uint8_t length)
{
	if (!frame || length < 6 || length > 8) {
		return;
	}
	uint16_t route = sys_get_be16(frame + 1);
	uint8_t seq = frame[3], offset = frame[4], count = length - 5;
	k_mutex_lock(&links_lock, K_FOREVER);
	for (struct can_link_context *ctx = links; ctx; ctx = ctx->next) {
		if (ctx->route != route || !ctx->emit) {
			continue;
		}
		if (offset == 0 && (count != 3 || sys_get_be24(frame + 5) != ctx->peer)) {
			continue;
		}
		if (offset == 0 && (!ctx->seen || ctx->rx_sequence != seq)) {
			ctx->seen = true;
			ctx->rx_sequence = seq;
			ctx->received = 0;
			ctx->expected = 0;
		}
		if (ctx->rx_sequence != seq || ctx->received != offset ||
		    offset + count > SPAGHETTI_CAN_SIGNAL_MAX) {
			continue;
		}
		memcpy(ctx->bytes + offset, frame + 5, count);
		ctx->received += count;
		if (ctx->received >= 5 && !ctx->expected) {
			size_t size = ctx->bytes[4];
			if (size > SPAGHETTI_CAN_SIGNAL_MAX - 5 ||
			    sys_get_be24(ctx->bytes) != ctx->peer) {
				ctx->received = 255;
				continue;
			}
			ctx->expected = size + 5;
		}
		if (!ctx->expected || ctx->received != ctx->expected) {
			continue;
		}
		ctx->received = 255; /* A duplicate final frame must not re-emit an action. */
		struct spaghetti_record_payload *record = k_calloc(1, sizeof(*record));
		if (!record) {
			continue;
		}
		record->kind = SPAGHETTI_RECORD_EVENT;
		record->schema_version = 1;
		strcpy(record->schema_id, "flow.can");
		record->values.field_count = 1;
		struct spaghetti_value *v = &record->values.fields[0];
		v->field_id = 1;
		v->type = ctx->bytes[3];
		const uint8_t *data = ctx->bytes + 5;
		size_t size = ctx->bytes[4];
		bool valid = true;
		switch (v->type) {
		case SPAGHETTI_VALUE_BOOL:
			valid = size == 1 && data[0] <= 1;
			v->data.boolean = data[0] != 0;
			break;
		case SPAGHETTI_VALUE_UINT64:
			valid = size == 8;
			if (valid) {
				v->data.unsigned_integer = sys_get_le64(data);
			}
			break;
		case SPAGHETTI_VALUE_INT64:
			valid = size == 8;
			if (valid) {
				v->data.signed_integer = (int64_t)sys_get_le64(data);
			}
			break;
		case SPAGHETTI_VALUE_FLOAT: {
			valid = size == 8;
			if (valid) {
				uint64_t raw = sys_get_le64(data);
				memcpy(&v->data.decimal, &raw, 8);
				valid = isfinite(v->data.decimal);
			}
			break;
		}
		case SPAGHETTI_VALUE_TEXT:
			valid = size <= SPAGHETTI_VALUE_TEXT_MAX;
			if (valid) {
				memcpy(v->data.text.text, data, size);
				v->data.text.size = size;
			}
			break;
		case SPAGHETTI_VALUE_BYTES:
			valid = size <= SPAGHETTI_VALUE_BYTES_MAX;
			if (valid) {
				memcpy(v->data.bytes.bytes, data, size);
				v->data.bytes.size = size;
			}
			break;
		default:
			valid = false;
			break;
		}
		if (valid) {
			(void)ctx->emit(record, ctx->user);
		}
		k_free(record);
	}
	k_mutex_unlock(&links_lock);
}
static const struct spaghetti_module_driver_ops ops = {.validate_config = validate,
                                                       .describe_endpoint = endpoint,
                                                       .init = init,
                                                       .read = read,
                                                       .command = command,
                                                       .validate_command = validate_command,
                                                       .start = start,
                                                       .stop = stop,
                                                       .deinit = deinit};
SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_can_link_driver) = {
    .type_id = "can-link",
    .api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
    .transport = SPAGHETTI_PORT_TRANSPORT_I2C,
    .required_capabilities = 0,
    .record_schemas = event_schemas,
    .record_schema_count = 1,
    .config_schema = &config_schema,
    .commands = commands,
    .command_count = ARRAY_SIZE(commands),
    .ops = &ops};
