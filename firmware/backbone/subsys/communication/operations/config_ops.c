#include <spaghetti/protocol.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>
#include <zephyr/kernel.h>

#include <spaghetti/access_control.h>
#include <spaghetti/config.h>
#include <spaghetti/config_codec.h>
#include <spaghetti/device_profile.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
    .schema_id = "spaghetti.protocol.config",
    .version = 1U,
    .fields = NULL,
    .field_count = 0U,
};

/* One bounded, transient upload. Never reserve the maximum wire size in every
 * communication job. Incomplete transfers expire even if the sender disappears. */
static K_MUTEX_DEFINE(config_upload_lock);
static struct {
	uint8_t *bytes;
	size_t received;
	uint32_t total, token, generation;
	int64_t expires;
	spaghetti_principal_id_t owner;
	bool apply;
} config_upload;

static void config_upload_expire(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(config_upload_timeout, config_upload_expire);
static void config_upload_expire(struct k_work *work)
{
	ARG_UNUSED(work);
	k_mutex_lock(&config_upload_lock, K_FOREVER);
	if (config_upload.bytes && k_uptime_get() < config_upload.expires) {
		k_work_reschedule(&config_upload_timeout,
		                  K_MSEC(config_upload.expires - k_uptime_get()));
		k_mutex_unlock(&config_upload_lock);
		return;
	}
	k_free(config_upload.bytes);
	memset(&config_upload, 0, sizeof(config_upload));
	k_mutex_unlock(&config_upload_lock);
}

/* Returns 1 for an acknowledged partial upload, 0 for complete bytes. */
static int decode_config_upload(const struct spaghetti_request_context *context,
                                const struct spaghetti_protocol_payload *request, uint32_t key,
                                uint32_t generation, const uint8_t **bytes, size_t *size,
                                uint8_t **owned)
{
	uint32_t token = 0, offset = 0, total = 0;
	int err = spaghetti_ops_decode_bstr(request, key, bytes, size);
	*owned = NULL;
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_optional_u32(request, 10U, 0U, &token);
	if (err < 0 || token == 0U) {
		return err;
	}
	if (spaghetti_ops_decode_u32(request, 11U, &offset) < 0 ||
	    spaghetti_ops_decode_u32(request, 12U, &total) < 0 || total == 0U ||
	    total > SPAGHETTI_CONFIG_CBOR_MAX_SIZE || *size == 0U || offset > total ||
	    *size > total - offset) {
		return -EINVAL;
	}
	k_mutex_lock(&config_upload_lock, K_FOREVER);
	if (!config_upload.bytes) {
		if (offset != 0U) {
			err = -ESTALE;
			goto out;
		}
		config_upload.bytes = k_malloc(total);
		if (!config_upload.bytes) {
			err = -ENOMEM;
			goto out;
		}
		config_upload.total = total;
		config_upload.token = token;
		config_upload.owner = context->principal_id;
		config_upload.generation = generation;
		config_upload.apply = key == 1U;
	}
	if (config_upload.token != token || config_upload.total != total ||
	    config_upload.owner != context->principal_id ||
	    config_upload.generation != generation || config_upload.apply != (key == 1U)) {
		err = -EBUSY;
		goto out;
	}
	if (offset < config_upload.received) {
		if (*size > config_upload.received - offset ||
		    memcmp(config_upload.bytes + offset, *bytes, *size) != 0) {
			err = -EINVAL;
			goto out;
		}
	} else {
		if (offset != config_upload.received) {
			err = -EINVAL;
			goto out;
		}
		memcpy(config_upload.bytes + offset, *bytes, *size);
		config_upload.received += *size;
	}
	config_upload.expires = k_uptime_get() + 15000;
	k_work_reschedule(&config_upload_timeout, K_SECONDS(15));
	err = 1;
	if (config_upload.received == total) {
		*owned = config_upload.bytes;
		*bytes = *owned;
		*size = total;
		memset(&config_upload, 0, sizeof(config_upload));
		k_work_cancel_delayable(&config_upload_timeout);
		err = 0;
	}
out:
	k_mutex_unlock(&config_upload_lock);
	return err;
}

static int upload_ack(struct spaghetti_protocol_payload *response)
{
	response->bytes[0] = 0xa0; /* empty map; the final chunk returns the normal result */
	response->size = 1;
	return 0;
}

static int execute_get_config(const struct spaghetti_request_context *context,
                              const struct spaghetti_protocol_payload *request,
                              struct spaghetti_protocol_payload *response)
{
	struct spaghetti_config *config;
	struct spaghetti_config_revision revision;
	uint8_t *encoded = NULL;
	size_t encoded_size = 0U;
	int err;

	ARG_UNUSED(context);
	uint32_t offset = 0U;
	err = spaghetti_ops_decode_optional_u32(request, 0U, 0U, &offset);
	if (err < 0) {
		return err;
	}

	config = spaghetti_ops_alloc_config();
	if (config == NULL) {
		return -ENOMEM;
	}
	err = spaghetti_config_get_snapshot(config, &revision);
	if (err < 0) {
		spaghetti_ops_free_config(config);
		return err;
	}
	encoded = k_malloc(SPAGHETTI_CONFIG_CBOR_MAX_SIZE);
 if (!encoded) { spaghetti_ops_free_config(config); return -ENOMEM; }
 err = spaghetti_config_encode_cbor(config, encoded, SPAGHETTI_CONFIG_CBOR_MAX_SIZE, &encoded_size);
	spaghetti_ops_free_config(config);
	if (err < 0) {
		k_free(encoded);
		return err;
	}

	if (offset > encoded_size) {
		k_free(encoded);
		return -EINVAL;
	}
	const bool chunked = encoded_size > 576U || offset != 0U;
	const size_t chunk_size = chunked ? MIN(encoded_size - offset, 400U) : encoded_size;
	const uint32_t fields = chunked ? 5U : 3U;
	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
		              sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, fields) || !zcbor_uint32_put(state, 0U) ||
		    !zcbor_uint32_put(state, revision.generation) || !zcbor_uint32_put(state, 1U) ||
		    !zcbor_bstr_encode_ptr(state, revision.sha256, sizeof(revision.sha256)) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_bstr_encode_ptr(state, encoded + offset, chunk_size) ||
		    (chunked &&
		     (!zcbor_uint32_put(state, 3U) || !zcbor_uint32_put(state, encoded_size) ||
		      !zcbor_uint32_put(state, 4U) || !zcbor_uint32_put(state, offset))) ||
		    !zcbor_map_end_encode(state, fields)) {
			k_free(encoded);
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	k_free(encoded);
	return 0;
}

