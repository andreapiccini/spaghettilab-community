#ifndef SPAGHETTI_DRIVER_REGISTRY_INTERNAL_H
#define SPAGHETTI_DRIVER_REGISTRY_INTERNAL_H

#include <stddef.h>

struct spaghetti_module_driver;

int spaghetti_driver_registry_validate(
	const struct spaghetti_module_driver *const *entries,
	size_t entry_count);

#endif /* SPAGHETTI_DRIVER_REGISTRY_INTERNAL_H */
