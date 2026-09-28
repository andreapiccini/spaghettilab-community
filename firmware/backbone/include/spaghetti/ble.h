/**
 * @file
 * @brief Authenticated BLE adapter for Communication Protocol V1.
 * @ingroup spaghetti_ble
 */

#ifndef SPAGHETTI_BLE_H
#define SPAGHETTI_BLE_H

#include <stdbool.h>
#include <stdint.h>

#include <zephyr/kernel.h>

#include <spaghetti/access_control.h>

/** Fixed application BLE credential key size in bytes. */
#define SPAGHETTI_BLE_KEY_SIZE 32U

/** Observable BLE adapter lifecycle. */
enum spaghetti_ble_state {
	SPAGHETTI_BLE_STATE_OFF, /**< Radio, advertising, and peers are idle. */
	SPAGHETTI_BLE_STATE_ADVERTISING, /**< Accepting new LE connections. */
	SPAGHETTI_BLE_STATE_AUTHENTICATING, /**< Connected peer has not proven key. */
	SPAGHETTI_BLE_STATE_CONNECTED, /**< At least one authenticated peer is active. */
};

/** Caller-owned coherent BLE adapter status copy. */
struct spaghetti_ble_status {
	enum spaghetti_ble_state state; /**< Adapter lifecycle state. */
	uint16_t negotiated_mtu; /**< ATT MTU of the active peer, or zero. */
	uint8_t peer_count; /**< Connected peers currently retained. */
	uint32_t rx_rejected; /**< Frames or envelopes discarded by policy. */
	uint32_t event_dropped; /**< Event notifies dropped by credit limits. */
};

/**
 * @brief Enable the BLE controller, register GATT, and start advertising.
 *
 * @retval 0 Advertising is active or an authenticated peer remains connected.
 * @retval -EALREADY The adapter is already started.
 * @retval -ENOTSUP BLE is not compiled or @c bt_enable cannot be used.
 * @retval -errno Controller, GATT, or advertising setup failed.
 *
 * @note Call from thread context in Normal mode after Communication init.
 */
int spaghetti_ble_start(void);

/**
 * @brief Disconnect peers, stop advertising, and release adapter buffers.
 *
 * @param[in] timeout Finite cleanup deadline copied by value; K_FOREVER is invalid.
 *
 * @retval 0 Peers, advertising, callbacks, and reassembly buffers are released.
 * @retval -EINVAL @p timeout is unbounded.
 * @retval -EALREADY The adapter is already stopped.
 * @retval -ENOTSUP BLE is not compiled.
 * @retval -EAGAIN Cleanup did not finish before @p timeout.
 * @retval -errno Controller cleanup failed.
 */
int spaghetti_ble_stop(k_timeout_t timeout);

/**
 * @brief Copy current BLE adapter status.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains a coherent snapshot.
 * @retval -EINVAL @p out is NULL.
 * @retval -ENOTSUP BLE is not compiled.
 */
int spaghetti_ble_get_status(struct spaghetti_ble_status *out);

/**
 * @brief Persist one application BLE credential in PSA ITS.
 *
 * @param[in] credential_id Non-zero credential slot identifier.
 * @param[in] principal_id Enabled principal bound to this credential.
 * @param[in] key Borrowed 32-byte secret copied only for this call.
 *
 * @retval 0 The encrypted/authenticated PSA ITS record was replaced.
 * @retval -EINVAL A pointer or identifier is invalid.
 * @retval -EACCES Local Maintenance UART is not active.
 * @retval -ENOENT @p principal_id is unknown or disabled.
 * @retval -ENOTSUP BLE credentials are not compiled.
 * @retval -errno Secure storage rejected the record.
 *
 * @note No caller pointer is retained and no credential bytes are logged.
 */
int spaghetti_ble_credential_set(
	uint16_t credential_id,
	spaghetti_principal_id_t principal_id,
	const uint8_t key[SPAGHETTI_BLE_KEY_SIZE]);

/**
 * @brief Delete one persisted application BLE credential.
 *
 * @param[in] credential_id Non-zero credential slot identifier.
 *
 * @retval 0 The credential was deleted.
 * @retval -EINVAL @p credential_id is zero.
 * @retval -EACCES Local Maintenance UART is not active.
 * @retval -ENOENT No credential exists for @p credential_id.
 * @retval -ENOTSUP BLE credentials are not compiled.
 * @retval -errno Secure storage rejected deletion.
 */
int spaghetti_ble_credential_clear(uint16_t credential_id);

/**
 * @brief Report whether one BLE credential slot is present.
 *
 * @param[in] credential_id Non-zero credential slot identifier.
 * @param[out] out_exists Caller-owned flag written only on success.
 *
 * @retval 0 @p out_exists is true when the slot contains a complete record.
 * @retval -EINVAL @p credential_id is zero or @p out_exists is NULL.
 * @retval -ENOTSUP BLE credentials are not compiled.
 * @retval -errno Secure storage rejected the query.
 */
