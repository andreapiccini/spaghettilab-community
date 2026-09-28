#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.audit",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_get_audit_log(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t cursor = 1U;
	uint32_t limit = 8U;
	uint32_t next_cursor = 0U;
	size_t written = 0U;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_optional_u32(request, 0U, 1U, &cursor);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_optional_u32(request, 1U, 8U, &limit);
	if (err < 0) {
		return err;
	}
	if (cursor == 0U) {
		cursor = 1U;
	}
	if (limit == 0U) {
		limit = 8U;
	}

	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 2U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_list_start_encode(state, limit)) {
			return -EMSGSIZE;
		}
		for (uint32_t seq = cursor;
		     (written < limit) && (seq < (cursor + 64U)); ++seq) {
			struct spaghetti_audit_entry entry;
			int get_err = spaghetti_audit_get(seq, &entry);

			if (get_err == -ENOENT) {
				continue;
			}
			if (get_err < 0) {
				return get_err;
			}
			if (!zcbor_map_start_encode(state, 5U) ||
			    !zcbor_uint32_put(state, 0U) ||
			    !zcbor_uint32_put(state, entry.sequence) ||
			    !zcbor_uint32_put(state, 1U) ||
			    !zcbor_uint32_put(state, entry.principal_id) ||
			    !zcbor_uint32_put(state, 2U) ||
			    !zcbor_uint32_put(state, entry.operation_id) ||
			    !zcbor_uint32_put(state, 3U) ||
			    !zcbor_int32_put(state, entry.internal_result) ||
			    !zcbor_uint32_put(state, 4U) ||
			    !zcbor_int64_put(state, entry.uptime_ms) ||
			    !zcbor_map_end_encode(state, 5U)) {
				return -EMSGSIZE;
			}
			++written;
			next_cursor = seq + 1U;
		}
		if (written == 0U) {
			next_cursor = 0U;
		}
		if (!zcbor_list_end_encode(state, limit) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, next_cursor) ||
		    !zcbor_map_end_encode(state, 2U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_audit_log) = {
	.operation = SPAGHETTI_PROTOCOL_GET_AUDIT_LOG,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_audit_log,
};
