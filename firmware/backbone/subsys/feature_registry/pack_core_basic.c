#include <spaghetti/feature_pack.h>

#include <spaghetti/config.h>

#include <zephyr/sys/util.h>

static const char *const core_basic_modules[] = {
	"ina219",
	"relay",
};

static const char *const core_basic_rules[] = {
	"threshold",
};

SPAGHETTI_FEATURE_PACK_DEFINE(spaghetti_pack_core_basic) = {
	.id = "core-basic",
	.version = "1.0.0",
	.deps = NULL,
	.dep_count = 0U,
	.conflicts = NULL,
	.conflict_count = 0U,
	.required_hw_caps = 0U,
	.module_types = core_basic_modules,
	.module_type_count = ARRAY_SIZE(core_basic_modules),
	.rule_types = core_basic_rules,
	.rule_type_count = ARRAY_SIZE(core_basic_rules),
	.block_types = NULL,
	.block_type_count = 0U,
	.min_protocol_version = 1U,
	.min_config_version = SPAGHETTI_CONFIG_VERSION,
	.abi_version = SPAGHETTI_FEATURE_PACK_ABI_VERSION,
};
