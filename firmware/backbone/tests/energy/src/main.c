#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/ztest.h>

#include <spaghetti/capabilities.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/energy.h>
#include <spaghetti/health.h>
#include <spaghetti/port.h>
#include <spaghetti/secure_workspace.h>

#include "../../subsys/connectivity/connectivity_internal.h"
#include "../../subsys/power/energy_internal.h"

int spaghetti_health_heartbeat(spaghetti_health_component_id_t id)
{
	ARG_UNUSED(id);
	return 0;
}

#define TEST_ACTION_CAPACITY 32U

struct connectivity_action {
	bool started;
	enum spaghetti_connectivity_service service;
};

struct ble_action {
	bool on;
};

static struct connectivity_action connectivity_actions[TEST_ACTION_CAPACITY];
static struct ble_action ble_actions[TEST_ACTION_CAPACITY];
static size_t connectivity_action_count;
static size_t ble_action_count;
static uint32_t physical_services;
static uint32_t supported_capabilities;
static enum spaghetti_connectivity_service failed_start_service;
static enum spaghetti_secure_workspace_owner workspace_owner;
static bool workspace_initialized;
static bool fail_ble_radio_on;

bool spaghetti_capabilities_support(uint32_t required)
{
	return (supported_capabilities & required) == required;
}

size_t spaghetti_port_count(void)
{
	return 0U;
}

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	ARG_UNUSED(id);
	return NULL;
}

bool spaghetti_port_has_capability(
	const struct spaghetti_port *port,
	uint32_t capabilities)
{
	ARG_UNUSED(port);
	ARG_UNUSED(capabilities);
	return false;
}

const struct device *spaghetti_port_i2c_device(const struct spaghetti_port *port)
{
	ARG_UNUSED(port);
	return NULL;
}

int spaghetti_secure_workspace_init(void)
{
	workspace_initialized = true;
	workspace_owner = SPAGHETTI_SECURE_OWNER_NONE;
	return 0;
}

int spaghetti_secure_workspace_get_snapshot(
	struct spaghetti_secure_workspace_snapshot *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	if (!workspace_initialized) {
		return -EACCES;
	}
	out->owner = workspace_owner;
	out->capacity = 4096U;
	out->peak_used = 0U;
	out->allocation_failures = 0U;
	return 0;
}

static void record_connectivity_action(
	bool started,
	enum spaghetti_connectivity_service service)
{
	zassert_true(connectivity_action_count < ARRAY_SIZE(connectivity_actions));
	connectivity_actions[connectivity_action_count].started = started;
	connectivity_actions[connectivity_action_count].service = service;
	connectivity_action_count++;
}

static void record_ble_action(bool on)
{
	zassert_true(ble_action_count < ARRAY_SIZE(ble_actions));
	ble_actions[ble_action_count].on = on;
	ble_action_count++;
}

static int fake_connectivity_start(enum spaghetti_connectivity_service service)
{
	record_connectivity_action(true, service);
	if (service == failed_start_service) {
		return -EIO;
	}
	physical_services |= (uint32_t)service;
	return 0;
}

static int fake_connectivity_stop(enum spaghetti_connectivity_service service)
{
	record_connectivity_action(false, service);
	physical_services &= ~(uint32_t)service;
	return 0;
}

static int fake_ble_set_radio(bool on)
{
	if (on && fail_ble_radio_on) {
		return -EIO;
	}
	record_ble_action(on);
	return 0;
}

static const struct spaghetti_connectivity_backend connectivity_backend = {
	.start = fake_connectivity_start,
	.stop = fake_connectivity_stop,
};

static const struct spaghetti_energy_ble_backend ble_backend = {
	.set_radio = fake_ble_set_radio,
};

static const struct spaghetti_energy_policy windowed_policy = {
	.ble_availability = SPAGHETTI_BLE_WINDOWED,
	.advertising_window_ms = 30U,
	.advertising_period_ms = 100U,
};

static void energy_before(void *fixture)
{
	ARG_UNUSED(fixture);
	spaghetti_connectivity_backend_reset();
	spaghetti_energy_reset();
	memset(connectivity_actions, 0, sizeof(connectivity_actions));
	memset(ble_actions, 0, sizeof(ble_actions));
	connectivity_action_count = 0U;
	ble_action_count = 0U;
	physical_services = 0U;
	failed_start_service = 0;
	fail_ble_radio_on = false;
	workspace_owner = SPAGHETTI_SECURE_OWNER_NONE;
	workspace_initialized = false;
	supported_capabilities = SPAGHETTI_BUILD_CAP_BLE |
		SPAGHETTI_BUILD_CAP_WIFI |
		SPAGHETTI_BUILD_CAP_MQTT;
	zassert_ok(spaghetti_secure_workspace_init());
	zassert_ok(spaghetti_connectivity_backend_install(&connectivity_backend));
	zassert_ok(spaghetti_energy_ble_backend_install(&ble_backend));
}

static void energy_after(void *fixture)
{
	ARG_UNUSED(fixture);
	spaghetti_energy_reset();
	spaghetti_connectivity_backend_reset();
}

static void boot_energy(enum spaghetti_ble_availability mode)
{
	const struct spaghetti_energy_policy policy = {
		.ble_availability = mode,
		.advertising_window_ms = windowed_policy.advertising_window_ms,
		.advertising_period_ms = windowed_policy.advertising_period_ms,
	};

	zassert_ok(spaghetti_energy_init(&policy));
	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
}

