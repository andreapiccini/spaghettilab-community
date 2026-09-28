#ifndef SPAGHETTI_SECURE_WORKSPACE_INTERNAL_H
#define SPAGHETTI_SECURE_WORKSPACE_INTERNAL_H

#include <stddef.h>

struct spaghetti_secure_allocator_stats {
	size_t capacity;
	size_t allocated;
	size_t peak_allocated;
};

int spaghetti_secure_allocator_get_stats(
	struct spaghetti_secure_allocator_stats *out);

#endif /* SPAGHETTI_SECURE_WORKSPACE_INTERNAL_H */
