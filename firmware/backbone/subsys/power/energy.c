#include <spaghetti/energy.h>

#include "energy_internal.h"

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/pm/device.h>
#include <zephyr/sys/util.h>

#include <spaghetti/connectivity.h>
#include <spaghetti/port.h>
#include <spaghetti/secure_workspace.h>

LOG_MODULE_REGISTER(spaghetti_energy, CONFIG_SPAGHETTI_ENERGY_LOG_LEVEL);

enum spaghetti_energy_ble_runtime_state {
	SPAGHETTI_ENERGY_BLE_STOPPED,
	SPAGHETTI_ENERGY_BLE_CONTINUOUS,
	SPAGHETTI_ENERGY_BLE_WINDOW_OPEN,
};

struct spaghetti_energy_context {
	struct spaghetti_energy_policy policy;
	enum spaghetti_connectivity_policy connectivity;
	enum spaghetti_energy_ble_runtime_state ble_runtime;
	struct spaghetti_energy_ble_backend ble_backend;
	bool initialized;
	bool window_active;
	bool port_busy_override;
	int64_t radio_on_since_ms;
	int64_t active_since_ms;
	uint64_t radio_active_ms;
	uint64_t active_uptime_ms;
	uint32_t window_count;
	enum spaghetti_energy_wake_reason wake_reason;
};

static int default_ble_set_radio(bool on);
static int try_runtime_pm_for_policy(
	enum spaghetti_connectivity_policy connectivity);

static struct spaghetti_energy_context context;
static bool test_port_busy;

static void window_close_work_handler(struct k_work *work);
static void window_period_work_handler(struct k_work *work);

K_MUTEX_DEFINE(energy_lock);
K_WORK_DELAYABLE_DEFINE(window_close_work, window_close_work_handler);
K_WORK_DELAYABLE_DEFINE(window_period_work, window_period_work_handler);

static int default_ble_set_radio(bool on)
{
	ARG_UNUSED(on);
	return 0;
}

static void accumulate_radio_time_locked(int64_t now_ms)
{
	if (context.radio_on_since_ms < 0) {
		return;
	}
	if (now_ms > context.radio_on_since_ms) {
		context.radio_active_ms +=
			(uint64_t)(now_ms - context.radio_on_since_ms);
	}
	context.radio_on_since_ms = -1;
}

static void accumulate_active_time_locked(int64_t now_ms)
{
	if (context.active_since_ms < 0) {
		return;
	}
	if (now_ms > context.active_since_ms) {
		context.active_uptime_ms +=
			(uint64_t)(now_ms - context.active_since_ms);
	}
	context.active_since_ms = -1;
}

static bool ble_availability_is_valid(enum spaghetti_ble_availability mode)
{
	return (mode == SPAGHETTI_BLE_OFF) ||
	       (mode == SPAGHETTI_BLE_ADVERTISING) ||
	       (mode == SPAGHETTI_BLE_WINDOWED);
}

static int validate_policy(const struct spaghetti_energy_policy *policy)
{
	if ((policy == NULL) || !ble_availability_is_valid(policy->ble_availability)) {
		return -EINVAL;
	}
	if (policy->ble_availability != SPAGHETTI_BLE_WINDOWED) {
		return 0;
	}
	if ((policy->advertising_window_ms == 0U) ||
	    (policy->advertising_period_ms == 0U) ||
	    (policy->advertising_window_ms >= policy->advertising_period_ms) ||
	    (policy->advertising_window_ms <
	     CONFIG_SPAGHETTI_ENERGY_MIN_ADVERTISING_WINDOW_MS) ||
	    (policy->advertising_window_ms >
	     CONFIG_SPAGHETTI_ENERGY_MAX_ADVERTISING_WINDOW_MS) ||
	    (policy->advertising_period_ms <
	     CONFIG_SPAGHETTI_ENERGY_MIN_ADVERTISING_PERIOD_MS) ||
	    (policy->advertising_period_ms >
	     CONFIG_SPAGHETTI_ENERGY_MAX_ADVERTISING_PERIOD_MS)) {
		return -EINVAL;
	}
	return 0;
}

static bool connectivity_policy_is_valid(
	enum spaghetti_connectivity_policy policy)
{
	return (policy == SPAGHETTI_CONNECTIVITY_LOW_ENERGY) ||
	       (policy == SPAGHETTI_CONNECTIVITY_ONLINE);
}

static bool connectivity_has_active_lease(void)
{
	struct spaghetti_connectivity_snapshot snapshot;
	int err = spaghetti_connectivity_get_snapshot(&snapshot);

	if (err < 0) {
		return false;
	}

	return snapshot.leased_services != 0U;
}

