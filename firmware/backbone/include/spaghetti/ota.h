/**
 * @file
 * @brief Authenticated bounded Wi-Fi and BLE OTA adapters.
 * @ingroup spaghetti_ota
 */

#ifndef SPAGHETTI_OTA_H
#define SPAGHETTI_OTA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <zephyr/kernel.h>

#include <spaghetti/access_control.h>
#include <spaghetti/core.h>

struct smp_transport;

/** Maximum BLE OTA write chunk accepted by the adapter. */
#define SPAGHETTI_OTA_BLE_CHUNK_MAX 512U

/** Borrowed BLE begin request; copied by open() for the session lifetime. */
struct spaghetti_ble_update_begin {
	uint32_t image_size; /**< Exact candidate byte count. */
	uint8_t image_sha256[32]; /**< Expected SHA-256 of candidate bytes. */
	char version[SPAGHETTI_CORE_VERSION_SIZE]; /**< Candidate version label. */
};

/** Fixed per-device DTLS pre-shared key size. */
#define SPAGHETTI_OTA_PSK_SIZE 32U

/** Maximum DTLS PSK identity bytes. */
#define SPAGHETTI_OTA_IDENTITY_MAX_SIZE 32U

/** Observable Wi-Fi OTA listener state. */
enum spaghetti_ota_state {
	SPAGHETTI_OTA_UNINITIALIZED, /**< Normal-mode initialization has not run. */
	SPAGHETTI_OTA_CLOSED, /**< No UDP socket or update window is open. */
	SPAGHETTI_OTA_ARMED, /**< Authenticated DTLS listener is open. */
	SPAGHETTI_OTA_ERROR, /**< Opening or cleanup failed. */
};

/** Caller-owned coherent OTA status copy. */
struct spaghetti_ota_status {
	enum spaghetti_ota_state state; /**< Listener lifecycle state. */
	uint16_t port; /**< UDP port, in host byte order. */
	bool credentials_present; /**< A complete PSK record exists. */
	int last_error; /**< Last lifecycle errno, or zero. */
};

/** Non-sensitive metadata for the single OTA credential vault entry. */
struct spaghetti_ota_credential_metadata {
	bool present; /**< True when a complete credential record exists. */
	spaghetti_principal_id_t principal_id; /**< Bound principal, or zero. */
	uint8_t identity_size; /**< Public identity byte count. */
	uint8_t identity[SPAGHETTI_OTA_IDENTITY_MAX_SIZE]; /**< Public identity copy. */
};

/**
 * @brief Initialize OTA closed without starting optional runtime resources.
 *
 * @retval 0 OTA initialized and remains closed until lifecycle start.
 * @retval -EALREADY OTA was initialized previously.
 * @retval -EIO Secure storage, DTLS, socket, or Update initialization failed.
 * @retval -errno A backend or Update operation failed.
 */
int spaghetti_ota_init(void);

/**
 * @brief Start OTA policy and consume an optional persisted one-shot window.
 *
 * @retval 0 OTA is started, with the listener open only for a pending request.
 * @retval -EACCES OTA is not initialized.
 * @retval -EALREADY OTA is already started.
 * @retval -errno Credential, Update, workspace, socket, or stack setup failed.
 */
int spaghetti_ota_start(void);

/**
 * @brief Stop OTA and release every optional runtime resource.
 *
 * @param[in] timeout Finite cleanup deadline copied by value; K_FOREVER is invalid.
 *
 * @retval 0 Work, socket, callback, listener, stack, and workspace are released.
 * @retval -EINVAL @p timeout is unbounded or exceeds the service limit.
 * @retval -EACCES OTA is not initialized.
 * @retval -EALREADY OTA is already stopped.
 * @retval -EAGAIN The listener did not exit before the deadline.
 * @retval -errno A backend cleanup operation failed.
 */
int spaghetti_ota_stop(k_timeout_t timeout);

/**
 * @brief Persist one per-device DTLS-PSK credential.
 *
 * @param[in] psk Caller-owned 32-byte secret borrowed only for this call.
 * @param[in] psk_size Must equal @ref SPAGHETTI_OTA_PSK_SIZE.
 * @param[in] identity Caller-owned public identity bytes borrowed for this call.
 * @param[in] identity_size Number of identity bytes, from one to 32.
 * @param[in] principal_id Principal bound to this credential, or zero if unbound.
 *
 * @retval 0 The encrypted/authenticated PSA ITS record was replaced.
 * @retval -EINVAL A pointer or size is invalid.
 * @retval -EACCES Local maintenance is not active.
 * @retval -ENOSPC Secure storage has no capacity.
 * @retval -errno Secure storage rejected the record.
 */
