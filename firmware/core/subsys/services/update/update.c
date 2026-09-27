#include <spaghetti/update.h>

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/core.h>
#include <spaghetti/config.h>
#include <spaghetti/health.h>
#include <spaghetti/image_manifest.h>

#include "update_internal.h"

LOG_MODULE_REGISTER(spaghetti_update, CONFIG_SPAGHETTI_UPDATE_LOG_LEVEL);

SPAGHETTI_HEALTH_COMPONENT_DEFINE(update_health) = {
	.id = SPAGHETTI_HEALTH_ID_UPDATE,
	.name = "update",
	.maximum_silence_ms = 3000U,
	.required_core_modes = BIT(SPAGHETTI_CORE_MODE_UNPROVISIONED) |
		BIT(SPAGHETTI_CORE_MODE_NORMAL) |
		BIT(SPAGHETTI_CORE_MODE_MAINTENANCE),
};

static void update_health_keepalive_handler(struct k_work *work);

K_WORK_DELAYABLE_DEFINE(update_health_keepalive,
			update_health_keepalive_handler);

static void update_health_keepalive_handler(struct k_work *work)
{
	ARG_UNUSED(work);
	(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_UPDATE);
	(void)k_work_reschedule(&update_health_keepalive,
		K_MSEC(CONFIG_SPAGHETTI_HEALTH_KEEPALIVE_MS));
}

struct spaghetti_update_context {
	struct spaghetti_update_status status;
	struct k_work_delayable timeout_work;
	int64_t deadline_ms;
	spaghetti_health_window_token_t health_window_token;
	const struct spaghetti_image_manifest *candidate_manifest;
	bool initialized;
};

static struct spaghetti_update_context context;
static struct k_work_q update_work_queue;
K_THREAD_STACK_DEFINE(update_work_stack, CONFIG_SPAGHETTI_UPDATE_WORK_STACK_SIZE);
K_MUTEX_DEFINE(update_lock);

static bool transport_is_valid(enum spaghetti_update_transport transport)
{
	return (transport == SPAGHETTI_UPDATE_TRANSPORT_UART) ||
	       (transport == SPAGHETTI_UPDATE_TRANSPORT_UDP) ||
	       (transport == SPAGHETTI_UPDATE_TRANSPORT_BLE) ||
	       (transport == SPAGHETTI_UPDATE_TRANSPORT_CAN) ||
	       (transport == SPAGHETTI_UPDATE_TRANSPORT_ESPNOW);
}

__weak int spaghetti_update_policy_authorize(
	enum spaghetti_update_transport transport)
{
	ARG_UNUSED(transport);
	return 0;
}

static bool session_has_expired(void)
{
	return (context.deadline_ms > 0) &&
	       (k_uptime_get() >= context.deadline_ms);
}

static int discard_candidate_locked(int reason)
{
	int err = spaghetti_update_backend_cancel();

	if (context.health_window_token != 0U) {
		(void)spaghetti_health_window_release(context.health_window_token);
		context.health_window_token = 0U;
	}

	if (err < 0) {
		context.status.state = SPAGHETTI_UPDATE_ERROR;
		context.status.last_error = err;
		return err;
	}

	context.status.state = SPAGHETTI_UPDATE_IDLE;
	context.status.transport = SPAGHETTI_UPDATE_TRANSPORT_NONE;
	context.status.timeout_remaining_ms = 0U;
	context.status.last_error = reason;
	context.deadline_ms = 0;
	return 0;
}

static void update_timeout_handler(struct k_work *work)
{
	ARG_UNUSED(work);
	(void)k_mutex_lock(&update_lock, K_FOREVER);
	if ((context.status.state == SPAGHETTI_UPDATE_ARMED) ||
	    (context.status.state == SPAGHETTI_UPDATE_RECEIVING)) {
		const int err = discard_candidate_locked(-ETIMEDOUT);

		if (err < 0) {
			LOG_ERR("timeout cleanup failed: err=%d", err);
		} else {
			LOG_WRN("update session timed out; secondary slot discarded");
		}
	}
	k_mutex_unlock(&update_lock);
}

