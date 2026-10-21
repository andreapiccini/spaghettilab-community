#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/core.h>
#include <spaghetti/field_update.h>
#include <spaghetti/identity.h>
#include <spaghetti/physical.h>
#include <spaghetti/update.h>

#include "field_update_internal.h"
#include "status_led_policy.h"

static int physical_apply_calls;
int spaghetti_physical_describe(uint8_t out[SPAGHETTI_PHYSICAL_SIZE])
{
	ARG_UNUSED(out);
	return -ENOTSUP;
}
int spaghetti_physical_apply_config(const uint8_t modes[4], uint8_t speed,
	const uint8_t expected[SPAGHETTI_PHYSICAL_EXPECTED_SIZE], const uint8_t config[20])
{
	zassert_not_null(modes);
	zassert_not_null(expected);
	zassert_equal(speed, 0U);
	ARG_UNUSED(config);
	++physical_apply_calls;
	return 0;
}

int spaghetti_physical_apply_config_extended(const uint8_t *modes,uint8_t count,uint8_t speed,const uint8_t expected[20],const uint8_t config[20])
{
 zassert_true(count==4 || count==8);
 return spaghetti_physical_apply_config(modes,speed,expected,config);
}
static int arm_calls;
static int begin_calls;
static int write_calls;
static int finish_calls;
static int cancel_calls;
static int next_arm_error;
static int next_begin_error;
static int next_write_error;
static int next_finish_error;
static uint32_t last_write_offset;
static size_t last_write_size;
static bool last_write_last;
static enum spaghetti_update_transport last_begin_transport;
static uint8_t written_bytes[16];

static void reset_fakes(void)
{
	arm_calls = 0;
	begin_calls = 0;
	write_calls = 0;
	finish_calls = 0;
	cancel_calls = 0;
	next_arm_error = 0;
	next_begin_error = 0;
	next_write_error = 0;
	next_finish_error = 0;
	last_write_offset = 0U;
	last_write_size = 0U;
	last_write_last = false;
	last_begin_transport = SPAGHETTI_UPDATE_TRANSPORT_NONE;
	memset(written_bytes, 0, sizeof(written_bytes));
}

int spaghetti_core_get_info(struct spaghetti_core_info *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	memset(out, 0, sizeof(*out));
	memcpy(out->version, "1.2.3+0", 8);
	return 0;
}

int spaghetti_identity_get(struct spaghetti_identity *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	memset(out, 0, sizeof(*out));
	out->device_id[0] = 0xAAU;
	out->device_id[1] = 0xBBU;
	out->device_id[2] = 0xCCU;
	out->device_id[3] = 0x11U;
	out->device_id[4] = 0x22U;
	out->device_id[5] = 0x33U;
	return 0;
}

int spaghetti_update_get_capacity(size_t *out_size)
{
	if (out_size == NULL) {
		return -EINVAL;
	}

	*out_size = 4096U;
	return 0;
}

int spaghetti_update_arm(uint32_t timeout_ms)
{
	ARG_UNUSED(timeout_ms);
	++arm_calls;
	if (next_arm_error != 0) {
		const int err = next_arm_error;

		next_arm_error = 0;
		return err;
	}
	return 0;
}

int spaghetti_update_begin(enum spaghetti_update_transport transport)
{
	++begin_calls;
	last_begin_transport = transport;
	if (next_begin_error != 0) {
		const int err = next_begin_error;

		next_begin_error = 0;
		return err;
	}
	return 0;
}

int spaghetti_update_write(uint32_t offset, const uint8_t *data,
			   size_t data_size, bool last)
{
	++write_calls;
	last_write_offset = offset;
	last_write_size = data_size;
	last_write_last = last;
	if ((data != NULL) && (offset + data_size) <= sizeof(written_bytes)) {
		memcpy(&written_bytes[offset], data, data_size);
	}
	if (next_write_error != 0) {
		const int err = next_write_error;

		next_write_error = 0;
		return err;
	}
	return 0;
}

