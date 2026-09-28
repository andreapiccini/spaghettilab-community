#include <spaghetti/protocol.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/config.h>
#include <spaghetti/config_codec.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.config",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_get_config(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	struct spaghetti_config *config;
	struct spaghetti_config_revision revision;
	uint8_t encoded[SPAGHETTI_CONFIG_CBOR_MAX_SIZE];
	size_t encoded_size = 0U;
	int err;

	ARG_UNUSED(context);
	ARG_UNUSED(request);

	config = spaghetti_ops_alloc_config();
	if (config == NULL) {
		return -ENOMEM;
	}
	err = spaghetti_config_get_snapshot(config, &revision);
	if (err < 0) {
		spaghetti_ops_free_config(config);
		return err;
	}
	err = spaghetti_config_encode_cbor(config, encoded, sizeof(encoded),
					   &encoded_size);
	spaghetti_ops_free_config(config);
	if (err < 0) {
		return err;
	}

	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 3U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_uint32_put(state, revision.generation) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_bstr_encode_ptr(state, revision.sha256,
					   sizeof(revision.sha256)) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_bstr_encode_ptr(state, encoded, encoded_size) ||
		    !zcbor_map_end_encode(state, 3U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

static int execute_validate_config(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	const uint8_t *config_bytes = NULL;
	size_t config_size = 0U;
	struct spaghetti_config *candidate;
	struct spaghetti_config_failure failure = {0};
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_bstr(request, 0U, &config_bytes, &config_size);
	if (err < 0) {
		return err;
	}
	candidate = spaghetti_ops_alloc_config();
	if (candidate == NULL) {
		return -ENOMEM;
	}
	err = spaghetti_config_decode_cbor(config_bytes, config_size, candidate);
	if (err < 0) {
		spaghetti_ops_free_config(candidate);
		return err;
	}
	err = spaghetti_config_validate(candidate, &failure);
	spaghetti_ops_free_config(candidate);
	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);
		const bool valid = (err == 0);

		if (!zcbor_map_start_encode(state, valid ? 1U : 4U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_bool_put(state, valid)) {
			return -EMSGSIZE;
		}
		if (!valid) {
			if (!zcbor_uint32_put(state, 1U) ||
			    !zcbor_uint32_put(state, (uint32_t)failure.field) ||
			    !zcbor_uint32_put(state, 2U) ||
			    !zcbor_uint32_put(state, (uint32_t)failure.index) ||
			    !zcbor_uint32_put(state, 3U) ||
			    !zcbor_uint32_put(state, (uint32_t)failure.reason)) {
				return -EMSGSIZE;
			}
		}
		if (!zcbor_map_end_encode(state, valid ? 1U : 4U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

static int execute_apply_config(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t expected_generation = 0U;
	const uint8_t *config_bytes = NULL;
	size_t config_size = 0U;
	struct spaghetti_config *candidate;
	struct spaghetti_config_commit_result commit = {0};
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &expected_generation);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_bstr(request, 1U, &config_bytes, &config_size);
	if (err < 0) {
		return err;
	}
	candidate = spaghetti_ops_alloc_config();
	if (candidate == NULL) {
		return -ENOMEM;
	}
	err = spaghetti_config_decode_cbor(config_bytes, config_size, candidate);
	if (err < 0) {
		spaghetti_ops_free_config(candidate);
		return err;
	}
	err = spaghetti_config_apply(candidate, expected_generation, &commit);
	spaghetti_ops_free_config(candidate);
	if (err < 0) {
		return err;
	}

	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 3U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_bool_put(state, commit.changed) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, commit.revision.generation) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_bstr_encode_ptr(state, commit.revision.sha256,
					   sizeof(commit.revision.sha256)) ||
		    !zcbor_map_end_encode(state, 3U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_config) = {
	.operation = SPAGHETTI_PROTOCOL_GET_CONFIG,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_config,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_validate_config) = {
	.operation = SPAGHETTI_PROTOCOL_VALIDATE_CONFIG,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_validate_config,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_apply_config) = {
	.operation = SPAGHETTI_PROTOCOL_APPLY_CONFIG,
	.required_permissions = SPAGHETTI_PERMISSION_CONFIGURE,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_apply_config,
};
