#include "../communication_internal.h"
#include <errno.h>
#include <spaghetti/access_control.h>
#include <spaghetti/protocol.h>
#include <zcbor_encode.h>
#include <zephyr/kernel.h>
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN)
#include "../../services/ota/can_rpc.h"
#endif
static const struct spaghetti_schema_descriptor can_schema = {
    .schema_id = "spaghetti.protocol.can",
    .version = 1U,
};
static int execute_can_request(const struct spaghetti_request_context *context,
                               const struct spaghetti_protocol_payload *request,
                               struct spaghetti_protocol_payload *response)
{
	ARG_UNUSED(context);
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN)
	uint32_t node;
	const uint8_t *bytes;
	size_t length, written;
	int err = spaghetti_ops_decode_u32(request, 0, &node);
	if (!err) {
		err = spaghetti_ops_decode_bstr(request, 1, &bytes, &length);
	}
	if (err) {
		return err;
	}
	struct spaghetti_protocol_request *inner = k_malloc(sizeof(*inner));
	if (!inner) {
		return -ENOMEM;
	}
	err = spaghetti_protocol_decode_request(bytes, length, inner);
	if (!err && !spaghetti_can_rpc_operation_allowed(inner->operation)) {
		err = -EACCES;
	}
	k_free(inner);
	if (err) {
		return err;
	}
	uint8_t *result = k_malloc(sizeof(response->bytes) - 8U);
	if (!result) {
		return -ENOMEM;
	}
	err = spaghetti_can_rpc_exchange(node, bytes, length, result, sizeof(response->bytes) - 8U,
	                                 &written);
	if (!err) {
		ZCBOR_STATE_E(state, 3, response->bytes, sizeof(response->bytes), 1);
		if (!zcbor_map_start_encode(state, 1) || !zcbor_uint32_put(state, 0) ||
		    !zcbor_bstr_encode_ptr(state, result, written) ||
		    !zcbor_map_end_encode(state, 1)) {
			err = -EMSGSIZE;
		} else {
			response->size = state->payload - response->bytes;
		}
	}
	k_free(result);
	return err;
#else
	ARG_UNUSED(request);
	ARG_UNUSED(response);
	return -ENOTSUP;
#endif
}
SPAGHETTI_OPERATION_HANDLER_DEFINE(op_can_request) = {
    .operation = SPAGHETTI_PROTOCOL_CAN_REQUEST,
    .required_permissions = SPAGHETTI_PERMISSION_READ | SPAGHETTI_PERMISSION_CONFIGURE |
                            SPAGHETTI_PERMISSION_COMMAND,
    .execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
    .request_schema = &can_schema,
    .response_schema = &can_schema,
    .execute = execute_can_request,
};
