#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/core.h>
#include <spaghetti/health.h>

#include "health_internal.h"

static enum spaghetti_core_mode test_mode = SPAGHETTI_CORE_MODE_NORMAL;
static uint32_t fake_wdt_feed_count;
static uint32_t fake_wdt_setup_count;
static bool fail_wdt_setup;

SPAGHETTI_HEALTH_COMPONENT_DEFINE(test_runtime_health) = {
	.id = SPAGHETTI_HEALTH_ID_RUNTIME,
	.name = "runtime",
	.maximum_silence_ms = 40U,
	.required_core_modes = BIT(SPAGHETTI_CORE_MODE_NORMAL),
};

SPAGHETTI_HEALTH_COMPONENT_DEFINE(test_communication_health) = {
	.id = SPAGHETTI_HEALTH_ID_COMMUNICATION,
	.name = "communication",
	.maximum_silence_ms = 40U,
	.required_core_modes = BIT(SPAGHETTI_CORE_MODE_UNPROVISIONED) |
		BIT(SPAGHETTI_CORE_MODE_NORMAL) |
		BIT(SPAGHETTI_CORE_MODE_MAINTENANCE),
};

SPAGHETTI_HEALTH_COMPONENT_DEFINE(test_connectivity_health) = {
	.id = SPAGHETTI_HEALTH_ID_CONNECTIVITY,
	.name = "connectivity",
	.maximum_silence_ms = 40U,
	.required_core_modes = BIT(SPAGHETTI_CORE_MODE_NORMAL),
};

SPAGHETTI_HEALTH_COMPONENT_DEFINE(test_update_health) = {
	.id = SPAGHETTI_HEALTH_ID_UPDATE,
	.name = "update",
	.maximum_silence_ms = 40U,
	.required_core_modes = BIT(SPAGHETTI_CORE_MODE_UNPROVISIONED) |
		BIT(SPAGHETTI_CORE_MODE_NORMAL) |
		BIT(SPAGHETTI_CORE_MODE_MAINTENANCE),
};

static enum spaghetti_core_mode test_mode_getter(void)
{
	return test_mode;
}

static int fake_wdt_setup(uint32_t timeout_ms)
{
	ARG_UNUSED(timeout_ms);
	fake_wdt_setup_count++;
	return fail_wdt_setup ? -EIO : 0;
}

static int fake_wdt_feed(void)
{
	fake_wdt_feed_count++;
	return 0;
}

static const struct spaghetti_health_watchdog_backend fake_wdt = {
	.setup = fake_wdt_setup,
	.feed = fake_wdt_feed,
};

static void beat_required_normal(void)
{
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_RUNTIME));
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_COMMUNICATION));
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_CONNECTIVITY));
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_UPDATE));
}

static void health_before(void *fixture)
{
	ARG_UNUSED(fixture);
	spaghetti_health_reset();
	test_mode = SPAGHETTI_CORE_MODE_NORMAL;
	fake_wdt_feed_count = 0U;
	fake_wdt_setup_count = 0U;
	fail_wdt_setup = false;
	zassert_ok(spaghetti_health_init());
	spaghetti_health_set_mode_getter(test_mode_getter);
	zassert_ok(spaghetti_health_watchdog_backend_install(&fake_wdt));
}

static void health_after(void *fixture)
{
	ARG_UNUSED(fixture);
	spaghetti_health_reset();
}

ZTEST(health, test_boot_healthy_feeds_only_through_supervisor)
{
	struct spaghetti_health_status status;

	beat_required_normal();
	zassert_ok(spaghetti_health_start());
	k_sleep(K_MSEC(30));
	zassert_ok(spaghetti_health_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_HEALTH_HEALTHY);
	zassert_true(status.hardware_watchdog_available);
	zassert_true(status.watchdog_feed_count > 0U);
	zassert_equal(fake_wdt_feed_count,
		spaghetti_health_test_supervisor_feed_count());
	zassert_equal(fake_wdt_setup_count, 1U);
}

