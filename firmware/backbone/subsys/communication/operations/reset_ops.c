#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/access_control.h>
#include <spaghetti/factory_reset.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.factory_reset",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_factory_reset(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t scope = 0U;
	int err;

	err = spaghetti_ops_decode_u32(request, 0U, &scope);
	if (err < 0) {
		return err;
	}
	spaghetti_factory_reset_set_acting_principal(context->principal_id);
	err = spaghetti_factory_reset(scope);
	spaghetti_factory_reset_set_acting_principal(0U);
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_empty_map(response);
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_factory_reset) = {
	.operation = SPAGHETTI_PROTOCOL_FACTORY_RESET,
	.required_permissions = SPAGHETTI_PERMISSION_PROVISION,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_factory_reset,
};
