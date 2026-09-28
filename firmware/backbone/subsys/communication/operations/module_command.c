#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <spaghetti/access_control.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/schema.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.module_command",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_module_command(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t key = 0U;
	uint32_t command_id = 0U;
	struct spaghetti_module_snapshot snapshot;
	struct spaghetti_module_command command = {0};
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &key);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_u32(request, 1U, &command_id);
	if (err < 0) {
		return err;
	}
	err = spaghetti_module_manager_get_by_key(key, &snapshot);
	if (err < 0) {
		return err;
	}
	command.command_id = (uint16_t)command_id;
	err = spaghetti_module_manager_command(snapshot.id, &command);
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_empty_map(response);
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_module_command) = {
	.operation = SPAGHETTI_PROTOCOL_MODULE_COMMAND,
	.required_permissions = SPAGHETTI_PERMISSION_COMMAND,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_module_command,
};
