#include <spaghetti/connectivity.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/capabilities.h>
#include <spaghetti/health.h>
#include <spaghetti/core.h>

#include "connectivity_internal.h"

LOG_MODULE_REGISTER(spaghetti_connectivity,
		    CONFIG_SPAGHETTI_CONNECTIVITY_LOG_LEVEL);

SPAGHETTI_HEALTH_COMPONENT_DEFINE(connectivity_health) = {
	.id = SPAGHETTI_HEALTH_ID_CONNECTIVITY,
	.name = "connectivity",
	.maximum_silence_ms = 3000U,
	.required_core_modes = BIT(SPAGHETTI_CORE_MODE_NORMAL),
};

static void connectivity_health_keepalive_handler(struct k_work *work);

K_WORK_DELAYABLE_DEFINE(connectivity_health_keepalive,
			connectivity_health_keepalive_handler);

static void connectivity_health_keepalive_handler(struct k_work *work)
{
	ARG_UNUSED(work);
	(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_CONNECTIVITY);
	(void)k_work_reschedule(&connectivity_health_keepalive,
		K_MSEC(CONFIG_SPAGHETTI_HEALTH_KEEPALIVE_MS));
}

#define SPAGHETTI_CONNECTIVITY_SERVICE_MASK \
	(SPAGHETTI_CONNECTIVITY_SERVICE_BLE | \
	 SPAGHETTI_CONNECTIVITY_SERVICE_WIFI | \
	 SPAGHETTI_CONNECTIVITY_SERVICE_MQTT | \
	 SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE)

#define SPAGHETTI_CONNECTIVITY_RADIO_MASK \
	(SPAGHETTI_CONNECTIVITY_SERVICE_BLE | \
	 SPAGHETTI_CONNECTIVITY_SERVICE_WIFI)

struct spaghetti_connectivity_context {
	struct spaghetti_connectivity_backend backend;
	enum spaghetti_connectivity_policy policy;
	uint32_t active_services;
	uint32_t leased_services;
	int64_t lease_expires_at_ms;
	int last_error;
	bool initialized;
};

static void lease_expiry_work_handler(struct k_work *work);

static int no_op_service_callback(
	enum spaghetti_connectivity_service service)
{
	ARG_UNUSED(service);
	return 0;
}

static struct spaghetti_connectivity_context context = {
	.backend = {
		.start = no_op_service_callback,
		.stop = no_op_service_callback,
	},
};

static const enum spaghetti_connectivity_service service_start_order[] = {
	SPAGHETTI_CONNECTIVITY_SERVICE_BLE,
	SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
	SPAGHETTI_CONNECTIVITY_SERVICE_MQTT,
	SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE,
};

K_MUTEX_DEFINE(connectivity_lock);
K_WORK_DELAYABLE_DEFINE(lease_expiry_work, lease_expiry_work_handler);

static bool policy_is_valid(enum spaghetti_connectivity_policy policy)
{
	return (policy == SPAGHETTI_CONNECTIVITY_LOW_ENERGY) ||
	       (policy == SPAGHETTI_CONNECTIVITY_ONLINE);
}

static uint32_t supported_services(void)
{
	uint32_t services = 0U;

	if (spaghetti_capabilities_support(SPAGHETTI_BUILD_CAP_BLE)) {
		services |= SPAGHETTI_CONNECTIVITY_SERVICE_BLE;
	}
	if (spaghetti_capabilities_support(SPAGHETTI_BUILD_CAP_WIFI)) {
		services |= SPAGHETTI_CONNECTIVITY_SERVICE_WIFI;
	}
	if (spaghetti_capabilities_support(SPAGHETTI_BUILD_CAP_MQTT)) {
		services |= SPAGHETTI_CONNECTIVITY_SERVICE_MQTT;
	}
	if (spaghetti_capabilities_support(
		    SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE)) {
		services |= SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE;
	}
	return services;
}

static uint32_t radio_bits(uint32_t services)
{
	uint32_t radios = services & SPAGHETTI_CONNECTIVITY_RADIO_MASK;

	if ((services & SPAGHETTI_CONNECTIVITY_SERVICE_MQTT) != 0U) {
		radios |= SPAGHETTI_CONNECTIVITY_SERVICE_WIFI;
	}
	return radios;
}

static uint32_t with_exclusive_radios(uint32_t persistent, uint32_t extra)
{
	const uint32_t extra_radios = radio_bits(extra);
	uint32_t desired = persistent | extra;

	if ((extra_radios & SPAGHETTI_CONNECTIVITY_RADIO_MASK) ==
	    SPAGHETTI_CONNECTIVITY_RADIO_MASK) {
		return desired;
	}
	if (((desired & SPAGHETTI_CONNECTIVITY_SERVICE_BLE) == 0U) ||
	    ((desired & SPAGHETTI_CONNECTIVITY_SERVICE_WIFI) == 0U)) {
		return desired;
	}

	if ((extra_radios & SPAGHETTI_CONNECTIVITY_SERVICE_WIFI) != 0U) {
		desired &= ~SPAGHETTI_CONNECTIVITY_SERVICE_BLE;
	} else if ((extra_radios & SPAGHETTI_CONNECTIVITY_SERVICE_BLE) != 0U) {
		desired &= ~(SPAGHETTI_CONNECTIVITY_SERVICE_WIFI |
			     SPAGHETTI_CONNECTIVITY_SERVICE_MQTT);
	} else {
		desired &= ~SPAGHETTI_CONNECTIVITY_SERVICE_BLE;
	}
	return desired;
}

