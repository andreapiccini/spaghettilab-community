#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/capabilities.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.capabilities",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_get_capabilities(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	struct spaghetti_capabilities caps;
	int err;

	ARG_UNUSED(context);
	ARG_UNUSED(request);
	err = spaghetti_capabilities_get(&caps);
	if (err < 0) {
		return err;
	}
	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 8U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_uint32_put(state, (uint32_t)caps.resource_profile) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, caps.build_capabilities) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_tstr_put_term(state, caps.core_variant,
					 sizeof(caps.core_variant)) ||
		    !zcbor_uint32_put(state, 3U) ||
		    !zcbor_uint32_put(state, caps.max_protocol_payload) ||
		    !zcbor_uint32_put(state, 4U) ||
		    !zcbor_uint32_put(state, caps.max_inflight_requests) ||
		    !zcbor_uint32_put(state, 5U) ||
		    !zcbor_uint32_put(state, caps.replay_window_ms) ||
		    !zcbor_uint32_put(state, 6U) ||
		    !zcbor_uint32_put(state, caps.max_modules) ||
		    !zcbor_uint32_put(state, 7U) ||
		    !zcbor_uint32_put(state, caps.max_principals) ||
		    !zcbor_map_end_encode(state, 8U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_capabilities) = {
	.operation = SPAGHETTI_PROTOCOL_GET_CAPABILITIES,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_capabilities,
};
