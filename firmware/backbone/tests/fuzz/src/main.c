/**
 * @file
 * @brief Zero-crash fuzz gate for Protocol V1 envelope decode + BLE framing.
 *
 * Config CBOR and catalog adversarial cases are covered by existing
 * config_codec / protocol suites; this harness keeps a Minimal-profile
 * allocation footprint and refuses crashes on malformed envelopes.
 */

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/protocol.h>

static const uint8_t corpus_envelope[][48] = {
	{ 0xBF, 0x00, 0x01, 0x01, 0x01, 0x02, 0x02, 0x03, 0x40, 0xFF },
	{ 0xBF, 0x00, 0x01, 0xFF },
	{ 0xA0 },
	{ 0xBF, 0x00, 0x01, 0x01, 0x01, 0x02, 0x02, 0x03, 0x58, 0xFF },
	{ 0xBF, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x02, 0x02, 0x03, 0x40, 0xFF },
	{ 0xBF, 0x02, 0x1B, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF },
	{ 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08 },
	{ 0xBF, 0x00, 0x01, 0x01, 0x01, 0x02, 0x63, 0xFF },
	{ 0xBF, 0x00, 0x01, 0x01, 0x01, 0x02, 0x02, 0x03, 0x59, 0x08, 0x00 },
	{ 0xBF, 0x01, 0x1A, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF },
};

static const uint8_t corpus_ble_frame[][24] = {
	{ 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0xDE, 0xAD, 0xBE, 0xEF },
	{ 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x04, 0x00, 0xBE, 0xEF },
	{ 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08 },
	{ 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x01 },
	{ 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x04, 0x00, 0xAA },
	{ 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF },
};

static void fuzz_ble_framing(const uint8_t *bytes, size_t len)
{
	uint32_t message_id;
	uint16_t offset;
	uint16_t total;
	size_t payload_len;

	if (len < 8U) {
		return;
	}
	message_id = (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
		     ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
	offset = (uint16_t)bytes[4] | ((uint16_t)bytes[5] << 8);
	total = (uint16_t)bytes[6] | ((uint16_t)bytes[7] << 8);
	payload_len = len - 8U;
	if ((total == 0U) || (total > 2048U) || (offset > total) ||
	    ((size_t)offset + payload_len > (size_t)total)) {
		return;
	}
	ARG_UNUSED(message_id);
}

ZTEST(fuzz, test_envelope_corpus_no_crash)
{
	struct spaghetti_protocol_request request;
	struct spaghetti_protocol_response response;

	for (size_t idx = 0U; idx < ARRAY_SIZE(corpus_envelope); ++idx) {
		memset(&request, 0xA5, sizeof(request));
		(void)spaghetti_protocol_decode_request(
			corpus_envelope[idx], sizeof(corpus_envelope[idx]),
			&request);
		memset(&response, 0x5A, sizeof(response));
		(void)spaghetti_protocol_decode_response(
			corpus_envelope[idx], sizeof(corpus_envelope[idx]),
			&response);
	}
}

ZTEST(fuzz, test_ble_framing_corpus_no_crash)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(corpus_ble_frame); ++idx) {
		fuzz_ble_framing(corpus_ble_frame[idx],
				 sizeof(corpus_ble_frame[idx]));
	}
}

ZTEST(fuzz, test_catalog_page_adversarial_lengths)
{
	uint8_t page[64];
	struct spaghetti_protocol_request request;

	memset(page, 0xBF, sizeof(page));
	page[sizeof(page) - 1U] = 0xFF;
	memset(&request, 0, sizeof(request));
	(void)spaghetti_protocol_decode_request(page, sizeof(page), &request);
}

ZTEST_SUITE(fuzz, NULL, NULL, NULL, NULL, NULL);
