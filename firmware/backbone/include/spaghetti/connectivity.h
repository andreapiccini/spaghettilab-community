/**
 * @file
 * @brief Connectivity policy and temporary service-lease API.
 * @ingroup spaghetti_connectivity
 */

#ifndef SPAGHETTI_CONNECTIVITY_H
#define SPAGHETTI_CONNECTIVITY_H

#include <stdint.h>

#include <zephyr/sys/util.h>

/**
 * Persistent policy used to derive the normal connectivity services.
 *
 * ESP32-C3 shares one 2.4 GHz radio: BLE and Wi-Fi never run together.
 * `LOW_ENERGY` is BLE (when compiled). `ONLINE` is Wi-Fi and MQTT (when
 * compiled). A lease for the other radio switches, it does not OR.
 */
enum spaghetti_connectivity_policy {
	SPAGHETTI_CONNECTIVITY_LOW_ENERGY, /**< BLE only when compiled. */
	SPAGHETTI_CONNECTIVITY_ONLINE, /**< Wi-Fi and MQTT when compiled. */
};

/** Independently controlled connectivity services. */
enum spaghetti_connectivity_service {
	SPAGHETTI_CONNECTIVITY_SERVICE_BLE = BIT(0), /**< Bluetooth LE service. */
	SPAGHETTI_CONNECTIVITY_SERVICE_WIFI = BIT(1), /**< Wi-Fi station service. */
	SPAGHETTI_CONNECTIVITY_SERVICE_MQTT = BIT(2), /**< MQTT client service. */
	SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE = BIT(3), /**< TLS console. */
};

/** Caller-owned request copied when a temporary lease is accepted. */
struct spaghetti_connectivity_lease_request {
	uint32_t services; /**< Service bits required for the lease. */
	uint32_t duration_ms; /**< Lease lifetime from current uptime. */
};

/** Caller-owned snapshot of current connectivity policy and service state. */
struct spaghetti_connectivity_snapshot {
	enum spaghetti_connectivity_policy policy; /**< Persistent policy. */
	uint32_t active_services; /**< Services whose backends are started. */
	uint32_t leased_services; /**< Services requested by the active lease. */
	int64_t lease_expires_at_ms; /**< Absolute uptime deadline, or zero. */
	int last_error; /**< Last transition error, or zero. */
};

/**
 * @brief Initialize the single connectivity-policy owner.
 *
 * @param[in] boot_policy Build-time policy copied by value.
 *
 * @retval 0 The Manager is initialized and the policy is active.
 * @retval -EINVAL @p boot_policy is not a defined policy.
 * @retval -EALREADY The Manager was already initialized.
 * @return A negative backend error when the initial transition fails.
 *
 * @note Call once from the Core main thread during boot.
 */
int spaghetti_connectivity_init(
	enum spaghetti_connectivity_policy boot_policy);

/**
 * @brief Change the persistent connectivity policy atomically.
 *
 * @param[in] policy New policy copied by value and retained on success.
 *
 * @retval 0 The new policy and its service state are active.
 * @retval -EINVAL @p policy is not a defined policy.
 * @retval -EACCES The Manager is not initialized.
 * @return A negative backend error; the previous policy is retained.
 */
int spaghetti_connectivity_set_policy(
	enum spaghetti_connectivity_policy policy);

/**
 * @brief Acquire one bounded temporary service lease.
 *
 * @param[in] request Borrowed request copied before this call returns.
 *
 * @retval 0 The services are active until the recorded uptime deadline.
 * @retval -EINVAL The pointer, mask, or duration is invalid.
 * @retval -EACCES The Manager is not initialized.
 * @retval -EBUSY Another lease is active.
 * @retval -ENOTSUP A requested service has no compiled capability.
 * @return A negative backend error; no lease is retained.
 */
int spaghetti_connectivity_acquire_lease(
	const struct spaghetti_connectivity_lease_request *request);

/**
 * @brief Release the active lease and restore the persistent policy.
 *
 * @retval 0 The lease is cleared and policy services are restored.
 * @retval -EACCES The Manager is not initialized.
 * @retval -ENOENT No lease is active.
 * @return A negative backend error; the existing lease is retained.
 */
int spaghetti_connectivity_release_lease(void);

/**
 * @brief Copy a coherent connectivity snapshot.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains the complete current snapshot.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES The Manager is not initialized.
 */
int spaghetti_connectivity_get_snapshot(
	struct spaghetti_connectivity_snapshot *out);

#endif /* SPAGHETTI_CONNECTIVITY_H */
