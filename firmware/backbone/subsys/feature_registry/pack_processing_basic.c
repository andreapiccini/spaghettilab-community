#include <spaghetti/feature_pack.h>

#include <spaghetti/config.h>

#include <zephyr/sys/util.h>

#if defined(CONFIG_SPAGHETTI_PACK_PROCESSING_BASIC)

static const char *const processing_basic_deps[] = {
	"core-basic",
};

static const char *const processing_basic_blocks[] = {
	"scale_offset",
	"clamp",
	"map_range",
	"add",
	"subtract",
	"multiply",
	"divide",
	"mask_shift",
	"combine_fields",
	"select",
	"moving_average",
	"low_pass",
	"median",
	"threshold",
	"hysteresis",
	"debounce",
	"lookup_table",
	"polynomial",
	"unit_convert",
	"publish_field",
};

SPAGHETTI_FEATURE_PACK_DEFINE(spaghetti_pack_processing_basic) = {
	.id = "processing-basic",
	.version = "1.0.0",
	.deps = processing_basic_deps,
	.dep_count = ARRAY_SIZE(processing_basic_deps),
	.conflicts = NULL,
	.conflict_count = 0U,
	.required_hw_caps = 0U,
	.module_types = NULL,
	.module_type_count = 0U,
	.rule_types = NULL,
	.rule_type_count = 0U,
	.block_types = processing_basic_blocks,
	.block_type_count = ARRAY_SIZE(processing_basic_blocks),
	.min_protocol_version = 1U,
	.min_config_version = SPAGHETTI_CONFIG_VERSION,
	.abi_version = SPAGHETTI_FEATURE_PACK_ABI_VERSION,
};

#endif /* CONFIG_SPAGHETTI_PACK_PROCESSING_BASIC */