static int set_ble_radio_locked(bool on)
{
	int err;

	if (on) {
		if (context.radio_on_since_ms < 0) {
			context.radio_on_since_ms = k_uptime_get();
		}
	} else {
		accumulate_radio_time_locked(k_uptime_get());
	}

	err = context.ble_backend.set_radio(on);
	return err;
}

static void cancel_window_timers(void)
{
	(void)k_work_cancel_delayable(&window_close_work);
	(void)k_work_cancel_delayable(&window_period_work);
}

static int close_ble_window_locked(void)
{
	int err = 0;

	if (!context.window_active) {
		return 0;
	}

	if (context.ble_runtime == SPAGHETTI_ENERGY_BLE_WINDOW_OPEN) {
		err = set_ble_radio_locked(false);
		if (err == 0) {
			context.ble_runtime = SPAGHETTI_ENERGY_BLE_STOPPED;
		}
	}
	context.window_active = false;
	cancel_window_timers();
	return err;
}

static void window_close_work_handler(struct k_work *work)
{
	int err;

	ARG_UNUSED(work);
	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	err = close_ble_window_locked();
	if ((err == 0) &&
	    (context.policy.ble_availability == SPAGHETTI_BLE_WINDOWED) &&
	    (context.connectivity == SPAGHETTI_CONNECTIVITY_LOW_ENERGY)) {
		(void)k_work_reschedule(
			&window_period_work,
			K_MSEC(context.policy.advertising_period_ms));
	}
	k_mutex_unlock(&energy_lock);
}

static int open_ble_window_locked(enum spaghetti_energy_wake_reason reason)
{
	int err;

	if (context.window_active) {
		return -EALREADY;
	}
	if (context.policy.ble_availability != SPAGHETTI_BLE_WINDOWED) {
		return -ENOTSUP;
	}

	err = set_ble_radio_locked(true);
	if (err < 0) {
		return err;
	}

	context.ble_runtime = SPAGHETTI_ENERGY_BLE_WINDOW_OPEN;
	context.window_active = true;
	context.window_count++;
	context.wake_reason = reason;
	(void)k_work_reschedule(&window_close_work,
		K_MSEC(context.policy.advertising_window_ms));
	return 0;
}

static void window_period_work_handler(struct k_work *work)
{
	int err;

	ARG_UNUSED(work);
	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	if (!context.initialized ||
	    (context.policy.ble_availability != SPAGHETTI_BLE_WINDOWED) ||
	    (context.connectivity != SPAGHETTI_CONNECTIVITY_LOW_ENERGY) ||
	    context.window_active) {
		k_mutex_unlock(&energy_lock);
		return;
	}
	err = open_ble_window_locked(SPAGHETTI_ENERGY_WAKE_WINDOW);
	k_mutex_unlock(&energy_lock);
	if (err < 0) {
		LOG_WRN("window open failed: err=%d", err);
	}
}

static int apply_ble_policy_locked(void)
{
	int err;

	cancel_window_timers();
	context.window_active = false;

	if (context.connectivity == SPAGHETTI_CONNECTIVITY_ONLINE) {
		err = set_ble_radio_locked(false);
		if (err == 0) {
			context.ble_runtime = SPAGHETTI_ENERGY_BLE_STOPPED;
		}
		return err;
	}

	switch (context.policy.ble_availability) {
	case SPAGHETTI_BLE_OFF:
		err = set_ble_radio_locked(false);
		if (err == 0) {
			context.ble_runtime = SPAGHETTI_ENERGY_BLE_STOPPED;
		}
		return err;
	case SPAGHETTI_BLE_ADVERTISING:
		err = set_ble_radio_locked(true);
		if (err == 0) {
			context.ble_runtime = SPAGHETTI_ENERGY_BLE_CONTINUOUS;
		}
		return err;
	case SPAGHETTI_BLE_WINDOWED:
		context.ble_runtime = SPAGHETTI_ENERGY_BLE_STOPPED;
		err = set_ble_radio_locked(false);
		if (err < 0) {
			return err;
		}
		if (context.connectivity == SPAGHETTI_CONNECTIVITY_LOW_ENERGY) {
			return open_ble_window_locked(
				SPAGHETTI_ENERGY_WAKE_CONNECTIVITY);
		}
		return 0;
	default:
		return -EINVAL;
	}
}

#if defined(CONFIG_PM) && defined(CONFIG_PM_DEVICE)

