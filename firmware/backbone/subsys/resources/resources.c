#include <spaghetti/resources.h>

#include <errno.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/device_profile.h>
#include <spaghetti/image_manifest.h>

LOG_MODULE_REGISTER(spaghetti_resources,
		    CONFIG_SPAGHETTI_RESOURCES_LOG_LEVEL);

struct resource_runtime {
	struct spaghetti_resource_pool_stats modules;
	struct spaghetti_resource_pool_stats rules;
	struct spaghetti_resource_pool_stats blocks;
	struct spaghetti_resource_pool_stats profiles;
	struct spaghetti_resource_pool_stats records;
	struct spaghetti_resource_pool_stats workspace;
	struct spaghetti_resource_pool_stats heap;
	uint32_t stack_size_bytes;
	uint32_t stack_min_unused_bytes;
	uint32_t allocation_failures;
	enum spaghetti_resource_owner last_exhausted;
	bool initialized;
};

static struct resource_runtime runtime;

static struct spaghetti_resource_pool_stats *pool_for_owner(
	enum spaghetti_resource_owner owner)
{
	switch (owner) {
	case SPAGHETTI_RESOURCE_OWNER_MODULES:
		return &runtime.modules;
	case SPAGHETTI_RESOURCE_OWNER_RULES:
		return &runtime.rules;
	case SPAGHETTI_RESOURCE_OWNER_BLOCKS:
		return &runtime.blocks;
	case SPAGHETTI_RESOURCE_OWNER_PROFILES:
		return &runtime.profiles;
	case SPAGHETTI_RESOURCE_OWNER_RECORDS:
		return &runtime.records;
	case SPAGHETTI_RESOURCE_OWNER_WORKSPACE:
		return &runtime.workspace;
	case SPAGHETTI_RESOURCE_OWNER_HEAP:
		return &runtime.heap;
	default:
		return NULL;
	}
}

static void refresh_profile_used(void)
{
	runtime.profiles.used =
		(uint16_t)MIN(spaghetti_device_profile_count(), UINT16_MAX);
	if (runtime.profiles.used > runtime.profiles.peak) {
		runtime.profiles.peak = runtime.profiles.used;
	}
}

/* Heap used/peak are updated only through spaghetti_resources_note_used(). */

int spaghetti_resources_init(void)
{
	const struct spaghetti_image_manifest *manifest;

	if (runtime.initialized) {
		return -EALREADY;
	}

	manifest = spaghetti_image_manifest_get();
	if (manifest == NULL) {
		return -EACCES;
	}

	memset(&runtime, 0, sizeof(runtime));
	runtime.modules.capacity = CONFIG_SPAGHETTI_MAX_MODULES;
	runtime.rules.capacity = CONFIG_SPAGHETTI_MAX_RULES;
	runtime.blocks.capacity = CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS;
	runtime.profiles.capacity = CONFIG_SPAGHETTI_MAX_DEVICE_PROFILES;
	runtime.records.capacity = CONFIG_SPAGHETTI_MAX_RECORD_QUEUE;
	runtime.workspace.capacity =
		(uint16_t)MIN(CONFIG_SPAGHETTI_SECURE_WORKSPACE_SIZE, UINT16_MAX);

#if defined(CONFIG_HEAP_MEM_POOL_SIZE) && (CONFIG_HEAP_MEM_POOL_SIZE > 0)
	runtime.heap.capacity =
		(uint16_t)MIN(CONFIG_HEAP_MEM_POOL_SIZE, UINT16_MAX);
#endif

#if defined(CONFIG_SPAGHETTI_RESOURCES_STACK_STATS)
	runtime.stack_size_bytes = CONFIG_SPAGHETTI_DECLARED_STACK_BYTES;
	runtime.stack_min_unused_bytes = CONFIG_SPAGHETTI_DECLARED_STACK_BYTES;
#endif

	runtime.initialized = true;
	LOG_INF("resources ready");
	return 0;
}

void spaghetti_resources_note_used(enum spaghetti_resource_owner owner,
				   uint16_t used)
{
	struct spaghetti_resource_pool_stats *pool;

	if (!runtime.initialized) {
		return;
	}

	pool = pool_for_owner(owner);
	if (pool == NULL) {
		return;
	}

	pool->used = used;
	if (used > pool->peak) {
		pool->peak = used;
	}
}

void spaghetti_resources_note_failure(enum spaghetti_resource_owner owner)
{
	if (!runtime.initialized) {
		return;
	}

	++runtime.allocation_failures;
	runtime.last_exhausted = owner;
}

int spaghetti_resources_reset_high_water(void)
{
	if (!runtime.initialized) {
		return -EACCES;
	}

	runtime.modules.peak = runtime.modules.used;
	runtime.rules.peak = runtime.rules.used;
	runtime.blocks.peak = runtime.blocks.used;
	runtime.profiles.peak = runtime.profiles.used;
	runtime.records.peak = runtime.records.used;
	runtime.workspace.peak = runtime.workspace.used;
	runtime.heap.peak = runtime.heap.used;
#if defined(CONFIG_SPAGHETTI_RESOURCES_STACK_STATS)
	runtime.stack_min_unused_bytes = runtime.stack_size_bytes;
#endif
	return 0;
}

int spaghetti_resources_get_snapshot(struct spaghetti_resources_snapshot *out)
{
	const struct spaghetti_image_manifest *manifest;

	if (out == NULL) {
		return -EINVAL;
	}
	if (!runtime.initialized) {
		return -EACCES;
	}

	manifest = spaghetti_image_manifest_get();
	if (manifest == NULL) {
		return -EACCES;
	}

	refresh_profile_used();

	memset(out, 0, sizeof(*out));
	out->flash_slot_bytes = manifest->flash_slot_bytes;
	out->flash_image_budget_bytes = manifest->flash_image_budget_bytes;
	out->flash_headroom_bytes = manifest->flash_headroom_bytes;
	out->static_ram_budget_bytes = manifest->static_ram_budget_bytes;
	out->declared_stack_bytes = manifest->declared_stack_bytes;
	out->declared_pool_bytes = manifest->declared_pool_bytes;
	out->declared_workspace_bytes = manifest->declared_workspace_bytes;
	memcpy(out->feature_set_hash, manifest->feature_set_hash,
	       sizeof(out->feature_set_hash));
	out->pack_count = manifest->pack_count;
	memcpy(out->packs, manifest->packs,
	       manifest->pack_count * sizeof(manifest->packs[0]));

	out->modules = runtime.modules;
	out->rules = runtime.rules;
	out->blocks = runtime.blocks;
	out->profiles = runtime.profiles;
	out->records = runtime.records;
	out->workspace = runtime.workspace;
	out->heap = runtime.heap;
#if defined(CONFIG_HEAP_MEM_POOL_SIZE) && (CONFIG_HEAP_MEM_POOL_SIZE > 0)
	out->heap_metrics_available = true;
#else
	out->heap_metrics_available = false;
#endif
#if defined(CONFIG_SPAGHETTI_RESOURCES_STACK_STATS)
	out->stack_metrics_available = true;
	out->stack_size_bytes = runtime.stack_size_bytes;
	out->stack_min_unused_bytes = runtime.stack_min_unused_bytes;
#else
	out->stack_metrics_available = false;
	out->stack_size_bytes = 0U;
	out->stack_min_unused_bytes = 0U;
#endif
	out->allocation_failures = runtime.allocation_failures;
	out->last_exhausted = runtime.last_exhausted;
	return 0;
}
