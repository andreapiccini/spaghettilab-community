#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <spaghetti/access_control.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/schema.h>
#include <spaghetti/device_profile.h>
#include <zephyr/kernel.h>

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
	struct spaghetti_module_command *command;
	struct spaghetti_record_payload *record;
	struct spaghetti_profile_rx_capture rx = {0};
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
	if (command_id == 0U || command_id > UINT16_MAX) return -EINVAL;
	command = k_calloc(1, sizeof(*command));
	record = k_calloc(1, sizeof(*record));
	if (command == NULL || record == NULL) { k_free(command); k_free(record); return -ENOMEM; }
	command->command_id = command_id;
	command->result = record;
	err = spaghetti_ops_decode_arguments(request, &command->arguments);
	if (err == 0) {
		spaghetti_device_profile_capture_command_begin();
		err = spaghetti_module_manager_command(snapshot.id, command);
		spaghetti_device_profile_capture_finish(&rx);
	}
	k_free(command);
	if (err < 0) { k_free(record); return err; }
	if (record->schema_id[0] == '\0') { k_free(record); return spaghetti_ops_encode_empty_map(response); }
	ZCBOR_STATE_E(state, 6, response->bytes, sizeof(response->bytes), 1U);
	bool ok = zcbor_map_start_encode(state, 3U) && zcbor_uint32_put(state, 0U) && zcbor_map_start_encode(state, record->values.field_count);
	for (size_t i = 0; ok && i < record->values.field_count; ++i) {
		const struct spaghetti_value *value = &record->values.fields[i];
		ok = zcbor_uint32_put(state, value->field_id);
		if (value->type == SPAGHETTI_VALUE_INT64) ok = ok && zcbor_int64_put(state, value->data.signed_integer);
		else if (value->type == SPAGHETTI_VALUE_UINT64) ok = ok && zcbor_uint64_put(state, value->data.unsigned_integer);
		else ok = false;
	}
	ok = ok && zcbor_map_end_encode(state, record->values.field_count) && zcbor_uint32_put(state, 1U) && zcbor_list_start_encode(state, rx.count);
	for (size_t i = 0; ok && i < rx.count; ++i) ok = zcbor_bstr_encode_ptr(state, rx.bytes[i], rx.lengths[i]);
	ok = ok && zcbor_list_end_encode(state, rx.count) && zcbor_uint32_put(state, 2U) && zcbor_bool_put(state, rx.truncated) && zcbor_map_end_encode(state, 3U);
	k_free(record);
	if (!ok) return -EMSGSIZE;
	response->size = state->payload - response->bytes;
	return 0;
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_module_command) = {
	.operation = SPAGHETTI_PROTOCOL_MODULE_COMMAND,
	.required_permissions = SPAGHETTI_PERMISSION_COMMAND,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_module_command,
};
