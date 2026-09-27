/**
 * @file
 * @brief SLUP: field firmware update over the Backbone CAN transceiver.
 * @ingroup spaghetti_update
 */

#ifndef SPAGHETTI_FIELD_UPDATE_H
#define SPAGHETTI_FIELD_UPDATE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/nfc.h>
#include <spaghetti/update.h>

/** Broadcast destination accepted by every listening peer. */
#define SPAGHETTI_FIELD_UPDATE_BROADCAST 0xFFFFFFFFU

/** 24-bit factory-MAC suffix used as the SLUP node identifier. */
#define SPAGHETTI_SLUP_NODE_MASK 0x00FFFFFFU

/** Maximum Backbones retained from one Discover sweep. */
#define SPAGHETTI_SLUP_PEERS_MAX 8U

/** Chain slot not yet assigned; USB-connected master becomes slot 1. */
#define SPAGHETTI_SLUP_CHAIN_UNKNOWN 0U

/** Discover/status flag: USB Serial/JTAG host is attached. */
#define SPAGHETTI_SLUP_FLAG_USB 0x01U

/** List-only flag: this row is the local board. Never sent on the bus. */
#define SPAGHETTI_SLUP_FLAG_LOCAL 0x80U

/** Bytes reserved for the signed image version copied from a peer. */
#define SPAGHETTI_SLUP_VERSION_SIZE 24U

/** One Backbone seen by SLUP Discover, copied into caller storage. */
struct spaghetti_slup_peer {
	uint32_t node_id; /**< Last three STA MAC bytes, range 0..0xFFFFFF. */
	uint8_t mac[6]; /**< Factory STA MAC reported by Discover. */
	uint8_t flags; /**< @ref SPAGHETTI_SLUP_FLAG_USB and LOCAL bits. */
	uint8_t chain_index; /**< 1 = USB end, 2..N along the cable, or 0. */
	char version[SPAGHETTI_SLUP_VERSION_SIZE]; /**< Signed image version, or empty. */
};

/**
 * @brief Start the SLUP CAN listener and the optional ESP-NOW listener.
 *
 * Safe to call without a stored Config. Listeners remain available in both
 * Normal and Maintenance mode so inaccessible boards can still be updated.
 *
 * @retval 0 Listeners started, or no compiled adapter needed work.
 * @retval -EALREADY Initialization already completed.
 * @retval -errno An adapter could not start. Other compiled adapters may still
 *                be listening.
 *
 * @note Thread context only. Call once after Update initialization.
 */
int spaghetti_field_update_init(void);

/**
 * @brief Report the 24-bit SLUP node identifier.
 *
 * The value is the last three bytes of the factory STA MAC, matching the
 * original host SLUP loader.
 *
 * @return Local node identifier in the range 0..0xFFFFFF.
 *
 * @note Thread-safe after @ref spaghetti_field_update_init.
 */
uint32_t spaghetti_field_update_local_node_id(void);

/**
 * @brief Report SLUP flags for this board.
 *
 * @return Bitmask of @ref SPAGHETTI_SLUP_FLAG_USB when a USB host is present.
 *
 * @note Thread-safe after @ref spaghetti_field_update_init.
 */
uint8_t spaghetti_field_update_local_flags(void);

/**
 * @brief Report the assigned chain slot for this board.
 *
 * @return 1..@ref SPAGHETTI_SLUP_PEERS_MAX, or
 *         @ref SPAGHETTI_SLUP_CHAIN_UNKNOWN.
 *
 * @note Thread-safe after @ref spaghetti_field_update_init.
 */
uint8_t spaghetti_field_update_local_chain_index(void);

/**
 * @brief Store the chain slot for this board in RAM.
 *
 * @param[in] index 1..@ref SPAGHETTI_SLUP_PEERS_MAX, or
 *                  @ref SPAGHETTI_SLUP_CHAIN_UNKNOWN.
 *
 * @retval 0 The slot was stored.
 * @retval -EINVAL @p index is greater than @ref SPAGHETTI_SLUP_PEERS_MAX.
 *
 * @note Thread context only. The value is not persisted across reboot.
 */
int spaghetti_field_update_set_chain_index(uint8_t index);

/**
 * @brief Test whether @p dest addresses this board.
 *
 * @param[in] dest Destination node identifier from a field-update packet.
 *
 * @return true when @p dest is broadcast or equals the local node identifier.
 *
 * @note Thread-safe after @ref spaghetti_field_update_init.
 */
bool spaghetti_field_update_node_matches(uint32_t dest);

/**
 * @brief Sweep the CAN bus and copy every Backbone that answers Discover.
 *
 * The local board is always included. Remaining peers are the Discover
 * responses collected for a short window. Rows are ordered USB/local first,
 * then increasing @c node_id. That index is only a list handle, not the
 * cable slot: boards can be swapped and CAN cannot see physical order.
 * Use @ref spaghetti_field_update_blink to see which board sits where.
 *
 * @param[out] out Caller-owned table, or NULL when only @p count is needed.
 * @param[in] max Number of entries at @p out; ignored when @p out is NULL.
 * @param[out] count Receives the number of copied peers, or the full count
 *                   when @p out is NULL.
 *
 * @retval 0 The table was copied. A missing CAN adapter still returns the
 *           local row.
 * @retval -EINVAL @p count is NULL, or @p out is NULL while @p max is not
 *                 zero.
 *
 * @note Thread context only. Blocks for the Discover window when CAN is up.
 */
