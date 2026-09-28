/**
 * @file
 * @brief Embedded firmware image manifest and candidate compatibility checks.
 * @ingroup spaghetti_feature_registry
 *
 * The manifest is compiled into the image and describes packs, versions, and
 * declared flash/RAM budgets. Candidate compatibility is decided from the
 * signed manifest, never from instantaneous free RAM.
 */

#ifndef SPAGHETTI_IMAGE_MANIFEST_H
#define SPAGHETTI_IMAGE_MANIFEST_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/capabilities.h>
#include <spaghetti/config.h>
#include <spaghetti/feature_pack.h>

/** Maximum bytes in the NUL-terminated firmware version string. */
#define SPAGHETTI_IMAGE_MANIFEST_VERSION_SIZE SPAGHETTI_CORE_VARIANT_SIZE

/** Maximum bytes in the bootloader minimum version string. */
#define SPAGHETTI_IMAGE_MANIFEST_BOOTLOADER_SIZE 24U

/** Config migration policy carried by a candidate image. */
enum spaghetti_config_migration_policy {
	SPAGHETTI_CONFIG_MIGRATION_REJECT_REMOVAL = 0, /**< Reject type removal. */
	SPAGHETTI_CONFIG_MIGRATION_EXPLICIT = 1, /**< Explicit Config migration present. */
};

/**
 * @brief Immutable image contract embedded in the firmware artifact.
 */
struct spaghetti_image_manifest {
	char core_variant[SPAGHETTI_CORE_VARIANT_SIZE]; /**< Stable Core ID. */
	enum spaghetti_resource_profile resource_profile; /**< Selected budget. */
	char fw_version[SPAGHETTI_IMAGE_MANIFEST_VERSION_SIZE]; /**< Signed version. */
	uint16_t abi_version; /**< Feature-pack ABI floor. */
	uint16_t min_protocol_version; /**< Machine-protocol floor. */
	uint16_t min_config_version; /**< Config schema floor. */
	size_t pack_count; /**< Used entries in @ref packs. */
	struct spaghetti_feature_pack_ref
		packs[SPAGHETTI_IMAGE_MANIFEST_PACK_MAX]; /**< Ordered pack list. */
	uint8_t feature_set_hash[SPAGHETTI_FEATURE_SET_HASH_SIZE]; /**< SHA-256. */
	uint32_t flash_slot_bytes; /**< Declared primary slot budget. */
	uint32_t flash_image_budget_bytes; /**< Declared image size budget. */
	uint32_t flash_headroom_bytes; /**< Declared slot headroom. */
	uint32_t static_ram_budget_bytes; /**< Declared static RAM budget. */
	uint32_t declared_stack_bytes; /**< Declared stack reservation. */
	uint32_t declared_pool_bytes; /**< Declared pool reservation. */
	uint32_t declared_workspace_bytes; /**< Declared workspace reservation. */
	char bootloader_min[SPAGHETTI_IMAGE_MANIFEST_BOOTLOADER_SIZE]; /**< Min BL. */
	enum spaghetti_config_migration_policy
		config_migration_policy; /**< Removal / migration policy. */
};

/**
 * @brief Initialize the embedded manifest from linked packs and build data.
 *
 * Computes @c feature_set_hash from the sorted @c id@version pack list.
 *
 * @retval 0 The manifest pointer is ready.
 * @retval -EINVAL Pack enumeration failed.
 * @retval -EALREADY Manifest init already completed.
 *
 * @note Call after @ref spaghetti_feature_registry_init.
 */
int spaghetti_image_manifest_init(void);

/**
 * @brief Return the immutable embedded image manifest.
 *
 * @return Const pointer after successful init, or NULL when uninitialized.
 */
const struct spaghetti_image_manifest *spaghetti_image_manifest_get(void);

/**
 * @brief Validate a candidate manifest against a Config snapshot.
 *
 * Rejects a candidate that omits a Module/Rule/Block type used by @p config
 * unless @c config_migration_policy is @ref SPAGHETTI_CONFIG_MIGRATION_EXPLICIT.
 * Also rejects ABI/protocol/config floors that are too new, and mismatched
 * Core variant or resource profile.
 *
 * @param[in] candidate Caller-owned candidate manifest borrowed for this call.
 * @param[in] config Caller-owned Config snapshot borrowed for this call.
 *
 * @retval 0 The candidate is compatible with @p config.
 * @retval -EINVAL An argument is NULL or internally inconsistent.
 * @retval -ENOTSUP Core variant, profile, ABI, protocol, or Config mismatch.
 * @retval -ENOENT A type required by @p config is absent from @p candidate.
 *
 * @note Thread context. Performs no flash I/O and allocates no heap.
 */
int spaghetti_image_manifest_validate_candidate(
	const struct spaghetti_image_manifest *candidate,
	const struct spaghetti_config *config);

#endif /* SPAGHETTI_IMAGE_MANIFEST_H */
