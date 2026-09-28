#include <spaghetti/feature_pack.h>

#include <spaghetti/config.h>

#include <zephyr/sys/util.h>

#if defined(CONFIG_SPAGHETTI_PACK_DEVICE_PROFILE)

static const char *const device_profile_deps[] = {
	"core-basic",
};

static const char *const device_profile_modules[] = {
	"declarative-device",
};

SPAGHETTI_FEATURE_PACK_DEFINE(spaghetti_pack_device_profile_engine) = {
	.id = "device-profile-engine",
	.version = "1.0.0",
	.deps = device_profile_deps,
	.dep_count = ARRAY_SIZE(device_profile_deps),
	.conflicts = NULL,
	.conflict_count = 0U,
	.required_hw_caps = 0U,
	.module_types = device_profile_modules,
	.module_type_count = ARRAY_SIZE(device_profile_modules),
	.rule_types = NULL,
	.rule_type_count = 0U,
	.block_types = NULL,
	.block_type_count = 0U,
	.min_protocol_version = 1U,
	.min_config_version = SPAGHETTI_CONFIG_VERSION,
	.abi_version = SPAGHETTI_FEATURE_PACK_ABI_VERSION,
};

#endif /* CONFIG_SPAGHETTI_PACK_DEVICE_PROFILE */
