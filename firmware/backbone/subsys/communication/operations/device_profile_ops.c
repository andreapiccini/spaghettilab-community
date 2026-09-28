#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/device_profile.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.device_profile",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_list_device_profiles(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t cursor = 0U;
	uint32_t limit = 8U;
	const size_t count = spaghetti_device_profile_count();
	uint32_t next_cursor = 0U;
	size_t written = 0U;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_optional_u32(request, 0U, 0U, &cursor);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_optional_u32(request, 1U, 8U, &limit);
	if (err < 0) {
		return err;
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
		for (size_t idx = cursor; (idx < count) && (written < limit); ++idx) {
			const struct spaghetti_device_profile *profile =
				spaghetti_device_profile_get(idx);

			if (profile == NULL) {
				continue;
			}
			if (!zcbor_map_start_encode(state, 3U) ||
			    !zcbor_uint32_put(state, 0U) ||
			    !zcbor_tstr_put_term(state, profile->profile_id,
						 sizeof(profile->profile_id)) ||
			    !zcbor_uint32_put(state, 1U) ||
			    !zcbor_uint32_put(state, profile->version) ||
			    !zcbor_uint32_put(state, 2U) ||
			    !zcbor_bstr_encode_ptr(state, profile->hash,
						   sizeof(profile->hash)) ||
			    !zcbor_map_end_encode(state, 3U)) {
				return -EMSGSIZE;
			}
			++written;
			next_cursor = (uint32_t)(idx + 1U);
		}
		if ((cursor + written) >= count) {
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

static int execute_get_device_profile(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t index = 0U;
	const struct spaghetti_device_profile *profile;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &index);
	if (err < 0) {
		return err;
	}
	profile = spaghetti_device_profile_get(index);
	if (profile == NULL) {
		return -ENOENT;
	}
	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 5U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_tstr_put_term(state, profile->profile_id,
					 sizeof(profile->profile_id)) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, profile->version) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_bstr_encode_ptr(state, profile->hash, sizeof(profile->hash)) ||
		    !zcbor_uint32_put(state, 3U) ||
		    !zcbor_uint32_put(state, (uint32_t)profile->transport) ||
		    !zcbor_uint32_put(state, 4U) ||
		    !zcbor_uint32_put(state, profile->required_capabilities) ||
		    !zcbor_map_end_encode(state, 5U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

static int execute_validate_device_profile(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	const uint8_t *cbor = NULL;
	size_t size = 0U;
	struct spaghetti_device_profile_failure failure = {0};
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_bstr(request, 0U, &cbor, &size);
	if (err < 0) {
		return err;
	}
	if ((cbor == NULL) || (size == 0U)) {
		return -EINVAL;
	}
	err = spaghetti_device_profile_validate_cbor(cbor, size, &failure);
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

static int execute_install_device_profile(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	const uint8_t *cbor = NULL;
	size_t size = 0U;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_bstr(request, 0U, &cbor, &size);
	if (err < 0) {
		return err;
	}
	err = spaghetti_device_profile_install(cbor, size);
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_empty_map(response);
}

static int execute_remove_device_profile(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t version = 0U;
	const uint8_t *id_bytes = NULL;
	size_t id_size = 0U;
	char profile_id[SPAGHETTI_DEVICE_PROFILE_ID_SIZE];
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_bstr(request, 0U, &id_bytes, &id_size);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_u32(request, 1U, &version);
	if (err < 0) {
		return err;
	}
	if ((id_size == 0U) || (id_size >= sizeof(profile_id))) {
		return -EINVAL;
	}
	memcpy(profile_id, id_bytes, id_size);
	profile_id[id_size] = '\0';
	err = spaghetti_device_profile_remove(profile_id, (uint16_t)version);
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_empty_map(response);
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_list_device_profiles) = {
	.operation = SPAGHETTI_PROTOCOL_LIST_DEVICE_PROFILES,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_list_device_profiles,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_device_profile) = {
	.operation = SPAGHETTI_PROTOCOL_GET_DEVICE_PROFILE,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_device_profile,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_validate_device_profile) = {
	.operation = SPAGHETTI_PROTOCOL_VALIDATE_DEVICE_PROFILE,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_validate_device_profile,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_install_device_profile) = {
	.operation = SPAGHETTI_PROTOCOL_INSTALL_DEVICE_PROFILE,
	.required_permissions = SPAGHETTI_PERMISSION_CONFIGURE,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_install_device_profile,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_remove_device_profile) = {
	.operation = SPAGHETTI_PROTOCOL_REMOVE_DEVICE_PROFILE,
	.required_permissions = SPAGHETTI_PERMISSION_CONFIGURE,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_remove_device_profile,
};
