#include <spaghetti/health.h>

#include "health_internal.h"

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/hwinfo.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#if defined(CONFIG_WATCHDOG) && DT_HAS_CHOSEN(zephyr_watchdog)
#include <zephyr/drivers/watchdog.h>
#endif

#include <spaghetti/core.h>

LOG_MODULE_REGISTER(spaghetti_health, CONFIG_SPAGHETTI_HEALTH_LOG_LEVEL);

#define SPAGHETTI_HEALTH_MAX_COMPONENTS \
	CONFIG_SPAGHETTI_MAX_HEALTH_COMPONENTS
#define SPAGHETTI_HEALTH_MAX_WINDOWS CONFIG_SPAGHETTI_MAX_HEALTH_WINDOWS

struct spaghetti_health_component_runtime {
	const struct spaghetti_health_component_descriptor *descriptor;
	int64_t last_heartbeat_ms;
	bool seen;
};

struct spaghetti_health_window {
	spaghetti_health_window_token_t token;
	spaghetti_health_component_id_t component_id;
	int64_t expires_at_ms;
	bool active;
};

struct spaghetti_health_context {
	struct spaghetti_health_component_runtime
		components[SPAGHETTI_HEALTH_MAX_COMPONENTS];
	struct spaghetti_health_window windows[SPAGHETTI_HEALTH_MAX_WINDOWS];
	struct spaghetti_health_watchdog_backend watchdog;
	spaghetti_health_mode_getter_t mode_getter;
	size_t component_count;
	enum spaghetti_health_state state;
	spaghetti_health_component_id_t stale_component_id;
	uint32_t last_reset_cause;
	uint32_t watchdog_feed_count;
	uint32_t next_window_token;
	bool initialized;
	bool started;
	bool hardware_watchdog_available;
	bool hardware_watchdog_armed;
	int wdt_channel_id;
};

static struct spaghetti_health_context context;
static uint32_t test_supervisor_feed_count;

K_MUTEX_DEFINE(health_lock);
K_THREAD_STACK_DEFINE(health_stack, CONFIG_SPAGHETTI_HEALTH_STACK_SIZE);

static void health_thread_entry(void *first, void *second, void *third);
static struct k_thread health_thread;
static k_tid_t health_thread_id;

static enum spaghetti_core_mode default_mode_getter(void)
{
#if defined(CONFIG_ZTEST)
	return SPAGHETTI_CORE_MODE_UNPROVISIONED;
#else
	struct spaghetti_core_info info;
	int err = spaghetti_core_get_info(&info);

	if (err < 0) {
		return SPAGHETTI_CORE_MODE_UNPROVISIONED;
	}
	return info.mode;
#endif
}

static int default_watchdog_setup(uint32_t timeout_ms)
{
	ARG_UNUSED(timeout_ms);
	return -ENOTSUP;
}

static int default_watchdog_feed(void)
{
	return -ENOTSUP;
}

#if defined(CONFIG_WATCHDOG) && DT_HAS_CHOSEN(zephyr_watchdog)

static const struct device *hardware_wdt_device(void)
{
	return DEVICE_DT_GET(DT_CHOSEN(zephyr_watchdog));
}

static int hardware_watchdog_setup(uint32_t timeout_ms)
{
	const struct device *wdt = hardware_wdt_device();
	struct wdt_timeout_cfg cfg = {
		.window = {
			.min = 0U,
			.max = timeout_ms,
		},
		.callback = NULL,
		.flags = WDT_FLAG_RESET_SOC,
	};
	int channel_id;

	if (!device_is_ready(wdt)) {
		return -ENODEV;
	}
	channel_id = wdt_install_timeout(wdt, &cfg);
	if (channel_id < 0) {
		return channel_id;
	}
	context.wdt_channel_id = channel_id;
	return wdt_setup(wdt, WDT_OPT_PAUSE_HALTED_BY_DBG);
}

static int hardware_watchdog_feed(void)
{
	const struct device *wdt = hardware_wdt_device();

	if (!device_is_ready(wdt) || (context.wdt_channel_id < 0)) {
		return -ENODEV;
	}
	return wdt_feed(wdt, context.wdt_channel_id);
}

#endif /* CONFIG_WATCHDOG && DT_HAS_CHOSEN(zephyr_watchdog) */

