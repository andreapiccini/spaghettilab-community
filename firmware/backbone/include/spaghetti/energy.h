/**
 * @file
 * @brief Low-energy radio availability and power-policy orchestration.
 * @ingroup spaghetti_energy
 */

#ifndef SPAGHETTI_ENERGY_H
#define SPAGHETTI_ENERGY_H

#include <stdint.h>

#include <spaghetti/connectivity.h>

/** BLE radio availability selected by the product policy. */
enum spaghetti_ble_availability {
	SPAGHETTI_BLE_OFF, /**< BLE radio remains stopped. */
	SPAGHETTI_BLE_ADVERTISING, /**< BLE radio stays available continuously. */
	SPAGHETTI_BLE_WINDOWED, /**< BLE opens bounded advertising windows. */
};

/** Caller-owned BLE timing policy copied during initialization. */
struct spaghetti_energy_policy {
	enum spaghetti_ble_availability ble_availability; /**< BLE mode. */
	uint32_t advertising_window_ms; /**< Active window length in milliseconds. */
	uint32_t advertising_period_ms; /**< Window cadence in milliseconds. */
};

/**
 * @brief Initialize the energy-policy owner and copy the BLE policy.
 *
 * @param[in] policy Borrowed policy copied on success. @p advertising_window_ms
 *                   must be less than @p advertising_period_ms when
 *                   @p ble_availability is @ref SPAGHETTI_BLE_WINDOWED.
 *
 * @retval 0 The policy is retained and metrics are reset.
 * @retval -EINVAL @p policy is NULL or contains an invalid field.
 * @retval -EALREADY The component was already initialized.
 *
 * @note Call once from the Core main thread before applying connectivity.
 */
int spaghetti_energy_init(const struct spaghetti_energy_policy *policy);

/**
 * @brief Apply connectivity policy effects on radios, TLS, and optional PM.
 *
 * In @ref SPAGHETTI_CONNECTIVITY_LOW_ENERGY, IP services are stopped, the secure
 * workspace must be unowned, Runtime is not stopped, and BLE follows the copied
 * policy. In @ref SPAGHETTI_CONNECTIVITY_ONLINE, system sleep is not forced
 * while Connectivity reports an active lease.
 *
 * @param[in] connectivity Connectivity policy copied by value.
 *
 * @retval 0 The requested policy and derived radio state are active.
 * @retval -EINVAL @p connectivity is not a defined policy.
 * @retval -EACCES The component is not initialized or Connectivity is not ready.
 * @retval -EBUSY The secure workspace is still owned during LOW_ENERGY.
 * @return A negative Connectivity or backend error; prior state is retained.
 *
 * @note Call from thread context. This function may block for bounded service
 *       stop deadlines owned by Connectivity.
 */
int spaghetti_energy_apply_connectivity(
	enum spaghetti_connectivity_policy connectivity);

/**
 * @brief Open one immediate BLE window for a local wake event.
 *
 * @retval 0 A window was opened or BLE is already continuously available.
 * @retval -EACCES The component is not initialized.
 * @retval -ENOTSUP The copied policy is not @ref SPAGHETTI_BLE_WINDOWED.
 * @retval -EALREADY A window is already active.
 *
 * @note Call from thread context. Runtime sampling is unaffected.
 */
int spaghetti_energy_notify_local_event(void);

#endif /* SPAGHETTI_ENERGY_H */
