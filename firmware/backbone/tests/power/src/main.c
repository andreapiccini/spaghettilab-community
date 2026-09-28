#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/topology.h>

#include "power_internal.h"
#include "topology_internal.h"

struct spaghetti_port {
	spaghetti_port_id_t id;
};

static const struct spaghetti_port ports[] = {
	{ .id = 0U },
};

static bool backend_enabled;
static int backend_enable_calls;
static int backend_disable_calls;
static int next_enable_error;
static int next_disable_error;

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

int spaghetti_power_backend_set(spaghetti_power_resource_id_t id, bool enabled)
{
	int err;

	if (id != 0U) {
		return -ENOENT;
	}

	if (enabled) {
		++backend_enable_calls;
		err = next_enable_error;
		next_enable_error = 0;
	} else {
		++backend_disable_calls;
		err = next_disable_error;
		next_disable_error = 0;
	}
	if (err < 0) {
		return err;
	}

	backend_enabled = enabled;
	return 0;
}

static void expect_status(enum spaghetti_power_state state,
			  uint16_t reference_count,
			  int last_error)
{
	struct spaghetti_power_status status;

	zassert_ok(spaghetti_power_get_status(0U, &status));
	zassert_equal(status.state, state);
	zassert_equal(status.reference_count, reference_count);
	zassert_equal(status.last_error, last_error);
}

static void power_before(void *fixture)
{
	ARG_UNUSED(fixture);
	backend_enabled = false;
	backend_enable_calls = 0;
	backend_disable_calls = 0;
	next_enable_error = 0;
	next_disable_error = 0;
	spaghetti_power_reset();
	spaghetti_topology_reset();
	zassert_ok(spaghetti_topology_init());
}

ZTEST(power, test_reference_counting_and_transition_rollback)
{
	struct spaghetti_power_status status;
	const spaghetti_power_owner_id_t module_a = 10U;
	const spaghetti_power_owner_id_t module_b = 11U;

	zassert_equal(spaghetti_power_acquire(0U, module_a), -EACCES);
	zassert_equal(spaghetti_power_release(0U, module_a), -EACCES);
	zassert_equal(spaghetti_power_get_status(0U, &status), -EACCES);

	next_disable_error = -EIO;
	zassert_equal(spaghetti_power_init(), -EIO);
	zassert_equal(spaghetti_power_get_status(0U, &status), -EACCES);
	next_disable_error = 0;
	zassert_ok(spaghetti_power_init());
	zassert_equal(spaghetti_power_init(), -EALREADY);
	zassert_false(backend_enabled);
	expect_status(SPAGHETTI_POWER_OFF, 0U, 0);

	zassert_equal(spaghetti_power_get_status(0U, NULL), -EINVAL);
	zassert_equal(spaghetti_power_get_status(9U, &status), -ENOENT);
	zassert_equal(spaghetti_power_acquire(
		0U, SPAGHETTI_POWER_OWNER_INVALID), -EINVAL);
	zassert_equal(spaghetti_power_release(
		0U, SPAGHETTI_POWER_OWNER_INVALID), -EINVAL);
	zassert_equal(spaghetti_power_acquire(9U, module_a), -ENOENT);
	zassert_equal(spaghetti_power_release(9U, module_a), -ENOENT);
	zassert_equal(spaghetti_power_release(0U, module_a), -EALREADY);

	backend_enable_calls = 0;
	backend_disable_calls = 0;
	next_enable_error = -EIO;
	zassert_equal(spaghetti_power_acquire(0U, module_a), -EIO);
	zassert_false(backend_enabled);
	expect_status(SPAGHETTI_POWER_ERROR, 0U, -EIO);

	zassert_ok(spaghetti_power_acquire(0U, module_a));
	zassert_true(backend_enabled);
	expect_status(SPAGHETTI_POWER_ON, 1U, 0);
	zassert_equal(spaghetti_power_acquire(0U, module_a), -EALREADY);
	zassert_ok(spaghetti_power_acquire(0U, module_b));
	zassert_equal(backend_enable_calls, 2);
	expect_status(SPAGHETTI_POWER_ON, 2U, 0);

	zassert_equal(spaghetti_power_release(0U, 12U), -ENOENT);
	zassert_ok(spaghetti_power_release(0U, module_a));
	zassert_true(backend_enabled);
	zassert_equal(backend_disable_calls, 0);
	expect_status(SPAGHETTI_POWER_ON, 1U, 0);

	next_disable_error = -EIO;
	zassert_equal(spaghetti_power_release(0U, module_b), -EIO);
	zassert_true(backend_enabled);
	expect_status(SPAGHETTI_POWER_ERROR, 1U, -EIO);
	zassert_equal(spaghetti_power_acquire(0U, 12U), -EIO);
	zassert_ok(spaghetti_power_release(0U, module_b));
	zassert_false(backend_enabled);
	expect_status(SPAGHETTI_POWER_OFF, 0U, 0);

	backend_enable_calls = 0;
	backend_disable_calls = 0;
	zassert_ok(spaghetti_power_acquire(0U, module_a));
	zassert_ok(spaghetti_power_acquire(0U, module_b));
	zassert_ok(spaghetti_power_release(0U, module_b));
	zassert_true(backend_enabled);
	zassert_ok(spaghetti_power_release(0U, module_a));
	zassert_equal(backend_enable_calls, 1);
	zassert_equal(backend_disable_calls, 1);
	zassert_false(backend_enabled);
	expect_status(SPAGHETTI_POWER_OFF, 0U, 0);

	backend_enable_calls = 0;
	backend_disable_calls = 0;
	for (spaghetti_power_owner_id_t owner = 0U; owner < 8U; ++owner) {
		zassert_ok(spaghetti_power_acquire(0U, owner));
	}
	zassert_equal(spaghetti_power_acquire(0U, 8U), -ENOSPC);
	zassert_equal(backend_enable_calls, 1);
	expect_status(SPAGHETTI_POWER_ON, 8U, 0);

	for (spaghetti_power_owner_id_t owner = 0U; owner < 8U; ++owner) {
		zassert_ok(spaghetti_power_release(0U, owner));
	}
	zassert_equal(backend_disable_calls, 1);
	zassert_false(backend_enabled);
	expect_status(SPAGHETTI_POWER_OFF, 0U, 0);
}

