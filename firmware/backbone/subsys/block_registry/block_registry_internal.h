#ifndef SPAGHETTI_BLOCK_REGISTRY_INTERNAL_H
#define SPAGHETTI_BLOCK_REGISTRY_INTERNAL_H

#include <stddef.h>

struct spaghetti_block_driver;

int spaghetti_block_registry_validate(
	const struct spaghetti_block_driver *const *entries,
	size_t entry_count);

#endif /* SPAGHETTI_BLOCK_REGISTRY_INTERNAL_H */
