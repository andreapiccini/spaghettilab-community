#include <spaghetti/protocol.h>

#include <errno.h>
#include <zcbor_encode.h>
#include <spaghetti/access_control.h>
#include <spaghetti/physical.h>
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
#include <spaghetti/field_update.h>
#endif
#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor physical_schema = {
	.schema_id = "spaghetti.protocol.physical",
	.version = 1U,
};

static int execute_apply_physical(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t node = 0U;
	uint32_t speed = 0U;
	const uint8_t *modes = NULL;
	size_t length = 0U;
	const uint8_t *expected = NULL;
	size_t expected_size = 0U;
	const uint8_t *config = NULL;
	size_t config_size = 0U;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &node);
	if (err == 0) {
		err = spaghetti_ops_decode_bstr(request, 1U, &modes, &length);
	}
	if (err == 0) {
		err = spaghetti_ops_decode_u32(request, 2U, &speed);
	}
	if (err == 0) {
		err = spaghetti_ops_decode_bstr(request, 3U, &expected, &expected_size);
	}
	if (err != 0) {
		return err;
	}
	err = spaghetti_ops_decode_bstr(request, 4U, &config, &config_size);
	if ((err != 0) && (err != -EINVAL)) return err;
	if (config && config_size != 20U) return -EINVAL;
	if ((length != 4U) || (speed > 1U) || (expected_size != SPAGHETTI_PHYSICAL_EXPECTED_SIZE)) {
		return -EINVAL;
	}
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
	err = spaghetti_field_update_apply_physical_config(node, modes, (uint8_t)speed, expected, config);
#else
	err = node == 0U ? spaghetti_physical_apply_config(modes, (uint8_t)speed, expected, config) : -ENOTSUP;
#endif
	if (err != 0) {
		return err;
	}
	ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
		       sizeof(response->bytes), 1U);
	if (!zcbor_map_start_encode(state, 3U) ||
	    !zcbor_uint32_put(state, 0U) || !zcbor_uint32_put(state, node) ||
	    !zcbor_uint32_put(state, 1U) || !zcbor_bstr_encode_ptr(state, modes, 4U) ||
	    !zcbor_uint32_put(state, 2U) || !zcbor_uint32_put(state, speed) ||
	    !zcbor_map_end_encode(state, 3U)) {
		return -EMSGSIZE;
	}
	response->size = (size_t)(state->payload - response->bytes);
	return 0;
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_apply_physical) = {
	.operation = SPAGHETTI_PROTOCOL_APPLY_PHYSICAL,
	.required_permissions = SPAGHETTI_PERMISSION_CONFIGURE,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &physical_schema,
	.response_schema = &physical_schema,
	.execute = execute_apply_physical,
};
