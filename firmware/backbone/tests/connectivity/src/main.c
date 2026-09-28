#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/ztest.h>

#include <spaghetti/capabilities.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/health.h>

#include "connectivity_internal.h"

#define TEST_ACTION_CAPACITY 32U

int spaghetti_health_heartbeat(spaghetti_health_component_id_t id)
{
	ARG_UNUSED(id);
	return 0;
}

struct backend_action {
	bool started;
	enum spaghetti_connectivity_service service;
};

static struct backend_action actions[TEST_ACTION_CAPACITY];
static size_t action_count;
static uint32_t physical_services;
static uint32_t supported_capabilities;
static enum spaghetti_connectivity_service failed_start_service;
static enum spaghetti_connectivity_service failed_stop_service;

bool spaghetti_capabilities_support(uint32_t required)
{
	return (supported_capabilities & required) == required;
}

static void record_action(bool started,
			  enum spaghetti_connectivity_service service)
{
	zassert_true(action_count < ARRAY_SIZE(actions));
	actions[action_count].started = started;
	actions[action_count].service = service;
	action_count++;
}

static int fake_start(enum spaghetti_connectivity_service service)
{
	record_action(true, service);
	if (service == failed_start_service) {
		return -EIO;
	}
	physical_services |= (uint32_t)service;
	return 0;
}

static int fake_stop(enum spaghetti_connectivity_service service)
{
	record_action(false, service);
	if (service == failed_stop_service) {
		return -EIO;
	}
	physical_services &= ~(uint32_t)service;
	return 0;
}

static void connectivity_before(void *fixture)
{
	static const struct spaghetti_connectivity_backend backend = {
		.start = fake_start,
		.stop = fake_stop,
	};

	ARG_UNUSED(fixture);
	spaghetti_connectivity_backend_reset();
	memset(actions, 0, sizeof(actions));
	action_count = 0U;
	physical_services = 0U;
	failed_start_service = 0;
	failed_stop_service = 0;
	supported_capabilities = SPAGHETTI_BUILD_CAP_BLE |
		SPAGHETTI_BUILD_CAP_WIFI |
		SPAGHETTI_BUILD_CAP_MQTT |
		SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE;
	zassert_ok(spaghetti_connectivity_backend_install(&backend));
}

static void connectivity_after(void *fixture)
{
	ARG_UNUSED(fixture);
	spaghetti_connectivity_backend_reset();
}

