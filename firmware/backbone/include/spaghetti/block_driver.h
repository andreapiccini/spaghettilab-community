/**
 * @file
 * @brief Public Block Driver contract for declarative processing pipelines.
 * @ingroup spaghetti_block_driver
 *
 * Every compiled block driver exposes an immutable descriptor collected into an
 * iterable section by @ref SPAGHETTI_BLOCK_DRIVER_DEFINE. The Block Registry
 * enumerates only those descriptors; there is no central concrete-block list.
 *
 * Descriptor fields consumed by validation and the processing engine:
 * - @c type_id, @c api_version, @c algorithm_version
 * - @c config_schema
 * - input/output port descriptors (name/id and accepted value types)
 * - @c state_size, @c state_align, @c workspace_size
 * - @c max_cost_per_record and @c required_capabilities (may be zero)
 * - @c ops (@c validate, @c init, @c process, @c reset, @c deinit)
 *
 * @c process() receives copied input values and writes bounded outputs. It must
 * not perform hardware I/O or call Module Manager.
 */

#ifndef SPAGHETTI_BLOCK_DRIVER_H
#define SPAGHETTI_BLOCK_DRIVER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/iterable_sections.h>

#include <spaghetti/schema.h>

/** ABI version carried by every compiled block driver descriptor. */
#define SPAGHETTI_BLOCK_DRIVER_API_VERSION 1U

/** Maximum ports (inputs or outputs) declared by one block driver. */
#define SPAGHETTI_BLOCK_MAX_PORTS 8U

/** Maximum per-instance state bytes accepted by the processing engine. */
#define SPAGHETTI_BLOCK_STATE_MAX 256U

/** Maximum temporary workspace bytes accepted by the processing engine. */
#define SPAGHETTI_BLOCK_WORKSPACE_MAX 128U

/** Iterable-section helper used by @ref SPAGHETTI_BLOCK_DRIVER_DEFINE. */
#define SPAGHETTI_BLOCK_DRIVER_ITER(name) \
	STRUCT_SECTION_ITERABLE(spaghetti_block_driver, name)

/**
 * @brief Declare one immutable block driver descriptor in the Registry section.
 *
 * Expand with `= { ... };` after the macro. Descriptors are linker-collected.
 *
 * @param name C identifier for the descriptor object.
 */
#define SPAGHETTI_BLOCK_DRIVER_DEFINE(name) \
	const SPAGHETTI_BLOCK_DRIVER_ITER(name)

/** Bit for @ref spaghetti_block_port_descriptor.accepted_types. */
#define SPAGHETTI_BLOCK_TYPE_BOOL BIT(SPAGHETTI_VALUE_BOOL)
/** Bit for INT64 ports. */
#define SPAGHETTI_BLOCK_TYPE_INT64 BIT(SPAGHETTI_VALUE_INT64)
/** Bit for UINT64 ports. */
#define SPAGHETTI_BLOCK_TYPE_UINT64 BIT(SPAGHETTI_VALUE_UINT64)
/** Bit for TEXT ports. */
#define SPAGHETTI_BLOCK_TYPE_TEXT BIT(SPAGHETTI_VALUE_TEXT)
/** Bit for BYTES ports. */
#define SPAGHETTI_BLOCK_TYPE_BYTES BIT(SPAGHETTI_VALUE_BYTES)
/** Numeric INT64/UINT64 ports. */
#define SPAGHETTI_BLOCK_TYPE_NUMERIC \
	(SPAGHETTI_BLOCK_TYPE_INT64 | SPAGHETTI_BLOCK_TYPE_UINT64)

/**
 * @brief Firmware-lifetime description of one block input or output port.
 */
struct spaghetti_block_port_descriptor {
	uint16_t port_id; /**< Stable port identifier within the driver. */
	const char *name; /**< Stable machine name borrowed for firmware life. */
	uint32_t accepted_types; /**< Bitmask of @ref spaghetti_value_type. */
	bool required; /**< True when an input must be connected. */
};

/**
 * @brief Callback used by @ref spaghetti_block_driver_ops.process to publish.
 *
 * @param[in] record Borrowed derived record copied by the callback when retained.
 * @param[in,out] user_data Opaque processing/runtime context.
 *
 * @retval 0 The record was accepted.
 * @retval -errno The record was rejected.
 */
typedef int (*spaghetti_block_publish_cb_t)(
	const struct spaghetti_record *record,
	void *user_data);

