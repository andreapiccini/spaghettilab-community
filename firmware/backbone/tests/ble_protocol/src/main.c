#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <psa/crypto.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/access_control.h>
#include <spaghetti/ble.h>
#include <spaghetti/communication.h>
#include <spaghetti/core.h>
#include <spaghetti/identity.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/ota.h>
#include <spaghetti/protocol.h>
#include <spaghetti/record_delivery.h>

#include "ble_internal.h"

#define TEST_CREDENTIAL_ID 3U
#define TEST_PRINCIPAL_ID 9U

static enum spaghetti_maintenance_link_state maintenance_state =
	SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
static struct spaghetti_principal test_principal = {
	.id = TEST_PRINCIPAL_ID,
	.role = SPAGHETTI_ROLE_ADMINISTRATOR,
	.permissions = SPAGHETTI_PERMISSION_READ |
		       SPAGHETTI_PERMISSION_CONFIGURE |
		       SPAGHETTI_PERMISSION_COMMAND |
		       SPAGHETTI_PERMISSION_DISCOVER |
		       SPAGHETTI_PERMISSION_UPDATE,
	.enabled = true,
	.name = "ble-peer",
};
static bool principal_enabled = true;
static uint8_t last_request_bytes[SPAGHETTI_BLE_ENVELOPE_MAX];
static size_t last_request_size;
static struct spaghetti_protocol_response canned_response;
static int handle_request_calls;
static const uint8_t test_device_id[SPAGHETTI_DEVICE_ID_SIZE] = {
	0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
	0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01,
	0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
	0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11,
};
static const uint8_t test_key[SPAGHETTI_BLE_KEY_SIZE] = {
	0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27,
	0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
	0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
	0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
};

enum spaghetti_maintenance_link_state
spaghetti_maintenance_link_get_state(void)
{
	return maintenance_state;
}

int spaghetti_principal_get(
	spaghetti_principal_id_t id,
	struct spaghetti_principal *out)
{
	if ((out == NULL) || (id == 0U)) {
		return -EINVAL;
	}
	if (id != TEST_PRINCIPAL_ID) {
		return -ENOENT;
	}
	*out = test_principal;
	out->enabled = principal_enabled;
	return 0;
}

int spaghetti_core_get_info(struct spaghetti_core_info *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_core_info) {
		.mode = SPAGHETTI_CORE_MODE_NORMAL,
	};
	return 0;
}

int spaghetti_identity_get(struct spaghetti_identity *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	memcpy(out->device_id, test_device_id, sizeof(test_device_id));
	strncpy(out->device_name, "ble-test", sizeof(out->device_name) - 1U);
	return 0;
}

int spaghetti_communication_handle_request(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_request *request,
	struct spaghetti_protocol_response *response)
{
	int err;

	if ((context == NULL) || (request == NULL) || (response == NULL)) {
		return -EINVAL;
	}
	++handle_request_calls;
	err = spaghetti_protocol_encode_request(
		request, last_request_bytes, sizeof(last_request_bytes),
		&last_request_size);
	if (err < 0) {
		return err;
	}
	*response = canned_response;
	response->correlation_id = request->correlation_id;
	return 0;
}

void spaghetti_ota_ble_on_disconnect(void)
{
}

static void make_frame(
	uint32_t message_id,
	uint16_t offset,
	uint16_t total,
	const uint8_t *payload,
	size_t payload_size,
	uint8_t *out,
	size_t *out_size)
{
	struct spaghetti_ble_frame_header header = {
		.message_id = message_id,
		.offset = offset,
		.total = total,
	};

	zassert_ok(spaghetti_ble_frame_encode(&header, out, 8U + payload_size));
	if (payload_size > 0U) {
		memcpy(&out[8], payload, payload_size);
	}
	*out_size = 8U + payload_size;
}

static int compute_test_hmac(
	const uint8_t nonce[SPAGHETTI_BLE_NONCE_SIZE],
	uint32_t session_id,
	uint8_t out[SPAGHETTI_BLE_HMAC_SIZE])
{
	uint8_t message[SPAGHETTI_BLE_NONCE_SIZE + SPAGHETTI_DEVICE_ID_SIZE +
			4U];
	psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
	psa_key_id_t key_id = 0U;
	size_t mac_size = 0U;
	psa_status_t status;

	memcpy(message, nonce, SPAGHETTI_BLE_NONCE_SIZE);
	memcpy(&message[SPAGHETTI_BLE_NONCE_SIZE], test_device_id,
	       SPAGHETTI_DEVICE_ID_SIZE);
	sys_put_le32(session_id,
		     &message[SPAGHETTI_BLE_NONCE_SIZE +
			      SPAGHETTI_DEVICE_ID_SIZE]);

	zassert_equal(psa_crypto_init(), PSA_SUCCESS);
	psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_SIGN_MESSAGE);
	psa_set_key_algorithm(&attributes, PSA_ALG_HMAC(PSA_ALG_SHA_256));
	psa_set_key_type(&attributes, PSA_KEY_TYPE_HMAC);
	psa_set_key_bits(&attributes, SPAGHETTI_BLE_KEY_SIZE * 8U);
	status = psa_import_key(&attributes, test_key, sizeof(test_key),
				&key_id);
	zassert_equal(status, PSA_SUCCESS);
	status = psa_mac_compute(key_id, PSA_ALG_HMAC(PSA_ALG_SHA_256),
				 message, sizeof(message), out,
				 SPAGHETTI_BLE_HMAC_SIZE, &mac_size);
	zassert_equal(status, PSA_SUCCESS);
	zassert_equal(mac_size, SPAGHETTI_BLE_HMAC_SIZE);
	(void)psa_destroy_key(key_id);
	psa_reset_key_attributes(&attributes);
	return 0;
}

