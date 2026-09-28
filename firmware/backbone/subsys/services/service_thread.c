#include "service_thread.h"

#include <spaghetti/service.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

static struct spaghetti_service_resource_snapshot resources;
K_MUTEX_DEFINE(service_thread_lock);

static void release_reservation(size_t stack_size)
{
	(void)k_mutex_lock(&service_thread_lock, K_FOREVER);
	resources.active_threads--;
	resources.active_stack_bytes -= stack_size;
	k_mutex_unlock(&service_thread_lock);
}

int spaghetti_service_thread_start(
	struct spaghetti_service_thread *thread,
	size_t stack_size,
	k_thread_entry_t entry,
	void *first,
	void *second,
	void *third,
	int priority,
	const char *name)
{
	k_thread_stack_t *stack;

	if ((thread == NULL) || (stack_size == 0U) || (entry == NULL) ||
	    (name == NULL) || (name[0] == '\0')) {
		return -EINVAL;
	}
	if (thread->stack != NULL) {
		return -EALREADY;
	}

	(void)k_mutex_lock(&service_thread_lock, K_FOREVER);
	if ((resources.active_threads >=
	     CONFIG_SPAGHETTI_SERVICE_THREAD_MAX_COUNT) ||
	    (stack_size > (CONFIG_SPAGHETTI_SERVICE_THREAD_MAX_STACK_BYTES -
			   resources.active_stack_bytes))) {
		resources.allocation_failures++;
		k_mutex_unlock(&service_thread_lock);
		return -ENOMEM;
	}
	resources.active_threads++;
	resources.active_stack_bytes += stack_size;
	resources.peak_threads = MAX(resources.peak_threads,
				     resources.active_threads);
	resources.peak_stack_bytes = MAX(resources.peak_stack_bytes,
					  resources.active_stack_bytes);
	k_mutex_unlock(&service_thread_lock);

	stack = k_thread_stack_alloc(stack_size, 0);
	if (stack == NULL) {
		(void)k_mutex_lock(&service_thread_lock, K_FOREVER);
		resources.allocation_failures++;
		k_mutex_unlock(&service_thread_lock);
		release_reservation(stack_size);
		return -ENOMEM;
	}
	thread->stack = stack;
	thread->stack_size = stack_size;
	(void)k_thread_create(&thread->thread, thread->stack,
			      thread->stack_size, entry, first, second, third,
			      priority, 0, K_NO_WAIT);
	(void)k_thread_name_set(&thread->thread, name);
	return 0;
}

int spaghetti_service_thread_join_and_release(
	struct spaghetti_service_thread *thread,
	k_timeout_t timeout)
{
	size_t unused_stack = 0U;
	size_t used_stack = 0U;
	int err;

	if (thread == NULL) {
		return -EINVAL;
	}
	if (thread->stack == NULL) {
		return -EALREADY;
	}
	err = k_thread_join(&thread->thread, timeout);
	if (err < 0) {
		return (err == -EBUSY) ? -EAGAIN : err;
	}
	if ((k_thread_stack_space_get(&thread->thread, &unused_stack) == 0) &&
	    (unused_stack <= thread->stack_size)) {
		used_stack = thread->stack_size - unused_stack;
	}
	err = k_thread_stack_free(thread->stack);
	if (err < 0) {
		return err;
	}
	(void)k_mutex_lock(&service_thread_lock, K_FOREVER);
	resources.peak_single_stack_used = MAX(
		resources.peak_single_stack_used, used_stack);
	k_mutex_unlock(&service_thread_lock);
	release_reservation(thread->stack_size);
	thread->stack = NULL;
	thread->stack_size = 0U;
	return 0;
}

int spaghetti_service_get_resource_snapshot(
	struct spaghetti_service_resource_snapshot *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	(void)k_mutex_lock(&service_thread_lock, K_FOREVER);
	*out = resources;
	k_mutex_unlock(&service_thread_lock);
	return 0;
}
