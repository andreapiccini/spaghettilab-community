#include <errno.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/ztest.h>

#include "usb_protocol_framing.h"

ZTEST(usb_protocol, test_encode_roundtrip_and_split_push)
{
	uint8_t envelope[] = { 0xA1, 0x00, 0x01 };
	uint8_t frame[SPAGHETTI_USB_FRAME_MAX];
	struct spaghetti_usb_frame_decoder decoder = {0};
	size_t written = 0U;
	enum spaghetti_usb_frame_push result = SPAGHETTI_USB_FRAME_NEED_MORE;

	zassert_ok(spaghetti_usb_frame_encode(
		SPAGHETTI_USB_FRAME_KIND_REQUEST, envelope, sizeof(envelope),
		frame, sizeof(frame), &written));
	zassert_equal(written, 5U + sizeof(envelope));
	zassert_equal(frame[0], SPAGHETTI_USB_FRAME_KIND_REQUEST);
	zassert_equal(frame[1], 0U);
	zassert_equal(frame[2], 0U);
	zassert_equal(frame[3], 0U);
	zassert_equal(frame[4], (uint8_t)sizeof(envelope));

	for (size_t idx = 0U; idx < written; ++idx) {
		result = spaghetti_usb_frame_decoder_push(&decoder, frame[idx]);
		if (idx + 1U < written) {
			zassert_equal(result, SPAGHETTI_USB_FRAME_NEED_MORE);
		}
	}
	zassert_equal(result, SPAGHETTI_USB_FRAME_READY);
	zassert_equal(spaghetti_usb_frame_kind(&decoder),
		      SPAGHETTI_USB_FRAME_KIND_REQUEST);
	zassert_equal(spaghetti_usb_frame_envelope_size(&decoder),
		      sizeof(envelope));
	zassert_mem_equal(spaghetti_usb_frame_envelope(&decoder), envelope,
			  sizeof(envelope));
}

ZTEST(usb_protocol, test_rejects_non_request_and_oversize)
{
	struct spaghetti_usb_frame_decoder decoder = {0};
	uint8_t oversize[5] = {
		SPAGHETTI_USB_FRAME_KIND_REQUEST, 0x00, 0x00, 0x10, 0x00
	};

	zassert_equal(spaghetti_usb_frame_decoder_push(
			      &decoder, SPAGHETTI_USB_FRAME_KIND_RESPONSE),
		      SPAGHETTI_USB_FRAME_DROP);
	zassert_equal(decoder.filled, 0U);

	for (size_t idx = 0U; idx < sizeof(oversize); ++idx) {
		enum spaghetti_usb_frame_push result =
			spaghetti_usb_frame_decoder_push(&decoder,
							 oversize[idx]);

		if (idx + 1U < sizeof(oversize)) {
			zassert_equal(result, SPAGHETTI_USB_FRAME_NEED_MORE);
		} else {
			zassert_equal(result, SPAGHETTI_USB_FRAME_DROP);
		}
	}
	zassert_equal(decoder.filled, 0U);
}

ZTEST(usb_protocol, test_encode_rejects_oversize_and_null)
{
	uint8_t out[8];
	size_t written = 99U;

	zassert_equal(spaghetti_usb_frame_encode(
			      SPAGHETTI_USB_FRAME_KIND_RESPONSE, NULL, 1U, out,
			      sizeof(out), &written),
		      -EINVAL);
	zassert_equal(spaghetti_usb_frame_encode(
			      SPAGHETTI_USB_FRAME_KIND_RESPONSE, NULL, 0U, NULL,
			      sizeof(out), &written),
		      -EINVAL);
}

ZTEST_SUITE(usb_protocol, NULL, NULL, NULL, NULL, NULL);