int spaghetti_update_finish(void)
{
	++finish_calls;
	if (next_finish_error != 0) {
		const int err = next_finish_error;

		next_finish_error = 0;
		return err;
	}
	return 0;
}

int spaghetti_update_cancel(void)
{
	++cancel_calls;
	return 0;
}

ZTEST(field_update, test_node_match_and_ingest)
{
	static const uint8_t image[] = { 0x01U, 0x02U, 0x03U, 0x04U };
	const uint32_t crc = spaghetti_field_update_crc32(image, sizeof(image));

	reset_fakes();
	zassert_equal(spaghetti_field_update_init(), -EALREADY);
	zassert_equal(spaghetti_field_update_local_node_id(), 0x112233U);
	zassert_true(spaghetti_field_update_node_matches(
		SPAGHETTI_FIELD_UPDATE_BROADCAST));
	zassert_true(spaghetti_field_update_node_matches(0U));
	zassert_true(spaghetti_field_update_node_matches(0x112233U));
	zassert_false(spaghetti_field_update_node_matches(0x445566U));

	zassert_equal(spaghetti_field_update_ingest_begin(
		SPAGHETTI_UPDATE_TRANSPORT_UART, 4U, crc), -EINVAL);
	zassert_equal(spaghetti_field_update_ingest_begin(
		SPAGHETTI_UPDATE_TRANSPORT_CAN, 0U, crc), -EINVAL);
	zassert_ok(spaghetti_field_update_ingest_begin(
		SPAGHETTI_UPDATE_TRANSPORT_CAN, sizeof(image), crc));
	zassert_equal(last_begin_transport, SPAGHETTI_UPDATE_TRANSPORT_CAN);
	zassert_ok(spaghetti_field_update_ingest_begin(
		SPAGHETTI_UPDATE_TRANSPORT_CAN, sizeof(image), crc));
	zassert_equal(begin_calls, 1);

	zassert_ok(spaghetti_field_update_ingest_data(
		SPAGHETTI_UPDATE_TRANSPORT_CAN, 0U, image, 2U));
	zassert_equal(spaghetti_field_update_ingest_data(
		SPAGHETTI_UPDATE_TRANSPORT_CAN, 1U, &image[1], 2U),
		-EINVAL);
	zassert_ok(spaghetti_field_update_ingest_data(
		SPAGHETTI_UPDATE_TRANSPORT_CAN, 2U, &image[2], 2U));
	zassert_true(last_write_last);
	zassert_ok(spaghetti_field_update_ingest_end(
		SPAGHETTI_UPDATE_TRANSPORT_CAN, sizeof(image), crc));
	zassert_equal(finish_calls, 1);
	zassert_mem_equal(written_bytes, image, sizeof(image));
}

ZTEST(field_update, test_crc_mismatch_and_missing_backend)
{
	static const uint8_t image[] = { 0x10U, 0x20U };

	reset_fakes();
	zassert_ok(spaghetti_field_update_ingest_begin(
		SPAGHETTI_UPDATE_TRANSPORT_ESPNOW, sizeof(image), 0xDEADBEEFU));
	zassert_ok(spaghetti_field_update_ingest_data(
		SPAGHETTI_UPDATE_TRANSPORT_ESPNOW, 0U, image, sizeof(image)));
	zassert_equal(spaghetti_field_update_ingest_end(
		SPAGHETTI_UPDATE_TRANSPORT_ESPNOW, sizeof(image),
		0xDEADBEEFU), -EBADMSG);
	zassert_equal(finish_calls, 0);
	zassert_equal(spaghetti_field_update_send(
		SPAGHETTI_UPDATE_TRANSPORT_CAN,
		SPAGHETTI_FIELD_UPDATE_BROADCAST), -ENOTSUP);
	zassert_equal(spaghetti_field_update_send(
		SPAGHETTI_UPDATE_TRANSPORT_CAN, 0x445566U), -ENOTSUP);
	zassert_equal(spaghetti_field_update_send(
		SPAGHETTI_UPDATE_TRANSPORT_UART, 0U), -EINVAL);
}

