/**
 * @file
 * @brief Public Module Manager contract for the Spaghetti firmware.
 * @ingroup spaghetti_module_manager
 */

#ifndef SPAGHETTI_MODULE_MANAGER_H
#define SPAGHETTI_MODULE_MANAGER_H

#include <stddef.h>
#include <stdint.h>

#include <spaghetti/module.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/schema.h>
#include <spaghetti/topology.h>

/**
 * @brief Runtime placement of one Module along a Flow and power rail.
 *
 * Flow is derived from the selected Port. Either ID may be UNSPECIFIED. A
 * declared rail also requires a declared Bay.
 */
struct spaghetti_module_placement {
	spaghetti_bay_id_t bay_id; /**< Bay ordinal, or UNSPECIFIED. */
	spaghetti_power_rail_id_t power_rail_id; /**< Rail ID, or UNSPECIFIED. */
};

/**
 * @brief Complete borrowed request used to create one Module.
 *
 * The Manager does not retain @ref type_id or @ref config. The concrete driver
 * copies any configuration it needs before configure returns.
 */
struct spaghetti_module_request {
	spaghetti_module_key_t key; /**< Nonzero stable Config identity. */
	spaghetti_port_id_t port_id; /**< Shared physical Port identifier. */
	const char *type_id; /**< Borrowed NUL-terminated driver type identifier. */
	const struct spaghetti_property_set *config; /**< Borrowed typed driver config. */
	struct spaghetti_module_placement placement; /**< Flow-relative Bay and rail. */
	uint32_t revision; /**< Nonzero desired-state revision for stale-operation checks. */
};

/**
 * @brief Caller-owned copy of one live Module's public state.
 */
struct spaghetti_module_snapshot {
	spaghetti_module_id_t id; /**< Ephemeral ID of the current live instance. */
	spaghetti_module_key_t key; /**< Stable Config identity. */
	spaghetti_port_id_t port_id; /**< Shared Port used by this instance. */
	spaghetti_flow_id_t flow_id; /**< Flow terminating on @ref port_id, when known. */
	struct spaghetti_module_placement placement; /**< Committed Bay and rail selection. */
	enum spaghetti_power_admission_state power_admission; /**< Power admission outcome. */
	char type_id[SPAGHETTI_TYPE_ID_MAX]; /**< Owned NUL-terminated driver type ID. */
	struct spaghetti_module_endpoint endpoint; /**< Normalized hardware endpoint. */
	enum spaghetti_module_state state; /**< Public lifecycle state at copy time. */
	uint32_t revision; /**< Config revision committed with this instance. */
};

/**
 * @brief Initialize an empty Module Manager.
 *
 * @retval 0 Initialization completed successfully.
 * @retval -EALREADY The Manager was already initialized.
 */
int spaghetti_module_manager_init(void);

/**
 * @brief Create one Module from a complete runtime request.
 *
 * Acquires Port then Power before driver init. Publishes placement and admission
 * in the snapshot only after a successful commit.
 *
 * @param[in] request Caller-owned request borrowed for this call.
 * @param[out] out_id Caller-owned destination written only after successful init.
 *
 * @retval 0 The Module is READY and @p out_id contains its runtime ID.
 * @retval -EINVAL A pointer, key, revision, placement, or endpoint is invalid.
 * @retval -ENOENT The Port, Flow, Bay, rail, or driver type does not exist.
 * @retval -EEXIST The stable key already exists.
 * @retval -EADDRINUSE The normalized endpoint conflicts on the selected Port.
 * @retval -ENOTSUP The Port lacks a required capability or Power is unavailable.
 * @retval -ENOSPC The Manager slot pool is full.
 * @retval -ENOMEM The concrete driver's bounded context pool is full.
 * @retval -ENODEV A required hardware device is unavailable.
 * @retval -EBUSY The selected key or endpoint is being configured or removed.
 * @retval -ERANGE A derived driver or Power value cannot be represented safely.
 * @retval -EIO A bounded initialization bus transfer failed.
 * @retval -ETIMEDOUT A bounded initialization bus transfer timed out.
 */
int spaghetti_module_manager_configure(
	const struct spaghetti_module_request *request,
	spaghetti_module_id_t *out_id);

/**
 * @brief Remove one exact live Module.
 *
 * Calls stop before deinit when events were started. Releases Power then Port.
 * If stop fails, the Module is marked ERROR and its context is retained.
 *
 * @param[in] id Ephemeral ID of the live Module to remove.
 * @param[in] expected_revision Nonzero revision that must match the live snapshot.
 *
 * @retval 0 The Module was deinitialized and removed.
 * @retval -EINVAL @p expected_revision is zero.
 * @retval -ENOENT @p id does not identify a live Module.
 * @retval -ESTALE The revision does not match.
 * @retval -EBUSY The Module is executing another driver operation.
 * @retval Negative errno from stop, deinit, or resource release.
 */