static void authenticate_peer(uint8_t peer_index)
{
	uint8_t challenge[SPAGHETTI_BLE_AUTH_CHALLENGE_SIZE];
	uint8_t proof[SPAGHETTI_BLE_AUTH_PROOF_SIZE];
	uint8_t hmac[SPAGHETTI_BLE_HMAC_SIZE];
	size_t challenge_size = 0U;
	uint32_t session_id;

	zassert_ok(spaghetti_ble_test_get_challenge(
		peer_index, challenge, sizeof(challenge), &challenge_size));
	zassert_equal(challenge_size, SPAGHETTI_BLE_AUTH_CHALLENGE_SIZE);
	zassert_equal(challenge[0], SPAGHETTI_BLE_AUTH_CHALLENGE_TYPE);
	session_id = sys_get_le32(&challenge[1]);
	zassert_ok(compute_test_hmac(&challenge[5], session_id, hmac));

	proof[0] = SPAGHETTI_BLE_AUTH_PROOF_TYPE;
	sys_put_le16(TEST_CREDENTIAL_ID, &proof[1]);
	memcpy(&proof[3], hmac, sizeof(hmac));
	zassert_ok(spaghetti_ble_inject_request(peer_index, proof,
						sizeof(proof)));
}

static void ble_before(void *fixture)
{
	struct spaghetti_ble_status status;

	ARG_UNUSED(fixture);
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	principal_enabled = true;
	handle_request_calls = 0;
	last_request_size = 0U;
	canned_response = (struct spaghetti_protocol_response) {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.status = SPAGHETTI_PROTOCOL_STATUS_OK,
		.payload = {
			.size = 2U,
			.bytes = {0xa1, 0x00},
		},
	};

	(void)spaghetti_ble_stop(K_MSEC(100));
	(void)spaghetti_ble_erase_credentials();
	zassert_ok(spaghetti_record_delivery_init(10U));
	zassert_ok(spaghetti_ble_test_set_device_id(test_device_id));
	zassert_ok(spaghetti_ble_credential_set(
		TEST_CREDENTIAL_ID, TEST_PRINCIPAL_ID, test_key));
	zassert_ok(spaghetti_ble_start());
	zassert_ok(spaghetti_ble_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_BLE_STATE_ADVERTISING);
}

static void ble_after(void *fixture)
{
	ARG_UNUSED(fixture);
	(void)spaghetti_ble_stop(K_MSEC(100));
	(void)spaghetti_ble_erase_credentials();
}

ZTEST(ble_protocol, test_framing_rejects_oversized_overlap_and_duplicate_id)
{
	struct spaghetti_ble_reassembly slot;
	uint8_t frame[64];
	uint8_t payload[8] = {1, 2, 3, 4, 5, 6, 7, 8};
	size_t frame_size = 0U;
	int64_t now = 1000;

	spaghetti_ble_reassembly_reset(&slot);
	make_frame(1U, 0U, (uint16_t)(SPAGHETTI_BLE_ENVELOPE_MAX + 1U),
		   payload, 1U, frame, &frame_size);
	zassert_equal(spaghetti_ble_reassembly_feed(
		&slot, frame, frame_size, now, 50), -EMSGSIZE);

	spaghetti_ble_reassembly_reset(&slot);
	make_frame(7U, 0U, 8U, payload, 4U, frame, &frame_size);
	zassert_equal(spaghetti_ble_reassembly_feed(
		&slot, frame, frame_size, now, 50), 0);
	make_frame(7U, 2U, 8U, payload, 4U, frame, &frame_size);
	zassert_equal(spaghetti_ble_reassembly_feed(
		&slot, frame, frame_size, now, 50), -EALREADY);

	spaghetti_ble_reassembly_reset(&slot);
	make_frame(8U, 0U, 8U, payload, 4U, frame, &frame_size);
	zassert_equal(spaghetti_ble_reassembly_feed(
		&slot, frame, frame_size, now, 50), 0);
	make_frame(9U, 4U, 8U, &payload[4], 4U, frame, &frame_size);
	zassert_equal(spaghetti_ble_reassembly_feed(
		&slot, frame, frame_size, now, 50), -EEXIST);

	spaghetti_ble_reassembly_reset(&slot);
	make_frame(10U, 0U, 4U, payload, 2U, frame, &frame_size);
	zassert_equal(spaghetti_ble_reassembly_feed(
		&slot, frame, frame_size, now, 50), 0);
	zassert_equal(spaghetti_ble_reassembly_feed(
		&slot, frame, frame_size, now + 100, 50), -ETIMEDOUT);
}