static bool port_controller_busy(void)
{
	if (context.port_busy_override || test_port_busy) {
		return true;
	}

	/*
	 * Port does not yet expose transaction serialization. Until phase 300
	 * adds that contract, treat a non-ready I2C controller as busy and skip
	 * runtime PM suspend.
	 */
	for (size_t port_idx = 0U; port_idx < spaghetti_port_count(); ++port_idx) {
		const struct spaghetti_port *port =
			spaghetti_port_get((spaghetti_port_id_t)port_idx);

		if ((port != NULL) &&
		    spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_I2C)) {
			const struct device *i2c =
				spaghetti_port_i2c_device(port);

			if ((i2c != NULL) && !device_is_ready(i2c)) {
				return true;
			}
		}
	}

	return false;
}

static int suspend_idle_port_devices(void)
{
	for (size_t port_idx = 0U; port_idx < spaghetti_port_count(); ++port_idx) {
		const struct spaghetti_port *port =
			spaghetti_port_get((spaghetti_port_id_t)port_idx);
		const struct device *i2c;

		if ((port == NULL) ||
		    !spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_I2C)) {
			continue;
		}
		i2c = spaghetti_port_i2c_device(port);
		if ((i2c == NULL) || !device_is_ready(i2c)) {
			continue;
		}
		if (!pm_device_runtime_is_enabled(i2c)) {
			continue;
		}
		(void)pm_device_action_run(i2c, PM_DEVICE_ACTION_SUSPEND);
	}
	return 0;
}

static int resume_port_devices(void)
{
	for (size_t port_idx = 0U; port_idx < spaghetti_port_count(); ++port_idx) {
		const struct spaghetti_port *port =
			spaghetti_port_get((spaghetti_port_id_t)port_idx);
		const struct device *i2c;

		if ((port == NULL) ||
		    !spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_I2C)) {
			continue;
		}
		i2c = spaghetti_port_i2c_device(port);
		if ((i2c == NULL) || !device_is_ready(i2c)) {
			continue;
		}
		if (!pm_device_runtime_is_enabled(i2c)) {
			continue;
		}
		(void)pm_device_action_run(i2c, PM_DEVICE_ACTION_RESUME);
	}
	return 0;
}

static int try_runtime_pm_for_policy(
	enum spaghetti_connectivity_policy connectivity)
{
	int pm_err;

	if (connectivity == SPAGHETTI_CONNECTIVITY_ONLINE) {
		pm_err = resume_port_devices();
		return pm_err;
	}
	if (connectivity_has_active_lease() || port_controller_busy()) {
		return 0;
	}
	pm_err = suspend_idle_port_devices();
	return pm_err;
}

#else

static int try_runtime_pm_for_policy(
	enum spaghetti_connectivity_policy connectivity)
{
	ARG_UNUSED(connectivity);
	return 0;
}

#endif /* CONFIG_PM && CONFIG_PM_DEVICE */

static int workspace_is_free(void)
{
	struct spaghetti_secure_workspace_snapshot snapshot;
	int err = spaghetti_secure_workspace_get_snapshot(&snapshot);

	if (err == -EACCES) {
		return true;
	}
	if (err < 0) {
		return false;
	}
	return snapshot.owner == SPAGHETTI_SECURE_OWNER_NONE;
}

static void mark_active_locked(int64_t now_ms)
{
	if (context.active_since_ms < 0) {
		context.active_since_ms = now_ms;
	}
}

static void mark_idle_locked(int64_t now_ms)
{
	accumulate_active_time_locked(now_ms);
}

int spaghetti_energy_init(const struct spaghetti_energy_policy *policy)
{
	int err;

	err = validate_policy(policy);
	if (err < 0) {
		return err;
	}

	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	if (context.initialized) {
		k_mutex_unlock(&energy_lock);
		return -EALREADY;
	}

	context.policy = *policy;
	context.connectivity = SPAGHETTI_CONNECTIVITY_LOW_ENERGY;
	context.ble_runtime = SPAGHETTI_ENERGY_BLE_STOPPED;
	context.window_active = false;
	context.port_busy_override = false;
	if (context.ble_backend.set_radio == NULL) {
		context.ble_backend.set_radio = default_ble_set_radio;
	}
	context.radio_on_since_ms = -1;
	context.active_since_ms = k_uptime_get();
	context.radio_active_ms = 0U;
	context.active_uptime_ms = 0U;
	context.window_count = 0U;
	context.wake_reason = SPAGHETTI_ENERGY_WAKE_BOOT;
	context.initialized = true;
	k_mutex_unlock(&energy_lock);

	LOG_INF("ready: ble_mode=%u", (uint32_t)policy->ble_availability);
	return 0;
}

int spaghetti_energy_apply_connectivity(
	enum spaghetti_connectivity_policy connectivity)
{
	struct spaghetti_connectivity_snapshot before;
	enum spaghetti_connectivity_policy previous;
	int err;
	int pm_err;
	const int64_t now_ms = k_uptime_get();

