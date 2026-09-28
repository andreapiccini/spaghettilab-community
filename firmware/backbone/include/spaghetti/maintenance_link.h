/**
 * @file
 * @brief Board-independent local maintenance-link contract.
 * @ingroup spaghetti_maintenance_link
 */

#ifndef SPAGHETTI_MAINTENANCE_LINK_H
#define SPAGHETTI_MAINTENANCE_LINK_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/** Fixed HMAC-SHA256 bootstrap credential size. */
#define SPAGHETTI_MAINTENANCE_KEY_SIZE 32U

/** Reason that authorized the current maintenance session. */
enum spaghetti_maintenance_entry_reason {
	SPAGHETTI_MAINTENANCE_CONFIG_ABSENT, /**< No valid Config was stored. */
	SPAGHETTI_MAINTENANCE_BOOTSTRAP_FRAME, /**< Authenticated boot frame matched. */
	SPAGHETTI_MAINTENANCE_REBOOT_REQUEST, /**< One-shot marker was consumed. */
};

/** Observable physical-link state. */
enum spaghetti_maintenance_link_state {
	SPAGHETTI_MAINTENANCE_LINK_UNINITIALIZED, /**< Initialization has not run. */
	SPAGHETTI_MAINTENANCE_LINK_NORMAL, /**< Normal bus owns the shared pins. */
	SPAGHETTI_MAINTENANCE_LINK_PROBING, /**< RX-only bootstrap probe is active. */
	SPAGHETTI_MAINTENANCE_LINK_ACTIVE, /**< Maintenance UART owns the pins. */
	SPAGHETTI_MAINTENANCE_LINK_ERROR, /**< Pinctrl or backend transition failed. */
};

/**
 * @brief Initialize the selected board link in its normal hardware role.
 *
 * @retval 0 The normal controller owns the shared pins.
 * @retval -EALREADY The link was initialized previously.
 * @retval -ENODEV A referenced Devicetree device is unavailable.
 * @retval -EIO The board pinctrl backend rejected the normal state.
 *
 * @note Core calls this once before Port initialization.
 */
int spaghetti_maintenance_link_init(void);

/**
 * @brief Listen without transmitting for one authenticated bootstrap frame.
 *
 * @param[in] timeout_ms Positive receive window in milliseconds.
 * @param[out] requested Caller-owned result written only on success.
 *
 * @retval 0 Probe completed; @p requested reports authentication success.
 * @retval -EINVAL A parameter is invalid.
 * @retval -EACCES The link is not initialized in NORMAL state.
 * @retval -EIO Pinctrl, UART, hardware identity, or secure storage failed.
 *
 * @note The pointer is never retained. TX remains disabled for the whole probe.
 */
int spaghetti_maintenance_link_probe(uint32_t timeout_ms, bool *requested);

/**
 * @brief Atomically switch the shared connection to local maintenance UART.
 *
 * @param[in] reason Boot-policy reason copied for diagnostics.
 *
 * @retval 0 SMP UART owns the shared pins.
 * @retval -EINVAL @p reason is outside the public enum.
 * @retval -EACCES The link is not initialized.
 * @retval -EALREADY Maintenance is already active.
 * @retval -EIO The board pinctrl backend rejected the UART state.
 *
 * @note Core calls this before any runtime Module is started.
 */
int spaghetti_maintenance_link_enter(
	enum spaghetti_maintenance_entry_reason reason);

/**
 * @brief Disable maintenance UART and restore the normal board controller.
 *
 * @retval 0 The normal controller owns the pins.
 * @retval -EACCES The link is not initialized.
 * @retval -EALREADY The link is already in NORMAL state.
 * @retval -EIO The board pinctrl backend rejected restoration.
 */
int spaghetti_maintenance_link_leave(void);

/**
 * @brief Store the per-device key used to authenticate future boot probes.
 *
 * @param[in] key Caller-owned 32-byte secret borrowed only for this call.
 * @param[in] key_size Must equal @ref SPAGHETTI_MAINTENANCE_KEY_SIZE.
 *
 * @retval 0 Secure Storage durably accepted the key.
 * @retval -EINVAL A pointer or size is invalid.
 * @retval -EACCES Maintenance is not active.
 * @retval -ENOSPC Secure Storage has no capacity.
 * @retval -EIO Secure Storage rejected the record.
 *
 * @note The key is never logged or retained in plaintext RAM after return.
 */
int spaghetti_maintenance_link_set_key(const uint8_t *key, size_t key_size);

/** @return Current coherent link state. */
enum spaghetti_maintenance_link_state spaghetti_maintenance_link_get_state(void);

#endif /* SPAGHETTI_MAINTENANCE_LINK_H */
