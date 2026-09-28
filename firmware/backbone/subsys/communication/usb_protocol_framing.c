#include "usb_protocol_framing.h"

#include <errno.h>
#include <string.h>

#include <zephyr/sys/byteorder.h>

void spaghetti_usb_frame_decoder_reset(
	struct spaghetti_usb_frame_decoder *decoder)
{
	if (decoder == NULL) {
		return;
	}

	decoder->filled = 0U;
}

static uint32_t decoder_length(
	const struct spaghetti_usb_frame_decoder *decoder)
{
	return sys_get_be32(&decoder->bytes[1]);
}

enum spaghetti_usb_frame_push spaghetti_usb_frame_decoder_push(
	struct spaghetti_usb_frame_decoder *decoder,
	uint8_t byte)
{
	uint32_t length;

	if (decoder == NULL) {
		return SPAGHETTI_USB_FRAME_DROP;
	}

	if (decoder->filled >= sizeof(decoder->bytes)) {
		spaghetti_usb_frame_decoder_reset(decoder);
		return SPAGHETTI_USB_FRAME_DROP;
	}

	decoder->bytes[decoder->filled] = byte;
	decoder->filled++;

	if (decoder->filled == 1U) {
		if (byte != SPAGHETTI_USB_FRAME_KIND_REQUEST) {
			spaghetti_usb_frame_decoder_reset(decoder);
			return SPAGHETTI_USB_FRAME_DROP;
		}
		return SPAGHETTI_USB_FRAME_NEED_MORE;
	}

	if (decoder->filled < SPAGHETTI_USB_FRAME_HEADER_SIZE) {
		return SPAGHETTI_USB_FRAME_NEED_MORE;
	}

	length = decoder_length(decoder);
	if (length > SPAGHETTI_USB_ENVELOPE_MAX) {
		spaghetti_usb_frame_decoder_reset(decoder);
		return SPAGHETTI_USB_FRAME_DROP;
	}
	if (decoder->filled < (SPAGHETTI_USB_FRAME_HEADER_SIZE + length)) {
		return SPAGHETTI_USB_FRAME_NEED_MORE;
	}

	return SPAGHETTI_USB_FRAME_READY;
}

uint8_t spaghetti_usb_frame_kind(
	const struct spaghetti_usb_frame_decoder *decoder)
{
	if ((decoder == NULL) || (decoder->filled == 0U)) {
		return 0xFFU;
	}

	return decoder->bytes[0];
}

const uint8_t *spaghetti_usb_frame_envelope(
	const struct spaghetti_usb_frame_decoder *decoder)
{
	if ((decoder == NULL) ||
	    (decoder->filled < SPAGHETTI_USB_FRAME_HEADER_SIZE)) {
		return NULL;
	}

	return &decoder->bytes[SPAGHETTI_USB_FRAME_HEADER_SIZE];
}

size_t spaghetti_usb_frame_envelope_size(
	const struct spaghetti_usb_frame_decoder *decoder)
{
	if ((decoder == NULL) ||
	    (decoder->filled < SPAGHETTI_USB_FRAME_HEADER_SIZE)) {
		return 0U;
	}

	return decoder_length(decoder);
}

int spaghetti_usb_frame_encode(
	uint8_t kind,
	const uint8_t *envelope,
	size_t envelope_size,
	uint8_t *out,
	size_t capacity,
	size_t *written)
{
	const size_t need = SPAGHETTI_USB_FRAME_HEADER_SIZE + envelope_size;

	if ((written == NULL) || (out == NULL) ||
	    ((envelope == NULL) && (envelope_size != 0U))) {
		return -EINVAL;
	}
	if (envelope_size > SPAGHETTI_USB_ENVELOPE_MAX) {
		return -EMSGSIZE;
	}
	if (capacity < need) {
		return -EMSGSIZE;
	}

	out[0] = kind;
	sys_put_be32((uint32_t)envelope_size, &out[1]);
	if (envelope_size > 0U) {
		memcpy(&out[SPAGHETTI_USB_FRAME_HEADER_SIZE], envelope,
		       envelope_size);
	}
	*written = need;
	return 0;
}
