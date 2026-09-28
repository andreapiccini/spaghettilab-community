#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/resources.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.resources",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static bool encode_pool(zcbor_state_t *state, uint32_t key,
			const struct spaghetti_resource_pool_stats *pool)
{
	return zcbor_uint32_put(state, key) &&
	       zcbor_map_start_encode(state, 3U) &&
	       zcbor_uint32_put(state, 0U) &&
	       zcbor_uint32_put(state, pool->capacity) &&
	       zcbor_uint32_put(state, 1U) &&
	       zcbor_uint32_put(state, pool->used) &&
	       zcbor_uint32_put(state, 2U) &&
	       zcbor_uint32_put(state, pool->peak) &&
	       zcbor_map_end_encode(state, 3U);
}

static int execute_get_resources(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	struct spaghetti_resources_snapshot snap;
	int err;

	ARG_UNUSED(context);
	ARG_UNUSED(request);
	err = spaghetti_resources_get_snapshot(&snap);
	if (err < 0) {
		return err;
	}
	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 16U);

		if (!zcbor_map_start_encode(state, 12U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_bstr_encode_ptr(state, snap.feature_set_hash,
					   sizeof(snap.feature_set_hash)) ||
		    !encode_pool(state, 1U, &snap.modules) ||
		    !encode_pool(state, 2U, &snap.rules) ||
		    !encode_pool(state, 3U, &snap.blocks) ||
		    !encode_pool(state, 4U, &snap.profiles) ||
		    !encode_pool(state, 5U, &snap.records) ||
		    !encode_pool(state, 6U, &snap.workspace) ||
		    !zcbor_uint32_put(state, 7U) ||
		    !zcbor_uint32_put(state, snap.allocation_failures) ||
		    !zcbor_uint32_put(state, 8U) ||
		    !zcbor_uint32_put(state, snap.flash_slot_bytes) ||
		    !zcbor_uint32_put(state, 9U) ||
		    !zcbor_uint32_put(state, snap.flash_image_budget_bytes) ||
		    !zcbor_uint32_put(state, 10U) ||
		    !zcbor_uint32_put(state, snap.flash_headroom_bytes) ||
		    !zcbor_uint32_put(state, 11U) ||
		    !zcbor_uint32_put(state, snap.static_ram_budget_bytes) ||
		    !zcbor_map_end_encode(state, 12U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_resources) = {
	.operation = SPAGHETTI_PROTOCOL_GET_RESOURCES,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_resources,
};
