/**
 * @file
 * @brief Admission control and usage metrics for heavy secure sessions.
 * @ingroup spaghetti_secure_workspace
 */

#ifndef SPAGHETTI_SECURE_WORKSPACE_H
#define SPAGHETTI_SECURE_WORKSPACE_H

#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

/** Service that currently owns the shared secure-session budget. */
enum spaghetti_secure_workspace_owner {
	SPAGHETTI_SECURE_OWNER_NONE, /**< No heavy secure session is admitted. */
	SPAGHETTI_SECURE_OWNER_MQTT, /**< MQTT TLS client. */
	SPAGHETTI_SECURE_OWNER_WIFI_OTA, /**< Wi-Fi OTA DTLS server. */
	SPAGHETTI_SECURE_OWNER_REMOTE_CONSOLE, /**< Remote TLS console. */
};

/** Caller-owned snapshot of shared secure-session resource usage. */
struct spaghetti_secure_workspace_snapshot {
	enum spaghetti_secure_workspace_owner owner; /**< Current owner. */
	size_t capacity; /**< Profile budget in bytes. */
	size_t peak_used; /**< Highest observed allocator delta in bytes. */
	uint32_t allocation_failures; /**< Failed admission attempts. */
};

/**
 * @brief Initialize secure-session admission and allocator metrics.
 *
 * @retval 0 The workspace is ready and unowned.
 * @retval -EALREADY The workspace was already initialized.
 * @return A negative allocator-statistics error when metrics are unavailable.
 *
 * @note Call once from the Core main thread before secure services initialize.
 */
int spaghetti_secure_workspace_init(void);

/**
 * @brief Acquire exclusive admission for one heavy secure session.
 *
 * @param[in] owner Non-NONE service owner copied by value.
 * @param[in] timeout Bounded wait copied by value; K_FOREVER is rejected.
 *
 * @retval 0 The caller owns the workspace until matching release.
 * @retval -EINVAL @p owner or @p timeout is invalid.
 * @retval -EACCES The workspace is not initialized.
 * @retval -EWOULDBLOCK The call was made from ISR context.
 * @retval -EAGAIN The bounded wait expired.
 * @retval -ENOMEM The allocator has less free memory than the profile budget.
 * @return A negative allocator-statistics error when metrics are unavailable.
 *
 * @note Call only from thread context. The API grants admission, not memory.
 */
int spaghetti_secure_workspace_acquire(
	enum spaghetti_secure_workspace_owner owner, k_timeout_t timeout);

/**
 * @brief Release admission held by the same secure service.
 *
 * @param[in] owner Expected owner copied by value.
 *
 * @retval 0 The workspace is unowned and usage metrics were updated.
 * @retval -EINVAL @p owner is NONE or unknown.
 * @retval -EACCES The workspace is not initialized.
 * @retval -EWOULDBLOCK The call was made from ISR context.
 * @retval -ENOENT No owner currently holds the workspace.
 * @retval -EPERM A different owner holds the workspace.
 * @return A negative allocator-statistics error; ownership is still released.
 */
int spaghetti_secure_workspace_release(
	enum spaghetti_secure_workspace_owner owner);

/**
 * @brief Copy secure-workspace admission and high-water state.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains a coherent snapshot.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES The workspace is not initialized.
 */
int spaghetti_secure_workspace_get_snapshot(
	struct spaghetti_secure_workspace_snapshot *out);

#endif /* SPAGHETTI_SECURE_WORKSPACE_H */
