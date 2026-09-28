#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_decode.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/core.h>
#include <spaghetti/ota.h>
#include <spaghetti/update.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.update",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_get_update_status(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	struct spaghetti_update_status status;
	int err;

	ARG_UNUSED(context);
	ARG_UNUSED(request);
	err = spaghetti_update_get_status(&status);
	if (err < 0) {
		return err;
	}
	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 5U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_uint32_put(state, (uint32_t)status.state) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, (uint32_t)status.transport) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_uint32_put(state, status.timeout_remaining_ms) ||
		    !zcbor_uint32_put(state, 3U) ||
		    !zcbor_uint32_put(state, status.active_slot) ||
		    !zcbor_uint32_put(state, 4U) ||
		    !zcbor_bool_put(state, status.image_confirmed) ||
		    !zcbor_map_end_encode(state, 5U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

static int decode_ble_begin(
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_ble_update_begin *out)
{
	uint32_t decoded_key;
	uint32_t image_size = 0U;
	struct zcbor_string sha = {0};
	struct zcbor_string version = {0};
	bool have_size = false;
	bool have_sha = false;
	bool have_version = false;

	ZCBOR_STATE_D(state, SPAGHETTI_OPS_CBOR_BACKUP, request->bytes,
		       request->size, 1U, 0U);

	if ((request == NULL) || (out == NULL)) {
		return -EINVAL;
	}
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	while (!zcbor_array_at_end(state)) {
		if (!zcbor_uint32_decode(state, &decoded_key)) {
			return -EBADMSG;
		}
		if (decoded_key == 0U) {
			if (!zcbor_uint32_decode(state, &image_size)) {
				return -EBADMSG;
			}
			have_size = true;
		} else if (decoded_key == 1U) {
			if (!zcbor_bstr_decode(state, &sha)) {
				return -EBADMSG;
			}
			have_sha = true;
		} else if (decoded_key == 2U) {
			if (!zcbor_tstr_decode(state, &version)) {
				return -EBADMSG;
			}
			have_version = true;
		} else if (!zcbor_any_skip(state, NULL)) {
			return -EBADMSG;
		}
	}
	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}
	if (!have_size || !have_sha || !have_version ||
	    (sha.len != sizeof(out->image_sha256)) ||
	    (version.len == 0U) ||
	    (version.len >= SPAGHETTI_CORE_VERSION_SIZE)) {
		return -EINVAL;
	}

	memset(out, 0, sizeof(*out));
	out->image_size = image_size;
	memcpy(out->image_sha256, sha.value, sizeof(out->image_sha256));
	memcpy(out->version, version.value, version.len);
	out->version[version.len] = '\0';
	return 0;
}

static int execute_open_ble_update(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	struct spaghetti_ble_update_begin begin;
	uint32_t session_id = 0U;
	const uint32_t key = 0U;
	int err;

	err = decode_ble_begin(request, &begin);
	if (err < 0) {
		return err;
	}
	spaghetti_ota_ble_set_acting_principal(context->principal_id);
	err = spaghetti_ota_ble_open(&begin, &session_id);
	spaghetti_ota_ble_set_acting_principal(0U);
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_u32_map(response, &key, &session_id, 1U);
}

static int execute_write_ble_update(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t session_id = 0U;
	uint32_t offset = 0U;
	const uint8_t *bytes = NULL;
	size_t size = 0U;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &session_id);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_u32(request, 1U, &offset);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_bstr(request, 2U, &bytes, &size);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ota_ble_write(session_id, offset, bytes, size);
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_empty_map(response);
}

static int execute_finish_ble_update(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t session_id = 0U;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &session_id);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ota_ble_finish(session_id);
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_empty_map(response);
}

static int execute_cancel_ble_update(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t session_id = 0U;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &session_id);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ota_ble_cancel(session_id);
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_empty_map(response);
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_update_status) = {
	.operation = SPAGHETTI_PROTOCOL_GET_UPDATE_STATUS,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_update_status,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_open_ble_update) = {
	.operation = SPAGHETTI_PROTOCOL_OPEN_BLE_UPDATE,
	.required_permissions = SPAGHETTI_PERMISSION_UPDATE,
	.execution = SPAGHETTI_OPERATION_ASYNC_JOB,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_open_ble_update,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_write_ble_update) = {
	.operation = SPAGHETTI_PROTOCOL_WRITE_BLE_UPDATE,
	.required_permissions = SPAGHETTI_PERMISSION_UPDATE,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_write_ble_update,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_finish_ble_update) = {
	.operation = SPAGHETTI_PROTOCOL_FINISH_BLE_UPDATE,
	.required_permissions = SPAGHETTI_PERMISSION_UPDATE,
	.execution = SPAGHETTI_OPERATION_ASYNC_JOB,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_finish_ble_update,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_cancel_ble_update) = {
	.operation = SPAGHETTI_PROTOCOL_CANCEL_BLE_UPDATE,
	.required_permissions = SPAGHETTI_PERMISSION_UPDATE,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_cancel_ble_update,
};
