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
#include <spaghetti/module_manager.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/topology.h>

#include "../communication_internal.h"

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.topology",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static size_t topology_rail_count(void)
{
#if defined(CONFIG_SPAGHETTI_POWER)
	const size_t count = spaghetti_power_rail_count();

	return count;
#else
	return 0U;
#endif
}

static uint32_t topology_bay_rail_mask(spaghetti_flow_id_t flow_id,
				       spaghetti_bay_id_t bay_id)
{
#if defined(CONFIG_SPAGHETTI_POWER)
	struct spaghetti_bay_power_descriptor bay_power = {0};

	if (spaghetti_power_bay_get(flow_id, bay_id, &bay_power) == 0) {
		return bay_power.available_rail_mask;
	}
#else
	ARG_UNUSED(flow_id);
	ARG_UNUSED(bay_id);
#endif
	return 0U;
}

static bool encode_rails(zcbor_state_t *state)
{
	const size_t rail_count = topology_rail_count();

	if (!zcbor_list_start_encode(state, rail_count)) {
		return false;
	}
#if defined(CONFIG_SPAGHETTI_POWER)
	for (size_t rail_idx = 0U; rail_idx < rail_count; ++rail_idx) {
		const struct spaghetti_power_rail_descriptor *rail =
			spaghetti_power_rail_get(
				(spaghetti_power_rail_id_t)rail_idx);

		if (rail == NULL) {
			continue;
		}
		if (!zcbor_map_start_encode(state, 3U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_uint32_put(state, rail->id) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, (uint32_t)rail->assurance) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_uint32_put(state, rail->max_total_microamps) ||
		    !zcbor_map_end_encode(state, 3U)) {
			return false;
		}
	}
#endif
	return zcbor_list_end_encode(state, rail_count);
}

static int execute_get_topology(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t cursor = 0U;
	uint32_t limit = 2U;
	const size_t flow_count = spaghetti_topology_flow_count();
	uint32_t next_cursor = 0U;
	size_t written = 0U;
	int err;

	ARG_UNUSED(context);
	err = spaghetti_ops_decode_optional_u32(request, 0U, 0U, &cursor);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_optional_u32(request, 1U, 2U, &limit);
	if (err < 0) {
		return err;
	}
	if (limit == 0U) {
		limit = 2U;
	}

	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 2U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_list_start_encode(state, limit)) {
			return -EMSGSIZE;
		}

		for (size_t flow_idx = cursor;
		     (flow_idx < flow_count) && (written < limit); ++flow_idx) {
			const struct spaghetti_flow_descriptor *flow =
				spaghetti_topology_flow_get(
					(spaghetti_flow_id_t)flow_idx);

			if (flow == NULL) {
				continue;
			}

			const uint32_t capabilities = spaghetti_port_capabilities(
				spaghetti_port_get(flow->port_id));

			if (!zcbor_map_start_encode(state, 6U) ||
			    !zcbor_uint32_put(state, 0U) ||
			    !zcbor_uint32_put(state, flow->id) ||
			    !zcbor_uint32_put(state, 1U) ||
			    !zcbor_uint32_put(state, flow->port_id) ||
			    !zcbor_uint32_put(state, 2U) ||
			    !zcbor_uint32_put(state, (uint32_t)flow->direction) ||
			    !zcbor_uint32_put(state, 3U) ||
			    !zcbor_uint32_put(state, flow->signal_count) ||
			    !zcbor_uint32_put(state, 4U) ||
			    !zcbor_list_start_encode(state,
						     flow->function_bay_count)) {
				return -EMSGSIZE;
			}

			for (uint8_t bay_id = 0U; bay_id < flow->function_bay_count;
			     ++bay_id) {
				struct spaghetti_bay_descriptor bay;
				struct spaghetti_module_snapshot
					modules[SPAGHETTI_CONFIG_MAX_MODULES];
				size_t module_count = 0U;
				uint32_t module_key = 0U;
				uint32_t admission =
					SPAGHETTI_POWER_ADMISSION_NOT_REQUIRED;
				const uint32_t rail_mask =
					topology_bay_rail_mask(flow->id, bay_id);

				err = spaghetti_topology_bay_get(flow->id, bay_id,
								 &bay);
				if (err < 0) {
					return err;
				}
				(void)spaghetti_module_manager_list_by_port(
					flow->port_id, modules,
					ARRAY_SIZE(modules), &module_count);
				for (size_t m = 0U; m < module_count; ++m) {
					if (modules[m].placement.bay_id == bay_id) {
						module_key = modules[m].key;
						admission = (uint32_t)
							modules[m].power_admission;
						break;
					}
				}

				if (!zcbor_map_start_encode(state, 6U) ||
				    !zcbor_uint32_put(state, 0U) ||
				    !zcbor_uint32_put(state, bay.id) ||
				    !zcbor_uint32_put(state, 1U) ||
				    !zcbor_uint32_put(state, bay.ordinal_from_field) ||
				    !zcbor_uint32_put(state, 2U) ||
				    !zcbor_uint32_put(state, rail_mask) ||
				    !zcbor_uint32_put(state, 3U) ||
				    !zcbor_uint32_put(state, module_key) ||
				    !zcbor_uint32_put(state, 4U) ||
				    !zcbor_uint32_put(state, admission) ||
				    !zcbor_uint32_put(state, 5U) ||
				    !encode_rails(state) ||
				    !zcbor_map_end_encode(state, 6U)) {
					return -EMSGSIZE;
				}
			}

			if (!zcbor_list_end_encode(state,
						   flow->function_bay_count) ||
			    !zcbor_uint32_put(state, 5U) ||
			    !zcbor_uint32_put(state, capabilities) ||
			    !zcbor_map_end_encode(state, 6U)) {
				return -EMSGSIZE;
			}
			++written;
			next_cursor = (uint32_t)(flow_idx + 1U);
		}
		if ((cursor + written) >= flow_count) {
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

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_topology) = {
	.operation = SPAGHETTI_PROTOCOL_GET_TOPOLOGY,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_topology,
};