int spaghetti_update_init(void)
{
	bool trial;
	uint8_t active_slot;
	int err = k_mutex_lock(&update_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (context.initialized) {
		err = -EALREADY;
		goto unlock;
	}

	err = spaghetti_update_backend_is_trial(&trial);
	if (err < 0) {
		goto unlock;
	}
	err = spaghetti_update_backend_active_slot(&active_slot);
	if (err < 0) {
		goto unlock;
	}

	k_work_init_delayable(&context.timeout_work, update_timeout_handler);
	k_work_queue_start(&update_work_queue, update_work_stack,
			   K_THREAD_STACK_SIZEOF(update_work_stack),
			   CONFIG_SPAGHETTI_UPDATE_WORK_PRIORITY, NULL);
	(void)k_thread_name_set(&update_work_queue.thread, "spaghetti_update");
	context.status = (struct spaghetti_update_status) {
		.state = trial ? SPAGHETTI_UPDATE_TRIAL_BOOT :
				 SPAGHETTI_UPDATE_IDLE,
		.transport = SPAGHETTI_UPDATE_TRANSPORT_NONE,
		.active_slot = active_slot,
		.image_confirmed = !trial,
	};
	context.deadline_ms = 0;
	context.initialized = true;
	(void)k_work_reschedule(&update_health_keepalive,
		K_MSEC(CONFIG_SPAGHETTI_HEALTH_KEEPALIVE_MS));
	(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_UPDATE);
	LOG_INF("ready: state=%s", trial ? "trial" : "idle");

unlock:
	k_mutex_unlock(&update_lock);
	return err;
}

int spaghetti_update_arm(uint32_t timeout_ms)
{
	int err;

	if (timeout_ms == 0U) {
		return -EINVAL;
	}

	err = k_mutex_lock(&update_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}

	switch (context.status.state) {
	case SPAGHETTI_UPDATE_IDLE:
		break;
	case SPAGHETTI_UPDATE_ARMED:
		err = -EALREADY;
		goto unlock;
	case SPAGHETTI_UPDATE_RECEIVING:
	case SPAGHETTI_UPDATE_VERIFYING:
	case SPAGHETTI_UPDATE_PENDING_REBOOT:
		err = -EBUSY;
		goto unlock;
	case SPAGHETTI_UPDATE_TRIAL_BOOT:
	case SPAGHETTI_UPDATE_ERROR:
	default:
		err = -EPERM;
		goto unlock;
	}

	context.status.state = SPAGHETTI_UPDATE_ARMED;
	context.status.transport = SPAGHETTI_UPDATE_TRANSPORT_NONE;
	context.status.timeout_remaining_ms = timeout_ms;
	context.status.last_error = 0;
	context.deadline_ms = k_uptime_get() + (int64_t)timeout_ms;
	(void)k_work_reschedule_for_queue(&update_work_queue,
					  &context.timeout_work,
					  K_MSEC(timeout_ms));
	{
		const uint32_t window_ms =
			MIN(timeout_ms, CONFIG_SPAGHETTI_HEALTH_MAX_WINDOW_MS);
		spaghetti_health_window_token_t token = 0U;
		const int window_err = spaghetti_health_window_acquire(
			SPAGHETTI_HEALTH_ID_UPDATE, K_MSEC(window_ms), &token);

		if (window_err == 0) {
			context.health_window_token = token;
		}
	}
	err = 0;
	(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_UPDATE);
	LOG_INF("armed: timeout_ms=%u", timeout_ms);

unlock:
	k_mutex_unlock(&update_lock);
	return err;
}

int spaghetti_update_begin(enum spaghetti_update_transport transport)
{
	int err;

	if (!transport_is_valid(transport)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&update_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (context.status.state != SPAGHETTI_UPDATE_ARMED) {
		err = ((context.status.state == SPAGHETTI_UPDATE_RECEIVING) ||
		       (context.status.state == SPAGHETTI_UPDATE_VERIFYING) ||
		       (context.status.state == SPAGHETTI_UPDATE_PENDING_REBOOT)) ?
			      -EBUSY : -EPERM;
		goto unlock;
	}
	if (session_has_expired()) {
		(void)k_work_cancel_delayable(&context.timeout_work);
		err = discard_candidate_locked(-ETIMEDOUT);
		if (err == 0) {
			err = -ETIMEDOUT;
		}
		goto unlock;
	}

	err = spaghetti_update_policy_authorize(transport);
	if (err < 0) {
		context.status.last_error = err;
		goto unlock;
	}

	err = spaghetti_update_backend_prepare();
	if (err < 0) {
		context.status.state = SPAGHETTI_UPDATE_ERROR;
		context.status.last_error = err;
		goto unlock;
	}

	context.status.state = SPAGHETTI_UPDATE_RECEIVING;
	context.status.transport = transport;
	context.status.last_error = 0;
	LOG_INF("receiving: transport=%u", (uint32_t)transport);
	err = 0;

unlock:
	k_mutex_unlock(&update_lock);
	return err;
}

int spaghetti_update_finish(void)
{
	int err = k_mutex_lock(&update_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (context.status.state != SPAGHETTI_UPDATE_RECEIVING) {
		err = -EPERM;
		goto unlock;
	}
	if (session_has_expired()) {
		(void)k_work_cancel_delayable(&context.timeout_work);
		err = discard_candidate_locked(-ETIMEDOUT);
		if (err == 0) {
			err = -ETIMEDOUT;
		}
		goto unlock;
	}

	(void)k_work_cancel_delayable(&context.timeout_work);
	context.status.state = SPAGHETTI_UPDATE_VERIFYING;
	if (context.candidate_manifest != NULL) {
		struct spaghetti_config live_config;
		struct spaghetti_config_revision revision;

		err = spaghetti_config_get_snapshot(&live_config, &revision);
		if (err == -EACCES) {
			/* Config not initialized yet; skip type-retention check. */
			err = 0;
		} else if (err < 0) {
			context.status.state = SPAGHETTI_UPDATE_ERROR;
			context.status.last_error = err;
			goto unlock;
		} else {
			err = spaghetti_image_manifest_validate_candidate(
				context.candidate_manifest, &live_config);
			if (err < 0) {
				LOG_ERR("candidate manifest rejected: err=%d", err);
				(void)discard_candidate_locked(err);
				context.candidate_manifest = NULL;
				goto unlock;
			}
		}
	}
	err = spaghetti_update_backend_finalize_test();
	if (err < 0) {
		context.status.state = SPAGHETTI_UPDATE_ERROR;
		context.status.last_error = err;
		goto unlock;
	}

	context.status.state = SPAGHETTI_UPDATE_PENDING_REBOOT;
	context.status.timeout_remaining_ms = 0U;
	context.status.last_error = 0;
	context.deadline_ms = 0;
	context.candidate_manifest = NULL;
	if (context.health_window_token != 0U) {
		(void)spaghetti_health_window_release(context.health_window_token);
		context.health_window_token = 0U;
	}
	(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_UPDATE);
	LOG_INF("candidate ready: MCUboot test requested");
	err = 0;

unlock:
	k_mutex_unlock(&update_lock);
	return err;
}

int spaghetti_update_write(uint32_t offset, const uint8_t *data,
			   size_t data_size, bool last)
{
	int err;

	if ((data == NULL) || (data_size == 0U)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&update_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (context.status.state != SPAGHETTI_UPDATE_RECEIVING) {
		err = -EPERM;
		goto unlock;
	}
	if (session_has_expired()) {
		(void)k_work_cancel_delayable(&context.timeout_work);
		err = discard_candidate_locked(-ETIMEDOUT);
		if (err == 0) {
			err = -ETIMEDOUT;
		}
		goto unlock;
	}

	err = spaghetti_update_backend_write(offset, data, data_size, last);
	if (err < 0) {
		context.status.state = SPAGHETTI_UPDATE_ERROR;
		context.status.last_error = err;
	}

unlock:
	k_mutex_unlock(&update_lock);
	return err;
}

int spaghetti_update_cancel(void)
{
	int err = k_mutex_lock(&update_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (context.status.state == SPAGHETTI_UPDATE_IDLE) {
		err = -EALREADY;
		goto unlock;
	}
	if (context.status.state == SPAGHETTI_UPDATE_TRIAL_BOOT) {
		err = -EPERM;
		goto unlock;
	}
	if (context.status.state == SPAGHETTI_UPDATE_VERIFYING) {
		err = -EBUSY;
		goto unlock;
	}

	(void)k_work_cancel_delayable(&context.timeout_work);
	err = discard_candidate_locked(0);
	if (err == 0) {
		LOG_INF("update cancelled; secondary slot discarded");
	}

unlock:
	k_mutex_unlock(&update_lock);
	return err;
}

int spaghetti_update_confirm_trial(void)
{
	int err = k_mutex_lock(&update_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (context.status.state != SPAGHETTI_UPDATE_TRIAL_BOOT) {
		err = -EPERM;
		goto unlock;
	}

	err = spaghetti_update_backend_confirm();
	if (err < 0) {
		context.status.state = SPAGHETTI_UPDATE_ERROR;
		context.status.last_error = err;
		goto unlock;
	}

	context.status.state = SPAGHETTI_UPDATE_IDLE;
	context.status.image_confirmed = true;
	context.status.last_error = 0;
	LOG_INF("trial image confirmed");

unlock:
	k_mutex_unlock(&update_lock);
	return err;
}

int spaghetti_update_get_capacity(size_t *out_size)
{
	int err;

	if (out_size == NULL) {
		return -EINVAL;
	}
	err = k_mutex_lock(&update_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
	} else {
		err = spaghetti_update_backend_get_capacity(out_size);
	}
	k_mutex_unlock(&update_lock);
	return err;
}

int spaghetti_update_get_status(struct spaghetti_update_status *out)
{
	struct spaghetti_update_status snapshot;
	int64_t remaining;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&update_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&update_lock);
		return -EACCES;
	}

	snapshot = context.status;
	if ((snapshot.state == SPAGHETTI_UPDATE_ARMED) ||
	    (snapshot.state == SPAGHETTI_UPDATE_RECEIVING)) {
		remaining = context.deadline_ms - k_uptime_get();
		snapshot.timeout_remaining_ms =
			(remaining > 0) ? (uint32_t)MIN(remaining, UINT32_MAX) : 0U;
	}
	*out = snapshot;
	k_mutex_unlock(&update_lock);
	return 0;
}

int spaghetti_update_bind_candidate_manifest(
	const struct spaghetti_image_manifest *candidate)
{
	int err = k_mutex_lock(&update_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}

	context.candidate_manifest = candidate;
	err = 0;

unlock:
	k_mutex_unlock(&update_lock);
	return err;
}