static uint32_t services_for_policy(
	enum spaghetti_connectivity_policy policy)
{
	const uint32_t available = supported_services();

	if (policy == SPAGHETTI_CONNECTIVITY_LOW_ENERGY) {
		return available & SPAGHETTI_CONNECTIVITY_SERVICE_BLE;
	}

	return available & (SPAGHETTI_CONNECTIVITY_SERVICE_WIFI |
			    SPAGHETTI_CONNECTIVITY_SERVICE_MQTT);
}

static void stop_mask_reverse(uint32_t services)
{
	for (size_t order_idx = ARRAY_SIZE(service_start_order);
	     order_idx > 0U; order_idx--) {
		const enum spaghetti_connectivity_service service =
			service_start_order[order_idx - 1U];

		if ((services & (uint32_t)service) != 0U) {
			(void)context.backend.stop(service);
		}
	}
}

static int transition_locked(uint32_t desired_services)
{
	const uint32_t previous_services = context.active_services;
	const uint32_t services_to_start = desired_services & ~previous_services;
	const uint32_t services_to_stop = previous_services & ~desired_services;
	uint32_t started_services = 0U;
	uint32_t stopped_services = 0U;
	int err;

	for (size_t order_idx = 0U;
	     order_idx < ARRAY_SIZE(service_start_order); order_idx++) {
		const enum spaghetti_connectivity_service service =
			service_start_order[order_idx];

		if ((services_to_start & (uint32_t)service) == 0U) {
			continue;
		}
		err = context.backend.start(service);
		if (err < 0) {
			stop_mask_reverse(started_services);
			return err;
		}
		started_services |= (uint32_t)service;
	}

	for (size_t order_idx = ARRAY_SIZE(service_start_order);
	     order_idx > 0U; order_idx--) {
		const enum spaghetti_connectivity_service service =
			service_start_order[order_idx - 1U];

		if ((services_to_stop & (uint32_t)service) == 0U) {
			continue;
		}
		err = context.backend.stop(service);
		if (err < 0) {
			for (size_t restart_idx = 0U;
			     restart_idx < ARRAY_SIZE(service_start_order);
			     restart_idx++) {
				const enum spaghetti_connectivity_service stopped =
					service_start_order[restart_idx];

				if ((stopped_services & (uint32_t)stopped) != 0U) {
					(void)context.backend.start(stopped);
				}
			}
			stop_mask_reverse(started_services);
			return err;
		}
		stopped_services |= (uint32_t)service;
	}

	context.active_services = desired_services;
	return 0;
}

static void lease_expiry_work_handler(struct k_work *work)
{
	const int64_t now_ms = k_uptime_get();
	int64_t remaining_ms;
	int err;

	ARG_UNUSED(work);
	(void)k_mutex_lock(&connectivity_lock, K_FOREVER);
	if (!context.initialized || (context.leased_services == 0U)) {
		k_mutex_unlock(&connectivity_lock);
		return;
	}

	remaining_ms = context.lease_expires_at_ms - now_ms;
	if (remaining_ms > 0) {
		(void)k_work_reschedule(&lease_expiry_work,
			K_MSEC(remaining_ms));
		k_mutex_unlock(&connectivity_lock);
		return;
	}

	err = transition_locked(services_for_policy(context.policy));
	context.leased_services = 0U;
	context.lease_expires_at_ms = 0;
	context.last_error = err;
	k_mutex_unlock(&connectivity_lock);
	if (err < 0) {
		LOG_ERR("lease expiry transition failed: err=%d", err);
	} else {
		LOG_INF("temporary connectivity lease expired");
	}
}

int spaghetti_connectivity_init(
	enum spaghetti_connectivity_policy boot_policy)
{
	int err;

	if (!policy_is_valid(boot_policy)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&connectivity_lock, K_FOREVER);
	if (context.initialized) {
		k_mutex_unlock(&connectivity_lock);
		return -EALREADY;
	}

	err = transition_locked(services_for_policy(boot_policy));
	if (err < 0) {
		context.last_error = err;
		k_mutex_unlock(&connectivity_lock);
		return err;
	}
	context.policy = boot_policy;
	context.leased_services = 0U;
	context.lease_expires_at_ms = 0;
	context.last_error = 0;
	context.initialized = true;
	k_mutex_unlock(&connectivity_lock);
	(void)k_work_reschedule(&connectivity_health_keepalive,
		K_MSEC(CONFIG_SPAGHETTI_HEALTH_KEEPALIVE_MS));
	(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_CONNECTIVITY);
	LOG_INF("ready: policy=%u active=0x%x", (uint32_t)boot_policy,
		context.active_services);
	return 0;
}