ZTEST(connectivity, test_policy_transitions_are_deterministic)
{
	struct spaghetti_connectivity_snapshot snapshot;

	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_equal(physical_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
	zassert_ok(spaghetti_connectivity_set_policy(
		SPAGHETTI_CONNECTIVITY_ONLINE));
	zassert_ok(spaghetti_connectivity_get_snapshot(&snapshot));
	zassert_equal(snapshot.policy, SPAGHETTI_CONNECTIVITY_ONLINE);
	zassert_equal(snapshot.active_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI |
		SPAGHETTI_CONNECTIVITY_SERVICE_MQTT);
	zassert_equal(snapshot.leased_services, 0U);
	zassert_equal(snapshot.lease_expires_at_ms, 0);
	zassert_equal(snapshot.last_error, 0);
	zassert_equal(action_count, 4U);
	zassert_true(actions[1].started);
	zassert_equal(actions[1].service,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI);
	zassert_true(actions[2].started);
	zassert_equal(actions[2].service,
		SPAGHETTI_CONNECTIVITY_SERVICE_MQTT);
	zassert_false(actions[3].started);
	zassert_equal(actions[3].service,
		SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
	zassert_ok(spaghetti_connectivity_set_policy(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_true(actions[4].started);
	zassert_equal(actions[4].service,
		SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
	zassert_false(actions[5].started);
	zassert_equal(actions[5].service,
		SPAGHETTI_CONNECTIVITY_SERVICE_MQTT);
	zassert_false(actions[6].started);
	zassert_equal(actions[6].service,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI);
}

ZTEST(connectivity, test_lease_release_and_timeout_restore_policy)
{
	const struct spaghetti_connectivity_lease_request lease = {
		.services = SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
		.duration_ms = 30U,
	};
	struct spaghetti_connectivity_snapshot snapshot;

	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_ok(spaghetti_connectivity_acquire_lease(&lease));
	zassert_equal(spaghetti_connectivity_acquire_lease(&lease), -EBUSY);
	zassert_ok(spaghetti_connectivity_get_snapshot(&snapshot));
	zassert_equal(snapshot.leased_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI);
	zassert_equal(physical_services, SPAGHETTI_CONNECTIVITY_SERVICE_WIFI);
	zassert_true(snapshot.lease_expires_at_ms > k_uptime_get());
	zassert_ok(spaghetti_connectivity_release_lease());
	zassert_equal(spaghetti_connectivity_release_lease(), -ENOENT);
	zassert_equal(physical_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_BLE);

	zassert_ok(spaghetti_connectivity_acquire_lease(&lease));
	k_sleep(K_MSEC(60));
	zassert_ok(spaghetti_connectivity_get_snapshot(&snapshot));
	zassert_equal(snapshot.active_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
	zassert_equal(snapshot.leased_services, 0U);
	zassert_equal(snapshot.lease_expires_at_ms, 0);
}

ZTEST(connectivity, test_missing_capability_and_invalid_input_are_rejected)
{
	const struct spaghetti_connectivity_lease_request wifi_lease = {
		.services = SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
		.duration_ms = 20U,
	};
	struct spaghetti_connectivity_snapshot snapshot;

	zassert_equal(spaghetti_connectivity_get_snapshot(NULL), -EINVAL);
	zassert_equal(spaghetti_connectivity_get_snapshot(&snapshot), -EACCES);
	zassert_equal(spaghetti_connectivity_set_policy(
		SPAGHETTI_CONNECTIVITY_ONLINE), -EACCES);
	zassert_equal(spaghetti_connectivity_acquire_lease(NULL), -EINVAL);
	zassert_equal(spaghetti_connectivity_init(
		(enum spaghetti_connectivity_policy)99), -EINVAL);
	supported_capabilities = SPAGHETTI_BUILD_CAP_BLE;
	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_equal(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY), -EALREADY);
	zassert_equal(spaghetti_connectivity_acquire_lease(&wifi_lease),
		-ENOTSUP);
	zassert_equal(spaghetti_connectivity_acquire_lease(
		&(struct spaghetti_connectivity_lease_request) {
			.services = BIT(31),
			.duration_ms = 20U,
		}), -EINVAL);
	zassert_equal(spaghetti_connectivity_acquire_lease(
		&(struct spaghetti_connectivity_lease_request) {
			.services = SPAGHETTI_CONNECTIVITY_SERVICE_BLE,
			.duration_ms = 9U,
		}), -EINVAL);
}

ZTEST(connectivity, test_failed_transition_rolls_back)
{
	struct spaghetti_connectivity_snapshot snapshot;

	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	failed_start_service = SPAGHETTI_CONNECTIVITY_SERVICE_MQTT;
	zassert_equal(spaghetti_connectivity_set_policy(
		SPAGHETTI_CONNECTIVITY_ONLINE), -EIO);
	zassert_ok(spaghetti_connectivity_get_snapshot(&snapshot));
	zassert_equal(snapshot.policy, SPAGHETTI_CONNECTIVITY_LOW_ENERGY);
	zassert_equal(snapshot.active_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
	zassert_equal(snapshot.last_error, -EIO);
	zassert_equal(physical_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
	zassert_false(actions[action_count - 1U].started);
	zassert_equal(actions[action_count - 1U].service,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI);
}

ZTEST(connectivity, test_logical_reboot_clears_lease)
{
	static const struct spaghetti_connectivity_backend backend = {
		.start = fake_start,
		.stop = fake_stop,
	};
	const struct spaghetti_connectivity_lease_request lease = {
		.services = SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE,
		.duration_ms = 100U,
	};
	struct spaghetti_connectivity_snapshot snapshot;

	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_ONLINE));
	zassert_ok(spaghetti_connectivity_acquire_lease(&lease));
	spaghetti_connectivity_backend_reset();
	zassert_equal(physical_services, 0U);
	zassert_equal(spaghetti_connectivity_get_snapshot(&snapshot), -EACCES);
	zassert_ok(spaghetti_connectivity_backend_install(&backend));
	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_ok(spaghetti_connectivity_get_snapshot(&snapshot));
	zassert_equal(snapshot.leased_services, 0U);
	zassert_equal(snapshot.lease_expires_at_ms, 0);
}

ZTEST(connectivity, test_radio_mutex_never_runs_ble_and_wifi)
{
	const struct spaghetti_connectivity_lease_request wifi_lease = {
		.services = SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
		.duration_ms = 40U,
	};
	const struct spaghetti_connectivity_lease_request ble_lease = {
		.services = SPAGHETTI_CONNECTIVITY_SERVICE_BLE,
		.duration_ms = 40U,
	};
	const struct spaghetti_connectivity_lease_request both = {
		.services = SPAGHETTI_CONNECTIVITY_SERVICE_BLE |
			    SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
		.duration_ms = 40U,
	};
	struct spaghetti_connectivity_snapshot snapshot;

	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_equal(spaghetti_connectivity_acquire_lease(&both), -EINVAL);
	zassert_ok(spaghetti_connectivity_acquire_lease(&wifi_lease));
	zassert_ok(spaghetti_connectivity_get_snapshot(&snapshot));
	zassert_equal(snapshot.active_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI);
	zassert_ok(spaghetti_connectivity_release_lease());
	zassert_equal(physical_services, SPAGHETTI_CONNECTIVITY_SERVICE_BLE);

	zassert_ok(spaghetti_connectivity_set_policy(
		SPAGHETTI_CONNECTIVITY_ONLINE));
	zassert_equal(physical_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI |
		SPAGHETTI_CONNECTIVITY_SERVICE_MQTT);
	zassert_ok(spaghetti_connectivity_acquire_lease(&ble_lease));
	zassert_ok(spaghetti_connectivity_get_snapshot(&snapshot));
	zassert_equal(snapshot.active_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
	zassert_ok(spaghetti_connectivity_release_lease());
	zassert_equal(physical_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI |
		SPAGHETTI_CONNECTIVITY_SERVICE_MQTT);
}

ZTEST_SUITE(connectivity, NULL, NULL, connectivity_before,
	    connectivity_after, NULL);
