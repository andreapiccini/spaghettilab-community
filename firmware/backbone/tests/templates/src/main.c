#include <errno.h>
#include <stddef.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/block_driver.h>
#include <spaghetti/block_registry.h>
#include <spaghetti/device_profile.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/feature_pack.h>
#include <spaghetti/image_manifest.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/topology.h>

#include "topology_internal.h"

/**
 * @file
 * @brief Clean-room compile check for firmware templates.
 *
 * Instantiates Module, Device Profile, Block Driver, and Capability Pack
 * templates without patching central registries. The board overlay exposes two
 * Flows so topology layout work does not require protocol or editor changes.
 */

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
};

static const struct spaghetti_port ports[] = {
	{ .id = 0U, .capabilities = SPAGHETTI_PORT_CAP_I2C },
	{ .id = 1U, .capabilities = SPAGHETTI_PORT_CAP_I2C },
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

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				   uint32_t capabilities)
{
	if (port == NULL) {
		return false;
	}

	return (port->capabilities & capabilities) == capabilities;
}

static void *templates_setup(void)
{
	spaghetti_topology_reset();
	zassert_ok(spaghetti_topology_init());
	zassert_ok(spaghetti_driver_registry_init());
	zassert_ok(spaghetti_block_registry_init());
	zassert_ok(spaghetti_feature_registry_init());
	zassert_ok(spaghetti_image_manifest_init());
	zassert_ok(spaghetti_device_profile_init());
	return NULL;
}

static void templates_before(void *fixture)
{
	ARG_UNUSED(fixture);
}

static void templates_after(void *fixture)
{
	ARG_UNUSED(fixture);
}

ZTEST(templates, test_module_driver_template_registers)
{
	const struct spaghetti_module_driver *driver =
		spaghetti_driver_registry_find("example");

	zassert_not_null(driver);
	zassert_equal(driver->api_version, SPAGHETTI_MODULE_DRIVER_API_VERSION);
	zassert_equal(strcmp(driver->type_id, "example"), 0);
	zassert_not_null(driver->config_schema);
	zassert_not_null(driver->ops);
	zassert_not_null(driver->ops->validate_config);
	zassert_not_null(driver->ops->describe_endpoint);
	zassert_not_null(driver->ops->init);
	zassert_not_null(driver->ops->read);
	zassert_not_null(driver->ops->deinit);
	zassert_is_null(driver->ops->start);
	zassert_is_null(driver->ops->stop);
}

ZTEST(templates, test_device_profile_template_registers)
{
	const struct spaghetti_device_profile *profile =
		spaghetti_device_profile_find("example-sensor", 1U, NULL);

	zassert_not_null(profile);
	zassert_equal(strcmp(profile->profile_id, "example-sensor"), 0);
	zassert_equal(profile->version, 1U);
	zassert_equal(profile->transport, SPAGHETTI_PORT_TRANSPORT_I2C);
	zassert_true(profile->sample_count >= 1U);
	zassert_true(profile->sample_field_count >= 1U);
}

ZTEST(templates, test_block_and_pack_templates_register)
{
	const struct spaghetti_block_driver *block =
		spaghetti_block_registry_find("example_offset");
	const struct spaghetti_feature_pack *pack =
		spaghetti_feature_pack_find("example-pack");

	zassert_not_null(block);
	zassert_equal(block->api_version, SPAGHETTI_BLOCK_DRIVER_API_VERSION);
	zassert_equal(strcmp(block->type_id, "example_offset"), 0);
	zassert_not_null(block->ops);
	zassert_not_null(block->ops->process);

	zassert_not_null(pack);
	zassert_equal(strcmp(pack->id, "example-pack"), 0);
	zassert_true(spaghetti_feature_pack_provides_module("example"));
	zassert_true(spaghetti_feature_pack_provides_block("example_offset"));
}

ZTEST(templates, test_fake_board_exposes_two_flows)
{
	const struct spaghetti_flow_descriptor *flow0;
	const struct spaghetti_flow_descriptor *flow1;

	zassert_equal(spaghetti_topology_flow_count(), 2U);

	flow0 = spaghetti_topology_flow_get(0U);
	flow1 = spaghetti_topology_flow_get(1U);
	zassert_not_null(flow0);
	zassert_not_null(flow1);
	zassert_equal(flow0->port_id, 0U);
	zassert_equal(flow1->port_id, 1U);
	zassert_equal(flow0->signal_count, SPAGHETTI_FLOW_SIGNAL_COUNT);
	zassert_equal(flow1->signal_count, SPAGHETTI_FLOW_SIGNAL_COUNT);
	zassert_equal(flow0->function_bay_count, 0U);
	zassert_equal(flow1->function_bay_count, 2U);
}

ZTEST_SUITE(templates, NULL, templates_setup, templates_before, templates_after,
	    NULL);
