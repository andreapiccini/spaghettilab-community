#include <spaghetti/secure_workspace.h>

#include "secure_workspace_internal.h"

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

LOG_MODULE_REGISTER(spaghetti_secure_workspace,
		    CONFIG_SPAGHETTI_SECURE_WORKSPACE_LOG_LEVEL);

struct spaghetti_secure_workspace_context {
	enum spaghetti_secure_workspace_owner owner;
	size_t allocation_baseline;
	size_t peak_used;
	uint32_t allocation_failures;
	bool initialized;
};

static struct spaghetti_secure_workspace_context context;
K_MUTEX_DEFINE(workspace_lock);
K_SEM_DEFINE(workspace_available, 1, 1);

BUILD_ASSERT(CONFIG_SPAGHETTI_MAX_SECURE_SESSIONS == 1,
	     "The public owner snapshot currently supports one heavy session");

static bool owner_is_valid(enum spaghetti_secure_workspace_owner owner)
{
	return (owner == SPAGHETTI_SECURE_OWNER_MQTT) ||
	       (owner == SPAGHETTI_SECURE_OWNER_WIFI_OTA) ||
	       (owner == SPAGHETTI_SECURE_OWNER_REMOTE_CONSOLE);
}

static bool timeout_is_valid(k_timeout_t timeout)
{
	int64_t timeout_ms;

	if (K_TIMEOUT_EQ(timeout, K_FOREVER)) {
		return false;
	}
	timeout_ms = k_ticks_to_ms_floor64(timeout.ticks);
	return (timeout_ms >= 0) &&
	       (timeout_ms <= CONFIG_SPAGHETTI_SECURE_WORKSPACE_ACQUIRE_MAX_MS);
}

int spaghetti_secure_workspace_init(void)
{
	struct spaghetti_secure_allocator_stats stats;
	int err = spaghetti_secure_allocator_get_stats(&stats);

	if (err < 0) {
		return err;
	}
	(void)k_mutex_lock(&workspace_lock, K_FOREVER);
	if (context.initialized) {
		k_mutex_unlock(&workspace_lock);
		return -EALREADY;
	}
	context = (struct spaghetti_secure_workspace_context) {
		.owner = SPAGHETTI_SECURE_OWNER_NONE,
		.initialized = true,
	};
	k_sem_reset(&workspace_available);
	k_sem_give(&workspace_available);
	k_mutex_unlock(&workspace_lock);
	LOG_INF("ready: capacity=%u allocator=%u",
		CONFIG_SPAGHETTI_SECURE_WORKSPACE_SIZE,
		(uint32_t)stats.capacity);
	return 0;
}

int spaghetti_secure_workspace_acquire(
	enum spaghetti_secure_workspace_owner owner, k_timeout_t timeout)
{
	struct spaghetti_secure_allocator_stats stats;
	int err;

	if (!owner_is_valid(owner) || !timeout_is_valid(timeout)) {
		return -EINVAL;
	}
	if (k_is_in_isr()) {
		return -EWOULDBLOCK;
	}

	(void)k_mutex_lock(&workspace_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&workspace_lock);
		return -EACCES;
	}
	k_mutex_unlock(&workspace_lock);

	err = k_sem_take(&workspace_available, timeout);
	if (err < 0) {
		(void)k_mutex_lock(&workspace_lock, K_FOREVER);
		context.allocation_failures++;
		k_mutex_unlock(&workspace_lock);
		return -EAGAIN;
	}

	err = spaghetti_secure_allocator_get_stats(&stats);
	if (err < 0) {
		(void)k_mutex_lock(&workspace_lock, K_FOREVER);
		context.allocation_failures++;
		k_mutex_unlock(&workspace_lock);
		k_sem_give(&workspace_available);
		return err;
	}
	if ((stats.allocated > stats.capacity) ||
	    ((stats.capacity - stats.allocated) <
	     CONFIG_SPAGHETTI_SECURE_WORKSPACE_SIZE)) {
		(void)k_mutex_lock(&workspace_lock, K_FOREVER);
		context.allocation_failures++;
		k_mutex_unlock(&workspace_lock);
		k_sem_give(&workspace_available);
		return -ENOMEM;
	}
	(void)k_mutex_lock(&workspace_lock, K_FOREVER);
	context.owner = owner;
	context.allocation_baseline = stats.allocated;
	k_mutex_unlock(&workspace_lock);
	return 0;
}

int spaghetti_secure_workspace_release(
	enum spaghetti_secure_workspace_owner owner)
{
	struct spaghetti_secure_allocator_stats stats;
	size_t session_peak = 0U;
	int stats_error;

	if (!owner_is_valid(owner)) {
		return -EINVAL;
	}
	if (k_is_in_isr()) {
		return -EWOULDBLOCK;
	}
	stats_error = spaghetti_secure_allocator_get_stats(&stats);

	(void)k_mutex_lock(&workspace_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&workspace_lock);
		return -EACCES;
	}
	if (context.owner == SPAGHETTI_SECURE_OWNER_NONE) {
		k_mutex_unlock(&workspace_lock);
		return -ENOENT;
	}
	if (context.owner != owner) {
		k_mutex_unlock(&workspace_lock);
		return -EPERM;
	}
	if ((stats_error == 0) &&
	    (stats.peak_allocated > context.allocation_baseline)) {
		session_peak = stats.peak_allocated -
			context.allocation_baseline;
		context.peak_used = MAX(context.peak_used, session_peak);
	}
	context.owner = SPAGHETTI_SECURE_OWNER_NONE;
	context.allocation_baseline = 0U;
	k_mutex_unlock(&workspace_lock);
	k_sem_give(&workspace_available);
	return stats_error;
}

int spaghetti_secure_workspace_get_snapshot(
	struct spaghetti_secure_workspace_snapshot *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&workspace_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&workspace_lock);
		return -EACCES;
	}
	*out = (struct spaghetti_secure_workspace_snapshot) {
		.owner = context.owner,
		.capacity = CONFIG_SPAGHETTI_SECURE_WORKSPACE_SIZE,
		.peak_used = context.peak_used,
		.allocation_failures = context.allocation_failures,
	};
	k_mutex_unlock(&workspace_lock);
	return 0;
}