ZTEST(ble_protocol, test_auth_requires_application_proof)
{
	uint8_t peer = 0U;
	uint8_t frame[32];
	size_t frame_size = 0U;
	struct spaghetti_ble_status status;
	uint8_t payload[4] = {1, 2, 3, 4};

	zassert_ok(spaghetti_ble_test_connect(&peer));
	zassert_ok(spaghetti_ble_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_BLE_STATE_AUTHENTICATING);

	make_frame(1U, 0U, 4U, payload, 4U, frame, &frame_size);
	zassert_equal(spaghetti_ble_inject_request(peer, frame, frame_size),
		      -EBADMSG);
	zassert_ok(spaghetti_ble_get_status(&status));
	zassert_true(status.rx_rejected > 0U);
	zassert_equal(handle_request_calls, 0);
}

ZTEST(ble_protocol, test_credential_auth_revoke_and_protocol_bytes)
{
	uint8_t peer = 0U;
	uint8_t frame[SPAGHETTI_BLE_ENVELOPE_MAX + 8U];
	uint8_t encoded[SPAGHETTI_BLE_ENVELOPE_MAX];
	uint8_t indicated[SPAGHETTI_BLE_ENVELOPE_MAX + 8U];
	uint8_t expected_response[SPAGHETTI_BLE_ENVELOPE_MAX];
	size_t encoded_size = 0U;
	size_t frame_size = 0U;
	size_t indicated_size = 0U;
	size_t expected_size = 0U;
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 42U,
		.operation = SPAGHETTI_PROTOCOL_GET_CATALOG,
		.payload = {
			.size = 1U,
			.bytes = {0xa0},
		},
	};
	struct spaghetti_ble_status status;
	struct spaghetti_record_consumer_status consumer;
	bool exists = false;

	zassert_ok(spaghetti_ble_credential_exists(TEST_CREDENTIAL_ID,
						   &exists));
	zassert_true(exists);

	zassert_ok(spaghetti_ble_test_connect(&peer));
	authenticate_peer(peer);
	zassert_ok(spaghetti_ble_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_BLE_STATE_CONNECTED);
	zassert_ok(spaghetti_record_delivery_get_consumer_status(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, &consumer));
	zassert_true(consumer.active);

	zassert_ok(spaghetti_protocol_encode_request(
		&request, encoded, sizeof(encoded), &encoded_size));
	make_frame(11U, 0U, (uint16_t)encoded_size, encoded, encoded_size,
		   frame, &frame_size);
	zassert_ok(spaghetti_ble_inject_request(peer, frame, frame_size));
	zassert_equal(handle_request_calls, 1);
	zassert_equal(last_request_size, encoded_size);
	zassert_mem_equal(last_request_bytes, encoded, encoded_size);

	canned_response.correlation_id = 42U;
	zassert_ok(spaghetti_protocol_encode_response(
		&canned_response, expected_response, sizeof(expected_response),
		&expected_size));
	zassert_ok(spaghetti_ble_test_get_response(
		peer, indicated, sizeof(indicated), &indicated_size));
	zassert_true(indicated_size >= 8U + expected_size);
	zassert_mem_equal(&indicated[8], expected_response, expected_size);

	principal_enabled = false;
	spaghetti_ble_close_peers_for_principal(TEST_PRINCIPAL_ID);
	zassert_ok(spaghetti_ble_get_status(&status));
	zassert_equal(status.peer_count, 0U);
	zassert_ok(spaghetti_record_delivery_get_consumer_status(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, &consumer));
	zassert_false(consumer.active);
}

ZTEST(ble_protocol, test_stop_releases_resources)
{
	uint8_t peer = 0U;
	struct spaghetti_ble_status status;
	struct spaghetti_record_consumer_status consumer;

	zassert_ok(spaghetti_ble_test_connect(&peer));
	authenticate_peer(peer);
	zassert_ok(spaghetti_ble_stop(K_MSEC(100)));
	zassert_ok(spaghetti_ble_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_BLE_STATE_OFF);
	zassert_equal(status.peer_count, 0U);
	zassert_equal(spaghetti_ble_inject_request(peer, (uint8_t[]){1}, 1U),
		      -EACCES);
	zassert_ok(spaghetti_record_delivery_get_consumer_status(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, &consumer));
	zassert_false(consumer.active);
	zassert_equal(spaghetti_ble_stop(K_MSEC(100)), -EALREADY);
}

ZTEST_SUITE(ble_protocol, NULL, NULL, ble_before, ble_after, NULL);