static bool duration_is_valid(k_timeout_t duration)
{
	int64_t duration_ms;

	if (K_TIMEOUT_EQ(duration, K_FOREVER) ||
	    K_TIMEOUT_EQ(duration, K_NO_WAIT)) {
		return false;
	}
	duration_ms = k_ticks_to_ms_floor64(duration.ticks);
	return (duration_ms > 0) &&
	       (duration_ms <= CONFIG_SPAGHETTI_HEALTH_MAX_WINDOW_MS);
}

static struct spaghetti_health_component_runtime *find_component_locked(
	spaghetti_health_component_id_t component_id)
{
	for (size_t idx = 0U; idx < context.component_count; ++idx) {
		if (context.components[idx].descriptor->id == component_id) {
			return &context.components[idx];
		}
	}
	return NULL;
}

static bool component_required_locked(
	const struct spaghetti_health_component_descriptor *descriptor)
{
	const enum spaghetti_core_mode mode = context.mode_getter();

	return (descriptor->required_core_modes & BIT(mode)) != 0U;
}

static int64_t effective_deadline_ms_locked(
	const struct spaghetti_health_component_runtime *component,
	int64_t now_ms)
{
	int64_t deadline_ms = component->last_heartbeat_ms +
		component->descriptor->maximum_silence_ms;

	for (size_t idx = 0U; idx < ARRAY_SIZE(context.windows); ++idx) {
		const struct spaghetti_health_window *window =
			&context.windows[idx];

		if (!window->active) {
			continue;
		}
		if (window->expires_at_ms <= now_ms) {
			continue;
		}
		if (window->component_id != component->descriptor->id) {
			continue;
		}
		deadline_ms = MAX(deadline_ms, window->expires_at_ms);
	}
	return deadline_ms;
}

static void expire_windows_locked(int64_t now_ms)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.windows); ++idx) {
		if (context.windows[idx].active &&
		    (context.windows[idx].expires_at_ms <= now_ms)) {
			context.windows[idx].active = false;
		}
	}
}

static int feed_watchdog_locked(void)
{
	int err;

	test_supervisor_feed_count++;
	context.watchdog_feed_count++;
	if (!context.hardware_watchdog_available) {
		return 0;
	}
	err = context.watchdog.feed();
	return err;
}

static void evaluate_locked(int64_t now_ms)
{
	bool all_required_healthy = true;
	spaghetti_health_component_id_t stale_id = 0U;

	expire_windows_locked(now_ms);

	for (size_t idx = 0U; idx < context.component_count; ++idx) {
		struct spaghetti_health_component_runtime *component =
			&context.components[idx];
		int64_t deadline_ms;

		if (!component_required_locked(component->descriptor)) {
			continue;
		}
		if (!component->seen) {
			all_required_healthy = false;
			if (stale_id == 0U) {
				stale_id = component->descriptor->id;
			}
			continue;
		}
		deadline_ms = effective_deadline_ms_locked(component, now_ms);
		if (now_ms > deadline_ms) {
			all_required_healthy = false;
			if (stale_id == 0U) {
				stale_id = component->descriptor->id;
			}
		}
	}

	if (!all_required_healthy) {
		context.state = SPAGHETTI_HEALTH_STALE;
		context.stale_component_id = stale_id;
		return;
	}

	context.stale_component_id = 0U;
	if (context.hardware_watchdog_available &&
	    context.hardware_watchdog_armed) {
		if (feed_watchdog_locked() < 0) {
			context.state = SPAGHETTI_HEALTH_DEGRADED;
			return;
		}
		context.state = SPAGHETTI_HEALTH_HEALTHY;
		return;
	}

	(void)feed_watchdog_locked();
	context.state = SPAGHETTI_HEALTH_DEGRADED;
}

static void health_thread_entry(void *first, void *second, void *third)
{
	ARG_UNUSED(first);
	ARG_UNUSED(second);
	ARG_UNUSED(third);

	while (true) {
		(void)k_mutex_lock(&health_lock, K_FOREVER);
		if (context.started) {
			evaluate_locked(k_uptime_get());
		}
		k_mutex_unlock(&health_lock);
		k_sleep(K_MSEC(CONFIG_SPAGHETTI_HEALTH_POLL_MS));
	}
}

