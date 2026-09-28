#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/secure_workspace.h>

#include "secure_workspace_internal.h"

static struct spaghetti_secure_allocator_stats allocator_stats = {
	.capacity = 64U * 1024U,
};
static int allocator_error;

int spaghetti_secure_allocator_get_stats(
	struct spaghetti_secure_allocator_stats *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	if (allocator_error < 0) {
		return allocator_error;
	}
	*out = allocator_stats;
	return 0;
}

static void account_allocation(size_t size)
{
	allocator_stats.allocated += size;
	allocator_stats.peak_allocated = MAX(
		allocator_stats.peak_allocated, allocator_stats.allocated);
}

static void account_free(size_t size)
{
	allocator_stats.allocated -= size;
}

ZTEST(secure_workspace, test_admission_usage_timeout_and_repeated_sessions)
{
	struct spaghetti_secure_workspace_snapshot snapshot;
	size_t allocation_size;
	size_t allocation_baseline;
	void *allocation;

	zassert_equal(spaghetti_secure_workspace_get_snapshot(NULL), -EINVAL);
	zassert_equal(spaghetti_secure_workspace_get_snapshot(&snapshot),
		-EACCES);
	zassert_equal(spaghetti_secure_workspace_acquire(
		SPAGHETTI_SECURE_OWNER_NONE, K_NO_WAIT), -EINVAL);
	zassert_equal(spaghetti_secure_workspace_acquire(
		SPAGHETTI_SECURE_OWNER_MQTT, K_FOREVER), -EINVAL);
	zassert_equal(spaghetti_secure_workspace_acquire(
		SPAGHETTI_SECURE_OWNER_MQTT, K_MSEC(101)), -EINVAL);
	zassert_ok(spaghetti_secure_workspace_init());
	zassert_equal(spaghetti_secure_workspace_init(), -EALREADY);
	zassert_ok(spaghetti_secure_workspace_get_snapshot(&snapshot));
	zassert_equal(snapshot.owner, SPAGHETTI_SECURE_OWNER_NONE);
	zassert_equal(snapshot.capacity,
		CONFIG_SPAGHETTI_SECURE_WORKSPACE_SIZE);
	zassert_equal(snapshot.peak_used, 0U);
	zassert_equal(snapshot.allocation_failures, 0U);

	zassert_ok(spaghetti_secure_workspace_acquire(
		SPAGHETTI_SECURE_OWNER_MQTT, K_NO_WAIT));
	zassert_equal(spaghetti_secure_workspace_acquire(
		SPAGHETTI_SECURE_OWNER_WIFI_OTA, K_NO_WAIT), -EAGAIN);
	zassert_equal(spaghetti_secure_workspace_release(
		SPAGHETTI_SECURE_OWNER_WIFI_OTA), -EPERM);
	zassert_ok(spaghetti_secure_workspace_get_snapshot(&snapshot));
	zassert_equal(snapshot.owner, SPAGHETTI_SECURE_OWNER_MQTT);
	zassert_equal(snapshot.allocation_failures, 1U);
	zassert_ok(spaghetti_secure_workspace_release(
		SPAGHETTI_SECURE_OWNER_MQTT));
	zassert_equal(spaghetti_secure_workspace_release(
		SPAGHETTI_SECURE_OWNER_MQTT), -ENOENT);

	allocator_stats.allocated =
		allocator_stats.capacity -
		CONFIG_SPAGHETTI_SECURE_WORKSPACE_SIZE + 1U;
	zassert_equal(spaghetti_secure_workspace_acquire(
		SPAGHETTI_SECURE_OWNER_WIFI_OTA, K_NO_WAIT), -ENOMEM);
	allocator_stats.allocated = 0U;
	zassert_ok(spaghetti_secure_workspace_get_snapshot(&snapshot));
	zassert_equal(snapshot.allocation_failures, 2U);
	allocator_error = -EIO;
	zassert_equal(spaghetti_secure_workspace_acquire(
		SPAGHETTI_SECURE_OWNER_WIFI_OTA, K_NO_WAIT), -EIO);
	allocator_error = 0;
	zassert_ok(spaghetti_secure_workspace_get_snapshot(&snapshot));
	zassert_equal(snapshot.allocation_failures, 3U);
	zassert_ok(spaghetti_secure_workspace_acquire(
		SPAGHETTI_SECURE_OWNER_WIFI_OTA, K_NO_WAIT));
	zassert_ok(spaghetti_secure_workspace_release(
		SPAGHETTI_SECURE_OWNER_WIFI_OTA));

	allocation_baseline = allocator_stats.allocated;
	for (size_t cycle_idx = 0U; cycle_idx < 100U; cycle_idx++) {
		zassert_ok(spaghetti_secure_workspace_acquire(
			SPAGHETTI_SECURE_OWNER_WIFI_OTA, K_MSEC(10)));
		allocation_size = 1024U + cycle_idx;
		allocation = calloc(1U, allocation_size);
		zassert_not_null(allocation);
		account_allocation(allocation_size);
		free(allocation);
		account_free(allocation_size);
		zassert_ok(spaghetti_secure_workspace_release(
			SPAGHETTI_SECURE_OWNER_WIFI_OTA));
	}
	zassert_equal(allocator_stats.allocated, allocation_baseline);
	zassert_ok(spaghetti_secure_workspace_get_snapshot(&snapshot));
	zassert_equal(snapshot.owner, SPAGHETTI_SECURE_OWNER_NONE);
	zassert_true(snapshot.peak_used >= 1024U);
}

ZTEST_SUITE(secure_workspace, NULL, NULL, NULL, NULL, NULL);
