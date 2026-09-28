#ifndef SPAGHETTI_RULE_REGISTRY_INTERNAL_H
#define SPAGHETTI_RULE_REGISTRY_INTERNAL_H

#include <stddef.h>

struct spaghetti_rule_driver;

int spaghetti_rule_registry_validate(
	const struct spaghetti_rule_driver *const *entries,
	size_t entry_count);

#endif /* SPAGHETTI_RULE_REGISTRY_INTERNAL_H */
