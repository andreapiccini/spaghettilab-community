#include <spaghetti/feature_pack.h>

#include <spaghetti/config.h>

#include <zephyr/sys/util.h>

#if defined(CONFIG_SPAGHETTI_PACK_PROCESSING_KALMAN)

static const char *const processing_kalman_deps[] = {
	"processing-basic",
};

static const char *const processing_kalman_blocks[] = {
	"kalman",
};

SPAGHETTI_FEATURE_PACK_DEFINE(spaghetti_pack_processing_kalman) = {
	.id = "processing-kalman",
	.version = "1.0.0",
	.deps = processing_kalman_deps,
	.dep_count = ARRAY_SIZE(processing_kalman_deps),
	.conflicts = NULL,
	.conflict_count = 0U,
	.required_hw_caps = 0U,
	.module_types = NULL,
	.module_type_count = 0U,
	.rule_types = NULL,
	.rule_type_count = 0U,
	.block_types = processing_kalman_blocks,
	.block_type_count = ARRAY_SIZE(processing_kalman_blocks),
	.min_protocol_version = 1U,
	.min_config_version = SPAGHETTI_CONFIG_VERSION,
	.abi_version = SPAGHETTI_FEATURE_PACK_ABI_VERSION,
};

#endif /* CONFIG_SPAGHETTI_PACK_PROCESSING_KALMAN */
