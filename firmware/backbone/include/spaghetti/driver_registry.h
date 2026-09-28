/**
 * @file
 * @brief Public Driver Registry API for the Spaghetti firmware.
 * @ingroup spaghetti_driver_registry
 */

#ifndef SPAGHETTI_DRIVER_REGISTRY_H
#define SPAGHETTI_DRIVER_REGISTRY_H

#include <stddef.h>

struct spaghetti_module_driver;

/**
 * @brief Validate the immutable compiled driver catalog.
 *
 * @retval 0 Every descriptor, type ID, capability, and required operation is valid.
 * @retval -EINVAL A descriptor is null, incomplete, duplicated, or malformed.
 *
 * @note Call once from boot thread context. This function performs no hardware I/O.
 */
int spaghetti_driver_registry_init(void);

/**
 * @brief Find an immutable driver descriptor by exact type ID.
 *
 * @param[in] type_id Caller-owned NUL-terminated string borrowed for this call.
 *
 * @return Firmware-lifetime immutable descriptor when found.
 * @return NULL when @p type_id is NULL, empty, malformed, or unknown.
 *
 * @note Callable from thread context after successful Registry initialization.
 */
const struct spaghetti_module_driver *spaghetti_driver_registry_find(
	const char *type_id);

/**
 * @brief Return the fixed number of compiled driver descriptors.
 *
 * @return Number of descriptors in the immutable Registry table.
 */
size_t spaghetti_driver_registry_count(void);

/**
 * @brief Get one immutable driver descriptor by index.
 *
 * @param[in] index Zero-based index below spaghetti_driver_registry_count().
 *
 * @return Firmware-lifetime immutable descriptor when @p index is valid.
 * @return NULL when @p index is out of range.
 */
const struct spaghetti_module_driver *spaghetti_driver_registry_get(size_t index);

#endif /* SPAGHETTI_DRIVER_REGISTRY_H */
