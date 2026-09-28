#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/feature_pack.h>
#include <spaghetti/image_manifest.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.features",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_get_features(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	struct spaghetti_feature_pack_catalog_entry entries[SPAGHETTI_IMAGE_MANIFEST_PACK_MAX];
	size_t count = 0U;
	uint8_t feature_set_hash[SPAGHETTI_FEATURE_SET_HASH_SIZE];
	int err;

	ARG_UNUSED(context);
	ARG_UNUSED(request);
	err = spaghetti_feature_pack_catalog(entries, ARRAY_SIZE(entries), &count);
	if (err < 0) {
		return err;
	}
	memset(feature_set_hash, 0, sizeof(feature_set_hash));
	{
		const struct spaghetti_image_manifest *manifest =
			spaghetti_image_manifest_get();

		if (manifest != NULL) {
			memcpy(feature_set_hash, manifest->feature_set_hash,
			       sizeof(feature_set_hash));
		}
	}

	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 2U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_bstr_encode_ptr(state, feature_set_hash,
					   sizeof(feature_set_hash)) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_list_start_encode(state, count)) {
			return -EMSGSIZE;
		}
		for (size_t idx = 0U; idx < count; ++idx) {
			const struct spaghetti_feature_pack_catalog_entry *entry =
				&entries[idx];

			if (!zcbor_map_start_encode(state, 4U) ||
			    !zcbor_uint32_put(state, 0U) ||
			    !zcbor_tstr_put_term(state, entry->pack.id,
						 sizeof(entry->pack.id)) ||
			    !zcbor_uint32_put(state, 1U) ||
			    !zcbor_tstr_put_term(state, entry->pack.version,
						 sizeof(entry->pack.version)) ||
			    !zcbor_uint32_put(state, 2U) ||
			    !zcbor_uint32_put(state, entry->required_hw_caps) ||
			    !zcbor_uint32_put(state, 3U) ||
			    !zcbor_uint32_put(state,
					      (uint32_t)entry->module_type_count) ||
			    !zcbor_map_end_encode(state, 4U)) {
				return -EMSGSIZE;
			}
		}
		if (!zcbor_list_end_encode(state, count) ||
		    !zcbor_map_end_encode(state, 2U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_features) = {
	.operation = SPAGHETTI_PROTOCOL_GET_FEATURES,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_features,
};