int spaghetti_ble_credential_exists(
	uint16_t credential_id,
	bool *out_exists);

/**
 * @brief Erase every BLE application credential without Maintenance checks.
 *
 * Used by factory reset after the reset itself has been authorized.
 *
 * @retval 0 Credentials were erased or none were stored.
 * @retval -ENOTSUP BLE credentials are not compiled.
 * @retval -EIO Secure storage rejected deletion.
 */
int spaghetti_ble_erase_credentials(void);

/**
 * @brief Delete BLE credentials bound to @p principal_id and close matching peers.
 *
 * @param[in] principal_id Principal whose BLE binding must be removed.
 *
 * @retval 0 Matching credentials were deleted and peers closed.
 * @retval -EINVAL @p principal_id is zero.
 * @retval -ENOENT No credential is bound to that principal.
 * @retval -ENOTSUP BLE credentials are not compiled.
 * @retval -errno Secure storage or peer cleanup failed.
 */
int spaghetti_ble_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id);

/**
 * @brief Close every connected BLE peer authenticated as @p principal_id.
 *
 * @param[in] principal_id Principal whose live peers must disconnect.
 */
void spaghetti_ble_close_peers_for_principal(
	spaghetti_principal_id_t principal_id);

/**
 * @brief Clear controller bonds and application credentials when possible.
 *
 * @retval 0 Bonds and credentials were cleared or were already absent.
 * @retval -ENOTSUP BLE is not compiled.
 * @retval -errno Bond or credential deletion failed.
 */
int spaghetti_ble_clear_bonds(void);

/**
 * @brief Gate advertising while the adapter remains started.
 *
 * Used by the energy policy windowing path. Turning the radio off stops
 * advertising and disconnects peers without forgetting credentials.
 *
 * @param[in] enabled True to advertise; false to stop advertising.
 *
 * @retval 0 Advertising state matches @p enabled.
 * @retval -EACCES The adapter has not been started.
 * @retval -ENOTSUP BLE is not compiled.
 * @retval -errno Controller advertising failed.
 */
int spaghetti_ble_set_radio(bool enabled);

/**
 * @brief Find one authenticated BLE peer authorized for UPDATE.
 *
 * @param[out] out_principal Caller-owned principal id written only on success.
 *
 * @retval 0 An authenticated peer holds UPDATE permission.
 * @retval -EINVAL @p out_principal is NULL.
 * @retval -ENOENT No authenticated UPDATE-capable peer is connected.
 * @retval -EACCES Access control rejected the peer principal.
 * @retval -ENOTSUP BLE is not compiled.
 */
int spaghetti_ble_find_update_principal(spaghetti_principal_id_t *out_principal);

/**
 * @brief Report whether @p principal_id has an authenticated BLE peer.
 *
 * Used by BLE→Wi-Fi handover ops. A non-zero test hook installed by
 * @ref spaghetti_ble_wifi_handover_set_test_authenticated also counts.
 *
 * @param[in] principal_id Principal that must own a live authenticated peer.
 *
 * @retval 0 An authenticated peer (or test hook) matches @p principal_id.
 * @retval -EINVAL @p principal_id is zero.
 * @retval -ENOENT No matching authenticated peer is connected.
 * @retval -ENOTSUP BLE is not compiled and no test hook is active.
 */
int spaghetti_ble_principal_is_authenticated(
	spaghetti_principal_id_t principal_id);

/**
 * @brief Install or clear the unit-test BLE authentication hook for handover.
 *
 * @param[in] principal_id Non-zero principal treated as BLE-authenticated, or
 *                         zero to clear the hook.
 *
 * @note Production adapters never call this. Handover ops also accept a live
 *       authenticated peer or a local adapter context.
 */
void spaghetti_ble_wifi_handover_set_test_authenticated(
	spaghetti_principal_id_t principal_id);

/**
 * @brief Request BLE peer disconnect after the handover acknowledgement.
 *
 * The BLE adapter consumes the request with
 * @ref spaghetti_ble_wifi_handover_take_pending_disconnect after the response
 * envelope is prepared so the Minimal-profile disconnect never races the ack.
 *
 * @param[in] principal_id Principal whose peers should disconnect after ack.
 */
void spaghetti_ble_wifi_handover_request_disconnect(
	spaghetti_principal_id_t principal_id);

/**
 * @brief Consume one deferred Minimal-profile BLE disconnect request.
 *
 * @param[out] out_principal Optional principal written when a request exists.
 *
 * @return True when a disconnect was pending and has been cleared.
 */
bool spaghetti_ble_wifi_handover_take_pending_disconnect(
	spaghetti_principal_id_t *out_principal);

#endif /* SPAGHETTI_BLE_H */
