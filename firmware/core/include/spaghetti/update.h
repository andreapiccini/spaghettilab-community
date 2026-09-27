/**
 * @file
 * @brief Transport-independent firmware-update coordination contract.
 * @ingroup spaghetti_update
 */

#ifndef SPAGHETTI_UPDATE_H
#define SPAGHETTI_UPDATE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/image_manifest.h>

/** Transport currently authorized to deliver one firmware candidate. */
enum spaghetti_update_transport {
	SPAGHETTI_UPDATE_TRANSPORT_NONE, /**< No transport owns the session. */
	SPAGHETTI_UPDATE_TRANSPORT_UART, /**< Local maintenance UART adapter. */
	SPAGHETTI_UPDATE_TRANSPORT_UDP, /**< Authenticated Wi-Fi UDP adapter. */
	SPAGHETTI_UPDATE_TRANSPORT_BLE, /**< Authenticated BLE adapter. */
	SPAGHETTI_UPDATE_TRANSPORT_CAN, /**< SLUP field update over the board CAN bus. */
	SPAGHETTI_UPDATE_TRANSPORT_ESPNOW, /**< Field update over ESP-NOW. */
};

/** Observable firmware-update lifecycle. */
enum spaghetti_update_state {
	SPAGHETTI_UPDATE_IDLE, /**< No update window or candidate is active. */
	SPAGHETTI_UPDATE_ARMED, /**< A bounded receive window is open. */
	SPAGHETTI_UPDATE_RECEIVING, /**< Exactly one transport owns the upload. */
	SPAGHETTI_UPDATE_VERIFYING, /**< Candidate finalization is in progress. */
	SPAGHETTI_UPDATE_PENDING_REBOOT, /**< MCUboot test boot was requested. */
	SPAGHETTI_UPDATE_TRIAL_BOOT, /**< The running image is not yet confirmed. */
	SPAGHETTI_UPDATE_ERROR, /**< A backend operation failed. */
};

/** Caller-owned coherent copy of the current update state. */
struct spaghetti_update_status {
	enum spaghetti_update_state state; /**< State observed while locked. */
	enum spaghetti_update_transport transport; /**< Session owner, or NONE. */
	uint32_t timeout_remaining_ms; /**< Remaining session time, or zero. */
	uint8_t active_slot; /**< MCUboot image slot currently executing: zero or one. */
	bool image_confirmed; /**< True when MCUboot will not revert this image. */
	int last_error; /**< Last transition error, or zero after success. */
};

/**
 * @brief Initialize the application-lifetime Update coordinator.
 *
 * The initial state is TRIAL_BOOT when MCUboot reports that the running image
 * is unconfirmed; otherwise it is IDLE. Initialization never erases either
 * image slot.
 *
 * @retval 0 The coordinator initialized successfully.
 * @retval -EALREADY The coordinator was already initialized.
 * @retval -EIO MCUboot state could not be read.
 * @retval -errno The selected boot backend rejected the query.
 *
 * @note Call once from the Core boot thread. This function is not ISR-safe.
 */
int spaghetti_update_init(void);

/**
 * @brief Open one bounded update window.
 *
 * @param[in] timeout_ms Whole-session timeout in milliseconds; must be non-zero.
 *
 * @retval 0 The coordinator entered ARMED.
 * @retval -EINVAL @p timeout_ms is zero.
 * @retval -EACCES The coordinator is not initialized.
 * @retval -EALREADY A receive window is already armed.
 * @retval -EBUSY An adapter owns an upload or a candidate awaits reboot.
 * @retval -EPERM The coordinator is in TRIAL_BOOT or ERROR.
 *
 * @note Thread context only. The value is copied; no caller storage is retained.
 */
int spaghetti_update_arm(uint32_t timeout_ms);

/**
 * @brief Assign the armed update session to exactly one transport.
 *
 * The backend erases only the secondary image slot before committing the
 * RECEIVING state. The deadline established by @ref spaghetti_update_arm is
 * not extended.
 *
 * @param[in] transport UART, UDP, BLE, CAN, or ESP-NOW adapter requesting ownership.
 *
 * @retval 0 @p transport owns the session and may receive image bytes.
 * @retval -EINVAL @p transport is NONE or outside the public enum.
 * @retval -EACCES The coordinator is not initialized.
 * @retval -EPERM No receive window is armed, or the coordinator is in ERROR.
 * @retval -ETIMEDOUT The armed deadline expired before ownership was granted.
 * @retval -EBUSY Another adapter owns the session or a candidate awaits reboot.
 * @retval -EIO The secondary slot could not be prepared.
 * @retval -errno The flash backend rejected preparation.
 *
 * @note Thread context only. This call may erase the complete secondary slot.
 */
int spaghetti_update_begin(enum spaghetti_update_transport transport);