int spaghetti_module_manager_remove(spaghetti_module_id_t id,
				    uint32_t expected_revision);

/**
 * @brief Copy a Module snapshot selected by runtime ID.
 *
 * @param[in] id Ephemeral ID to find.
 * @param[out] out Caller-owned snapshot written only on success.
 *
 * @retval 0 The snapshot was copied.
 * @retval -EINVAL @p out is NULL.
 * @retval -ENOENT @p id does not identify a live Module.
 */
int spaghetti_module_manager_get_by_id(
	spaghetti_module_id_t id,
	struct spaghetti_module_snapshot *out);

/**
 * @brief Copy a Module snapshot selected by stable key.
 *
 * @param[in] key Nonzero Config-owned key to find.
 * @param[out] out Caller-owned snapshot written only on success.
 *
 * @retval 0 The snapshot was copied.
 * @retval -EINVAL @p key is zero or @p out is NULL.
 * @retval -ENOENT No live Module has @p key.
 */
int spaghetti_module_manager_get_by_key(
	spaghetti_module_key_t key,
	struct spaghetti_module_snapshot *out);

/**
 * @brief List every live Module that references one Port.
 *
 * @param[in] port_id Physical Port whose references are counted.
 * @param[out] out Caller-owned array of @p capacity snapshots, or NULL for count-only.
 * @param[in] capacity Number of elements available at @p out; zero for count-only.
 * @param[out] out_count Caller-owned required/actual count destination.
 *
 * @retval 0 All matching snapshots were copied, or count-only query succeeded.
 * @retval -EINVAL Pointer and capacity arguments are inconsistent.
 * @retval -ENOENT @p port_id does not identify an available Port.
 * @retval -ENOSPC @p capacity is too small; @p out_count contains required capacity.
 */
int spaghetti_module_manager_list_by_port(
	spaghetti_port_id_t port_id,
	struct spaghetti_module_snapshot *out,
	size_t capacity,
	size_t *out_count);

/**
 * @brief Read one typed record from a live READY Module.
 *
 * @param[in] id Ephemeral ID of the Module to read.
 * @param[out] out Caller-owned record written only after a complete successful read.
 *
 * @retval 0 The complete record was copied to @p out.
 * @retval -EINVAL @p out is NULL.
 * @retval -ENOENT @p id does not identify a live Module.
 * @retval -EBUSY The Module is executing another driver operation.
 * @retval -ENOTSUP The driver has no read operation.
 * @retval -EPROTONOSUPPORT The payload schema is not declared by the driver.
 * @retval -EIO A driver or bus operation failed.
 * @retval -ETIMEDOUT The driver's bounded acquisition timed out.
 * @retval -ERANGE The hardware reported overflow or a result cannot be represented.
 */
int spaghetti_module_manager_read(
	spaghetti_module_id_t id,
	struct spaghetti_record *out);

/**
 * @brief Apply one generic command to a live READY Module.
 *
 * @param[in] id Ephemeral ID of the Module to command.
 * @param[in] command Caller-owned command borrowed only for this synchronous call.
 *
 * @retval 0 The concrete driver applied the requested state.
 * @retval -EINVAL @p command is NULL.
 * @retval -ENOENT @p id does not identify a live Module.
 * @retval -EBUSY The Module is executing another driver operation.
 * @retval -ENOTSUP The command ID or driver operation is unsupported.
 * @retval -ENODEV Required output hardware is unavailable.
 * @retval -EIO The concrete output operation failed.
 */
int spaghetti_module_manager_command(
	spaghetti_module_id_t id,
	const struct spaghetti_module_command *command);

/**
 * @brief Arm optional driver event emission for one Module.
 *
 * @param[in] id Ephemeral ID of the Module.
 * @param[in] emit Borrowed callback invoked from thread/workqueue context only.
 * @param[in] emit_user_data Borrowed user data retained until stop.
 *
 * @retval 0 Events are armed.
 * @retval -EINVAL @p emit is NULL.
 * @retval -ENOENT @p id does not identify a live Module.
 * @retval -EBUSY The Module is executing another driver operation.
 * @retval -ENOTSUP The driver has no start/stop pair.
 * @retval -EALREADY Events are already armed.
 */
int spaghetti_module_manager_start_events(
	spaghetti_module_id_t id,
	spaghetti_module_event_cb_t emit,
	void *emit_user_data);

/**
 * @brief Disarm optional driver event emission for one Module.
 *
 * @param[in] id Ephemeral ID of the Module.
 *
 * @retval 0 Future callbacks are prevented.
 * @retval -ENOENT @p id does not identify a live Module.
 * @retval -EBUSY The Module is executing another driver operation.
 * @retval -ENOTSUP The driver has no start/stop pair.
 * @retval -EALREADY Events were not armed.
 */
int spaghetti_module_manager_stop_events(spaghetti_module_id_t id);

#endif /* SPAGHETTI_MODULE_MANAGER_H */
