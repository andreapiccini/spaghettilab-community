/**
 * @file
 * @brief Public Module Driver contract for the Spaghetti firmware.
 * @ingroup spaghetti_module_driver
 */

#ifndef SPAGHETTI_MODULE_DRIVER_H
#define SPAGHETTI_MODULE_DRIVER_H

#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/iterable_sections.h>

#include <spaghetti/module.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/schema.h>

/** ABI version carried by every compiled Module driver descriptor. */
#define SPAGHETTI_MODULE_DRIVER_API_VERSION 2U

/** Iterable-section helper used by @ref SPAGHETTI_MODULE_DRIVER_DEFINE. */
#define SPAGHETTI_MODULE_DRIVER_ITER(name) \
	STRUCT_SECTION_ITERABLE(spaghetti_module_driver, name)

/**
 * @brief Declare one immutable driver descriptor in the Registry iterable section.
 *
 * Expand with `= { ... };` after the macro. Descriptors are linker-collected.
 *
 * @param name C identifier for the descriptor object.
 */
#define SPAGHETTI_MODULE_DRIVER_DEFINE(name) const SPAGHETTI_MODULE_DRIVER_ITER(name)

/** Pure callback that validates borrowed property config without hardware access. */
typedef int (*spaghetti_module_validate_config_cb_t)(
	const struct spaghetti_property_set *config);

/** Pure callback that writes one endpoint only after complete config validation. */
typedef int (*spaghetti_module_describe_endpoint_cb_t)(
	const struct spaghetti_property_set *config,
	struct spaghetti_module_endpoint *out);

/** Callback that initializes one provisional Module and owns any assigned context. */
typedef int (*spaghetti_module_init_cb_t)(
	struct spaghetti_module *module,
	const struct spaghetti_property_set *config);

/** Callback that writes one caller-owned record payload only on success. */
typedef int (*spaghetti_module_read_cb_t)(
	struct spaghetti_module *module,
	struct spaghetti_record_payload *out);

/** Callback that applies one borrowed generic command synchronously. */
typedef int (*spaghetti_module_command_cb_t)(
	struct spaghetti_module *module,
	const struct spaghetti_module_command *command);

/**
 * @brief Callback that receives one borrowed event payload from thread context.
 *
 * Drivers must never invoke this from ISR context.
 */
typedef int (*spaghetti_module_event_cb_t)(
	const struct spaghetti_record_payload *payload,
	void *user_data);

/** Optional callback that arms event emission until a matching stop. */
typedef int (*spaghetti_module_start_cb_t)(
	struct spaghetti_module *module,
	spaghetti_module_event_cb_t emit,
	void *emit_user_data);

/** Optional callback that prevents future event callbacks before returning. */
typedef int (*spaghetti_module_stop_cb_t)(struct spaghetti_module *module);

/** Callback that places one Module in safe state and releases its context. */
typedef int (*spaghetti_module_deinit_cb_t)(struct spaghetti_module *module);

/**
 * @brief Operations implemented by every concrete Module driver.
 *
 * Config and command pointers are borrowed only for the call. A driver copies any
 * data it retains into its own bounded context pool. Operations run in thread
 * context.
 */
struct spaghetti_module_driver_ops {
	spaghetti_module_validate_config_cb_t validate_config; /**< Pure config validation. */
	spaghetti_module_describe_endpoint_cb_t describe_endpoint; /**< Endpoint derivation. */
	spaghetti_module_init_cb_t init; /**< Context allocation and instance initialization. */
	spaghetti_module_read_cb_t read; /**< Bounded record acquisition; may be NULL. */
	spaghetti_module_command_cb_t command; /**< Bounded actuator command; may be NULL. */
	spaghetti_module_start_cb_t start; /**< Optional event arming; paired with stop. */
	spaghetti_module_stop_cb_t stop; /**< Optional event disarming; paired with start. */
	spaghetti_module_deinit_cb_t deinit; /**< Safe-state and context release. */
};

/**
 * @brief Immutable descriptor shared by every instance of one Module type.
 *
 * Descriptors, schemas, and string literals have firmware lifetime and belong to
 * the plug-in that defines them.
 */
struct spaghetti_module_driver {
	const char *type_id; /**< Firmware-lifetime, NUL-terminated stable type ID. */
	uint16_t api_version; /**< Must equal SPAGHETTI_MODULE_DRIVER_API_VERSION. */
	uint32_t required_capabilities; /**< Port bits, or 0 when a Device Profile decides. */
	enum spaghetti_port_transport transport; /**< Port mode acquired before init. */
	struct spaghetti_module_power_requirement power_requirement; /**< Copied admission needs. */
	const struct spaghetti_schema_descriptor *config_schema; /**< Required config schema. */
	/** Nullable with count 0. */
	const struct spaghetti_schema_descriptor *const *record_schemas;
	size_t record_schema_count; /**< Number of @ref record_schemas entries. */
	const struct spaghetti_command_descriptor *commands; /**< Nullable with count 0. */
	size_t command_count; /**< Number of @ref commands entries. */
	const struct spaghetti_module_driver_ops *ops; /**< Firmware-lifetime operations. */
};

#endif /* SPAGHETTI_MODULE_DRIVER_H */
