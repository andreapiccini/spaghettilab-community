/**
 * @file
 * @brief Build-time and runtime resource report for Core observability.
 * @ingroup spaghetti_resources
 *
 * Snapshots separate immutable build budgets from runtime used/peak counters.
 * Instantaneous free RAM is never published as an installability promise.
 */

#ifndef SPAGHETTI_RESOURCES_H
#define SPAGHETTI_RESOURCES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/feature_pack.h>

/** Bounded owners tracked by the resource report. */
enum spaghetti_resource_owner {
	SPAGHETTI_RESOURCE_OWNER_NONE = 0, /**< No owner recorded. */
	SPAGHETTI_RESOURCE_OWNER_MODULES, /**< Module Manager pool. */
	SPAGHETTI_RESOURCE_OWNER_RULES, /**< Runtime rule pool. */
	SPAGHETTI_RESOURCE_OWNER_BLOCKS, /**< Processing block pool. */
	SPAGHETTI_RESOURCE_OWNER_PROFILES, /**< Device Profile slots. */
	SPAGHETTI_RESOURCE_OWNER_RECORDS, /**< Record Delivery queue. */
	SPAGHETTI_RESOURCE_OWNER_WORKSPACE, /**< Shared processing workspace. */
	SPAGHETTI_RESOURCE_OWNER_HEAP, /**< System heap when enabled. */
	SPAGHETTI_RESOURCE_OWNER_STACK, /**< Optional stack high-water. */
};

/** One bounded pool observation: capacity, current use, and peak since boot. */
struct spaghetti_resource_pool_stats {
	uint16_t capacity; /**< Compiled maximum. */
	uint16_t used; /**< Current occupied slots or bytes units. */
	uint16_t peak; /**< High-water since boot or last reset. */
};

/**
 * @brief Caller-owned coherent resource snapshot.
 *
 * Build fields are immutable for the image. Runtime fields report current use
 * and high-water marks. There is intentionally no @c free_ram field.
 */
struct spaghetti_resources_snapshot {
	uint32_t flash_slot_bytes; /**< Declared slot size. */
	uint32_t flash_image_budget_bytes; /**< Declared image budget. */
	uint32_t flash_headroom_bytes; /**< Declared slot headroom. */
	uint32_t static_ram_budget_bytes; /**< Declared static RAM budget. */
	uint32_t declared_stack_bytes; /**< Declared stack bytes. */
	uint32_t declared_pool_bytes; /**< Declared pool bytes. */
	uint32_t declared_workspace_bytes; /**< Declared workspace bytes. */
	uint8_t feature_set_hash[SPAGHETTI_FEATURE_SET_HASH_SIZE]; /**< Pack hash. */
	size_t pack_count; /**< Installed pack count. */
	struct spaghetti_feature_pack_ref
		packs[SPAGHETTI_IMAGE_MANIFEST_PACK_MAX]; /**< Pack list copy. */
	struct spaghetti_resource_pool_stats modules; /**< Module pool. */
	struct spaghetti_resource_pool_stats rules; /**< Rule pool. */
	struct spaghetti_resource_pool_stats blocks; /**< Block pool. */
	struct spaghetti_resource_pool_stats profiles; /**< Profile pool. */
	struct spaghetti_resource_pool_stats records; /**< Record queue. */
	struct spaghetti_resource_pool_stats workspace; /**< Workspace bytes. */
	struct spaghetti_resource_pool_stats heap; /**< Heap when compiled. */
	bool heap_metrics_available; /**< True when heap stats are meaningful. */
	bool stack_metrics_available; /**< True when stack HWM is compiled. */
	uint32_t stack_size_bytes; /**< Declared monitorable stack size. */
	uint32_t stack_min_unused_bytes; /**< Minimum-ever unused stack bytes. */
	uint32_t allocation_failures; /**< Failed pool admissions. */
	enum spaghetti_resource_owner last_exhausted; /**< Last exhausted owner. */
};

/**
 * @brief Initialize runtime resource counters from build constants.
 *
 * @retval 0 Resources are ready.
 * @retval -EALREADY Already initialized.
 *
 * @note Call once from the Core boot thread after pack/manifest init.
 */
int spaghetti_resources_init(void);

/**
 * @brief Copy a coherent resource snapshot into caller-owned storage.
 *
 * @param[out] out Destination written only on success. Never allocates.
 *
 * @retval 0 @p out contains a coherent snapshot.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES Resources are not initialized.
 */
int spaghetti_resources_get_snapshot(struct spaghetti_resources_snapshot *out);

/**
 * @brief Reset high-water marks to the current used values.
 *
 * Capacities and failure counters are unchanged. Diagnostic-only.
 *
 * @retval 0 Peaks were reset.
 * @retval -EACCES Resources are not initialized.
 */
int spaghetti_resources_reset_high_water(void);

/**
 * @brief Record current use for one pool and update its peak.
 *
 * @param[in] owner Pool owner.
 * @param[in] used Current occupied count or byte units.
 *
 * @note Safe from thread context. Ignores calls before init.
 */
void spaghetti_resources_note_used(enum spaghetti_resource_owner owner,
				   uint16_t used);

/**
 * @brief Record a failed allocation against one owner.
 *
 * @param[in] owner Exhausted owner.
 *
 * @note Safe from thread context. Ignores calls before init.
 */
void spaghetti_resources_note_failure(enum spaghetti_resource_owner owner);

#endif /* SPAGHETTI_RESOURCES_H */