static int load_descriptors_locked(void)
{
	size_t count = 0U;

	STRUCT_SECTION_FOREACH(spaghetti_health_component_descriptor,
			       descriptor) {
		if ((descriptor->id == 0U) || (descriptor->name == NULL) ||
		    (descriptor->name[0] == '\0') ||
		    (descriptor->maximum_silence_ms == 0U) ||
		    (descriptor->required_core_modes == 0U)) {
			return -EINVAL;
		}
		for (size_t idx = 0U; idx < count; ++idx) {
			if (context.components[idx].descriptor->id ==
			    descriptor->id) {
				return -EINVAL;
			}
		}
		if (count >= ARRAY_SIZE(context.components)) {
			return -ENOMEM;
		}
		context.components[count].descriptor = descriptor;
		context.components[count].last_heartbeat_ms = 0;
		context.components[count].seen = false;
		count++;
	}
	context.component_count = count;
	return 0;
}

int spaghetti_health_init(void)
{
	uint32_t reset_cause = 0U;
	int err;

	(void)k_mutex_lock(&health_lock, K_FOREVER);
	if (context.initialized) {
		k_mutex_unlock(&health_lock);
		return -EALREADY;
	}

	memset(&context, 0, sizeof(context));
	context.mode_getter = default_mode_getter;
	context.watchdog.setup = default_watchdog_setup;
	context.watchdog.feed = default_watchdog_feed;
	context.next_window_token = 1U;
	context.wdt_channel_id = -1;
	context.state = SPAGHETTI_HEALTH_STARTING;
	test_supervisor_feed_count = 0U;

#if defined(CONFIG_WATCHDOG) && DT_HAS_CHOSEN(zephyr_watchdog)
	context.hardware_watchdog_available = true;
	context.watchdog.setup = hardware_watchdog_setup;
	context.watchdog.feed = hardware_watchdog_feed;
#else
	context.hardware_watchdog_available = false;
#endif

	err = load_descriptors_locked();
	if (err < 0) {
		k_mutex_unlock(&health_lock);
		return err;
	}

#if defined(CONFIG_HWINFO)
	if (hwinfo_get_reset_cause(&reset_cause) == 0) {
		(void)hwinfo_clear_reset_cause();
	}
#endif
	context.last_reset_cause = reset_cause;
	context.initialized = true;
	k_mutex_unlock(&health_lock);
	LOG_INF("ready: components=%u hw_wdt=%u reset=0x%x",
		(uint32_t)context.component_count,
		context.hardware_watchdog_available ? 1U : 0U,
		reset_cause);
	return 0;
}

int spaghetti_health_start(void)
{
	int err;

	(void)k_mutex_lock(&health_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&health_lock);
		return -EACCES;
	}
	if (context.started) {
		k_mutex_unlock(&health_lock);
		return -EALREADY;
	}

	if (context.hardware_watchdog_available) {
		err = context.watchdog.setup(
			CONFIG_SPAGHETTI_HEALTH_WATCHDOG_MS);
		if (err < 0) {
			k_mutex_unlock(&health_lock);
			return err;
		}
		context.hardware_watchdog_armed = true;
	}

	health_thread_id = k_thread_create(
		&health_thread, health_stack,
		K_THREAD_STACK_SIZEOF(health_stack), health_thread_entry,
		NULL, NULL, NULL, CONFIG_SPAGHETTI_HEALTH_PRIORITY, 0,
		K_NO_WAIT);
	(void)k_thread_name_set(health_thread_id, "spaghetti_health");
	context.started = true;
	k_mutex_unlock(&health_lock);
	LOG_INF("supervisor started");
	return 0;
}

int spaghetti_health_heartbeat(spaghetti_health_component_id_t component_id)
{
	struct spaghetti_health_component_runtime *component;

	if (component_id == 0U) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&health_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&health_lock);
		return -EACCES;
	}
	component = find_component_locked(component_id);
	if (component == NULL) {
		k_mutex_unlock(&health_lock);
		return -ENOENT;
	}
	component->last_heartbeat_ms = k_uptime_get();
	component->seen = true;
	k_mutex_unlock(&health_lock);
	return 0;
}

