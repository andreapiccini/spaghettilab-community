/**
 * @file
 * @brief Temporary bytes↔property_set bridge for legacy Config/Discovery blobs.
 *
 * Removed by TASK-330-01 once Storage/CBOR carry property sets directly.
 */

#ifndef SPAGHETTI_LEGACY_DRIVER_CONFIG_H
#define SPAGHETTI_LEGACY_DRIVER_CONFIG_H

#include <stddef.h>

#include <spaghetti/schema.h>

/**
 * @brief Convert legacy packed driver config bytes into a property set.
 *
 * Supports the production type IDs still stored as struct blobs until phase 330.
 *
 * @param[in] type_id Borrowed NUL-terminated driver type ID.
 * @param[in] bytes Borrowed packed config bytes.
 * @param[in] size Number of valid bytes at @p bytes.
 * @param[out] out Caller-owned property set written only on success.
 *
 * @retval 0 Conversion completed.
 * @retval -EINVAL Pointer, size, or packed layout is invalid.
 * @retval -ENOTSUP @p type_id has no legacy packed layout.
 */
int spaghetti_legacy_driver_config_bytes_to_properties(
	const char *type_id,
	const void *bytes,
	size_t size,
	struct spaghetti_property_set *out);

#endif /* SPAGHETTI_LEGACY_DRIVER_CONFIG_H */
