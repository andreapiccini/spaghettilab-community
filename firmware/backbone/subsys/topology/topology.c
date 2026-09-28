#include <spaghetti/topology.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/devicetree.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

LOG_MODULE_REGISTER(spaghetti_topology, CONFIG_SPAGHETTI_TOPOLOGY_LOG_LEVEL);

#define SPAGHETTI_FLOW_DIRECTION(node_id) \
	((enum spaghetti_flow_direction)DT_ENUM_IDX(node_id, direction))

#define SPAGHETTI_FLOW_VALIDATE(node_id) \
	BUILD_ASSERT(DT_REG_ADDR(node_id) <= UINT8_MAX, \
		     "Spaghetti Flow ID must fit spaghetti_flow_id_t"); \
	BUILD_ASSERT(DT_PROP(node_id, signal_count) == \
			     SPAGHETTI_FLOW_SIGNAL_COUNT, \
		     "Spaghetti Flow signal-count must be five"); \
	BUILD_ASSERT(DT_PROP(node_id, function_bay_count) <= \
			     CONFIG_SPAGHETTI_MAX_FUNCTION_BAYS_PER_FLOW, \
		     "Spaghetti Flow function-bay-count exceeds profile"); \
	BUILD_ASSERT(DT_REG_ADDR(DT_PHANDLE(node_id, port)) <= UINT8_MAX, \
		     "Spaghetti Flow port ID must fit spaghetti_port_id_t");

#define SPAGHETTI_FLOW_DEFINE(node_id) \
	{ \
		.id = (spaghetti_flow_id_t)DT_REG_ADDR(node_id), \
		.port_id = (spaghetti_port_id_t)DT_REG_ADDR( \
			DT_PHANDLE(node_id, port)), \
		.direction = SPAGHETTI_FLOW_DIRECTION(node_id), \
		.signal_count = (uint8_t)DT_PROP(node_id, signal_count), \
		.function_bay_count = \
			(uint8_t)DT_PROP(node_id, function_bay_count), \
	},

DT_FOREACH_STATUS_OKAY(spaghettilab_flow, SPAGHETTI_FLOW_VALIDATE)

static const struct spaghetti_flow_descriptor flows[] = {
	DT_FOREACH_STATUS_OKAY(spaghettilab_flow, SPAGHETTI_FLOW_DEFINE)
};

static bool topology_ready;

static const struct spaghetti_flow_descriptor *flow_by_id_locked(
	spaghetti_flow_id_t id)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(flows); ++idx) {
		if (flows[idx].id == id) {
			return &flows[idx];
		}
	}

	return NULL;
}

int spaghetti_topology_init(void)
{
	if (topology_ready) {
		return -EALREADY;
	}

	if (ARRAY_SIZE(flows) > CONFIG_SPAGHETTI_MAX_FLOWS) {
		return -E2BIG;
	}
	if (ARRAY_SIZE(flows) != spaghetti_port_count()) {
		return -EINVAL;
	}

	for (size_t idx = 0U; idx < ARRAY_SIZE(flows); ++idx) {
		const struct spaghetti_flow_descriptor *flow = &flows[idx];

		if (flow->signal_count != SPAGHETTI_FLOW_SIGNAL_COUNT) {
			return -EINVAL;
		}
		if (flow->function_bay_count >
		    CONFIG_SPAGHETTI_MAX_FUNCTION_BAYS_PER_FLOW) {
			return -E2BIG;
		}
		if (spaghetti_port_get(flow->port_id) == NULL) {
			return -ENOENT;
		}

		for (size_t prior = 0U; prior < idx; ++prior) {
			if (flows[prior].id == flow->id) {
				return -EINVAL;
			}
			if (flows[prior].port_id == flow->port_id) {
				return -EINVAL;
			}
		}
	}

	topology_ready = true;
	LOG_INF("ready: flows=%u", (uint32_t)ARRAY_SIZE(flows));
	return 0;
}

size_t spaghetti_topology_flow_count(void)
{
	return ARRAY_SIZE(flows);
}

const struct spaghetti_flow_descriptor *spaghetti_topology_flow_get(
	spaghetti_flow_id_t id)
{
	if (!topology_ready) {
		return NULL;
	}

	return flow_by_id_locked(id);
}

const struct spaghetti_flow_descriptor *spaghetti_topology_flow_for_port(
	spaghetti_port_id_t port_id)
{
	if (!topology_ready) {
		return NULL;
	}

	for (size_t idx = 0U; idx < ARRAY_SIZE(flows); ++idx) {
		if (flows[idx].port_id == port_id) {
			return &flows[idx];
		}
	}

	return NULL;
}

int spaghetti_topology_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_descriptor *out)
{
	const struct spaghetti_flow_descriptor *flow;

	if ((out == NULL) || (bay_id == SPAGHETTI_BAY_ID_UNSPECIFIED)) {
		return -EINVAL;
	}
	if (!topology_ready) {
		return -ENOENT;
	}

	flow = flow_by_id_locked(flow_id);
	if (flow == NULL) {
		return -ENOENT;
	}
	if (bay_id >= flow->function_bay_count) {
		return -ENOENT;
	}

	out->flow_id = flow_id;
	out->id = bay_id;
	out->ordinal_from_field = bay_id;
	return 0;
}

#if defined(CONFIG_ZTEST)
void spaghetti_topology_reset(void)
{
	topology_ready = false;
}
#endif