int spaghetti_field_update_discover(struct spaghetti_slup_peer *out, size_t max,
				    size_t *count);

/**
 * @brief Copy the last Discover table without touching the CAN bus.
 *
 * Used by GET_STATUS so the host can drop peers that stopped answering
 * the periodic sweep. The local row is always present after init.
 *
 * @param[out] out Caller-owned table, or NULL when only @p count is needed.
 * @param[in] max Number of entries at @p out; ignored when @p out is NULL.
 * @param[out] count Receives the number of copied peers.
 *
 * @retval 0 The table was copied.
 * @retval -EINVAL @p count is NULL, or @p out is NULL while @p max is not
 *                 zero.
 * @retval -EAGAIN @ref spaghetti_field_update_init has not completed.
 *
 * @note Thread-safe after @ref spaghetti_field_update_init.
 */
int spaghetti_field_update_copy_peers(struct spaghetti_slup_peer *out,
				      size_t max, size_t *count);

/**
 * @brief Copy local and last-reported remote NFC tags.
 *
 * Local tags come from the ST25 poller. Remote tags are the last SLUP
 * NFC replies collected during the periodic Discover sweep.
 *
 * @param[out] out Caller-owned table, or NULL when only @p count is needed.
 * @param[in] max Number of entries at @p out; ignored when @p out is NULL.
 * @param[out] count Receives the number of copied tags.
 *
 * @retval 0 The table was copied.
 * @retval -EINVAL @p count is NULL, or @p out is NULL while @p max is not
 *                 zero.
 *
 * @note Thread-safe after @ref spaghetti_field_update_init.
 */
int spaghetti_field_update_copy_nfc_tags(struct spaghetti_nfc_tag *out,
					 size_t max, size_t *count);

/**
 * @brief Put one addressed Backbone into SLUP load mode.
 *
 * Sends the existing EnterUpdate command (0x03) on the CAN transceiver.
 * Only that board will accept the following image frames.
 *
 * @param[in] dest_node_id 24-bit node identifier of the target.
 *
 * @retval 0 The target ACKed EnterUpdate.
 * @retval -EINVAL @p dest_node_id is broadcast, zero, or this board.
 * @retval -ENOTSUP The CAN adapter is not compiled.
 * @retval -ETIMEDOUT The target did not ACK.
 * @retval -errno The CAN adapter failed to send.
 *
 * @note Thread context only. Blocks until the ACK or timeout.
 */
int spaghetti_field_update_enter_update(uint32_t dest_node_id);

/**
 * @brief Pulse STATUS LED D5 on one Backbone so its cable slot is visible.
 *
 * Physical order is not on the CAN bus and is not stored on the board: the
 * same @c node_id can sit in any slot after a swap. Blinking that board is
 * how the current position is observed.
 *
 * @param[in] dest_node_id Local node or a peer from Discover.
 * @param[in] flashes Pulse count, or zero for the default of five.
 *
 * @retval 0 The LED sequence finished, or the peer ACKed after blinking.
 * @retval -EINVAL @p dest_node_id or @p flashes is invalid.
 * @retval -ENOTSUP The CAN adapter is not compiled and the target is remote.
 * @retval -ETIMEDOUT The peer did not finish the blink.
 * @retval -errno The CAN adapter failed to send.
 *
 * @note Thread context only. Blocks for the blink duration.
 */
int spaghetti_field_update_blink(uint32_t dest_node_id, uint8_t flashes);

/**
 * @brief Write a chain slot onto one addressed Backbone.
 *
 * @param[in] dest_node_id 24-bit node identifier of the target.
 * @param[in] index 1..@ref SPAGHETTI_SLUP_PEERS_MAX.
 *
 * @retval 0 The target stored the slot.
 * @retval -EINVAL @p dest_node_id or @p index is invalid.
 * @retval -ENOTSUP The CAN adapter is not compiled.
 * @retval -ETIMEDOUT The target did not ACK.
 * @retval -errno The CAN adapter failed to send.
 *
 * @note Thread context only. Blocks until the ACK or timeout.
 */
int spaghetti_field_update_assign_chain(uint32_t dest_node_id, uint8_t index);

/**
 * @brief Assign 1..N from the current Discover order and push the slots.
 *
 * Writes session labels 1..N in Discover list order (USB/this first, then
 * @c node_id). That is not the cable order after a swap. Blink first, then
 * @ref spaghetti_field_update_assign_chain if a slot label is needed.
 *
 * @retval 0 Every reachable board stored a slot.
 * @retval -errno Discover or an addressed assign failed.
 *
 * @note Thread context only. Blocks for Discover plus one ACK per peer.
 */
