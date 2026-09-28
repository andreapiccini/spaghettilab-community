#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/capabilities.h>
#include <spaghetti/service.h>

#include "service_thread.h"

static uint32_t available_capabilities = SPAGHETTI_BUILD_CAP_WIFI;
static size_t owned_resources;
static size_t resource_peak;
static size_t start_calls;
static size_t stop_calls;
static int next_start_error;
static int next_stop_error;

bool spaghetti_capabilities_support(uint32_t required)
{
	return (available_capabilities & required) == required;
}

static int fake_start(void)
{
	++start_calls;
	if (next_start_error < 0) {
		const int err = next_start_error;

		next_start_error = 0;
		return err;
	}
	++owned_resources;
	resource_peak = MAX(resource_peak, owned_resources);
	return 0;
}

static int fake_stop(k_timeout_t timeout)
{
	++stop_calls;
	zassert_false(K_TIMEOUT_EQ(timeout, K_FOREVER));
	if (next_stop_error < 0) {
		const int err = next_stop_error;

		next_stop_error = 0;
		return err;
	}
	owned_resources = 0U;
	return 0;
}

static const struct spaghetti_service_ops fake_ops = {
	.start = fake_start,
	.stop = fake_stop,
};

static const struct spaghetti_service_descriptor descriptors[] = {
	{
		.id = SPAGHETTI_SERVICE_ID_WIFI,
		.required_capabilities = SPAGHETTI_BUILD_CAP_WIFI,
		.ops = &fake_ops,
	},
	{
		.id = SPAGHETTI_SERVICE_ID_REMOTE_CONSOLE,
		.required_capabilities =
			SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE,
		.ops = &fake_ops,
	},
};

static void short_thread_entry(void *first, void *second, void *third)
{
	ARG_UNUSED(first);
	ARG_UNUSED(second);
	ARG_UNUSED(third);
}

ZTEST(service_manager, test_dynamic_thread_stacks_return_to_baseline)
{
	struct spaghetti_service_resource_snapshot before;
	struct spaghetti_service_resource_snapshot after;
	struct spaghetti_service_thread thread = {0};

	zassert_ok(spaghetti_service_get_resource_snapshot(&before));
	zassert_equal(before.active_threads, 0U);
	zassert_equal(before.active_stack_bytes, 0U);
	for (size_t cycle_idx = 0U; cycle_idx < 100U; ++cycle_idx) {
		zassert_ok(spaghetti_service_thread_start(
			&thread, 1024U, short_thread_entry,
			NULL, NULL, NULL, 5, "service_test"));
		zassert_equal(spaghetti_service_thread_start(
			&thread, 1024U, short_thread_entry,
			NULL, NULL, NULL, 5, "service_test"), -EALREADY);
		zassert_ok(spaghetti_service_thread_join_and_release(
			&thread, K_MSEC(50)));
	}
	zassert_ok(spaghetti_service_get_resource_snapshot(&after));
	zassert_equal(after.active_threads, before.active_threads);
	zassert_equal(after.active_stack_bytes, before.active_stack_bytes);
	zassert_true(after.peak_threads >= 1U);
	zassert_true(after.peak_stack_bytes >= 1024U);
}

ZTEST(service_manager, test_bounded_lifecycle_and_resource_return)
{
	const struct spaghetti_service_descriptor duplicate[] = {
		descriptors[0], descriptors[0],
	};
	enum spaghetti_service_state state;

	zassert_equal(spaghetti_service_start(SPAGHETTI_SERVICE_ID_WIFI),
		-EACCES);
	zassert_equal(spaghetti_service_manager_init(NULL, 1U), -EINVAL);
	zassert_equal(spaghetti_service_manager_init(duplicate,
		ARRAY_SIZE(duplicate)), -EEXIST);
	zassert_ok(spaghetti_service_manager_init(
		descriptors, ARRAY_SIZE(descriptors)));
	zassert_equal(spaghetti_service_manager_init(
		descriptors, ARRAY_SIZE(descriptors)), -EALREADY);
	zassert_equal(spaghetti_service_get_state("missing", &state), -ENOENT);
	zassert_equal(spaghetti_service_get_state(
		SPAGHETTI_SERVICE_ID_WIFI, NULL), -EINVAL);
	zassert_equal(spaghetti_service_start(
		SPAGHETTI_SERVICE_ID_REMOTE_CONSOLE), -ENOTSUP);
	zassert_equal(spaghetti_service_stop(
		SPAGHETTI_SERVICE_ID_WIFI, K_FOREVER), -EINVAL);

	for (size_t cycle_idx = 0U; cycle_idx < 100U; ++cycle_idx) {
		zassert_ok(spaghetti_service_start(
			SPAGHETTI_SERVICE_ID_WIFI));
		zassert_equal(spaghetti_service_start(
			SPAGHETTI_SERVICE_ID_WIFI), -EALREADY);
		zassert_equal(owned_resources, 1U);
		zassert_ok(spaghetti_service_get_state(
			SPAGHETTI_SERVICE_ID_WIFI, &state));
		zassert_equal(state, SPAGHETTI_SERVICE_RUNNING);
		zassert_ok(spaghetti_service_stop(
			SPAGHETTI_SERVICE_ID_WIFI, K_MSEC(10)));
		zassert_equal(owned_resources, 0U);
		zassert_equal(spaghetti_service_stop(
			SPAGHETTI_SERVICE_ID_WIFI, K_NO_WAIT), -EALREADY);
	}

	zassert_equal(start_calls, 100U);
	zassert_equal(stop_calls, 100U);
	zassert_equal(resource_peak, 1U);
	next_stop_error = -ETIMEDOUT;
	zassert_ok(spaghetti_service_start(SPAGHETTI_SERVICE_ID_WIFI));
	zassert_equal(spaghetti_service_stop(
		SPAGHETTI_SERVICE_ID_WIFI, K_MSEC(10)), -ETIMEDOUT);
	zassert_ok(spaghetti_service_get_state(
		SPAGHETTI_SERVICE_ID_WIFI, &state));
	zassert_equal(state, SPAGHETTI_SERVICE_DEGRADED);
	zassert_equal(spaghetti_service_start(
		SPAGHETTI_SERVICE_ID_WIFI), -EIO);
	zassert_ok(spaghetti_service_stop(
		SPAGHETTI_SERVICE_ID_WIFI, K_MSEC(10)));
	zassert_equal(owned_resources, 0U);
	zassert_ok(spaghetti_service_get_state(
		SPAGHETTI_SERVICE_ID_WIFI, &state));
	zassert_equal(state, SPAGHETTI_SERVICE_STOPPED);

	next_start_error = -ENOMEM;
	zassert_equal(spaghetti_service_start(
		SPAGHETTI_SERVICE_ID_WIFI), -ENOMEM);
	zassert_ok(spaghetti_service_get_state(
		SPAGHETTI_SERVICE_ID_WIFI, &state));
	zassert_equal(state, SPAGHETTI_SERVICE_DEGRADED);
	zassert_ok(spaghetti_service_stop(
		SPAGHETTI_SERVICE_ID_WIFI, K_NO_WAIT));
	zassert_equal(owned_resources, 0U);
}

ZTEST_SUITE(service_manager, NULL, NULL, NULL, NULL, NULL);
