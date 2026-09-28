#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/access_control.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.job",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_get_job_status(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t job_id = 0U;
	int err = spaghetti_ops_decode_u32(request, 0U, &job_id);

	if (err < 0) {
		return err;
	}
	return spaghetti_communication_job_get_status(context, job_id, response);
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_job_status) = {
	.operation = SPAGHETTI_PROTOCOL_GET_JOB_STATUS,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_job_status,
};
