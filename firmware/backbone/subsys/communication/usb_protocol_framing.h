#ifndef SPAGHETTI_USB_PROTOCOL_FRAMING_H
#define SPAGHETTI_USB_PROTOCOL_FRAMING_H

#include <stddef.h>
#include <stdint.h>

#include <spaghetti/protocol.h>

/** Same kind bytes as the TypeScript StreamFrameDecoder. */
#define SPAGHETTI_USB_FRAME_KIND_RESPONSE 0x00U
#define SPAGHETTI_USB_FRAME_KIND_EVENT 0x01U
#define SPAGHETTI_USB_FRAME_KIND_REQUEST 0x02U

/** Kind + big-endian uint32 length. */
#define SPAGHETTI_USB_FRAME_HEADER_SIZE 5U

/** CBOR envelope ceiling: profile payload plus bounded map overhead. */
#define SPAGHETTI_USB_ENVELOPE_MAX \
	(SPAGHETTI_PROTOCOL_PAYLOAD_MAX + 64U)

#define SPAGHETTI_USB_FRAME_MAX \
	(SPAGHETTI_USB_FRAME_HEADER_SIZE + SPAGHETTI_USB_ENVELOPE_MAX)

enum spaghetti_usb_frame_push {
	SPAGHETTI_USB_FRAME_NEED_MORE = 0,
	SPAGHETTI_USB_FRAME_READY = 1,
	SPAGHETTI_USB_FRAME_DROP = 2,
};

struct spaghetti_usb_frame_decoder {
	uint8_t bytes[SPAGHETTI_USB_FRAME_MAX];
	size_t filled;
};

/**
 * @brief Append one byte to a stream-frame decoder.
 *
 * A ready frame has kind @c SPAGHETTI_USB_FRAME_KIND_REQUEST. Oversize length,
 * truncated leftover after a drop, or a non-request kind resets @p decoder.
 */
enum spaghetti_usb_frame_push spaghetti_usb_frame_decoder_push(
	struct spaghetti_usb_frame_decoder *decoder,
	uint8_t byte);

void spaghetti_usb_frame_decoder_reset(
	struct spaghetti_usb_frame_decoder *decoder);

uint8_t spaghetti_usb_frame_kind(
	const struct spaghetti_usb_frame_decoder *decoder);

const uint8_t *spaghetti_usb_frame_envelope(
	const struct spaghetti_usb_frame_decoder *decoder);

size_t spaghetti_usb_frame_envelope_size(
	const struct spaghetti_usb_frame_decoder *decoder);

int spaghetti_usb_frame_encode(
	uint8_t kind,
	const uint8_t *envelope,
	size_t envelope_size,
	uint8_t *out,
	size_t capacity,
	size_t *written);

#endif /* SPAGHETTI_USB_PROTOCOL_FRAMING_H */