	if (!connectivity_policy_is_valid(connectivity)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&energy_lock);
		return -EACCES;
	}
	k_mutex_unlock(&energy_lock);

	err = spaghetti_connectivity_get_snapshot(&before);
	if (err < 0) {
		return -EACCES;
	}

	if ((connectivity == SPAGHETTI_CONNECTIVITY_LOW_ENERGY) &&
	    !workspace_is_free()) {
		return -EBUSY;
	}

	err = spaghetti_connectivity_set_policy(connectivity);
	if (err < 0) {
		return err;
	}

	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	previous = context.connectivity;
	context.connectivity = connectivity;
	context.wake_reason = SPAGHETTI_ENERGY_WAKE_CONNECTIVITY;

	if (connectivity == SPAGHETTI_CONNECTIVITY_ONLINE) {
		mark_active_locked(now_ms);
	} else if (!connectivity_has_active_lease()) {
		mark_idle_locked(now_ms);
	} else {
		mark_active_locked(now_ms);
	}

	err = apply_ble_policy_locked();
	if (err < 0) {
		context.connectivity = previous;
		(void)spaghetti_connectivity_set_policy(previous);
		k_mutex_unlock(&energy_lock);
		return err;
	}

	pm_err = try_runtime_pm_for_policy(connectivity);
	if (pm_err < 0) {
		LOG_WRN("runtime PM skipped: err=%d", pm_err);
	}

	k_mutex_unlock(&energy_lock);
	return 0;
}

int spaghetti_energy_notify_local_event(void)
{
	int err;

	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&energy_lock);
		return -EACCES;
	}
	if (context.policy.ble_availability != SPAGHETTI_BLE_WINDOWED) {
		k_mutex_unlock(&energy_lock);
		return -ENOTSUP;
	}
	err = open_ble_window_locked(SPAGHETTI_ENERGY_WAKE_LOCAL_EVENT);
	k_mutex_unlock(&energy_lock);
	return err;
}

int spaghetti_energy_ble_backend_install(
	const struct spaghetti_energy_ble_backend *backend)
{
	if ((backend == NULL) || (backend->set_radio == NULL)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	if (context.initialized) {
		k_mutex_unlock(&energy_lock);
		return -EBUSY;
	}
	context.ble_backend = *backend;
	k_mutex_unlock(&energy_lock);
	return 0;
}

void spaghetti_energy_ble_backend_reset(void)
{
	struct k_work_sync sync;

	(void)k_work_cancel_delayable_sync(&window_close_work, &sync);
	(void)k_work_cancel_delayable_sync(&window_period_work, &sync);
	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	accumulate_radio_time_locked(k_uptime_get());
	accumulate_active_time_locked(k_uptime_get());
	context.ble_backend.set_radio = default_ble_set_radio;
	k_mutex_unlock(&energy_lock);
}

void spaghetti_energy_reset(void)
{
	struct k_work_sync sync;

	(void)k_work_cancel_delayable_sync(&window_close_work, &sync);
	(void)k_work_cancel_delayable_sync(&window_period_work, &sync);
	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	memset(&context, 0, sizeof(context));
	context.ble_backend.set_radio = default_ble_set_radio;
	context.radio_on_since_ms = -1;
	context.active_since_ms = -1;
	test_port_busy = false;
	k_mutex_unlock(&energy_lock);
}

int spaghetti_energy_get_snapshot(struct spaghetti_energy_snapshot *out)
{
	const int64_t now_ms = k_uptime_get();
	uint64_t radio_active_ms;
	uint64_t active_uptime_ms;

	if (out == NULL) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&energy_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&energy_lock);
		return -EACCES;
	}

	radio_active_ms = context.radio_active_ms;
	if (context.radio_on_since_ms >= 0) {
		radio_active_ms += (uint64_t)(now_ms - context.radio_on_since_ms);
	}

	active_uptime_ms = context.active_uptime_ms;
	if (context.active_since_ms >= 0) {
		active_uptime_ms += (uint64_t)(now_ms - context.active_since_ms);
	}

	*out = (struct spaghetti_energy_snapshot) {
		.active_uptime_ms = active_uptime_ms,
		.radio_active_ms = radio_active_ms,
		.window_count = context.window_count,
		.wake_reason = context.wake_reason,
		.ble_radio_on = context.radio_on_since_ms >= 0,
		.window_active = context.window_active,
	};
	k_mutex_unlock(&energy_lock);
	return 0;
}

bool spaghetti_energy_test_port_controller_busy(void)
{
	return test_port_busy;
}

void spaghetti_energy_test_set_port_controller_busy(bool busy)
{
	test_port_busy = busy;
}
