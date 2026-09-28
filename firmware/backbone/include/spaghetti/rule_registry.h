/**
 * @file
 * @brief Public Rule Registry API for the Spaghetti firmware.
 * @ingroup spaghetti_rule_registry
 */

#ifndef SPAGHETTI_RULE_REGISTRY_H
#define SPAGHETTI_RULE_REGISTRY_H

#include <stddef.h>

struct spaghetti_rule_driver;

/**
 * @brief Validate the immutable compiled rule-driver catalog.
 *
 * @retval 0 Every descriptor is valid. An empty catalog is accepted.
 * @retval -EINVAL A descriptor is null, incomplete, duplicated, or malformed.
 *
 * @note Call once from boot thread context. This function performs no hardware I/O.
 */
int spaghetti_rule_registry_init(void);

/**
 * @brief Find an immutable rule driver descriptor by exact type ID.
 *
 * @param[in] type_id Caller-owned NUL-terminated string borrowed for this call.
 *
 * @return Firmware-lifetime immutable descriptor when found.
 * @return NULL when @p type_id is NULL, empty, malformed, or unknown.
 */
const struct spaghetti_rule_driver *spaghetti_rule_registry_find(
	const char *type_id);

/**
 * @brief Return the fixed number of compiled rule driver descriptors.
 *
 * @return Number of descriptors in the immutable Registry table.
 */
size_t spaghetti_rule_registry_count(void);

/**
 * @brief Get one immutable rule driver descriptor by index.
 *
 * @param[in] index Zero-based index below spaghetti_rule_registry_count().
 *
 * @return Firmware-lifetime immutable descriptor when @p index is valid.
 * @return NULL when @p index is out of range.
 */
const struct spaghetti_rule_driver *spaghetti_rule_registry_get(size_t index);

#endif /* SPAGHETTI_RULE_REGISTRY_H */
