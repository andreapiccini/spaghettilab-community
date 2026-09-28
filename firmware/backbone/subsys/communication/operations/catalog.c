#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/block_registry.h>
#include <spaghetti/config.h>
#include <spaghetti/device_profile.h>
#include <spaghetti/discovery.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/feature_pack.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/rule_registry.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor catalog_request_schema = {
	.schema_id = "spaghetti.protocol.get_catalog.request",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static const struct spaghetti_schema_descriptor catalog_response_schema = {
	.schema_id = "spaghetti.protocol.get_catalog.response",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static void catalog_fingerprint(uint8_t out[32])
{
	uint8_t material[256];
	size_t offset = 0U;
	const size_t drivers = spaghetti_driver_registry_count();
	const size_t rules = spaghetti_rule_registry_count();
	const size_t blocks = spaghetti_block_registry_count();
	const size_t profiles = spaghetti_device_profile_count();
	const size_t packs = spaghetti_feature_pack_count();

	memset(material, 0, sizeof(material));
	material[offset++] = (uint8_t)drivers;
	material[offset++] = (uint8_t)rules;
	material[offset++] = (uint8_t)blocks;
	material[offset++] = (uint8_t)profiles;
	material[offset++] = (uint8_t)packs;
	material[offset++] = SPAGHETTI_PROTOCOL_VERSION;
	material[offset++] = (uint8_t)SPAGHETTI_CONFIG_VERSION;
	for (size_t idx = 0U; (idx < drivers) && (offset + 24U < sizeof(material));
	     ++idx) {
		const struct spaghetti_module_driver *driver =
			spaghetti_driver_registry_get(idx);

		if ((driver != NULL) && (driver->type_id != NULL)) {
			size_t len = strlen(driver->type_id);

			if (len > 23U) {
				len = 23U;
			}
			memcpy(&material[offset], driver->type_id, len);
			offset += len;
		}
	}
	spaghetti_ops_sha256(material, offset, out);
}

static int execute_get_catalog(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t cursor = 0U;
	uint32_t limit = 8U;
	uint8_t fingerprint[32];
	size_t driver_count;
	size_t written_count = 0U;
	uint32_t next_cursor = 0U;
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
	if (limit > 32U) {
		limit = 32U;
	}

	catalog_fingerprint(fingerprint);
	driver_count = spaghetti_driver_registry_count();

	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 6U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_uint32_put(state, SPAGHETTI_PROTOCOL_VERSION) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, SPAGHETTI_CONFIG_VERSION) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_bstr_encode_ptr(state, fingerprint, sizeof(fingerprint)) ||
		    !zcbor_uint32_put(state, 3U) ||
		    !zcbor_list_start_encode(state, limit)) {
			return -EMSGSIZE;
		}

		for (size_t idx = cursor;
		     (idx < driver_count) && (written_count < limit); ++idx) {
			const struct spaghetti_module_driver *driver =
				spaghetti_driver_registry_get(idx);

			if (driver == NULL) {
				continue;
			}
			if (!zcbor_map_start_encode(state, 2U) ||
			    !zcbor_uint32_put(state, 0U) ||
			    !zcbor_tstr_put_term(state, driver->type_id,
						 SPAGHETTI_TYPE_ID_MAX) ||
			    !zcbor_uint32_put(state, 1U) ||
			    !zcbor_uint32_put(state,
					      (uint32_t)driver->command_count) ||
			    !zcbor_map_end_encode(state, 2U)) {
				return -EMSGSIZE;
			}
			++written_count;
			next_cursor = (uint32_t)(idx + 1U);
		}

		if ((cursor + written_count) >= driver_count) {
			next_cursor = 0U;
		}
		if (!zcbor_list_end_encode(state, limit) ||
		    !zcbor_uint32_put(state, 4U) ||
		    !zcbor_uint32_put(state, next_cursor) ||
		    !zcbor_uint32_put(state, 5U) ||
		    !zcbor_uint32_put(state, (uint32_t)driver_count) ||
		    !zcbor_map_end_encode(state, 6U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_catalog) = {
	.operation = SPAGHETTI_PROTOCOL_GET_CATALOG,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &catalog_request_schema,
	.response_schema = &catalog_response_schema,
	.execute = execute_get_catalog,
};
