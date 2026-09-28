#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/config.h>
#include <spaghetti/core.h>
#include <spaghetti/health.h>
#include <spaghetti/identity.h>
#include <spaghetti/module.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/port.h>

#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
#include <spaghetti/field_update.h>
#endif
#include <spaghetti/nfc.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor status_request_schema = {
	.schema_id = "spaghetti.protocol.get_status.request",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static const struct spaghetti_schema_descriptor status_response_schema = {
	.schema_id = "spaghetti.protocol.get_status.response",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int collect_module_snapshots(
	struct spaghetti_module_snapshot *snapshots,
	size_t *out_module_count)
{
	const size_t port_count = spaghetti_port_count();
	size_t total_count = 0U;

	for (size_t port_idx = 0U; port_idx < port_count; ++port_idx) {
		size_t port_module_count;
		int err = spaghetti_module_manager_list_by_port(
			(spaghetti_port_id_t)port_idx, NULL, 0U,
			&port_module_count);

		if (err < 0) {
			return err;
		}
		if (port_module_count >
		    (SPAGHETTI_CONFIG_MAX_MODULES - total_count)) {
			return -ENOSPC;
		}
		if (port_module_count == 0U) {
			continue;
		}
		err = spaghetti_module_manager_list_by_port(
			(spaghetti_port_id_t)port_idx, &snapshots[total_count],
			SPAGHETTI_CONFIG_MAX_MODULES - total_count,
			&port_module_count);
		if (err < 0) {
			return err;
		}
		total_count += port_module_count;
	}
	*out_module_count = total_count;
	return 0;
}

static int execute_get_status(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	struct spaghetti_core_info core_info;
	struct spaghetti_health_status health = {0};
	struct spaghetti_module_snapshot snapshots[SPAGHETTI_CONFIG_MAX_MODULES];
	size_t module_count = 0U;
	int err;

	ARG_UNUSED(context);
	ARG_UNUSED(request);

	err = spaghetti_core_get_info(&core_info);
	if (err < 0) {
		return err;
	}
	(void)spaghetti_health_get_status(&health);
	err = collect_module_snapshots(snapshots, &module_count);
	if (err < 0) {
		return err;
	}

	{
		struct spaghetti_identity identity;
		const bool have_identity = (spaghetti_identity_get(&identity) == 0);
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
		struct spaghetti_slup_peer peers[SPAGHETTI_SLUP_PEERS_MAX];
		size_t peer_count = 0U;
		const bool have_peers =
			(spaghetti_field_update_copy_peers(
				 peers, ARRAY_SIZE(peers), &peer_count) == 0);
		struct spaghetti_nfc_tag nfc_tags[SPAGHETTI_NFC_TAGS_MAX];
		size_t nfc_count = 0U;
		const bool have_nfc =
			(spaghetti_field_update_copy_nfc_tags(
				 nfc_tags, ARRAY_SIZE(nfc_tags), &nfc_count) ==
			 0);
#else
		const bool have_peers = false;
		const size_t peer_count = 0U;
		struct spaghetti_nfc_tag nfc_tags[SPAGHETTI_NFC_TAGS_MAX];
		size_t nfc_count = 0U;
		const bool have_nfc =
			(spaghetti_nfc_copy_tags(nfc_tags, ARRAY_SIZE(nfc_tags),
						 &nfc_count) == 0);
#endif
		const size_t map_keys = (have_identity ? 12U : 10U) +
					(have_peers ? 1U : 0U) +
					(have_nfc ? 1U : 0U);
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, map_keys) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_uint32_put(state, (uint32_t)core_info.state) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, (uint32_t)core_info.mode) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_uint32_put(state, (uint32_t)core_info.image_state) ||
		    !zcbor_uint32_put(state, 3U) ||
		    !zcbor_uint32_put(state, core_info.active_slot) ||
		    !zcbor_uint32_put(state, 4U) ||
		    !zcbor_bool_put(state, core_info.image_confirmed) ||
		    !zcbor_uint32_put(state, 5U) ||
		    !zcbor_tstr_put_term(state, core_info.version,
					 SPAGHETTI_CORE_VERSION_SIZE) ||
		    !zcbor_uint32_put(state, 6U) ||
		    !zcbor_uint32_put(state, (uint32_t)spaghetti_port_count()) ||
		    !zcbor_uint32_put(state, 7U) ||
		    !zcbor_uint32_put(state, health.last_reset_cause) ||
		    !zcbor_uint32_put(state, 8U) ||
		    !zcbor_uint32_put(state, (uint32_t)health.state) ||
		    !zcbor_uint32_put(state, 9U) ||
		    !zcbor_list_start_encode(state, module_count)) {
			return -EMSGSIZE;
		}

		for (size_t idx = 0U; idx < module_count; ++idx) {
			const struct spaghetti_module_snapshot *snapshot =
				&snapshots[idx];
			uint32_t endpoint_value = 0U;

			if (snapshot->endpoint.value_size > 0U) {
				const size_t copy_size =
					MIN(snapshot->endpoint.value_size,
					    sizeof(endpoint_value));

				memcpy(&endpoint_value, snapshot->endpoint.value,
				       copy_size);
			}
			if (!zcbor_map_start_encode(state, 7U) ||
			    !zcbor_uint32_put(state, 0U) ||
			    !zcbor_uint32_put(state, snapshot->key) ||
			    !zcbor_uint32_put(state, 1U) ||
			    !zcbor_uint32_put(state, snapshot->id) ||
			    !zcbor_uint32_put(state, 2U) ||
			    !zcbor_uint32_put(state, snapshot->port_id) ||
			    !zcbor_uint32_put(state, 3U) ||
			    !zcbor_uint32_put(state, (uint32_t)snapshot->state) ||
			    !zcbor_uint32_put(state, 4U) ||
			    !zcbor_uint32_put(state,
					      (uint32_t)snapshot->endpoint.kind) ||
			    !zcbor_uint32_put(state, 5U) ||
			    !zcbor_uint32_put(state, endpoint_value) ||
			    !zcbor_uint32_put(state, 6U) ||
			    !zcbor_tstr_put_term(state, snapshot->type_id,
						 SPAGHETTI_TYPE_ID_MAX) ||
			    !zcbor_map_end_encode(state, 7U)) {
				return -EMSGSIZE;
			}
		}

		if (!zcbor_list_end_encode(state, module_count)) {
			return -EMSGSIZE;
		}
		if (have_identity &&
		    (!zcbor_uint32_put(state, 10U) ||
		     !zcbor_bstr_encode_ptr(state, identity.device_id,
					    sizeof(identity.device_id)) ||
		     !zcbor_uint32_put(state, 11U) ||
		     !zcbor_tstr_put_term(state, identity.device_name,
					  SPAGHETTI_DEVICE_NAME_SIZE))) {
			return -EMSGSIZE;
		}
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
		if (have_peers) {
			if (!zcbor_uint32_put(state, 12U) ||
			    !zcbor_list_start_encode(state, peer_count)) {
				return -EMSGSIZE;
			}
			for (size_t idx = 0U; idx < peer_count; ++idx) {
				const struct spaghetti_slup_peer *peer = &peers[idx];
				const bool local =
					(peer->flags & SPAGHETTI_SLUP_FLAG_LOCAL) !=
					0U;

				if (!zcbor_map_start_encode(state, 5U) ||
				    !zcbor_uint32_put(state, 0U) ||
				    !zcbor_uint32_put(state, peer->node_id) ||
				    !zcbor_uint32_put(state, 1U) ||
				    !zcbor_bstr_encode_ptr(state, peer->mac,
							   sizeof(peer->mac)) ||
				    !zcbor_uint32_put(state, 2U) ||
				    !zcbor_uint32_put(state, peer->flags) ||
				    !zcbor_uint32_put(state, 3U) ||
				    !zcbor_bool_put(state, local) ||
				    !zcbor_uint32_put(state, 4U) ||
				    !zcbor_tstr_put_term(state, peer->version,
							 SPAGHETTI_SLUP_VERSION_SIZE) ||
				    !zcbor_map_end_encode(state, 5U)) {
					return -EMSGSIZE;
				}
			}
			if (!zcbor_list_end_encode(state, peer_count)) {
				return -EMSGSIZE;
			}
		}