int spaghetti_connectivity_set_policy(
	enum spaghetti_connectivity_policy policy)
{
	uint32_t desired_services;
	int err;

	if (!policy_is_valid(policy)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&connectivity_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&connectivity_lock);
		return -EACCES;
	}
	desired_services = with_exclusive_radios(
		services_for_policy(policy), context.leased_services);
	err = transition_locked(desired_services);
	if (err == 0) {
		context.policy = policy;
	}
	context.last_error = err;
	k_mutex_unlock(&connectivity_lock);
	return err;
}

int spaghetti_connectivity_acquire_lease(
	const struct spaghetti_connectivity_lease_request *request)
{
	uint32_t desired_services;
	int schedule_result;
	int err;

	if ((request == NULL) || (request->services == 0U) ||
	    ((request->services & ~SPAGHETTI_CONNECTIVITY_SERVICE_MASK) != 0U) ||
	    (request->duration_ms < CONFIG_SPAGHETTI_CONNECTIVITY_MIN_LEASE_MS) ||
	    (request->duration_ms > CONFIG_SPAGHETTI_CONNECTIVITY_MAX_LEASE_MS)) {
		return -EINVAL;
	}
	if ((request->services & ~supported_services()) != 0U) {
		return -ENOTSUP;
	}
	if (radio_bits(request->services) == SPAGHETTI_CONNECTIVITY_RADIO_MASK) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&connectivity_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&connectivity_lock);
		return -EACCES;
	}
	if (context.leased_services != 0U) {
		k_mutex_unlock(&connectivity_lock);
		return -EBUSY;
	}

	desired_services = with_exclusive_radios(
		services_for_policy(context.policy), request->services);
	err = transition_locked(desired_services);
	if (err < 0) {
		context.last_error = err;
		k_mutex_unlock(&connectivity_lock);
		return err;
	}

	context.leased_services = request->services;
	context.lease_expires_at_ms = k_uptime_get() + request->duration_ms;
	schedule_result = k_work_reschedule(
		&lease_expiry_work, K_MSEC(request->duration_ms));
	if (schedule_result < 0) {
		err = schedule_result;
		context.leased_services = 0U;
		context.lease_expires_at_ms = 0;
		(void)transition_locked(services_for_policy(context.policy));
		context.last_error = err;
		k_mutex_unlock(&connectivity_lock);
		return err;
	}
	context.last_error = 0;
	k_mutex_unlock(&connectivity_lock);
	return 0;
}

int spaghetti_connectivity_release_lease(void)
{
	int err;

	(void)k_mutex_lock(&connectivity_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&connectivity_lock);
		return -EACCES;
	}
	if (context.leased_services == 0U) {
		k_mutex_unlock(&connectivity_lock);
		return -ENOENT;
	}

	err = transition_locked(services_for_policy(context.policy));
	if (err == 0) {
		context.leased_services = 0U;
		context.lease_expires_at_ms = 0;
		(void)k_work_cancel_delayable(&lease_expiry_work);
	}
	context.last_error = err;
	k_mutex_unlock(&connectivity_lock);
	return err;
}

int spaghetti_connectivity_get_snapshot(
	struct spaghetti_connectivity_snapshot *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&connectivity_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&connectivity_lock);
		return -EACCES;
	}
	out->policy = context.policy;
	out->active_services = context.active_services;
	out->leased_services = context.leased_services;
	out->lease_expires_at_ms = context.lease_expires_at_ms;
	out->last_error = context.last_error;
	k_mutex_unlock(&connectivity_lock);
	return 0;
}

int spaghetti_connectivity_backend_install(
	const struct spaghetti_connectivity_backend *backend)
{
	if ((backend == NULL) || (backend->start == NULL) ||
	    (backend->stop == NULL)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&connectivity_lock, K_FOREVER);
	if (context.initialized) {
		k_mutex_unlock(&connectivity_lock);
		return -EBUSY;
	}
	context.backend = *backend;
	k_mutex_unlock(&connectivity_lock);
	return 0;
}

void spaghetti_connectivity_backend_reset(void)
{
	struct k_work_sync sync;

	(void)k_work_cancel_delayable_sync(&lease_expiry_work, &sync);
	(void)k_mutex_lock(&connectivity_lock, K_FOREVER);
	stop_mask_reverse(context.active_services);
	context.policy = SPAGHETTI_CONNECTIVITY_LOW_ENERGY;
	context.active_services = 0U;
	context.leased_services = 0U;
	context.lease_expires_at_ms = 0;
	context.last_error = 0;
	context.initialized = false;
	context.backend.start = no_op_service_callback;
	context.backend.stop = no_op_service_callback;
	k_mutex_unlock(&connectivity_lock);
}