ZTEST(field_update, test_slup_identity_discover_and_number)
{
	struct spaghetti_slup_peer peers[SPAGHETTI_SLUP_PEERS_MAX];
	size_t count = 0U;

	reset_fakes();
	zassert_equal(spaghetti_field_update_local_node_id(), 0x112233U);
	zassert_ok(spaghetti_field_update_set_chain_index(
		SPAGHETTI_SLUP_CHAIN_UNKNOWN));
	zassert_equal(spaghetti_field_update_local_chain_index(),
		      SPAGHETTI_SLUP_CHAIN_UNKNOWN);
	zassert_equal(spaghetti_field_update_set_chain_index(9U), -EINVAL);
	zassert_ok(spaghetti_field_update_set_chain_index(2U));
	zassert_equal(spaghetti_field_update_local_chain_index(), 2U);

	zassert_equal(spaghetti_field_update_enter_update(0x112233U),
		      -EINVAL);
	zassert_equal(spaghetti_field_update_enter_update(0x445566U),
		      -ENOTSUP);
	zassert_equal(spaghetti_field_update_assign_chain(0x445566U, 3U),
		      -ENOTSUP);

	zassert_ok(spaghetti_field_update_discover(peers, ARRAY_SIZE(peers),
						   &count));
	zassert_equal(count, 1U);
	zassert_equal(peers[0].node_id, 0x112233U);
	zassert_true((peers[0].flags & SPAGHETTI_SLUP_FLAG_LOCAL) != 0U);
	zassert_equal(peers[0].mac[3], 0x11U);
	zassert_equal(peers[0].mac[5], 0x33U);
	zassert_mem_equal(peers[0].version, "1.2.3+0", 8);

	count = 0U;
	zassert_ok(spaghetti_field_update_copy_peers(peers, ARRAY_SIZE(peers),
						     &count));
	zassert_equal(count, 1U);
	zassert_equal(peers[0].node_id, 0x112233U);

	{
		struct spaghetti_nfc_tag tags[SPAGHETTI_NFC_TAGS_MAX];
		size_t nfc_count = 99U;

		zassert_ok(spaghetti_field_update_copy_nfc_tags(
			tags, ARRAY_SIZE(tags), &nfc_count));
		zassert_equal(nfc_count, 0U);
		zassert_equal(spaghetti_field_update_copy_nfc_tags(NULL, 1U,
								  &nfc_count),
			      -EINVAL);
	}
	zassert_equal(spaghetti_field_update_copy_peers(NULL, 1U, &count),
		      -EINVAL);

	zassert_ok(spaghetti_field_update_number_chain());
	zassert_equal(spaghetti_field_update_local_chain_index(), 1U);

	/* native_sim has no Backbone PWM LED. */
	zassert_equal(spaghetti_field_update_blink(0x112233U, 1U), -ENOTSUP);
	zassert_equal(spaghetti_field_update_blink(0U, 1U), -EINVAL);
	zassert_equal(spaghetti_field_update_blink(0x445566U, 1U), -ENOTSUP);
	zassert_false(spaghetti_field_update_usb_feed(0x00));
	zassert_equal(spaghetti_field_update_recv_usb(0x112233U), -EINVAL);
}

ZTEST(field_update, test_progress_ack_does_not_complete_begin)
{
	uint8_t status = 0xFFU;

	spaghetti_field_update_prepare_ack();
	spaghetti_field_update_note_ack(SPAGHETTI_ESPNOW_OTA_BEGIN, 40U,
					SPAGHETTI_SLUP_ACK_PROGRESS, 0U);
	zassert_ok(spaghetti_field_update_wait_ack(SPAGHETTI_ESPNOW_OTA_BEGIN,
						   0U, &status, K_NO_WAIT));
	zassert_equal(status, SPAGHETTI_SLUP_ACK_PROGRESS);
	zassert_equal(spaghetti_field_update_last_ack_value(), 40U);

	spaghetti_field_update_prepare_ack();
	spaghetti_field_update_note_ack(SPAGHETTI_ESPNOW_OTA_BEGIN, 0U, 0U, 0U);
	status = 0xFFU;
	zassert_ok(spaghetti_field_update_wait_ack(SPAGHETTI_ESPNOW_OTA_BEGIN,
						   0U, &status, K_NO_WAIT));
	zassert_equal(status, 0U);
}

