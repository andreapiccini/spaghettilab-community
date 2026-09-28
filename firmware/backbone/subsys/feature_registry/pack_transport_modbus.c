#include <spaghetti/feature_pack.h>

#include <spaghetti/config.h>

#include <zephyr/sys/util.h>

#if defined(CONFIG_SPAGHETTI_PACK_MODBUS)

/*
 * Stub transport pack. Declares the capability surface for differential builds
 * and host catalog tests; no Modbus transport implementation is linked yet.
 */
static const char *const transport_modbus_deps[] = {
	"core-basic",
};

SPAGHETTI_FEATURE_PACK_DEFINE(spaghetti_pack_transport_modbus) = {
	.id = "transport-modbus",
	.version = "0.1.0",
	.deps = transport_modbus_deps,
	.dep_count = ARRAY_SIZE(transport_modbus_deps),
	.conflicts = NULL,
	.conflict_count = 0U,
	.required_hw_caps = 0U,
	.module_types = NULL,
	.module_type_count = 0U,
	.rule_types = NULL,
	.rule_type_count = 0U,
	.block_types = NULL,
	.block_type_count = 0U,
	.min_protocol_version = 1U,
	.min_config_version = SPAGHETTI_CONFIG_VERSION,
	.abi_version = SPAGHETTI_FEATURE_PACK_ABI_VERSION,
};

#endif /* CONFIG_SPAGHETTI_PACK_MODBUS */