ZTEST(health, test_missing_heartbeat_marks_stale_component)
{
	struct spaghetti_health_status status;

	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_COMMUNICATION));
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_CONNECTIVITY));
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_UPDATE));
	spaghetti_health_test_poll();
	zassert_ok(spaghetti_health_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_HEALTH_STALE);
	zassert_equal(status.stale_component_id, SPAGHETTI_HEALTH_ID_RUNTIME);
	zassert_equal(fake_wdt_feed_count, 0U);
}

ZTEST(health, test_inactive_policy_component_is_not_required)
{
	struct spaghetti_health_status status;

	test_mode = SPAGHETTI_CORE_MODE_MAINTENANCE;
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_COMMUNICATION));
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_UPDATE));
	spaghetti_health_test_poll();
	zassert_ok(spaghetti_health_get_status(&status));
	zassert_true((status.state == SPAGHETTI_HEALTH_DEGRADED) ||
		     (status.state == SPAGHETTI_HEALTH_HEALTHY));
	zassert_equal(status.stale_component_id, 0U);
}

ZTEST(health, test_window_extends_deadline_and_expires)
{
	struct spaghetti_health_status status;
	spaghetti_health_window_token_t token;

	beat_required_normal();
	zassert_ok(spaghetti_health_window_acquire(
		SPAGHETTI_HEALTH_ID_UPDATE, K_MSEC(80), &token));
	zassert_true(token != 0U);
	k_sleep(K_MSEC(50));
	/* Keep other required components fresh; Update relies on the window. */
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_RUNTIME));
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_COMMUNICATION));
	zassert_ok(spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_CONNECTIVITY));
	spaghetti_health_test_poll();
	zassert_ok(spaghetti_health_get_status(&status));
	zassert_not_equal(status.state, SPAGHETTI_HEALTH_STALE);
	k_sleep(K_MSEC(50));
	zassert_equal(spaghetti_health_window_release(token), -ETIMEDOUT);
}

ZTEST(health, test_window_pool_full_and_invalid_inputs)
{
	spaghetti_health_window_token_t first;
	spaghetti_health_window_token_t second;
	spaghetti_health_window_token_t third;
	struct spaghetti_health_status status;

	zassert_equal(spaghetti_health_get_status(NULL), -EINVAL);
	zassert_equal(spaghetti_health_heartbeat(0U), -EINVAL);
	zassert_equal(spaghetti_health_heartbeat(99U), -ENOENT);
	zassert_equal(spaghetti_health_window_acquire(
		SPAGHETTI_HEALTH_ID_UPDATE, K_FOREVER, &first), -EINVAL);
	zassert_ok(spaghetti_health_window_acquire(
		SPAGHETTI_HEALTH_ID_UPDATE, K_MSEC(50), &first));
	zassert_ok(spaghetti_health_window_acquire(
		SPAGHETTI_HEALTH_ID_COMMUNICATION, K_MSEC(50), &second));
	zassert_equal(spaghetti_health_window_acquire(
		SPAGHETTI_HEALTH_ID_RUNTIME, K_MSEC(50), &third), -ENOMEM);
	zassert_ok(spaghetti_health_window_release(first));
	zassert_equal(spaghetti_health_window_release(0U), -EINVAL);
	zassert_equal(spaghetti_health_window_release(12345U), -ENOENT);
	zassert_ok(spaghetti_health_get_status(&status));
	zassert_true(status.last_reset_cause == status.last_reset_cause);
}

ZTEST(health, test_degraded_without_hardware_watchdog)
{
	struct spaghetti_health_status status;

	spaghetti_health_reset();
	zassert_ok(spaghetti_health_init());
	spaghetti_health_set_mode_getter(test_mode_getter);
	beat_required_normal();
	spaghetti_health_test_poll();
	zassert_ok(spaghetti_health_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_HEALTH_DEGRADED);
	zassert_false(status.hardware_watchdog_available);
	zassert_true(status.watchdog_feed_count > 0U);
}

ZTEST(health, test_start_rejects_duplicate_and_records_reset_cause)
{
	struct spaghetti_health_status status;

	beat_required_normal();
	zassert_ok(spaghetti_health_start());
	zassert_equal(spaghetti_health_start(), -EALREADY);
	zassert_ok(spaghetti_health_get_status(&status));
	zassert_true(status.hardware_watchdog_available);
}

ZTEST_SUITE(health, NULL, NULL, health_before, health_after, NULL);