int spaghetti_field_update_number_chain(void);

/**
 * @brief Open a field-update session for one inbound image.
 *
 * @param[in] transport CAN or ESP-NOW adapter that received Begin.
 * @param[in] image_size Exact candidate byte count.
 * @param[in] image_crc32 IEEE CRC-32 of the candidate, or zero to skip the check.
 *
 * @retval 0 The session is receiving, including an identical Begin retry.
 * @retval -EINVAL @p transport or @p image_size is invalid.
 * @retval -ENOSPC @p image_size exceeds the secondary slot.
 * @retval -errno Update arm/begin failed.
 *
 * @note Thread context only.
 */
int spaghetti_field_update_ingest_begin(enum spaghetti_update_transport transport,
					uint32_t image_size,
					uint32_t image_crc32);

/**
 * @brief Append one contiguous field-update chunk.
 *
 * @param[in] transport Adapter that owns the session.
 * @param[in] offset Zero-based byte offset; must equal bytes already written,
 *                   or fall entirely inside the already-written prefix.
 * @param[in] data Caller-owned bytes borrowed only for this call.
 * @param[in] data_size Number of bytes at @p data; must be non-zero.
 *
 * @retval 0 The chunk was accepted or was a complete replay.
 * @retval -EINVAL A pointer, size, or offset contract is invalid.
 * @retval -EPERM No session is receiving on @p transport.
 * @retval -errno Update write failed.
 *
 * @note Thread context only.
 */
int spaghetti_field_update_ingest_data(enum spaghetti_update_transport transport,
				       uint32_t offset, const uint8_t *data,
				       size_t data_size);

/**
 * @brief Finalize the inbound candidate after the last data chunk.
 *
 * @param[in] transport Adapter that owns the session.
 * @param[in] image_size Must match the Begin size.
 * @param[in] image_crc32 Must match the Begin CRC when that CRC was non-zero.
 *
 * @retval 0 Update entered PENDING_REBOOT.
 * @retval -EINVAL @p transport is invalid.
 * @retval -EPERM No session is receiving on @p transport.
 * @retval -EBADMSG Size or CRC does not match the received bytes.
 * @retval -errno Update finish failed.
 *
 * @note Thread context only. The caller sends the transport ACK before reboot.
 */
int spaghetti_field_update_ingest_end(enum spaghetti_update_transport transport,
				      uint32_t image_size,
				      uint32_t image_crc32);

/**
 * @brief Send the running signed image to one peer on a field transport.
 *
 * On CAN this is SLUP: EnterUpdate for @p dest_node_id, then the image on
 * the same SN65HVD230 transceiver. Broadcast is rejected; name the target
 * from Discover.
 *
 * @param[in] transport CAN or ESP-NOW adapter.
 * @param[in] dest_node_id Target node, or
 *                         @ref SPAGHETTI_FIELD_UPDATE_BROADCAST on ESP-NOW.
 *
 * @retval 0 The target ACKed the complete image.
 * @retval -EINVAL @p transport is not a field adapter, or CAN dest is
 *                 missing, broadcast, or this board.
 * @retval -ENOTSUP The selected adapter is not compiled.
 * @retval -EIO The running slot could not be read.
 * @retval -ETIMEDOUT A required ACK did not arrive.
 * @retval -errno A transport or Update helper failed.
 *
 * @note Thread context only. Blocks for the duration of the transfer.
 */
int spaghetti_field_update_send(enum spaghetti_update_transport transport,
				uint32_t dest_node_id);

/**
 * @brief Consume one USB Serial/JTAG byte while a host SLUP recv is armed.
 *
 * @param[in] byte Next UART byte from the PC.
 *
 * @return true when the byte was queued for @c slup recv. false when no recv
 *         is armed and the USB adapter must keep the byte.
 *
 * @note ISR-safe. Does not send CAN frames.
 */
bool spaghetti_field_update_usb_feed(uint8_t byte);

/**
 * @brief Stream a host-supplied image from USB onto one CAN peer.
 *
 * Reads an 8-byte little-endian header (size, IEEE CRC-32) and the payload
 * from USB, then runs EnterUpdate and the CAN image frames. The PC owns the
 * file path; this board only forwards bytes.
 *
 * @param[in] dest_node_id Target peer. Must not be this board.
 *
 * @retval 0 The peer ACKed the complete image.
 * @retval -EINVAL @p dest_node_id is this board, zero, or broadcast.
 * @retval -EIO The USB stream overflowed or the header is invalid.
 * @retval -ETIMEDOUT USB or CAN stalled.
 * @retval -errno EnterUpdate or a CAN frame failed.
 *
 * @note Thread context only. Blocks for the transfer. Prints SLUP_RECV and
 *       SLUP_OK for the host tool.
 */
int spaghetti_field_update_recv_usb(uint32_t dest_node_id);

#endif /* SPAGHETTI_FIELD_UPDATE_H */
