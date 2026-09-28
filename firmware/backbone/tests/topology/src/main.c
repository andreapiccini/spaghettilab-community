#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/port.h>
#include <spaghetti/topology.h>

#include "topology_internal.h"

struct spaghetti_port {
	spaghetti_port_id_t id;
};

static const struct spaghetti_port ports[] = {
	{ .id = 0U },
	{ .id = 1U },
};

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(ports); ++idx) {
		if (ports[idx].id == id) {
			return &ports[idx];
		}
	}

	return NULL;
}

size_t spaghetti_port_count(void)
{
	return ARRAY_SIZE(ports);
}

static void topology_before(void *fixture)
{
	ARG_UNUSED(fixture);
	spaghetti_topology_reset();
	zassert_ok(spaghetti_topology_init());
}

static void topology_after(void *fixture)
{
	ARG_UNUSED(fixture);
	spaghetti_topology_reset();
}

ZTEST(topology, test_enumerates_two_flows_with_different_bay_counts)
{
	const struct spaghetti_flow_descriptor *flow0;
	const struct spaghetti_flow_descriptor *flow1;
	const struct spaghetti_flow_descriptor *by_port;

	zassert_equal(spaghetti_topology_flow_count(), 2U);

	flow0 = spaghetti_topology_flow_get(0U);
	flow1 = spaghetti_topology_flow_get(1U);
	zassert_not_null(flow0);
	zassert_not_null(flow1);
	zassert_equal(flow0->port_id, 0U);
	zassert_equal(flow1->port_id, 1U);
	zassert_equal(flow0->direction, SPAGHETTI_FLOW_FIELD_TO_CORE);
	zassert_equal(flow1->direction, SPAGHETTI_FLOW_CORE_TO_FIELD);
	zassert_equal(flow0->signal_count, SPAGHETTI_FLOW_SIGNAL_COUNT);
	zassert_equal(flow1->signal_count, SPAGHETTI_FLOW_SIGNAL_COUNT);
	zassert_equal(flow0->function_bay_count, 0U);
	zassert_equal(flow1->function_bay_count, 3U);

	by_port = spaghetti_topology_flow_for_port(1U);
	zassert_equal(by_port, flow1);
	zassert_is_null(spaghetti_topology_flow_get(9U));
	zassert_is_null(spaghetti_topology_flow_for_port(9U));
}

ZTEST(topology, test_bay_lookup_and_negative_validation)
{
	struct spaghetti_bay_descriptor bay;

	zassert_equal(spaghetti_topology_bay_get(0U, 0U, &bay), -ENOENT);
	zassert_ok(spaghetti_topology_bay_get(1U, 0U, &bay));
	zassert_equal(bay.flow_id, 1U);
	zassert_equal(bay.id, 0U);
	zassert_equal(bay.ordinal_from_field, 0U);
	zassert_ok(spaghetti_topology_bay_get(1U, 2U, &bay));
	zassert_equal(bay.ordinal_from_field, 2U);
	zassert_equal(spaghetti_topology_bay_get(1U, 3U, &bay), -ENOENT);
	zassert_equal(spaghetti_topology_bay_get(9U, 0U, &bay), -ENOENT);
	zassert_equal(spaghetti_topology_bay_get(
		1U, SPAGHETTI_BAY_ID_UNSPECIFIED, &bay), -EINVAL);
	zassert_equal(spaghetti_topology_bay_get(1U, 0U, NULL), -EINVAL);
	zassert_equal(spaghetti_topology_init(), -EALREADY);
}

ZTEST_SUITE(topology, NULL, NULL, topology_before, topology_after, NULL);
