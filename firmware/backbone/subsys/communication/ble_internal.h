#ifndef SPAGHETTI_BLE_INTERNAL_H
#define SPAGHETTI_BLE_INTERNAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

#include <spaghetti/access_control.h>
#include <spaghetti/ble.h>

/** Absolute maximum reassembled Protocol envelope on BLE. */
#define SPAGHETTI_BLE_ENVELOPE_MAX 2048U

/** Framing header byte count. */
#define SPAGHETTI_BLE_FRAME_HEADER_SIZE 8U

/** Application challenge nonce size. */
#define SPAGHETTI_BLE_NONCE_SIZE 32U

/** HMAC-SHA256 tag size. */
#define SPAGHETTI_BLE_HMAC_SIZE 32U

/** Auth challenge / proof leading type bytes. */
#define SPAGHETTI_BLE_AUTH_CHALLENGE_TYPE 0x01U
#define SPAGHETTI_BLE_AUTH_PROOF_TYPE 0x02U

/** Auth challenge notify size: type + session_id + nonce. */
#define SPAGHETTI_BLE_AUTH_CHALLENGE_SIZE \
	(1U + 4U + SPAGHETTI_BLE_NONCE_SIZE)

/** Auth proof write size: type + credential_id + hmac. */
#define SPAGHETTI_BLE_AUTH_PROOF_SIZE \
	(1U + 2U + SPAGHETTI_BLE_HMAC_SIZE)

/** Maximum concurrent BLE credentials in PSA ITS. */
#define SPAGHETTI_BLE_CREDENTIAL_SLOTS 8U

/** Default reassembly timeout when Kconfig is unavailable. */
#ifndef CONFIG_SPAGHETTI_BLE_REASSEMBLY_TIMEOUT_MS
#define CONFIG_SPAGHETTI_BLE_REASSEMBLY_TIMEOUT_MS 5000
#endif

#ifndef CONFIG_SPAGHETTI_BLE_EVENT_CREDIT
#define CONFIG_SPAGHETTI_BLE_EVENT_CREDIT 4
#endif

#ifndef CONFIG_SPAGHETTI_BLE_LOG_LEVEL
#define CONFIG_SPAGHETTI_BLE_LOG_LEVEL 3
#endif

/** Little-endian framing header fields. */
struct spaghetti_ble_frame_header {
	uint32_t message_id;
	uint16_t offset;
	uint16_t total;
};

/** One in-flight reassembly buffer. */
struct spaghetti_ble_reassembly {
	bool active;
	uint32_t message_id;
	uint16_t total;
	uint16_t received;
	int64_t started_ms;
	uint8_t bitmap[(SPAGHETTI_BLE_ENVELOPE_MAX + 7U) / 8U];
	uint8_t buffer[SPAGHETTI_BLE_ENVELOPE_MAX];
};

/**
 * @brief Decode one framing header from borrowed bytes.
 *
 * @retval 0 Header fields were written.
 * @retval -EINVAL A pointer is NULL or @p size is below the header.
 */
int spaghetti_ble_frame_parse(
	const uint8_t *bytes,
	size_t size,
	struct spaghetti_ble_frame_header *out);

/**
 * @brief Encode one framing header into caller-owned bytes.
 *
 * @retval 0 Eight header bytes were written.
 * @retval -EINVAL A pointer is NULL or @p capacity is below eight.
 */
int spaghetti_ble_frame_encode(
	const struct spaghetti_ble_frame_header *header,
	uint8_t *out,
	size_t capacity);

/**
 * @brief Reset one reassembly slot.
 */
void spaghetti_ble_reassembly_reset(struct spaghetti_ble_reassembly *slot);

/**
 * @brief Feed one framed fragment into a single-flight reassembly slot.
 *
 * @retval 0 Fragment accepted; assembly still incomplete.
 * @retval 1 Fragment completed the envelope in @p slot->buffer.
 * @retval -EINVAL Pointer or header is invalid.
 * @retval -EMSGSIZE @p total exceeds the absolute ceiling.
 * @retval -EEXIST A different @p message_id is already open.
 * @retval -EALREADY Fragment overlaps already-received bytes.
 * @retval -ETIMEDOUT Prior open reassembly expired and was discarded.
 */
int spaghetti_ble_reassembly_feed(
	struct spaghetti_ble_reassembly *slot,
	const uint8_t *frame,
	size_t frame_size,
	int64_t now_ms,
	int64_t timeout_ms);

/**
 * @brief BLE adapter permission ceiling (no PROVISION).
 */
uint32_t spaghetti_ble_permissions(void);

/**
 * @brief Inject one request write for tests or host stubs.
 *
 * @param[in] peer_index Zero-based peer slot.
 * @param[in] bytes Borrowed ATT write payload.
 * @param[in] size Byte count of @p bytes.
 *
 * @retval 0 Bytes were accepted.
 * @retval -EINVAL Arguments are invalid.
 * @retval -EACCES Adapter is stopped or peer is unknown.
 * @retval -EBADMSG Framing or authentication failed.
 * @retval -errno Dispatch failed.
 */
int spaghetti_ble_inject_request(
	uint8_t peer_index,
	const uint8_t *bytes,
	size_t size);

/**
 * @brief Simulate an ATT connection for host/unit tests.
 *
 * @param[out] peer_index Caller-owned peer slot written only on success.
 *
 * @retval 0 Peer is connected and awaiting application proof.
 * @retval -EINVAL @p peer_index is NULL.
 * @retval -EACCES Adapter is not started.
 * @retval -ENOSPC Peer table is full.
 */
int spaghetti_ble_test_connect(uint8_t *peer_index);

/**
 * @brief Simulate an ATT disconnect for host/unit tests.
 *
 * @param[in] peer_index Zero-based peer slot.
 *
 * @retval 0 Peer was released.
 * @retval -EINVAL Peer is unknown.
 */
int spaghetti_ble_test_disconnect(uint8_t peer_index);

/**
 * @brief Copy the latest auth challenge for one peer.
 *
 * @retval 0 Challenge bytes were written.
 * @retval -EINVAL Arguments are invalid.
 * @retval -ENOENT Peer has no pending challenge.
 */
int spaghetti_ble_test_get_challenge(
	uint8_t peer_index,
	uint8_t *out,
	size_t capacity,
	size_t *out_size);

/**
 * @brief Copy the latest indicated response for one peer.
 *
 * @retval 0 Response bytes were written.
 * @retval -EINVAL Arguments are invalid.
 * @retval -ENOENT No response is pending.
 */
int spaghetti_ble_test_get_response(
	uint8_t peer_index,
	uint8_t *out,
	size_t capacity,
	size_t *out_size);

/**
 * @brief Install a fixed device identity for host HMAC tests.
 *
 * @param[in] device_id Borrowed 32-byte identity copied on success.
 *
 * @retval 0 Identity override was installed.
 * @retval -EINVAL @p device_id is NULL.
 */
int spaghetti_ble_test_set_device_id(const uint8_t device_id[32]);

#endif /* SPAGHETTI_BLE_INTERNAL_H */
