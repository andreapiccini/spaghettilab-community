/**
 * @file
 * @brief Capability Pack descriptors, registry, and host catalog contract.
 * @ingroup spaghetti_feature_registry
 *
 * A pack groups related compiled firmware. Installing a pack means flashing a
 * signed MCUboot image that contains it; packs are not dynamically loaded.
 * No React marketplace UI is provided by this firmware API.
 */

#ifndef SPAGHETTI_FEATURE_PACK_H
#define SPAGHETTI_FEATURE_PACK_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/iterable_sections.h>

/** ABI version carried by every compiled pack descriptor. */
#define SPAGHETTI_FEATURE_PACK_ABI_VERSION 1U

/** Maximum bytes in a NUL-terminated pack ID or version string. */
#define SPAGHETTI_FEATURE_PACK_ID_SIZE 32U

/** Maximum dependency or conflict entries declared by one pack. */
#define SPAGHETTI_FEATURE_PACK_DEP_MAX 8U

/** Maximum Module/Rule/Block type IDs provided by one pack. */
#define SPAGHETTI_FEATURE_PACK_TYPE_MAX 32U

/** SHA-256 digest size for @c feature_set_hash. */
#define SPAGHETTI_FEATURE_SET_HASH_SIZE 32U

/** Maximum packs recorded in one image manifest. */
#define SPAGHETTI_IMAGE_MANIFEST_PACK_MAX 16U

/** Iterable-section helper used by @ref SPAGHETTI_FEATURE_PACK_DEFINE. */
#define SPAGHETTI_FEATURE_PACK_ITER(name) \
	STRUCT_SECTION_ITERABLE(spaghetti_feature_pack, name)

/**
 * @brief Declare one immutable Capability Pack descriptor.
 *
 * Expand with `= { ... };` after the macro. Descriptors are linker-collected.
 *
 * @param name C identifier for the descriptor object.
 */
#define SPAGHETTI_FEATURE_PACK_DEFINE(name) \
	const SPAGHETTI_FEATURE_PACK_ITER(name)

/**
 * @brief Immutable build-time Capability Pack descriptor.
 *
 * String tables and string literals have firmware lifetime. Empty counts are
 * allowed; NULL pointers are allowed only when the matching count is zero.
 */
struct spaghetti_feature_pack {
	const char *id; /**< Stable pack ID, e.g. "core-basic". */
	const char *version; /**< Pack version string, e.g. "1.0.0". */
	const char *const *deps; /**< Required pack IDs. */
	size_t dep_count; /**< Number of @ref deps entries. */
	const char *const *conflicts; /**< Mutually exclusive pack IDs. */
	size_t conflict_count; /**< Number of @ref conflicts entries. */
	uint32_t required_hw_caps; /**< @ref spaghetti_build_capability bits. */
	const char *const *module_types; /**< Provided Module type IDs. */
	size_t module_type_count; /**< Number of @ref module_types. */
	const char *const *rule_types; /**< Provided Rule type IDs. */
	size_t rule_type_count; /**< Number of @ref rule_types. */
	const char *const *block_types; /**< Provided Block type IDs. */
	size_t block_type_count; /**< Number of @ref block_types. */
	uint16_t min_protocol_version; /**< Minimum machine-protocol version. */
	uint16_t min_config_version; /**< Minimum Config schema version. */
	uint16_t abi_version; /**< Must equal SPAGHETTI_FEATURE_PACK_ABI_VERSION. */
};

/** Compact pack identity published in the image manifest and catalog. */
struct spaghetti_feature_pack_ref {
	char id[SPAGHETTI_FEATURE_PACK_ID_SIZE]; /**< Owned pack ID. */
	char version[SPAGHETTI_FEATURE_PACK_ID_SIZE]; /**< Owned pack version. */
};

/**
 * @brief Caller-owned catalog entry for one installed pack.
 *
 * Type ID pointers borrow firmware-lifetime strings from the pack descriptor.
 */
struct spaghetti_feature_pack_catalog_entry {
	struct spaghetti_feature_pack_ref pack; /**< Owned ID and version. */
	uint32_t required_hw_caps; /**< Hardware capability bits. */
	const char *const *module_types; /**< Borrowed Module type table. */
	size_t module_type_count; /**< Module type count. */
	const char *const *rule_types; /**< Borrowed Rule type table. */
	size_t rule_type_count; /**< Rule type count. */
	const char *const *block_types; /**< Borrowed Block type table. */
	size_t block_type_count; /**< Block type count. */
	uint16_t min_protocol_version; /**< Protocol floor. */
	uint16_t min_config_version; /**< Config floor. */
	uint16_t abi_version; /**< Pack ABI. */
};

/**
 * @brief Validate and index every linked Capability Pack.
 *
 * @retval 0 Packs are unique, dependencies resolve, and conflicts are absent.
 * @retval -EINVAL A descriptor field is incomplete or ABI mismatches.
 * @retval -EEXIST Two packs share the same ID.
 * @retval -ENOENT A declared dependency is not linked.
 * @retval -EADDRINUSE A declared conflict is also linked.
 * @retval -EALREADY The registry was already initialized.
 *
 * @note Call once from the Core boot thread before catalog or manifest use.
 */
int spaghetti_feature_registry_init(void);

/**
 * @brief Locate one pack by ID.
 *
 * @param[in] id Firmware-lifetime or caller-owned NUL-terminated pack ID.
 *
 * @return Borrowed pack descriptor, or NULL when absent or uninitialized.
 */
const struct spaghetti_feature_pack *spaghetti_feature_pack_find(const char *id);

/**
 * @brief Return the number of linked packs.
 *
 * @return Pack count after successful init, or zero when uninitialized.
 */
size_t spaghetti_feature_pack_count(void);

/**
 * @brief Return one pack by stable index.
 *
 * @param[in] index Zero-based index below @ref spaghetti_feature_pack_count.
 *
 * @return Borrowed pack descriptor, or NULL when out of range.
 */
const struct spaghetti_feature_pack *spaghetti_feature_pack_get(size_t index);

/**
 * @brief Copy catalog entries for host enumeration.
 *
 * @param[out] out Caller-owned array written only on success.
 * @param[in] capacity Maximum entries @p out can hold.
 * @param[out] out_count Required or written entry count.
 *
 * @retval 0 Entries were copied, or a count-only query succeeded.
 * @retval -EINVAL Pointer and capacity arguments are inconsistent.
 * @retval -EACCES The registry is not initialized.
 * @retval -ENOSPC @p capacity is too small; @p out_count holds the requirement.
 */
int spaghetti_feature_pack_catalog(
	struct spaghetti_feature_pack_catalog_entry *out,
	size_t capacity,
	size_t *out_count);

/**
 * @brief Test whether any linked pack provides a Module type ID.
 *
 * @param[in] type_id NUL-terminated Module type ID.
 *
 * @return true when a pack provides @p type_id.
 */
bool spaghetti_feature_pack_provides_module(const char *type_id);

/**
 * @brief Test whether any linked pack provides a Rule type ID.
 *
 * @param[in] type_id NUL-terminated Rule type ID.
 *
 * @return true when a pack provides @p type_id.
 */
bool spaghetti_feature_pack_provides_rule(const char *type_id);

/**
 * @brief Test whether any linked pack provides a Block type ID.
 *
 * @param[in] type_id NUL-terminated Block type ID.
 *
 * @return true when a pack provides @p type_id.
 */
bool spaghetti_feature_pack_provides_block(const char *type_id);

#endif /* SPAGHETTI_FEATURE_PACK_H */
