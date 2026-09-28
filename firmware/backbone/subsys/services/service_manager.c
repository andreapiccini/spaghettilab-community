#include <spaghetti/service.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <spaghetti/capabilities.h>

LOG_MODULE_REGISTER(spaghetti_service_manager,
		    CONFIG_SPAGHETTI_SERVICE_MANAGER_LOG_LEVEL);

struct spaghetti_service_manager_context {
	const struct spaghetti_service_descriptor *descriptors;
	enum spaghetti_service_state states[CONFIG_SPAGHETTI_SERVICE_MAX_COUNT];
	size_t descriptor_count;
	bool initialized;
};

static struct spaghetti_service_manager_context context;
K_MUTEX_DEFINE(service_manager_lock);

static bool id_is_valid(const char *id)
{
	return (id != NULL) && (id[0] != '\0') &&
	       (memchr(id, '\0', CONFIG_SPAGHETTI_SERVICE_ID_MAX_SIZE) != NULL);
}

static bool timeout_is_valid(k_timeout_t timeout)
{
	int64_t timeout_ms;

	if (K_TIMEOUT_EQ(timeout, K_FOREVER)) {
		return false;
	}
	timeout_ms = k_ticks_to_ms_floor64(timeout.ticks);
	return (timeout_ms >= 0) &&
	       (timeout_ms <= CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS);
}

static int find_service_locked(const char *id, size_t *out_index)
{
	for (size_t service_idx = 0U;
	     service_idx < context.descriptor_count; ++service_idx) {
		if (strcmp(context.descriptors[service_idx].id, id) == 0) {
			*out_index = service_idx;
			return 0;
		}
	}

	return -ENOENT;
}

int spaghetti_service_manager_init(
	const struct spaghetti_service_descriptor *descriptors,
	size_t descriptor_count)
{
	if ((descriptors == NULL) || (descriptor_count == 0U)) {
		return -EINVAL;
	}
	if (descriptor_count > CONFIG_SPAGHETTI_SERVICE_MAX_COUNT) {
		return -ENOSPC;
	}
	for (size_t service_idx = 0U; service_idx < descriptor_count;
	     ++service_idx) {
		const struct spaghetti_service_descriptor *descriptor =
			&descriptors[service_idx];

		if (!id_is_valid(descriptor->id) || (descriptor->ops == NULL) ||
		    (descriptor->ops->start == NULL) ||
		    (descriptor->ops->stop == NULL)) {
			return -EINVAL;
		}
		for (size_t previous_idx = 0U; previous_idx < service_idx;
		     ++previous_idx) {
			if (strcmp(descriptors[previous_idx].id,
				   descriptor->id) == 0) {
				return -EEXIST;
			}
		}
	}

	(void)k_mutex_lock(&service_manager_lock, K_FOREVER);
	if (context.initialized) {
		k_mutex_unlock(&service_manager_lock);
		return -EALREADY;
	}
	context.descriptors = descriptors;
	context.descriptor_count = descriptor_count;
	for (size_t service_idx = 0U; service_idx < descriptor_count;
	     ++service_idx) {
		context.states[service_idx] = SPAGHETTI_SERVICE_STOPPED;
	}
	context.initialized = true;
	k_mutex_unlock(&service_manager_lock);
	LOG_INF("ready: services=%u", (uint32_t)descriptor_count);
	return 0;
}

int spaghetti_service_start(const char *id)
{
	const struct spaghetti_service_descriptor *descriptor;
	size_t service_idx;
	int err;

	if (!id_is_valid(id)) {
		return -EINVAL;
	}
	(void)k_mutex_lock(&service_manager_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&service_manager_lock);
		return -EACCES;
	}
	err = find_service_locked(id, &service_idx);
	if (err < 0) {
		k_mutex_unlock(&service_manager_lock);
		return err;
	}
	if (context.states[service_idx] == SPAGHETTI_SERVICE_DEGRADED) {
		k_mutex_unlock(&service_manager_lock);
		return -EIO;
	}
	if (context.states[service_idx] != SPAGHETTI_SERVICE_STOPPED) {
		k_mutex_unlock(&service_manager_lock);
		return -EALREADY;
	}
	descriptor = &context.descriptors[service_idx];
	if (!spaghetti_capabilities_support(
		    descriptor->required_capabilities)) {
		k_mutex_unlock(&service_manager_lock);
		return -ENOTSUP;
	}
	context.states[service_idx] = SPAGHETTI_SERVICE_STARTING;
	k_mutex_unlock(&service_manager_lock);

	err = descriptor->ops->start();
	(void)k_mutex_lock(&service_manager_lock, K_FOREVER);
	context.states[service_idx] = (err == 0) ?
		SPAGHETTI_SERVICE_RUNNING : SPAGHETTI_SERVICE_DEGRADED;
	k_mutex_unlock(&service_manager_lock);
	return err;
}

int spaghetti_service_stop(const char *id, k_timeout_t timeout)
{
	const struct spaghetti_service_descriptor *descriptor;
	size_t service_idx;
	int err;

	if (!id_is_valid(id) || !timeout_is_valid(timeout)) {
		return -EINVAL;
	}
	(void)k_mutex_lock(&service_manager_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&service_manager_lock);
		return -EACCES;
	}
	err = find_service_locked(id, &service_idx);
	if (err < 0) {
		k_mutex_unlock(&service_manager_lock);
		return err;
	}
	if ((context.states[service_idx] == SPAGHETTI_SERVICE_STOPPED) ||
	    (context.states[service_idx] == SPAGHETTI_SERVICE_STARTING) ||
	    (context.states[service_idx] == SPAGHETTI_SERVICE_STOPPING)) {
		k_mutex_unlock(&service_manager_lock);
		return -EALREADY;
	}
	descriptor = &context.descriptors[service_idx];
	context.states[service_idx] = SPAGHETTI_SERVICE_STOPPING;
	k_mutex_unlock(&service_manager_lock);

	err = descriptor->ops->stop(timeout);
	(void)k_mutex_lock(&service_manager_lock, K_FOREVER);
	context.states[service_idx] = (err == 0) ?
		SPAGHETTI_SERVICE_STOPPED : SPAGHETTI_SERVICE_DEGRADED;
	k_mutex_unlock(&service_manager_lock);
	return err;
}

int spaghetti_service_get_state(
	const char *id, enum spaghetti_service_state *out)
{
	size_t service_idx;
	int err;

	if (!id_is_valid(id) || (out == NULL)) {
		return -EINVAL;
	}
	(void)k_mutex_lock(&service_manager_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&service_manager_lock);
		return -EACCES;
	}
	err = find_service_locked(id, &service_idx);
	if (err == 0) {
		*out = context.states[service_idx];
	}
	k_mutex_unlock(&service_manager_lock);
	return err;
}
