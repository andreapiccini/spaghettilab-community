#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/discovery.h>
#include <spaghetti/port.h>
#include <spaghetti/topology.h>

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
};

static const struct spaghetti_port fake_port = {
	.id = 0U,
	.capabilities = SPAGHETTI_PORT_CAP_I2C,
};

static const struct spaghetti_flow_descriptor fake_flow = {
	.id = 0U,
	.port_id = 0U,
	.direction = SPAGHETTI_FLOW_BIDIRECTIONAL,
	.signal_count = SPAGHETTI_FLOW_SIGNAL_COUNT,
	.function_bay_count = 0U,
};

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	return (id == fake_port.id) ? &fake_port : NULL;
}

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				   uint32_t capabilities)
{
	if ((port == NULL) || (capabilities == 0U)) {
		return false;
	}

	return (port->capabilities & capabilities) == capabilities;
}

const struct spaghetti_flow_descriptor *spaghetti_topology_flow_for_port(
	spaghetti_port_id_t port_id)
{
	return (port_id == fake_flow.port_id) ? &fake_flow : NULL;
}

static struct spaghetti_discovery_scan_policy default_policy(void)
{
	return (struct spaghetti_discovery_scan_policy){
		.allow_read_only = true,
		.allow_state_changing = false,
		.timeout_per_provider = K_MSEC(10),
	};
}

ZTEST(discovery, test_init_scan_list_empty_without_providers)
{
	struct spaghetti_discovery_scan_policy policy = default_policy();
	struct spaghetti_discovery_candidate listed[2];
	size_t count = 99U;

	zassert_equal(spaghetti_discovery_scan_port(0U, &policy), -EACCES);
	zassert_ok(spaghetti_discovery_init());
	zassert_equal(spaghetti_discovery_init(), -EALREADY);

	zassert_equal(spaghetti_discovery_scan_port(0U, NULL), -EINVAL);
	policy.allow_read_only = false;
	policy.allow_state_changing = false;
	zassert_equal(spaghetti_discovery_scan_port(0U, &policy), -EINVAL);
	policy = default_policy();

	zassert_equal(spaghetti_discovery_scan_port(1U, &policy), -ENOENT);
	zassert_ok(spaghetti_discovery_scan_port(0U, &policy));

	zassert_ok(spaghetti_discovery_list(NULL, 0U, &count));
	zassert_equal(count, 0U);
	zassert_ok(spaghetti_discovery_list(listed, ARRAY_SIZE(listed), &count));
	zassert_equal(count, 0U);

	zassert_equal(spaghetti_discovery_accept(1U, 10U, 1U, NULL), -EINVAL);
	zassert_equal(spaghetti_discovery_reject(1U, 1U), -ENOENT);
}

ZTEST_SUITE(discovery, NULL, NULL, NULL, NULL, NULL);