/** Pure callback that validates borrowed block config without hardware access. */
typedef int (*spaghetti_block_validate_cb_t)(
	const struct spaghetti_property_set *config);

/**
 * @brief Allocate and initialize one block instance state.
 *
 * @param[in] config Borrowed properties valid only for this call.
 * @param[out] state Caller-provided aligned state buffer of @c state_size.
 *
 * @retval 0 State was initialized.
 * @retval -errno Validation or initialization failed.
 */
typedef int (*spaghetti_block_init_cb_t)(
	const struct spaghetti_property_set *config,
	void *state);

/**
 * @brief Process one evaluation with copied inputs and bounded outputs.
 *
 * @param[in,out] state Instance state previously created by init.
 * @param[in,out] workspace Temporary buffer of @c workspace_size, or NULL.
 * @param[in] inputs Copied input values indexed by port order.
 * @param[in] input_valid True when the corresponding input is present.
 * @param[in] input_count Number of input ports (matches descriptor).
 * @param[out] outputs Caller-owned output slots indexed by port order.
 * @param[out] output_valid Set true when the corresponding output is produced.
 * @param[in] output_count Number of output ports (matches descriptor).
 * @param[in] source_record Borrowed trigger record for provenance/publish.
 * @param[in] publish Optional publish callback for derived records.
 * @param[in,out] publish_user_data Opaque context for @p publish.
 *
 * @retval 0 Processing succeeded (outputs and/or publish may be empty).
 * @retval -ERANGE Overflow or out-of-range arithmetic.
 * @retval -EDOM Division by zero or undefined numeric domain.
 * @retval -errno Other block-defined failure.
 */
typedef int (*spaghetti_block_process_cb_t)(
	void *state,
	void *workspace,
	const struct spaghetti_value *inputs,
	const bool *input_valid,
	size_t input_count,
	struct spaghetti_value *outputs,
	bool *output_valid,
	size_t output_count,
	const struct spaghetti_record *source_record,
	spaghetti_block_publish_cb_t publish,
	void *publish_user_data);

/** Callback that clears temporal state without releasing the instance. */
typedef void (*spaghetti_block_reset_cb_t)(void *state);

/** Callback that releases resources held inside one instance state buffer. */
typedef void (*spaghetti_block_deinit_cb_t)(void *state);

/**
 * @brief Operations implemented by every concrete block driver.
 *
 * Config pointers are borrowed only for the call. Drivers copy retained data
 * into the provided state buffer. Operations run in thread context.
 */
struct spaghetti_block_driver_ops {
	spaghetti_block_validate_cb_t validate; /**< Pure config validation. */
	spaghetti_block_init_cb_t init; /**< State initialization. */
	spaghetti_block_process_cb_t process; /**< Per-record evaluation. */
	spaghetti_block_reset_cb_t reset; /**< Clear temporal state. */
	spaghetti_block_deinit_cb_t deinit; /**< Release retained resources. */
};

/**
 * @brief Immutable descriptor shared by every instance of one block type.
 *
 * Descriptors, schemas, ports, and string literals have firmware lifetime and
 * belong to the plug-in that defines them.
 */
struct spaghetti_block_driver {
	const char *type_id; /**< Firmware-lifetime NUL-terminated type ID. */
	uint16_t api_version; /**< Must equal SPAGHETTI_BLOCK_DRIVER_API_VERSION. */
	uint16_t algorithm_version; /**< Incompatible algorithm changes bump this. */
	const struct spaghetti_schema_descriptor *config_schema; /**< Required. */
	const struct spaghetti_block_port_descriptor *inputs; /**< Input ports. */
	size_t input_count; /**< Number of @ref inputs entries. */
	const struct spaghetti_block_port_descriptor *outputs; /**< Output ports. */
	size_t output_count; /**< Number of @ref outputs entries. */
	size_t state_size; /**< Bytes reserved per instance (<= STATE_MAX). */
	size_t state_align; /**< Alignment required for the state buffer. */
	size_t workspace_size; /**< Temporary bytes per evaluation (<= WORKSPACE_MAX). */
	uint32_t max_cost_per_record; /**< Abstract CPU cost units per evaluation. */
	uint32_t required_capabilities; /**< Capability bitmask; zero if none. */
	const struct spaghetti_block_driver_ops *ops; /**< Firmware-lifetime ops. */
};

#endif /* SPAGHETTI_BLOCK_DRIVER_H */
