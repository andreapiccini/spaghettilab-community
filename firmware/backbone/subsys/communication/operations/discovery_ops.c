#include <spaghetti/protocol.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/config.h>
#include <spaghetti/discovery.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.discovery",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static int execute_list_discovery(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t cursor = 0U;
	uint32_t limit = 4U;
	struct spaghetti_discovery_candidate candidates[CONFIG_SPAGHETTI_MAX_MODULES];
	size_t count = 0U;
	uint32_t next_cursor = 0U;
	size_t written = 0U;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_optional_u32(request, 0U, 0U, &cursor);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_optional_u32(request, 1U, 4U, &limit);
	if (err < 0) {
		return err;
	}
	if (limit == 0U) {
		limit = 4U;
	}
	err = spaghetti_discovery_list(candidates, ARRAY_SIZE(candidates), &count);
	if (err < 0) {
		return err;
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
			const struct spaghetti_discovery_candidate *c = &candidates[idx];

			if (!zcbor_map_start_encode(state, 5U) ||
			    !zcbor_uint32_put(state, 0U) ||
			    !zcbor_uint32_put(state, c->id) ||
			    !zcbor_uint32_put(state, 1U) ||
			    !zcbor_uint32_put(state, c->port_id) ||
			    !zcbor_uint32_put(state, 2U) ||
			    !zcbor_uint32_put(state, c->generation) ||
			    !zcbor_uint32_put(state, 3U) ||
			    !zcbor_uint32_put(state, (uint32_t)c->confidence) ||
			    !zcbor_uint32_put(state, 4U) ||
			    !zcbor_tstr_put_term(state, c->suggested_type_id,
						 sizeof(c->suggested_type_id)) ||
			    !zcbor_map_end_encode(state, 5U)) {
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

static int execute_scan_discovery(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t port_id = 0U;
	uint32_t allow_state_changing = 0U;
	struct spaghetti_discovery_scan_policy policy = {
		.allow_read_only = true,
		.allow_state_changing = false,
		.timeout_per_provider = K_MSEC(200),
	};
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &port_id);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_optional_u32(request, 1U, 0U, &allow_state_changing);
	if (err < 0) {
		return err;
	}
	policy.allow_state_changing = (allow_state_changing != 0U);
	err = spaghetti_discovery_scan_port((spaghetti_port_id_t)port_id, &policy);
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_empty_map(response);
}

static int execute_accept_discovery(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t candidate_id = 0U;
	uint32_t key = 0U;
	uint32_t generation = 0U;
	struct spaghetti_module_config module;
	struct spaghetti_config *config;
	struct spaghetti_config_revision revision;
	struct spaghetti_config_commit_result commit = {0};
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_u32(request, 0U, &candidate_id);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_u32(request, 1U, &key);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_u32(request, 2U, &generation);
	if (err < 0) {
		return err;
	}
	err = spaghetti_discovery_accept(candidate_id, key, generation, &module);
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
	if (config->module_count >= SPAGHETTI_CONFIG_MAX_MODULES) {
		spaghetti_ops_free_config(config);
		return -ENOSPC;
	}
	config->modules[config->module_count++] = module;
	err = spaghetti_config_apply(config, revision.generation, &commit);
	spaghetti_ops_free_config(config);
	if (err < 0) {
		return err;
	}
	{
		uint32_t keys[2] = {0U, 1U};
		uint32_t values[2] = {commit.revision.generation, module.key};

		return spaghetti_ops_encode_u32_map(response, keys, values, 2U);
	}
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_list_discovery) = {
	.operation = SPAGHETTI_PROTOCOL_LIST_DISCOVERY,
	.required_permissions = SPAGHETTI_PERMISSION_DISCOVER,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_list_discovery,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_scan_discovery) = {
	.operation = SPAGHETTI_PROTOCOL_SCAN_DISCOVERY,
	.required_permissions = SPAGHETTI_PERMISSION_DISCOVER,
	.execution = SPAGHETTI_OPERATION_ASYNC_JOB,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_scan_discovery,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_accept_discovery) = {
	.operation = SPAGHETTI_PROTOCOL_ACCEPT_DISCOVERY,
	.required_permissions = SPAGHETTI_PERMISSION_CONFIGURE | SPAGHETTI_PERMISSION_DISCOVER,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_accept_discovery,
};