static int execute_validate_config(const struct spaghetti_request_context *context,
                                   const struct spaghetti_protocol_payload *request,
                                   struct spaghetti_protocol_payload *response)
{
	const uint8_t *config_bytes = NULL;
	uint8_t *owned = NULL;
	size_t config_size = 0U;
	struct spaghetti_config *candidate;
	struct spaghetti_config_failure failure = {0};
	int err;

	ARG_UNUSED(context);
	err = decode_config_upload(context, request, 0U, 0U, &config_bytes, &config_size, &owned);
	if (err == 1) {
		return upload_ack(response);
	}
	if (err < 0) {
		return err;
	}
	candidate = spaghetti_ops_alloc_config();
	if (candidate == NULL) {
		k_free(owned);
		return -ENOMEM;
	}
	err = spaghetti_config_decode_cbor_checked(config_bytes, config_size, candidate, &failure);
	k_free(owned);
	if (err < 0 && (int)failure.field < 0) {
		spaghetti_ops_free_config(candidate);
		return err;
	}
	spaghetti_ops_free_config(candidate);
	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
		              sizeof(response->bytes), 1U);
		const bool valid = (err == 0);

		if (!zcbor_map_start_encode(state, valid ? 1U : 4U) ||
		    !zcbor_uint32_put(state, 0U) || !zcbor_bool_put(state, valid)) {
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

static int execute_apply_config(const struct spaghetti_request_context *context,
                                const struct spaghetti_protocol_payload *request,
                                struct spaghetti_protocol_payload *response)
{
	uint32_t expected_generation = 0U;
	const uint8_t *config_bytes = NULL;
	uint8_t *owned = NULL;
	size_t config_size = 0U;
	struct spaghetti_config *candidate;
	struct spaghetti_config_commit_result commit = {0};
	struct spaghetti_profile_rx_capture rx = {0};
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &expected_generation);
	if (err < 0) {
		return err;
	}
	err = decode_config_upload(context, request, 1U, expected_generation, &config_bytes,
	                           &config_size, &owned);
	if (err == 1) {
		return upload_ack(response);
	}
	if (err < 0) {
		return err;
	}
	candidate = spaghetti_ops_alloc_config();
	if (candidate == NULL) {
		k_free(owned);
		return -ENOMEM;
	}
	err = spaghetti_config_decode_cbor(config_bytes, config_size, candidate);
	k_free(owned);
	if (err < 0) {
		spaghetti_ops_free_config(candidate);
		return err;
	}
	spaghetti_device_profile_capture_begin();
	err = spaghetti_config_apply(candidate, expected_generation, &commit);
	spaghetti_device_profile_capture_finish(&rx);
	spaghetti_ops_free_config(candidate);
	if (err < 0) {
		if (commit.failure_phase != NULL) {
			ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			              sizeof(response->bytes), 1U);
			if (zcbor_map_start_encode(state, 3U) && zcbor_uint32_put(state, 0U) &&
			    zcbor_int32_put(state, commit.failure_errno) &&
			    zcbor_uint32_put(state, 1U) &&
			    zcbor_tstr_encode_ptr(state, commit.failure_phase,
			                          strlen(commit.failure_phase)) &&
			    zcbor_uint32_put(state, 2U) &&
			    zcbor_int32_put(state, commit.rollback_errno) &&
			    zcbor_map_end_encode(state, 3U)) {
				response->size = (size_t)(state->payload - response->bytes);
			}
		}
		return err;
	}

	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
		              sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 5U) || !zcbor_uint32_put(state, 0U) ||
		    !zcbor_bool_put(state, commit.changed) || !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, commit.revision.generation) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_bstr_encode_ptr(state, commit.revision.sha256,
		                           sizeof(commit.revision.sha256))) {
			return -EMSGSIZE;
		}
		if (!zcbor_uint32_put(state, 3U) || !zcbor_list_start_encode(state, rx.count)) {
			return -EMSGSIZE;
		}
		for (uint8_t i = 0; i < rx.count; ++i) {
			if (!zcbor_bstr_encode_ptr(state, rx.bytes[i], rx.lengths[i])) {
				return -EMSGSIZE;
			}
		}
		if (!zcbor_list_end_encode(state, rx.count) || !zcbor_uint32_put(state, 4U) ||
		    !zcbor_bool_put(state, rx.truncated) || !zcbor_map_end_encode(state, 5U)) {
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