#else
		ARG_UNUSED(peer_count);
#endif
		if (have_nfc) {
			size_t published = 0U;

			for (size_t idx = 0U; idx < nfc_count; ++idx) {
				if (nfc_tags[idx].module_type_id != 0U) {
					published += 1U;
				}
			}
			if (!zcbor_uint32_put(state, 13U) ||
			    !zcbor_list_start_encode(state, published)) {
				return -EMSGSIZE;
			}
			for (size_t idx = 0U; idx < nfc_count; ++idx) {
				const struct spaghetti_nfc_tag *tag =
					&nfc_tags[idx];
				const char *type_id;
				const size_t map_keys = 9U;

				if (tag->module_type_id == 0U) {
					continue;
				}
				type_id = spaghetti_nfc_type_id(tag);
				if (!zcbor_map_start_encode(state, map_keys) ||
				    !zcbor_uint32_put(state, 0U) ||
				    !zcbor_uint32_put(state, tag->antenna) ||
				    !zcbor_uint32_put(state, 1U) ||
				    !zcbor_tstr_put_term(state, type_id, 16U) ||
				    !zcbor_uint32_put(state, 2U) ||
				    !zcbor_bstr_encode_ptr(state, tag->uid,
							   tag->uid_len) ||
				    !zcbor_uint32_put(state, 3U) ||
				    !zcbor_uint32_put(state, tag->node_id) ||
				    !zcbor_uint32_put(state, 4U) ||
				    !zcbor_bool_put(state, tag->local) ||
				    !zcbor_uint32_put(state, 5U) ||
				    !zcbor_uint32_put(state,
						      tag->module_type_id) ||
				    !zcbor_uint32_put(state, 6U) ||
				    !zcbor_uint32_put(state, tag->vendor_id) ||
				    !zcbor_uint32_put(state, 7U) ||
				    !zcbor_uint32_put(state,
						      tag->fallback_class) ||
				    !zcbor_uint32_put(state, 8U) ||
				    !zcbor_uint32_put(state, tag->registry_id) ||
				    !zcbor_map_end_encode(state, map_keys)) {
					return -EMSGSIZE;
				}
			}
			if (!zcbor_list_end_encode(state, published)) {
				return -EMSGSIZE;
			}
		}
		if (!zcbor_map_end_encode(state, map_keys)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_status) = {
	.operation = SPAGHETTI_PROTOCOL_GET_STATUS,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &status_request_schema,
	.response_schema = &status_response_schema,
	.execute = execute_get_status,
};