int spaghetti_ota_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size,
	spaghetti_principal_id_t principal_id);

/**
 * @brief Replace the OTA secret while preserving the bound principal.
 *
 * @param[in] psk Caller-owned 32-byte secret borrowed only for this call.
 * @param[in] psk_size Must equal @ref SPAGHETTI_OTA_PSK_SIZE.
 * @param[in] identity Caller-owned public identity bytes borrowed for this call.
 * @param[in] identity_size Number of identity bytes, from one to 32.
 *
 * @retval 0 The credential was rotated without changing principal binding.
 * @retval -EINVAL A pointer or size is invalid.
 * @retval -EACCES Local maintenance is not active.
 * @retval -ENOENT No credential was stored.
 * @retval -errno Secure storage rejected the record.
 */
int spaghetti_ota_rotate_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size);

/**
 * @brief Delete the persisted DTLS-PSK credential and pending request.
 *
 * @retval 0 The record was deleted.
 * @retval -EACCES Local maintenance is not active.
 * @retval -ENOENT No credential was stored.
 * @retval -errno Secure storage rejected deletion.
 */
int spaghetti_ota_clear_credentials(void);

/**
 * @brief Erase the OTA credential vault without Maintenance authorization.
 *
 * Used by factory reset after the reset itself has been authorized.
 *
 * @retval 0 The credential was erased.
 * @retval -ENOENT No credential was stored.
 * @retval -EIO Secure storage rejected deletion.
 */
int spaghetti_ota_erase_credentials(void);

/**
 * @brief Delete the OTA credential when it is bound to @p principal_id.
 *
 * @param[in] principal_id Principal whose credential should be removed.
 *
 * @retval 0 The credential was deleted.
 * @retval -EINVAL @p principal_id is zero.
 * @retval -ENOENT No credential is bound to that principal.
 * @retval -errno Secure storage rejected deletion.
 */
int spaghetti_ota_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id);

/**
 * @brief Copy non-sensitive OTA credential metadata.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains present/principal/identity metadata.
 * @retval -EINVAL @p out is NULL.
 * @retval -errno Secure storage rejected the query.
 */
int spaghetti_ota_get_credential_metadata(
	struct spaghetti_ota_credential_metadata *out);

/**
 * @brief Save one OTA request that will be consumed by the next normal boot.
 *
 * @param[in] timeout_ms Whole OTA-window duration in milliseconds.
 *
 * @retval 0 The one-shot request was stored.
 * @retval -EINVAL @p timeout_ms is zero or exceeds the configured maximum.
 * @retval -EACCES Local maintenance is not active.
 * @retval -ENOENT Credentials or a valid persisted Config are absent.
 * @retval -errno Secure storage rejected the update.
 */
int spaghetti_ota_request_once(uint32_t timeout_ms);

/**
 * @brief Open DTLS-SMP immediately for an already authenticated caller.
 *
 * @param[in] timeout_ms Whole window duration in milliseconds.
 *
 * @retval 0 Update is ARMED and the authenticated UDP listener is open.
 * @retval -EINVAL @p timeout_ms is zero or exceeds the configured maximum.
 * @retval -EACCES OTA has not been initialized.
 * @retval -ENOENT No DTLS credential is provisioned.
 * @retval -errno Update, DTLS, socket, or thread startup failed.
 */
int spaghetti_ota_arm(uint32_t timeout_ms);

/**
 * @brief Close the listener and discard an incomplete candidate.
 *
 * @retval 0 OTA is closed and Update returned to IDLE.
 * @retval -EACCES OTA has not been initialized.
 * @retval -EALREADY OTA is already closed.
 * @retval -errno Socket, credential, or Update cleanup failed.
 */
int spaghetti_ota_cancel(void);

/**
 * @brief Test whether an SMP request arrived through the OTA transport.
 *
 * @param[in] transport Borrowed mcumgr transport pointer from the request.
 *
 * @return True only for the active Spaghetti DTLS transport.
 */