ZTEST(energy, test_low_energy_stops_ip_services_and_ble_off)
{
	const struct spaghetti_energy_policy policy = {
		.ble_availability = SPAGHETTI_BLE_OFF,
	};

	zassert_ok(spaghetti_energy_init(&policy));
	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_ONLINE));
	zassert_ok(spaghetti_energy_apply_connectivity(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_equal(physical_services, SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
	zassert_true(ble_action_count >= 1U);
	zassert_false(ble_actions[ble_action_count - 1U].on);
}

ZTEST(energy, test_ble_advertising_keeps_radio_on)
{
	boot_energy(SPAGHETTI_BLE_ADVERTISING);
	zassert_ok(spaghetti_energy_apply_connectivity(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_true(ble_actions[ble_action_count - 1U].on);
}

ZTEST(energy, test_windowed_policy_opens_and_closes_fake_radio)
{
	struct spaghetti_energy_snapshot snapshot;

	boot_energy(SPAGHETTI_BLE_WINDOWED);
	zassert_ok(spaghetti_energy_apply_connectivity(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_ok(spaghetti_energy_get_snapshot(&snapshot));
	zassert_equal(snapshot.window_count, 1U);
	zassert_true(snapshot.ble_radio_on);
	zassert_equal(snapshot.wake_reason,
		SPAGHETTI_ENERGY_WAKE_CONNECTIVITY);
	k_sleep(K_MSEC(40));
	zassert_ok(spaghetti_energy_get_snapshot(&snapshot));
	zassert_false(snapshot.ble_radio_on);
	zassert_true(snapshot.radio_active_ms >= 20U);
}

ZTEST(energy, test_notify_local_event_opens_window_only_when_windowed)
{
	struct spaghetti_energy_snapshot snapshot;

	boot_energy(SPAGHETTI_BLE_WINDOWED);
	zassert_ok(spaghetti_energy_apply_connectivity(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_equal(spaghetti_energy_notify_local_event(), -EALREADY);
	k_sleep(K_MSEC(40));
	zassert_ok(spaghetti_energy_notify_local_event());
	zassert_ok(spaghetti_energy_get_snapshot(&snapshot));
	zassert_equal(snapshot.wake_reason, SPAGHETTI_ENERGY_WAKE_LOCAL_EVENT);
	zassert_true(snapshot.ble_radio_on);
}

ZTEST(energy, test_online_with_active_lease_keeps_active_path)
{
	const struct spaghetti_connectivity_lease_request lease = {
		.services = SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
		.duration_ms = 200U,
	};
	struct spaghetti_energy_snapshot snapshot;

	boot_energy(SPAGHETTI_BLE_OFF);
	zassert_ok(spaghetti_energy_apply_connectivity(
		SPAGHETTI_CONNECTIVITY_ONLINE));
	zassert_ok(spaghetti_connectivity_acquire_lease(&lease));
	zassert_ok(spaghetti_energy_apply_connectivity(
		SPAGHETTI_CONNECTIVITY_ONLINE));
	k_sleep(K_MSEC(1));
	zassert_ok(spaghetti_energy_get_snapshot(&snapshot));
	zassert_true(snapshot.active_uptime_ms > 0U);
	zassert_equal(physical_services,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI |
		SPAGHETTI_CONNECTIVITY_SERVICE_MQTT);
	zassert_false(snapshot.ble_radio_on);
}

ZTEST(energy, test_low_energy_rejects_busy_workspace)
{
	const struct spaghetti_energy_policy policy = {
		.ble_availability = SPAGHETTI_BLE_OFF,
	};

	zassert_ok(spaghetti_energy_init(&policy));
	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_ONLINE));
	workspace_owner = SPAGHETTI_SECURE_OWNER_MQTT;
	zassert_equal(spaghetti_energy_apply_connectivity(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY), -EBUSY);
}

ZTEST(energy, test_invalid_policy_and_init_boundaries)
{
	zassert_equal(spaghetti_energy_init(NULL), -EINVAL);
	zassert_equal(spaghetti_energy_apply_connectivity(
		(enum spaghetti_connectivity_policy)99), -EINVAL);
	zassert_equal(spaghetti_energy_apply_connectivity(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY), -EACCES);
	zassert_equal(spaghetti_energy_notify_local_event(), -EACCES);
	zassert_equal(spaghetti_energy_init(
		&(struct spaghetti_energy_policy) {
			.ble_availability = SPAGHETTI_BLE_WINDOWED,
			.advertising_window_ms = 100U,
			.advertising_period_ms = 50U,
		}), -EINVAL);
}

ZTEST(energy, test_online_forces_ble_radio_off)
{
	const struct spaghetti_energy_policy policy = {
		.ble_availability = SPAGHETTI_BLE_ADVERTISING,
	};
	struct spaghetti_connectivity_snapshot snapshot;
	struct spaghetti_energy_snapshot energy;

	zassert_ok(spaghetti_energy_init(&policy));
	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_ok(spaghetti_energy_apply_connectivity(
		SPAGHETTI_CONNECTIVITY_ONLINE));
	zassert_ok(spaghetti_connectivity_get_snapshot(&snapshot));
	zassert_equal(snapshot.policy, SPAGHETTI_CONNECTIVITY_ONLINE);
	zassert_ok(spaghetti_energy_get_snapshot(&energy));
	zassert_false(energy.ble_radio_on);
}

ZTEST(energy, test_notify_local_event_rejects_non_windowed_policy)
{
	const struct spaghetti_energy_policy policy = {
		.ble_availability = SPAGHETTI_BLE_ADVERTISING,
	};

	zassert_ok(spaghetti_energy_init(&policy));
	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	zassert_equal(spaghetti_energy_notify_local_event(), -ENOTSUP);
}

ZTEST_SUITE(energy, NULL, NULL, energy_before, energy_after, NULL);
