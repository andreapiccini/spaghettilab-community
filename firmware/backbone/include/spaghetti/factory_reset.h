/**
 * @file
 * @brief Authorized scoped factory-reset contract.
 * @ingroup spaghetti_factory_reset
 */

#ifndef SPAGHETTI_FACTORY_RESET_H
#define SPAGHETTI_FACTORY_RESET_H

#include <stdbool.h>
#include <stdint.h>

#include <zephyr/sys/util.h>

#include <spaghetti/access_control.h>

/** Bitmask scopes selecting which namespaces a factory reset may delete. */
enum spaghetti_reset_scope {
	SPAGHETTI_RESET_CONFIG = BIT(0), /**< Persistent Config Settings record. */
	SPAGHETTI_RESET_NETWORK = BIT(1), /**< Wi-Fi profiles and preferred SSID. */
	SPAGHETTI_RESET_CREDENTIALS = BIT(2), /**< OTA, MQTT, and remote-console secrets. */
	SPAGHETTI_RESET_BLE_BONDS = BIT(3), /**< BLE bonds and app credentials. */
	SPAGHETTI_RESET_ALL = 0x0f, /**< Every defined reset scope. */
};

/** Caller-owned status from the latest factory-reset attempt. */
struct spaghetti_factory_reset_status {
	uint32_t requested_scope; /**< Scope bitmask accepted for the attempt. */
	uint32_t failed_scopes; /**< Subset of scopes that failed deletion. */
	bool reboot_requested; /**< True when a successful reset requested reboot. */
	bool maintenance_forced; /**< True when partial failure entered Maintenance. */
};

/**
 * @brief Select the acting principal used when Maintenance is inactive.
 *
 * Protocol 360 will supply the authenticated session principal. Unit tests use
 * this hook to exercise PROVISION authorization without a transport.
 *
 * @param[in] id Principal that must hold @ref SPAGHETTI_PERMISSION_PROVISION,
 *               or zero to clear the acting principal.
 */
void spaghetti_factory_reset_set_acting_principal(spaghetti_principal_id_t id);

/**
 * @brief Delete selected namespaces after authorization, then request reboot.
 *
 * Authorization requires an ACTIVE Maintenance link or an acting principal with
 * @ref SPAGHETTI_PERMISSION_PROVISION. MCUboot slots and the confirmed image are
 * never erased. A partial delete forces the Maintenance path and reports failed
 * scopes without requesting reboot.
 *
 * @param[in] scope Bitmask of @ref spaghetti_reset_scope values.
 *
 * @retval 0 Selected namespaces were deleted and reboot was requested.
 * @retval -EINVAL @p scope is zero or contains unknown bits.
 * @retval -EACCES The caller is not authorized.
 * @retval -EIO At least one selected namespace could not be deleted.
 * @retval -errno A stop, delete, or maintenance transition failed.
 *
 * @note BLE bond and application-credential clearing runs when
 *       @ref SPAGHETTI_RESET_BLE_BONDS is selected.
 */
int spaghetti_factory_reset(uint32_t scope);

/**
 * @brief Copy status from the latest factory-reset attempt.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains the latest attempt status.
 * @retval -EINVAL @p out is NULL.
 * @retval -ENOENT No factory reset has been attempted yet.
 */
int spaghetti_factory_reset_get_status(
	struct spaghetti_factory_reset_status *out);

#endif /* SPAGHETTI_FACTORY_RESET_H */
