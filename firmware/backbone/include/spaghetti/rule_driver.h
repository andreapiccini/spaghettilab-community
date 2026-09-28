/**
 * @file
 * @brief Public Rule Driver contract for the Spaghetti firmware.
 * @ingroup spaghetti_rule_driver
 */

#ifndef SPAGHETTI_RULE_DRIVER_H
#define SPAGHETTI_RULE_DRIVER_H

#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/iterable_sections.h>

#include <spaghetti/module.h>
#include <spaghetti/schema.h>

/** ABI version carried by every compiled rule driver descriptor. */
#define SPAGHETTI_RULE_DRIVER_API_VERSION 1U

/** Iterable-section helper used by @ref SPAGHETTI_RULE_DRIVER_DEFINE. */
#define SPAGHETTI_RULE_DRIVER_ITER(name) \
	STRUCT_SECTION_ITERABLE(spaghetti_rule_driver, name)

/**
 * @brief Declare one immutable rule driver descriptor in the Registry section.
 *
 * Expand with `= { ... };` after the macro. Descriptors are linker-collected.
 *
 * @param name C identifier for the descriptor object.
 */
#define SPAGHETTI_RULE_DRIVER_DEFINE(name) const SPAGHETTI_RULE_DRIVER_ITER(name)

/**
 * @brief Copied action emitted by a rule for Runtime to apply.
 */
struct spaghetti_rule_action {
	spaghetti_module_key_t target_key; /**< Stable target Module key. */
	struct spaghetti_module_command command; /**< Owned command payload. */
};

/**
 * @brief Callback used by @ref spaghetti_rule_driver_ops.on_record to emit actions.
 *
 * @param[in] action Borrowed action copied by the callback when retained.
 * @param[in,out] user_data Opaque Runtime context.
 *
 * @retval 0 The action was accepted.
 * @retval -errno The action was rejected.
 */
typedef int (*spaghetti_rule_emit_action_cb_t)(
	const struct spaghetti_rule_action *action,
	void *user_data);

/** Pure callback that validates borrowed rule config without hardware access. */
typedef int (*spaghetti_rule_validate_config_cb_t)(
	const struct spaghetti_property_set *config);

/** Callback that allocates rule context and writes @p out_context only on success. */
typedef int (*spaghetti_rule_init_cb_t)(
	const struct spaghetti_property_set *config,
	void **out_context);

/** Callback that evaluates one borrowed record and may emit copied actions. */
typedef int (*spaghetti_rule_on_record_cb_t)(
	void *context,
	const struct spaghetti_record *record,
	spaghetti_rule_emit_action_cb_t emit,
	void *emit_user_data);

/** Callback that releases one rule context previously created by init. */
typedef int (*spaghetti_rule_deinit_cb_t)(void *context);

/**
 * @brief Operations implemented by every concrete rule driver.
 *
 * Config pointers are borrowed only for the call. A driver copies any data it
 * retains into its own bounded context pool. Operations run in thread context.
 */
struct spaghetti_rule_driver_ops {
	spaghetti_rule_validate_config_cb_t validate_config; /**< Pure config validation. */
	spaghetti_rule_init_cb_t init; /**< Context allocation. */
	spaghetti_rule_on_record_cb_t on_record; /**< Record-driven action emission. */
	spaghetti_rule_deinit_cb_t deinit; /**< Context release. */
};

/**
 * @brief Immutable descriptor shared by every instance of one rule type.
 *
 * Descriptors, schemas, and string literals have firmware lifetime and belong to
 * the plug-in that defines them.
 */
struct spaghetti_rule_driver {
	const char *type_id; /**< Firmware-lifetime, NUL-terminated stable type ID. */
	uint16_t api_version; /**< Must equal SPAGHETTI_RULE_DRIVER_API_VERSION. */
	const struct spaghetti_schema_descriptor *config_schema; /**< Required schema. */
	const struct spaghetti_rule_driver_ops *ops; /**< Firmware-lifetime operations. */
};

#endif /* SPAGHETTI_RULE_DRIVER_H */