static void *field_update_setup(void)
{
	reset_fakes();
	zassert_ok(spaghetti_field_update_init());
	return NULL;
}

ZTEST(field_update, test_local_physical_apply_routes_directly)
{
	const uint8_t modes[4] = {4, 5, 0, 0};
	const uint8_t expected[SPAGHETTI_PHYSICAL_EXPECTED_SIZE] = {0};
	const int before = physical_apply_calls;
	zassert_ok(spaghetti_field_update_apply_physical_config(0, modes, 0, expected, NULL));
	zassert_equal(physical_apply_calls, before + 1);
}

ZTEST_SUITE(field_update, NULL, field_update_setup, NULL, NULL, NULL);

/* A blank tag must leave the reader over CAN even without SLM1 metadata. */
extern bool test_nfc_present;
K_SEM_DEFINE(nfc_reply_sem, 0, 4);
static uint8_t nfc_reply_parts[4][8];
int spaghetti_field_update_can_reply(uint32_t node, const uint8_t *data, uint8_t dlc)
{
 ARG_UNUSED(node);
 if (dlc == 8U && data[0] == SPAGHETTI_SLUP_RSP_NFC) {
  uint8_t part = data[1] & 15U;
  if (part < 4U) {
   memcpy(nfc_reply_parts[part], data, 8U);
   k_sem_give(&nfc_reply_sem);
  }
 }
 return 0;
}
ZTEST(field_update, test_blank_tag_can_snapshot)
{
 const uint8_t command = SPAGHETTI_SLUP_CMD_NFC;
 k_sem_reset(&nfc_reply_sem);
 memset(nfc_reply_parts, 0, sizeof(nfc_reply_parts));
 test_nfc_present = true;
 int posted = spaghetti_field_update_post_can(
  SPAGHETTI_SLUP_TWAI_NODE_CMD_BASE | 0x112233U, &command, 1U);
 if (posted != 0) test_nfc_present = false;
 zassert_ok(posted);
 int received = 0;
 for (; received < 4; ++received) {
  if (k_sem_take(&nfc_reply_sem, K_SECONDS(1)) != 0) break;
 }
 test_nfc_present = false;
 zassert_equal(received, 4, "blank tag must send all four CAN parts");
 zassert_equal(nfc_reply_parts[0][4], 7U);
 zassert_equal(nfc_reply_parts[0][5], 2U);
 zassert_equal(nfc_reply_parts[1][2], 3U);
 const uint8_t zero_metadata[4] = {0};
 zassert_mem_equal(&nfc_reply_parts[2][2], zero_metadata, 4U);
}

int spaghetti_communication_emit_discovery(uint32_t candidate, uint8_t port,
                                           uint32_t generation)
{
 ARG_UNUSED(candidate); ARG_UNUSED(port); ARG_UNUSED(generation);
 return 0;
}

ZTEST(field_update, test_idle_led_breathing_wave)
{
 zassert_equal(spaghetti_status_led_idle_percent(0),0);
 zassert_equal(spaghetti_status_led_idle_percent(500),12);
 zassert_equal(spaghetti_status_led_idle_percent(1000),25);
 zassert_equal(spaghetti_status_led_idle_percent(1500),12);
 zassert_equal(spaghetti_status_led_idle_percent(2000),0);
 for(uint32_t t=0;t<8000;t+=40)zassert_true(spaghetti_status_led_idle_percent(t)<=25);
}