ZTEST(power, test_unmanaged_and_enforced_admission)
{
	enum spaghetti_power_admission_state state =
		SPAGHETTI_POWER_ADMISSION_NOT_REQUIRED;
	struct spaghetti_bay_power_descriptor bay;
	const struct spaghetti_power_rail_descriptor *rail0;
	const struct spaghetti_power_rail_descriptor *rail1;
	const struct spaghetti_power_binding unmanaged = {
		.flow_id = 0U,
		.bay_id = 0U,
		.rail_id = 1U,
	};
	const struct spaghetti_power_binding switched = {
		.flow_id = 0U,
		.bay_id = 0U,
		.rail_id = 0U,
	};
	const struct spaghetti_power_binding missing_rail = {
		.flow_id = 0U,
		.bay_id = 1U,
		.rail_id = 0U,
	};
	const struct spaghetti_module_power_requirement undeclared = {
		.declared = false,
	};
	const struct spaghetti_module_power_requirement ok = {
		.declared = true,
		.min_microvolts = 3100000U,
		.max_microvolts = 3500000U,
		.max_microamps = 40000U,
	};
	const struct spaghetti_module_power_requirement over_voltage = {
		.declared = true,
		.min_microvolts = 4000000U,
		.max_microvolts = 5000000U,
		.max_microamps = 1000U,
	};
	const struct spaghetti_module_power_requirement heavy = {
		.declared = true,
		.min_microvolts = 3100000U,
		.max_microvolts = 3500000U,
		.max_microamps = 70000U,
	};

	zassert_ok(spaghetti_power_init());
	zassert_equal(spaghetti_power_rail_count(), 2U);
	rail0 = spaghetti_power_rail_get(0U);
	rail1 = spaghetti_power_rail_get(1U);
	zassert_not_null(rail0);
	zassert_not_null(rail1);
	zassert_equal(rail0->assurance, SPAGHETTI_POWER_SWITCHED);
	zassert_equal(rail1->assurance, SPAGHETTI_POWER_UNMANAGED);
	zassert_ok(spaghetti_power_bay_get(0U, 0U, &bay));
	zassert_equal(bay.available_rail_mask, BIT(0) | BIT(1));

	backend_enable_calls = 0;
	zassert_ok(spaghetti_power_attach(&unmanaged, 20U, &undeclared, &state));
	zassert_equal(state, SPAGHETTI_POWER_ADMISSION_UNVERIFIED);
	zassert_equal(backend_enable_calls, 0);
	zassert_ok(spaghetti_power_detach(&unmanaged, 20U));

	zassert_equal(spaghetti_power_validate_binding(
			      &missing_rail, &ok, &state),
		      -ENOENT);
	zassert_equal(spaghetti_power_validate_binding(
			      &switched, &over_voltage, &state),
		      -ERANGE);

	zassert_ok(spaghetti_power_attach(&switched, 21U, &ok, &state));
	zassert_equal(state, SPAGHETTI_POWER_ADMISSION_ENFORCED);
	zassert_true(backend_enabled);
	zassert_equal(spaghetti_power_attach(&switched, 22U, &heavy, &state),
		      -ENOSPC);
	zassert_ok(spaghetti_power_detach(&switched, 21U));
	zassert_false(backend_enabled);

	next_enable_error = -EIO;
	zassert_equal(spaghetti_power_attach(&switched, 23U, &ok, &state), -EIO);
	zassert_false(backend_enabled);
}

ZTEST_SUITE(power, NULL, NULL, power_before, NULL, NULL);
