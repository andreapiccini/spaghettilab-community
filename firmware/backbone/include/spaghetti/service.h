/**
 * @file
 * @brief Deterministic lifecycle owner for optional firmware services.
 * @ingroup spaghetti_services
 */

#ifndef SPAGHETTI_SERVICE_H
#define SPAGHETTI_SERVICE_H

#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

/** Stable production service IDs used by Connectivity Manager adapters. */
#define SPAGHETTI_SERVICE_ID_WIFI "wifi"
#define SPAGHETTI_SERVICE_ID_MQTT "mqtt"
#define SPAGHETTI_SERVICE_ID_OTA "ota"
#define SPAGHETTI_SERVICE_ID_REMOTE_CONSOLE "remote-console"

/** Generic lifecycle state independently of service-specific diagnostics. */
enum spaghetti_service_state {
	SPAGHETTI_SERVICE_STOPPED, /**< No optional runtime resource is owned. */
	SPAGHETTI_SERVICE_STARTING, /**< The start callback is executing. */
	SPAGHETTI_SERVICE_RUNNING, /**< The service owns its runtime resources. */
	SPAGHETTI_SERVICE_STOPPING, /**< The bounded stop callback is executing. */
	SPAGHETTI_SERVICE_DEGRADED, /**< A transition failed and cleanup is required. */
};

/** Firmware-lifetime operations implemented by one optional service adapter. */
struct spaghetti_service_ops {
	int (*start)(void); /**< Start all resources needed by the service. */
	int (*stop)(k_timeout_t timeout); /**< Stop and release every runtime resource. */
};

/** Firmware-lifetime registration record for one optional service. */
struct spaghetti_service_descriptor {
	const char *id; /**< Unique NUL-terminated firmware-lifetime ID. */
	uint32_t required_capabilities; /**< Build capabilities required to start. */
	const struct spaghetti_service_ops *ops; /**< Firmware-lifetime callbacks. */
};

/** Caller-owned optional-thread resource metrics. */
struct spaghetti_service_resource_snapshot {
	size_t active_threads; /**< Threads whose stack has not been returned. */
	size_t active_stack_bytes; /**< Requested bytes currently allocated. */
	size_t peak_threads; /**< Highest simultaneous optional-thread count. */
	size_t peak_stack_bytes; /**< Highest simultaneous requested stack bytes. */
	size_t peak_single_stack_used; /**< Highest measured usage of one joined stack. */
	uint32_t allocation_failures; /**< Rejected quota or allocator requests. */
};

/**
 * @brief Initialize the Manager with a fixed firmware-owned descriptor table.
 *
 * @param[in] descriptors Firmware-lifetime array retained by the Manager.
 * @param[in] descriptor_count Number of elements in @p descriptors.
 *
 * @retval 0 Every descriptor is registered in STOPPED state.
 * @retval -EINVAL A pointer, count, ID, or callback is invalid.
 * @retval -EEXIST Two descriptors use the same ID.
 * @retval -EALREADY The Manager was already initialized.
 * @retval -ENOSPC The table exceeds the build-time capacity.
 *
 * @note Call once from the Core boot thread before Connectivity Manager starts.
 */
int spaghetti_service_manager_init(
	const struct spaghetti_service_descriptor *descriptors,
	size_t descriptor_count);

/**
 * @brief Start one registered service atomically.
 *
 * @param[in] id Caller-owned ID borrowed only for lookup during this call.
 *
 * @retval 0 The callback completed and the service is RUNNING.
 * @retval -EINVAL @p id is NULL or not a bounded NUL-terminated string.
 * @retval -EACCES The Manager is not initialized.
 * @retval -ENOENT No descriptor has @p id.
 * @retval -ENOTSUP Required build capabilities are unavailable.
 * @retval -EALREADY The service is RUNNING or already transitioning.
 * @retval -EIO The service is DEGRADED and requires a stop cleanup attempt.
 * @return A negative service callback error; state becomes DEGRADED.
 *
 * @note Call from thread context. Connectivity Manager is the production caller.
 */
int spaghetti_service_start(const char *id);

/**
 * @brief Stop one service and wait for complete resource cleanup.
 *
 * @param[in] id Caller-owned ID borrowed only for lookup during this call.
 * @param[in] timeout Finite cleanup deadline copied by value; K_FOREVER is invalid.
 *
 * @retval 0 Socket, callback, work, subscriber, thread, and stack are released.
 * @retval -EINVAL An argument is invalid.
 * @retval -EACCES The Manager is not initialized.
 * @retval -ENOENT No descriptor has @p id.
 * @retval -EALREADY The service is already STOPPED or transitioning.
 * @return A negative service callback error; state becomes DEGRADED.
 *
 * @note A DEGRADED service may call stop again to retry cleanup.
 */
int spaghetti_service_stop(const char *id, k_timeout_t timeout);

/**
 * @brief Copy the generic lifecycle state of one registered service.
 *
 * @param[in] id Caller-owned ID borrowed only for lookup during this call.
 * @param[out] out Caller-owned state destination written only on success.
 *
 * @retval 0 @p out contains a coherent state.
 * @retval -EINVAL An argument is invalid.
 * @retval -EACCES The Manager is not initialized.
 * @retval -ENOENT No descriptor has @p id.
 */
int spaghetti_service_get_state(
	const char *id, enum spaghetti_service_state *out);

/**
 * @brief Copy dynamic optional-thread allocation metrics.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains coherent current and high-water values.
 * @retval -EINVAL @p out is NULL.
 */
int spaghetti_service_get_resource_snapshot(
	struct spaghetti_service_resource_snapshot *out);

#endif /* SPAGHETTI_SERVICE_H */