/**
 * @brief Append one ordered firmware chunk to the owned secondary slot.
 *
 * @param[in] offset Expected zero-based byte offset. Chunks must be contiguous.
 * @param[in] data Caller-owned bytes borrowed only for this synchronous call.
 * @param[in] data_size Number of bytes at @p data; must be non-zero.
 * @param[in] last True only for the final chunk, which flushes buffered flash data.
 *
 * @retval 0 The complete chunk was accepted at @p offset.
 * @retval -EINVAL A pointer, size, offset, or final-chunk contract is invalid.
 * @retval -EACCES The coordinator is not initialized.
 * @retval -EPERM No transport owns a RECEIVING session.
 * @retval -ETIMEDOUT The whole-session deadline expired.
 * @retval -EIO The flash stream rejected the write.
 * @retval -errno The selected flash backend rejected the operation.
 *
 * @note Thread context only. The coordinator retains no caller buffer.
 */
int spaghetti_update_write(uint32_t offset, const uint8_t *data,
			   size_t data_size, bool last);

/**
 * @brief Finalize the received candidate and request one MCUboot test boot.
 *
 * The transport must call this only after its bounded upload engine reports a
 * complete transfer. The backend checks that the secondary slot contains a
 * readable MCUboot image header, then requests BOOT_UPGRADE_TEST. MCUboot
 * performs the definitive signature verification before executing the image.
 *
 * @retval 0 The coordinator entered PENDING_REBOOT.
 * @retval -EACCES The coordinator is not initialized.
 * @retval -EPERM No transport currently owns a receiving session.
 * @retval -ETIMEDOUT The whole-session deadline expired.
 * @retval -EBADMSG The secondary slot has no valid MCUboot image header.
 * @retval -EIO Reading flash or writing MCUboot metadata failed.
 * @retval -errno The flash or boot backend rejected finalization.
 *
 * @note Thread context only. This function never requests a permanent upgrade.
 */
int spaghetti_update_finish(void);

/**
 * @brief Cancel the current update and erase only the secondary slot.
 *
 * @retval 0 The coordinator returned to IDLE and released its transport.
 * @retval -EACCES The coordinator is not initialized.
 * @retval -EALREADY No update window, upload, or pending candidate exists.
 * @retval -EPERM The currently running image is in TRIAL_BOOT.
 * @retval -EIO The secondary slot could not be erased.
 * @retval -errno The flash backend rejected cancellation.
 *
 * @note Thread context only. Active firmware and persistent storage are untouched.
 */
int spaghetti_update_cancel(void);

/**
 * @brief Confirm the currently running trial image after Core health checks.
 *
 * @retval 0 MCUboot marked the image confirmed and Update returned to IDLE.
 * @retval -EACCES The coordinator is not initialized.
 * @retval -EPERM The running image is not in TRIAL_BOOT.
 * @retval -EIO MCUboot could not persist the confirmation trailer.
 * @retval -errno The boot backend rejected confirmation.
 *
 * @note Core is the only caller. Transports and Shell must not expose this operation.
 */
int spaghetti_update_confirm_trial(void);

/**
 * @brief Report the maximum candidate image size accepted by MCUboot.
 *
 * @param[out] out_size Caller-owned destination receiving bytes available in
 *                      the secondary slot before the MCUboot trailer. Update
 *                      retains no pointer to it.
 *
 * @retval 0 @p out_size contains the exact maximum candidate size.
 * @retval -EINVAL @p out_size is NULL.
 * @retval -EACCES The coordinator is not initialized.
 * @retval -EIO The secondary flash slot cannot be inspected.
 * @retval -errno The flash-map backend rejected the query.
 *
 * @note Thread context only. This function does not erase or write flash.
 */
int spaghetti_update_get_capacity(size_t *out_size);

/**
 * @brief Copy the coherent update status into caller-owned storage.
 *
 * @param[out] out Caller-owned destination written only on success. The
 *                 coordinator retains no pointer to it.
 *
 * @retval 0 @p out contains a coherent snapshot.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES The coordinator is not initialized.
 *
 * @note Thread-safe from thread context; no flash is accessed.
 */
int spaghetti_update_get_status(struct spaghetti_update_status *out);

/**
 * @brief Bind an optional candidate image manifest for finish-time checks.
 *
 * When bound, @ref spaghetti_update_finish validates the candidate against the
 * live Config before entering PENDING_REBOOT. Pass NULL to clear the binding.
 * Adapters that cannot extract a candidate manifest leave this unbound.
 *
 * @param[in] candidate Borrowed firmware-lifetime or caller-owned manifest, or
 *                      NULL to clear.
 *
 * @retval 0 The binding was updated.
 * @retval -EACCES The coordinator is not initialized.
 *
 * @note Thread context only. The coordinator retains the pointer until clear,
 *       cancel, or a successful finish that consumes it.
 */
int spaghetti_update_bind_candidate_manifest(
	const struct spaghetti_image_manifest *candidate);

#endif /* SPAGHETTI_UPDATE_H */