int spaghetti_health_window_acquire(
	spaghetti_health_component_id_t component_id,
	k_timeout_t duration,
	spaghetti_health_window_token_t *out_token)
{
	struct spaghetti_health_component_runtime *component;
	struct spaghetti_health_window *slot = NULL;
	const int64_t now_ms = k_uptime_get();
	int64_t duration_ms;

	if ((component_id == 0U) || (out_token == NULL) ||
	    !duration_is_valid(duration)) {
		return -EINVAL;
	}
	duration_ms = k_ticks_to_ms_floor64(duration.ticks);

	(void)k_mutex_lock(&health_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&health_lock);
		return -EACCES;
	}
	component = find_component_locked(component_id);
	if (component == NULL) {
		k_mutex_unlock(&health_lock);
		return -ENOENT;
	}
	expire_windows_locked(now_ms);
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.windows); ++idx) {
		if (!context.windows[idx].active) {
			slot = &context.windows[idx];
			break;
		}
	}
	if (slot == NULL) {
		k_mutex_unlock(&health_lock);
		return -ENOMEM;
	}
	if (context.next_window_token == 0U) {
		context.next_window_token = 1U;
	}
	slot->token = context.next_window_token++;
	slot->component_id = component_id;
	slot->expires_at_ms = now_ms + duration_ms;
	slot->active = true;
	*out_token = slot->token;
	k_mutex_unlock(&health_lock);
	return 0;
}

int spaghetti_health_window_release(spaghetti_health_window_token_t token)
{
	const int64_t now_ms = k_uptime_get();

	if (token == 0U) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&health_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&health_lock);
		return -EACCES;
	}
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.windows); ++idx) {
		struct spaghetti_health_window *window = &context.windows[idx];

		if (!window->active || (window->token != token)) {
			continue;
		}
		if (window->expires_at_ms <= now_ms) {
			window->active = false;
			k_mutex_unlock(&health_lock);
			return -ETIMEDOUT;
		}
		window->active = false;
		k_mutex_unlock(&health_lock);
		return 0;
	}
	k_mutex_unlock(&health_lock);
	return -ENOENT;
}

int spaghetti_health_get_status(struct spaghetti_health_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&health_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&health_lock);
		return -EACCES;
	}
	*out = (struct spaghetti_health_status) {
		.state = context.state,
		.hardware_watchdog_available =
			context.hardware_watchdog_available,
		.stale_component_id = context.stale_component_id,
		.last_reset_cause = context.last_reset_cause,
		.watchdog_feed_count = context.watchdog_feed_count,
	};
	k_mutex_unlock(&health_lock);
	return 0;
}

int spaghetti_health_watchdog_backend_install(
	const struct spaghetti_health_watchdog_backend *backend)
{
	if ((backend == NULL) || (backend->setup == NULL) ||
	    (backend->feed == NULL)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&health_lock, K_FOREVER);
	if (context.started) {
		k_mutex_unlock(&health_lock);
		return -EBUSY;
	}
	context.watchdog = *backend;
	context.hardware_watchdog_available = true;
	k_mutex_unlock(&health_lock);
	return 0;
}

void spaghetti_health_set_mode_getter(spaghetti_health_mode_getter_t getter)
{
	(void)k_mutex_lock(&health_lock, K_FOREVER);
	context.mode_getter = (getter != NULL) ? getter : default_mode_getter;
	k_mutex_unlock(&health_lock);
}

void spaghetti_health_reset(void)
{
	k_tid_t tid = NULL;
	bool was_started = false;

	(void)k_mutex_lock(&health_lock, K_FOREVER);
	was_started = context.started;
	tid = health_thread_id;
	context.started = false;
	health_thread_id = NULL;
	k_mutex_unlock(&health_lock);

	if (was_started && (tid != NULL)) {
		k_thread_abort(tid);
	}

	(void)k_mutex_lock(&health_lock, K_FOREVER);
	memset(&context, 0, sizeof(context));
	context.mode_getter = default_mode_getter;
	context.watchdog.setup = default_watchdog_setup;
	context.watchdog.feed = default_watchdog_feed;
	context.wdt_channel_id = -1;
	context.next_window_token = 1U;
	test_supervisor_feed_count = 0U;
	k_mutex_unlock(&health_lock);
}

uint32_t spaghetti_health_test_supervisor_feed_count(void)
{
	return test_supervisor_feed_count;
}

void spaghetti_health_test_poll(void)
{
	(void)k_mutex_lock(&health_lock, K_FOREVER);
	if (context.initialized) {
		evaluate_locked(k_uptime_get());
	}
	k_mutex_unlock(&health_lock);
}