bool spaghetti_ota_is_transport(const struct smp_transport *transport);

/**
 * @brief Copy current OTA state.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains a coherent snapshot.
 * @retval -EINVAL @p out is NULL.
 */
int spaghetti_ota_get_status(struct spaghetti_ota_status *out);

/** Defer cancellation so the current SMP response can be transmitted. */
void spaghetti_ota_cancel_after_response(void);

/** Close only the transport before reboot, preserving a pending candidate. */
void spaghetti_ota_prepare_reboot(void);

/**
 * @brief Open one BLE-owned Update session after authorization.
 *
 * Quiesces Runtime before the first secondary-slot erase. Requires an
 * authenticated BLE peer with UPDATE permission, or a non-zero acting
 * principal installed for tests.
 *
 * @param[in] request Borrowed begin metadata copied only for this call.
 * @param[out] session_id Caller-owned session identifier written on success.
 *
 * @retval 0 BLE owns Update and @p session_id is valid.
 * @retval -EINVAL A pointer or @p request field is invalid.
 * @retval -EACCES Authorization failed or Update is uninitialized.
 * @retval -EBUSY Another transport owns Update.
 * @retval -EFBIG @p request->image_size exceeds secondary-slot capacity.
 * @retval -errno Update, Runtime, or backend preparation failed.
 *
 * @note Thread context only. No caller pointer is retained after return.
 */
int spaghetti_ota_ble_open(
	const struct spaghetti_ble_update_begin *request,
	uint32_t *session_id);

/**
 * @brief Append one ordered BLE chunk at the exact expected offset.
 *
 * @param[in] session_id Session returned by @ref spaghetti_ota_ble_open.
 * @param[in] offset Exact next byte offset; must match adapter progress.
 * @param[in] bytes Borrowed chunk bytes retained only for this call.
 * @param[in] size Chunk length from one to @ref SPAGHETTI_OTA_BLE_CHUNK_MAX.
 *
 * @retval 0 The chunk was accepted and written through Update.
 * @retval -EINVAL Session, offset, pointer, or size is invalid.
 * @retval -ENOENT @p session_id is unknown.
 * @retval -EPERM No BLE session is receiving.
 * @retval -errno Update rejected the write.
 *
 * @note Thread context only. Clears a pending disconnect-resume window.
 */
int spaghetti_ota_ble_write(uint32_t session_id, uint32_t offset,
			    const uint8_t *bytes, size_t size);

/**
 * @brief Verify size/hash and finalize the BLE candidate through Update.
 *
 * @param[in] session_id Session returned by @ref spaghetti_ota_ble_open.
 *
 * @retval 0 Update entered PENDING_REBOOT after hash and finish checks.
 * @retval -EINVAL @p session_id is zero.
 * @retval -ENOENT @p session_id is unknown.
 * @retval -EBADMSG Received size or SHA-256 does not match the begin request.
 * @retval -errno Update finalization failed.
 *
 * @note Thread context only. Trial reboot remains owned by Update/Core.
 */
int spaghetti_ota_ble_finish(uint32_t session_id);

/**
 * @brief Cancel the BLE session and discard the secondary candidate.
 *
 * @param[in] session_id Session returned by @ref spaghetti_ota_ble_open.
 *
 * @retval 0 BLE released ownership; confirmed image is untouched.
 * @retval -EINVAL @p session_id is zero.
 * @retval -ENOENT @p session_id is unknown.
 * @retval -EALREADY No BLE session is active.
 * @retval -errno Update cancellation failed.
 *
 * @note Thread context only.
 */
int spaghetti_ota_ble_cancel(uint32_t session_id);

/**
 * @brief Select the acting principal used when no live BLE peer authorizes.
 *
 * @param[in] id Enabled principal with UPDATE permission, or zero to clear.
 *
 * @note Intended for unit tests and Protocol handlers that already authorized.
 */
void spaghetti_ota_ble_set_acting_principal(spaghetti_principal_id_t id);

/**
 * @brief Start the bounded disconnect-resume window for an active BLE session.
 *
 * Called from the BLE adapter when a peer disconnects. If the same session is
 * not continued with write/finish before the resume timeout, the candidate is
 * cancelled and the confirmed image remains untouched.
 */
void spaghetti_ota_ble_on_disconnect(void);

#endif /* SPAGHETTI_OTA_H */
