#ifndef SPAGHETTI_SERVICE_THREAD_H
#define SPAGHETTI_SERVICE_THREAD_H

#include <stddef.h>

#include <zephyr/kernel.h>

struct spaghetti_service_thread {
	struct k_thread thread;
	k_thread_stack_t *stack;
	size_t stack_size;
};

int spaghetti_service_thread_start(
	struct spaghetti_service_thread *thread,
	size_t stack_size,
	k_thread_entry_t entry,
	void *first,
	void *second,
	void *third,
	int priority,
	const char *name);

int spaghetti_service_thread_join_and_release(
	struct spaghetti_service_thread *thread,
	k_timeout_t timeout);

#endif /* SPAGHETTI_SERVICE_THREAD_H */
