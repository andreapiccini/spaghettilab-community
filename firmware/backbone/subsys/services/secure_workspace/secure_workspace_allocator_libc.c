#include "secure_workspace_internal.h"

#include <errno.h>

#include <sys_malloc.h>

#include <zephyr/sys/mem_stats.h>

int spaghetti_secure_allocator_get_stats(
	struct spaghetti_secure_allocator_stats *out)
{
	struct sys_memory_stats stats;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}
	err = malloc_runtime_stats_get(&stats);
	if (err < 0) {
		return err;
	}
	*out = (struct spaghetti_secure_allocator_stats) {
		.capacity = stats.free_bytes + stats.allocated_bytes,
		.allocated = stats.allocated_bytes,
		.peak_allocated = stats.max_allocated_bytes,
	};
	return 0;
}
