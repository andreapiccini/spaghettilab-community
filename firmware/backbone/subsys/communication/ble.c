#include <spaghetti/ble.h>

#include "ble_internal.h"

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <psa/crypto.h>

#if IS_ENABLED(CONFIG_SECURE_STORAGE)
#include <psa/internal_trusted_storage.h>
#endif

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/util.h>

#include <spaghetti/communication.h>
#include <spaghetti/core.h>
#include <spaghetti/identity.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/ota.h>
#include <spaghetti/protocol.h>
#include <spaghetti/record_delivery.h>

#if IS_ENABLED(CONFIG_BT)
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>
#endif

static void ble_ota_disconnect_notify(struct k_work *work);

K_WORK_DEFINE(ble_ota_disconnect_work, ble_ota_disconnect_notify);

static void ble_ota_disconnect_notify(struct k_work *work)
{
	ARG_UNUSED(work);
	spaghetti_ota_ble_on_disconnect();
}

LOG_MODULE_REGISTER(spaghetti_ble, CONFIG_SPAGHETTI_BLE_LOG_LEVEL);

#define SPAGHETTI_BLE_RECORD_UID_BASE ((psa_storage_uid_t)0x0057FFE3U)
#define SPAGHETTI_BLE_RECORD_MAGIC 0x5350424CU
#define SPAGHETTI_BLE_RECORD_VERSION 1U

#define SPAGHETTI_BLE_PEER_MAX CONFIG_SPAGHETTI_MAX_BLE_PEERS

struct spaghetti_ble_credential_record {
	uint32_t magic;
	uint8_t version;
	uint8_t reserved;
	uint16_t credential_id;
	spaghetti_principal_id_t principal_id;
	uint8_t key[SPAGHETTI_BLE_KEY_SIZE];
};

#if !IS_ENABLED(CONFIG_SECURE_STORAGE)
static struct spaghetti_ble_credential_record host_credentials[
	SPAGHETTI_BLE_CREDENTIAL_SLOTS];
static bool host_credential_used[SPAGHETTI_BLE_CREDENTIAL_SLOTS];
#endif

enum spaghetti_ble_peer_phase {
	SPAGHETTI_BLE_PEER_FREE = 0,
	SPAGHETTI_BLE_PEER_AUTHENTICATING,
	SPAGHETTI_BLE_PEER_AUTHENTICATED,
};

struct spaghetti_ble_peer {
	enum spaghetti_ble_peer_phase phase;
	spaghetti_principal_id_t principal_id;
	uint16_t credential_id;
	uint16_t mtu;
	uint32_t session_id;
	uint8_t nonce[SPAGHETTI_BLE_NONCE_SIZE];
	uint8_t challenge[SPAGHETTI_BLE_AUTH_CHALLENGE_SIZE];
	bool challenge_valid;
	struct spaghetti_ble_reassembly reassembly;
	uint8_t response[SPAGHETTI_BLE_FRAME_HEADER_SIZE +
			 SPAGHETTI_BLE_ENVELOPE_MAX];
	size_t response_size;
	uint8_t event_credit;
#if IS_ENABLED(CONFIG_BT)
	struct bt_conn *conn;
#endif
};

struct spaghetti_ble_context {
	enum spaghetti_ble_state state;
	bool started;
	bool radio_enabled;
	uint16_t negotiated_mtu;
	uint8_t peer_count;
	uint32_t rx_rejected;
	uint32_t event_dropped;
	uint32_t next_session_id;
	uint32_t next_message_id;
	bool device_id_override;
	uint8_t device_id[SPAGHETTI_DEVICE_ID_SIZE];
	struct spaghetti_ble_peer peers[SPAGHETTI_BLE_PEER_MAX];
};

static struct spaghetti_ble_context context = {
	.state = SPAGHETTI_BLE_STATE_OFF,
	.next_session_id = 1U,
	.next_message_id = 1U,
};

static spaghetti_principal_id_t handover_test_principal;
static spaghetti_principal_id_t handover_pending_disconnect;
static bool handover_disconnect_pending;

K_MUTEX_DEFINE(ble_lock);
K_MUTEX_DEFINE(ble_handover_lock);

static void ble_handover_disconnect_notify(struct k_work *work);

K_WORK_DEFINE(ble_handover_disconnect_work, ble_handover_disconnect_notify);

static void ble_handover_disconnect_notify(struct k_work *work)
{
	spaghetti_principal_id_t principal_id = 0U;

	ARG_UNUSED(work);
	if (spaghetti_ble_wifi_handover_take_pending_disconnect(&principal_id) &&
	    (principal_id != 0U)) {
		spaghetti_ble_close_peers_for_principal(principal_id);
	}
}

#if IS_ENABLED(CONFIG_BT)
static struct bt_uuid_128 spaghetti_ble_svc_uuid = BT_UUID_INIT_128(
	0x01, 0x00, 0x00, 0x00, 0x00, 0x42, 0x41, 0x4c,
	0x49, 0x54, 0x54, 0x45, 0x48, 0x47, 0x50, 0x53);
static struct bt_uuid_128 spaghetti_ble_req_uuid = BT_UUID_INIT_128(
	0x02, 0x00, 0x00, 0x00, 0x00, 0x42, 0x41, 0x4c,
	0x49, 0x54, 0x54, 0x45, 0x48, 0x47, 0x50, 0x53);
static struct bt_uuid_128 spaghetti_ble_rsp_uuid = BT_UUID_INIT_128(
	0x03, 0x00, 0x00, 0x00, 0x00, 0x42, 0x41, 0x4c,
	0x49, 0x54, 0x54, 0x45, 0x48, 0x47, 0x50, 0x53);
static struct bt_uuid_128 spaghetti_ble_evt_uuid = BT_UUID_INIT_128(
	0x04, 0x00, 0x00, 0x00, 0x00, 0x42, 0x41, 0x4c,
	0x49, 0x54, 0x54, 0x45, 0x48, 0x47, 0x50, 0x53);

static void ble_ccc_cfg_changed(const struct bt_gatt_attr *attr,
				uint16_t value);
static ssize_t ble_request_write(struct bt_conn *conn,
				 const struct bt_gatt_attr *attr,
				 const void *buf, uint16_t len,
				 uint16_t offset, uint8_t flags);

BT_GATT_SERVICE_DEFINE(spaghetti_ble_svc,
	BT_GATT_PRIMARY_SERVICE(&spaghetti_ble_svc_uuid),
	BT_GATT_CHARACTERISTIC(&spaghetti_ble_req_uuid.uuid,
			       BT_GATT_CHRC_WRITE,
			       BT_GATT_PERM_WRITE_ENCRYPT,
			       NULL, ble_request_write, NULL),
	BT_GATT_CHARACTERISTIC(&spaghetti_ble_rsp_uuid.uuid,
			       BT_GATT_CHRC_INDICATE,
			       BT_GATT_PERM_READ_ENCRYPT,
			       NULL, NULL, NULL),
	BT_GATT_CCC(ble_ccc_cfg_changed,
		    BT_GATT_PERM_READ_ENCRYPT | BT_GATT_PERM_WRITE_ENCRYPT),
	BT_GATT_CHARACTERISTIC(&spaghetti_ble_evt_uuid.uuid,
			       BT_GATT_CHRC_NOTIFY,
			       BT_GATT_PERM_READ_ENCRYPT,
			       NULL, NULL, NULL),
	BT_GATT_CCC(ble_ccc_cfg_changed,
		    BT_GATT_PERM_READ_ENCRYPT | BT_GATT_PERM_WRITE_ENCRYPT),
);

static const struct bt_data ad[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
	BT_DATA_BYTES(BT_DATA_UUID128_ALL,
		      0x01, 0x00, 0x00, 0x00, 0x00, 0x42, 0x41, 0x4c,
		      0x49, 0x54, 0x54, 0x45, 0x48, 0x47, 0x50, 0x53),
};
#endif

static void wipe_sensitive(void *data, size_t data_size)
{
	volatile uint8_t *bytes = data;

	for (size_t byte_idx = 0U; byte_idx < data_size; ++byte_idx) {
		bytes[byte_idx] = 0U;
	}
}

static int map_psa_status(psa_status_t status)
{
	switch (status) {
	case PSA_SUCCESS:
		return 0;
	case PSA_ERROR_DOES_NOT_EXIST:
		return -ENOENT;
	case PSA_ERROR_INSUFFICIENT_STORAGE:
		return -ENOSPC;
	case PSA_ERROR_INVALID_ARGUMENT:
		return -EINVAL;
	default:
		return -EIO;
	}
}

#if IS_ENABLED(CONFIG_SECURE_STORAGE)
static psa_storage_uid_t credential_uid(uint16_t credential_id)
{
	return SPAGHETTI_BLE_RECORD_UID_BASE + credential_id;
}
#endif

#if !IS_ENABLED(CONFIG_SECURE_STORAGE)
static int host_credential_index(uint16_t credential_id)
{
	if ((credential_id == 0U) ||
	    (credential_id > SPAGHETTI_BLE_CREDENTIAL_SLOTS)) {
		return -EINVAL;
	}
	return (int)credential_id - 1;
}
#endif

uint32_t spaghetti_ble_permissions(void)
{
	return SPAGHETTI_PERMISSION_READ | SPAGHETTI_PERMISSION_CONFIGURE |
	       SPAGHETTI_PERMISSION_COMMAND | SPAGHETTI_PERMISSION_DISCOVER;
}

int spaghetti_ble_frame_parse(
	const uint8_t *bytes,
	size_t size,
	struct spaghetti_ble_frame_header *out)
{
	if ((bytes == NULL) || (out == NULL) ||
	    (size < SPAGHETTI_BLE_FRAME_HEADER_SIZE)) {
		return -EINVAL;
	}

	*out = (struct spaghetti_ble_frame_header) {
		.message_id = sys_get_le32(&bytes[0]),
		.offset = sys_get_le16(&bytes[4]),
		.total = sys_get_le16(&bytes[6]),
	};
	return 0;
}

int spaghetti_ble_frame_encode(
	const struct spaghetti_ble_frame_header *header,
	uint8_t *out,
	size_t capacity)
{
	if ((header == NULL) || (out == NULL) ||
	    (capacity < SPAGHETTI_BLE_FRAME_HEADER_SIZE)) {
		return -EINVAL;
	}

	sys_put_le32(header->message_id, &out[0]);
	sys_put_le16(header->offset, &out[4]);
	sys_put_le16(header->total, &out[6]);
	return 0;
}

void spaghetti_ble_reassembly_reset(struct spaghetti_ble_reassembly *slot)
{
	if (slot == NULL) {
		return;
	}
	memset(slot, 0, sizeof(*slot));
}

static bool bitmap_test(const uint8_t *bitmap, uint16_t index)
{
	return (bitmap[index / 8U] & BIT(index % 8U)) != 0U;
}

static void bitmap_set(uint8_t *bitmap, uint16_t index)
{
	bitmap[index / 8U] |= (uint8_t)BIT(index % 8U);
}

int spaghetti_ble_reassembly_feed(
	struct spaghetti_ble_reassembly *slot,
	const uint8_t *frame,
	size_t frame_size,
	int64_t now_ms,
	int64_t timeout_ms)
{
	struct spaghetti_ble_frame_header header;
	size_t payload_size;
	int err;

	if ((slot == NULL) || (frame == NULL)) {
		return -EINVAL;
	}

	err = spaghetti_ble_frame_parse(frame, frame_size, &header);
	if (err < 0) {
		return err;
	}

	payload_size = frame_size - SPAGHETTI_BLE_FRAME_HEADER_SIZE;
	if ((header.total == 0U) ||
	    (header.total > SPAGHETTI_BLE_ENVELOPE_MAX) ||
	    (header.offset > header.total) ||
	    ((uint32_t)header.offset + (uint32_t)payload_size >
	     (uint32_t)header.total)) {
		return -EMSGSIZE;
	}

	if (slot->active &&
	    ((now_ms - slot->started_ms) > timeout_ms)) {
		spaghetti_ble_reassembly_reset(slot);
		return -ETIMEDOUT;
	}

	if (slot->active && (slot->message_id != header.message_id)) {
		return -EEXIST;
	}

	if (!slot->active) {
		slot->active = true;
		slot->message_id = header.message_id;
		slot->total = header.total;
		slot->received = 0U;
		slot->started_ms = now_ms;
		memset(slot->bitmap, 0, sizeof(slot->bitmap));
		memset(slot->buffer, 0, sizeof(slot->buffer));
	} else if (slot->total != header.total) {
		return -EMSGSIZE;
	}

	for (size_t idx = 0U; idx < payload_size; ++idx) {
		const uint16_t absolute = (uint16_t)(header.offset + idx);

		if (bitmap_test(slot->bitmap, absolute)) {
			if (slot->buffer[absolute] !=
			    frame[SPAGHETTI_BLE_FRAME_HEADER_SIZE + idx]) {
				return -EALREADY;
			}
			continue;
		}
		slot->buffer[absolute] =
			frame[SPAGHETTI_BLE_FRAME_HEADER_SIZE + idx];
		bitmap_set(slot->bitmap, absolute);
		++slot->received;
	}

	if (slot->received < slot->total) {
		return 0;
	}
	return 1;
}

static bool maintenance_active(void)
{
	return spaghetti_maintenance_link_get_state() ==
	       SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
}

static int read_credential_record(
	uint16_t credential_id,
	struct spaghetti_ble_credential_record *record)
{
#if IS_ENABLED(CONFIG_SECURE_STORAGE)
	size_t read_size = 0U;
	psa_status_t status;

	status = psa_its_get(credential_uid(credential_id), 0U,
			     sizeof(*record), record, &read_size);
	if (status != PSA_SUCCESS) {
		return map_psa_status(status);
	}
	if ((read_size != sizeof(*record)) ||
	    (record->magic != SPAGHETTI_BLE_RECORD_MAGIC) ||
	    (record->version != SPAGHETTI_BLE_RECORD_VERSION) ||
	    (record->credential_id != credential_id) ||
	    (record->principal_id == 0U)) {
		wipe_sensitive(record, sizeof(*record));
		return -EBADMSG;
	}
	return 0;
#else
	int index = host_credential_index(credential_id);

	if (index < 0) {
		return index;
	}
	if (!host_credential_used[index]) {
		return -ENOENT;
	}
	*record = host_credentials[index];
	return 0;
#endif
}

static int write_credential_record(
	const struct spaghetti_ble_credential_record *record)
{
#if IS_ENABLED(CONFIG_SECURE_STORAGE)
	return map_psa_status(psa_its_set(
		credential_uid(record->credential_id), sizeof(*record), record,
		PSA_STORAGE_FLAG_NONE));
#else
	int index = host_credential_index(record->credential_id);

	if (index < 0) {
		return index;
	}
	host_credentials[index] = *record;
	host_credential_used[index] = true;
	return 0;
#endif
}

static int remove_credential_record(uint16_t credential_id)
{
#if IS_ENABLED(CONFIG_SECURE_STORAGE)
	return map_psa_status(psa_its_remove(credential_uid(credential_id)));
#else
	int index = host_credential_index(credential_id);

	if (index < 0) {
		return index;
	}
	if (!host_credential_used[index]) {
		return -ENOENT;
	}
	wipe_sensitive(&host_credentials[index],
		       sizeof(host_credentials[index]));
	host_credential_used[index] = false;
	return 0;
#endif
}

static void refresh_state_locked(void)
{
	bool authenticating = false;
	bool authenticated = false;

	context.peer_count = 0U;
	context.negotiated_mtu = 0U;
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		if (context.peers[idx].phase == SPAGHETTI_BLE_PEER_FREE) {
			continue;
		}
		++context.peer_count;
		if (context.peers[idx].mtu > context.negotiated_mtu) {
			context.negotiated_mtu = context.peers[idx].mtu;
		}
		if (context.peers[idx].phase ==
		    SPAGHETTI_BLE_PEER_AUTHENTICATING) {
			authenticating = true;
		}
		if (context.peers[idx].phase ==
		    SPAGHETTI_BLE_PEER_AUTHENTICATED) {
			authenticated = true;
		}
	}

	if (!context.started) {
		context.state = SPAGHETTI_BLE_STATE_OFF;
	} else if (authenticated) {
		context.state = SPAGHETTI_BLE_STATE_CONNECTED;
	} else if (authenticating) {
		context.state = SPAGHETTI_BLE_STATE_AUTHENTICATING;
	} else if (context.radio_enabled) {
		context.state = SPAGHETTI_BLE_STATE_ADVERTISING;
	} else {
		context.state = SPAGHETTI_BLE_STATE_OFF;
	}
}

static int load_device_id(uint8_t out[SPAGHETTI_DEVICE_ID_SIZE])
{
	struct spaghetti_identity identity;
	int err;

	if (context.device_id_override) {
		memcpy(out, context.device_id, SPAGHETTI_DEVICE_ID_SIZE);
		return 0;
	}

	err = spaghetti_identity_get(&identity);
	if (err < 0) {
		return err;
	}
	memcpy(out, identity.device_id, SPAGHETTI_DEVICE_ID_SIZE);
	return 0;
}

static int compute_hmac(
	const uint8_t key[SPAGHETTI_BLE_KEY_SIZE],
	const uint8_t nonce[SPAGHETTI_BLE_NONCE_SIZE],
	const uint8_t device_id[SPAGHETTI_DEVICE_ID_SIZE],
	uint32_t session_id,
	uint8_t out[SPAGHETTI_BLE_HMAC_SIZE])
{
	uint8_t message[SPAGHETTI_BLE_NONCE_SIZE + SPAGHETTI_DEVICE_ID_SIZE +
			4U];
	psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
	psa_key_id_t key_id = 0U;
	size_t mac_size = 0U;
	psa_status_t status;
	int err;

	memcpy(message, nonce, SPAGHETTI_BLE_NONCE_SIZE);
	memcpy(&message[SPAGHETTI_BLE_NONCE_SIZE], device_id,
	       SPAGHETTI_DEVICE_ID_SIZE);
	sys_put_le32(session_id,
		     &message[SPAGHETTI_BLE_NONCE_SIZE +
			      SPAGHETTI_DEVICE_ID_SIZE]);

	status = psa_crypto_init();
	if (status != PSA_SUCCESS) {
		err = map_psa_status(status);
		goto out;
	}

	psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_SIGN_MESSAGE);
	psa_set_key_algorithm(&attributes, PSA_ALG_HMAC(PSA_ALG_SHA_256));
	psa_set_key_type(&attributes, PSA_KEY_TYPE_HMAC);
	psa_set_key_bits(&attributes, SPAGHETTI_BLE_KEY_SIZE * 8U);
	status = psa_import_key(&attributes, key, SPAGHETTI_BLE_KEY_SIZE,
				&key_id);
	if (status != PSA_SUCCESS) {
		err = map_psa_status(status);
		goto out;
	}

	status = psa_mac_compute(key_id, PSA_ALG_HMAC(PSA_ALG_SHA_256),
				 message, sizeof(message), out,
				 SPAGHETTI_BLE_HMAC_SIZE, &mac_size);
	if ((status != PSA_SUCCESS) || (mac_size != SPAGHETTI_BLE_HMAC_SIZE)) {
		err = (status == PSA_SUCCESS) ? -EIO : map_psa_status(status);
		goto out;
	}
	err = 0;

out:
	if (key_id != 0U) {
		(void)psa_destroy_key(key_id);
	}
	psa_reset_key_attributes(&attributes);
	wipe_sensitive(message, sizeof(message));
	return err;
}

static bool tags_match(const uint8_t *left, const uint8_t *right, size_t size)
{
	uint8_t diff = 0U;

	for (size_t idx = 0U; idx < size; ++idx) {
		diff |= (uint8_t)(left[idx] ^ right[idx]);
	}
	return diff == 0U;
}

static void deactivate_record_consumer_locked(void)
{
	bool any_authenticated = false;

	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		if (context.peers[idx].phase ==
		    SPAGHETTI_BLE_PEER_AUTHENTICATED) {
			any_authenticated = true;
			break;
		}
	}
	if (!any_authenticated) {
		(void)spaghetti_record_delivery_set_consumer_active(
			SPAGHETTI_RECORD_CONSUMER_ID_BLE, false);
	}
}

static void release_peer_locked(struct spaghetti_ble_peer *peer)
{
	bool was_authenticated;

	if (peer == NULL) {
		return;
	}
	was_authenticated =
		(peer->phase == SPAGHETTI_BLE_PEER_AUTHENTICATED);
#if IS_ENABLED(CONFIG_BT)
	if (peer->conn != NULL) {
		bt_conn_unref(peer->conn);
		peer->conn = NULL;
	}
#endif
	wipe_sensitive(peer->nonce, sizeof(peer->nonce));
	spaghetti_ble_reassembly_reset(&peer->reassembly);
	memset(peer, 0, sizeof(*peer));
	deactivate_record_consumer_locked();
	refresh_state_locked();
	if (was_authenticated) {
		(void)k_work_submit(&ble_ota_disconnect_work);
	}
}

static struct spaghetti_ble_peer *allocate_peer_locked(void)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		if (context.peers[idx].phase == SPAGHETTI_BLE_PEER_FREE) {
			return &context.peers[idx];
		}
	}
	return NULL;
}

static uint8_t peer_index_of(const struct spaghetti_ble_peer *peer)
{
	return (uint8_t)(peer - context.peers);
}

static int fill_challenge_locked(struct spaghetti_ble_peer *peer)
{
	psa_status_t status;

	if (context.next_session_id == 0U) {
		context.next_session_id = 1U;
	}
	peer->session_id = context.next_session_id++;
	status = psa_crypto_init();
	if (status != PSA_SUCCESS) {
		return map_psa_status(status);
	}
	status = psa_generate_random(peer->nonce, sizeof(peer->nonce));
	if (status != PSA_SUCCESS) {
		return map_psa_status(status);
	}

	peer->challenge[0] = SPAGHETTI_BLE_AUTH_CHALLENGE_TYPE;
	sys_put_le32(peer->session_id, &peer->challenge[1]);
	memcpy(&peer->challenge[5], peer->nonce, sizeof(peer->nonce));
	peer->challenge_valid = true;
	return 0;
}

static int open_peer_locked(struct spaghetti_ble_peer **out_peer)
{
	struct spaghetti_ble_peer *peer;
	int err;

	peer = allocate_peer_locked();
	if (peer == NULL) {
		return -ENOSPC;
	}

	memset(peer, 0, sizeof(*peer));
	peer->phase = SPAGHETTI_BLE_PEER_AUTHENTICATING;
	peer->mtu = 23U;
	peer->event_credit = CONFIG_SPAGHETTI_BLE_EVENT_CREDIT;
	err = fill_challenge_locked(peer);
	if (err < 0) {
		release_peer_locked(peer);
		return err;
	}
	refresh_state_locked();
	*out_peer = peer;
	return 0;
}

static int verify_auth_proof_locked(
	struct spaghetti_ble_peer *peer,
	const uint8_t *bytes,
	size_t size)
{
	struct spaghetti_ble_credential_record record;
	struct spaghetti_principal principal;
	uint8_t device_id[SPAGHETTI_DEVICE_ID_SIZE];
	uint8_t expected[SPAGHETTI_BLE_HMAC_SIZE];
	uint16_t credential_id;
	int err;

	if ((size != SPAGHETTI_BLE_AUTH_PROOF_SIZE) ||
	    (bytes[0] != SPAGHETTI_BLE_AUTH_PROOF_TYPE) ||
	    !peer->challenge_valid) {
		return -EBADMSG;
	}

	credential_id = sys_get_le16(&bytes[1]);
	if (credential_id == 0U) {
		return -EINVAL;
	}

	err = read_credential_record(credential_id, &record);
	if (err < 0) {
		return (err == -ENOENT) ? -EACCES : err;
	}

	err = spaghetti_principal_get(record.principal_id, &principal);
	if ((err < 0) || !principal.enabled) {
		wipe_sensitive(&record, sizeof(record));
		return -EACCES;
	}

	err = load_device_id(device_id);
	if (err < 0) {
		wipe_sensitive(&record, sizeof(record));
		return err;
	}

	err = compute_hmac(record.key, peer->nonce, device_id,
			   peer->session_id, expected);
	wipe_sensitive(&record, sizeof(record));
	if (err < 0) {
		return err;
	}

	if (!tags_match(expected, &bytes[3], SPAGHETTI_BLE_HMAC_SIZE)) {
		wipe_sensitive(expected, sizeof(expected));
		return -EACCES;
	}
	wipe_sensitive(expected, sizeof(expected));

	peer->credential_id = credential_id;
	peer->principal_id = principal.id;
	peer->phase = SPAGHETTI_BLE_PEER_AUTHENTICATED;
	peer->challenge_valid = false;
	err = spaghetti_record_delivery_set_consumer_active(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, true);
	if ((err < 0) && (err != -EALREADY)) {
		/*
		 * Record Delivery may be uninitialized in isolated unit tests;
		 * authentication still succeeds and the consumer activates when
		 * Delivery is ready.
		 */
		LOG_DBG("record consumer activate deferred err=%d", err);
	}
	refresh_state_locked();
	return 0;
}

static int encode_framed_message(
	uint32_t message_id,
	const uint8_t *payload,
	size_t payload_size,
	uint8_t *out,
	size_t capacity,
	size_t *out_size)
{
	struct spaghetti_ble_frame_header header = {
		.message_id = message_id,
		.offset = 0U,
		.total = (uint16_t)payload_size,
	};
	int err;

	if ((payload_size > SPAGHETTI_BLE_ENVELOPE_MAX) ||
	    (capacity < (SPAGHETTI_BLE_FRAME_HEADER_SIZE + payload_size))) {
		return -EMSGSIZE;
	}
	err = spaghetti_ble_frame_encode(&header, out, capacity);
	if (err < 0) {
		return err;
	}
	if (payload_size > 0U) {
		memcpy(&out[SPAGHETTI_BLE_FRAME_HEADER_SIZE], payload,
		       payload_size);
	}
	*out_size = SPAGHETTI_BLE_FRAME_HEADER_SIZE + payload_size;
	return 0;
}

static int dispatch_request_locked(
	struct spaghetti_ble_peer *peer,
	const uint8_t *envelope,
	size_t envelope_size)
{
	struct spaghetti_protocol_request request;
	struct spaghetti_protocol_response response;
	struct spaghetti_request_context request_context;
	struct spaghetti_principal principal;
	struct spaghetti_core_info info;
	uint8_t encoded[SPAGHETTI_BLE_ENVELOPE_MAX];
	size_t encoded_size = 0U;
	uint32_t message_id;
	int err;

	err = spaghetti_protocol_decode_request(envelope, envelope_size,
						&request);
	if (err < 0) {
		return -EBADMSG;
	}

	err = spaghetti_principal_get(peer->principal_id, &principal);
	if ((err < 0) || !principal.enabled) {
		return -EACCES;
	}
	err = spaghetti_core_get_info(&info);
	if (err < 0) {
		info.mode = SPAGHETTI_CORE_MODE_NORMAL;
	}

	request_context = (struct spaghetti_request_context) {
		.principal_id = peer->principal_id,
		.permissions = principal.permissions &
			       spaghetti_ble_permissions(),
		.local = false,
		.core_mode = info.mode,
	};

	err = spaghetti_communication_handle_request(
		&request_context, &request, &response);
	if (err < 0) {
		return err;
	}

	err = spaghetti_protocol_encode_response(
		&response, encoded, sizeof(encoded), &encoded_size);
	if (err < 0) {
		return err;
	}

	if (context.next_message_id == 0U) {
		context.next_message_id = 1U;
	}
	message_id = context.next_message_id++;
	err = encode_framed_message(message_id, encoded, encoded_size,
				    peer->response, sizeof(peer->response),
				    &peer->response_size);
	if ((err == 0) && handover_disconnect_pending) {
		(void)k_work_submit(&ble_handover_disconnect_work);
	}
	return err;
}

static int handle_request_bytes_locked(
	struct spaghetti_ble_peer *peer,
	const uint8_t *bytes,
	size_t size)
{
	int feed;
	int err;

	if (peer->phase == SPAGHETTI_BLE_PEER_AUTHENTICATING) {
		err = verify_auth_proof_locked(peer, bytes, size);
		if (err < 0) {
			++context.rx_rejected;
		}
		return err;
	}
	if (peer->phase != SPAGHETTI_BLE_PEER_AUTHENTICATED) {
		++context.rx_rejected;
		return -EACCES;
	}

	feed = spaghetti_ble_reassembly_feed(
		&peer->reassembly, bytes, size, k_uptime_get(),
		CONFIG_SPAGHETTI_BLE_REASSEMBLY_TIMEOUT_MS);
	if (feed == -ETIMEDOUT) {
		++context.rx_rejected;
		spaghetti_ble_reassembly_reset(&peer->reassembly);
		feed = spaghetti_ble_reassembly_feed(
			&peer->reassembly, bytes, size, k_uptime_get(),
			CONFIG_SPAGHETTI_BLE_REASSEMBLY_TIMEOUT_MS);
	}
	if (feed < 0) {
		++context.rx_rejected;
		if ((feed == -EEXIST) || (feed == -EALREADY) ||
		    (feed == -EMSGSIZE)) {
			spaghetti_ble_reassembly_reset(&peer->reassembly);
		}
		return feed;
	}
	if (feed == 0) {
		return 0;
	}

	err = dispatch_request_locked(peer, peer->reassembly.buffer,
				      peer->reassembly.total);
	spaghetti_ble_reassembly_reset(&peer->reassembly);
	if (err < 0) {
		++context.rx_rejected;
	}
	return err;
}

#if IS_ENABLED(CONFIG_BT)
static struct spaghetti_ble_peer *peer_from_conn_locked(struct bt_conn *conn)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		if ((context.peers[idx].phase != SPAGHETTI_BLE_PEER_FREE) &&
		    (context.peers[idx].conn == conn)) {
			return &context.peers[idx];
		}
	}
	return NULL;
}

static void ble_ccc_cfg_changed(const struct bt_gatt_attr *attr,
				uint16_t value)
{
	ARG_UNUSED(attr);
	ARG_UNUSED(value);
}

static ssize_t ble_request_write(struct bt_conn *conn,
				 const struct bt_gatt_attr *attr,
				 const void *buf, uint16_t len,
				 uint16_t offset, uint8_t flags)
{
	struct spaghetti_ble_peer *peer;
	int err;

	ARG_UNUSED(attr);
	ARG_UNUSED(flags);
	if ((offset != 0U) || (buf == NULL)) {
		return BT_GATT_ERR(BT_ATT_ERR_INVALID_OFFSET);
	}

	(void)k_mutex_lock(&ble_lock, K_FOREVER);
	peer = peer_from_conn_locked(conn);
	if (peer == NULL) {
		k_mutex_unlock(&ble_lock);
		return BT_GATT_ERR(BT_ATT_ERR_UNLIKELY);
	}
	err = handle_request_bytes_locked(peer, buf, len);
	k_mutex_unlock(&ble_lock);
	if (err < 0) {
		return BT_GATT_ERR(BT_ATT_ERR_VALUE_NOT_ALLOWED);
	}
	return len;
}

static void ble_connected(struct bt_conn *conn, uint8_t err)
{
	struct spaghetti_ble_peer *peer;
	int open_err;

	if (err != 0U) {
		return;
	}

	(void)k_mutex_lock(&ble_lock, K_FOREVER);
	open_err = open_peer_locked(&peer);
	if (open_err < 0) {
		k_mutex_unlock(&ble_lock);
		(void)bt_conn_disconnect(conn,
					 BT_HCI_ERR_REMOTE_USER_TERM_CONN);
		return;
	}
	peer->conn = bt_conn_ref(conn);
	peer->mtu = MAX((uint16_t)bt_gatt_get_mtu(conn), 23U);
	refresh_state_locked();
	k_mutex_unlock(&ble_lock);

	/* Event characteristic value is attrs[7] in the static GATT table. */
	(void)bt_gatt_notify(conn, &spaghetti_ble_svc.attrs[7],
			     peer->challenge, sizeof(peer->challenge));
}

static void ble_disconnected(struct bt_conn *conn, uint8_t reason)
{
	struct spaghetti_ble_peer *peer;

	ARG_UNUSED(reason);
	(void)k_mutex_lock(&ble_lock, K_FOREVER);
	peer = peer_from_conn_locked(conn);
	if (peer != NULL) {
		release_peer_locked(peer);
	}
	k_mutex_unlock(&ble_lock);
}

BT_CONN_CB_DEFINE(spaghetti_ble_conn_cb) = {
	.connected = ble_connected,
	.disconnected = ble_disconnected,
};

static int ble_radio_start_advertising(void)
{
	return bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad),
			       NULL, 0);
}

static int ble_radio_stop_advertising(void)
{
	int err = bt_le_adv_stop();

	return ((err == 0) || (err == -EALREADY)) ? 0 : err;
}
#endif

static int start_advertising_locked(void)
{
#if IS_ENABLED(CONFIG_BT)
	int err = ble_radio_start_advertising();

	if ((err < 0) && (err != -EALREADY)) {
		return err;
	}
#endif
	context.radio_enabled = true;
	refresh_state_locked();
	return 0;
}

static int stop_advertising_locked(void)
{
	int err = 0;

#if IS_ENABLED(CONFIG_BT)
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		if ((context.peers[idx].phase != SPAGHETTI_BLE_PEER_FREE) &&
		    (context.peers[idx].conn != NULL)) {
			(void)bt_conn_disconnect(
				context.peers[idx].conn,
				BT_HCI_ERR_REMOTE_USER_TERM_CONN);
		}
	}
	err = ble_radio_stop_advertising();
#endif
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		if (context.peers[idx].phase != SPAGHETTI_BLE_PEER_FREE) {
			release_peer_locked(&context.peers[idx]);
		}
	}
	context.radio_enabled = false;
	refresh_state_locked();
	return err;
}

static int start_radio_locked(void)
{
	int err = 0;

#if IS_ENABLED(CONFIG_BT)
	err = bt_enable(NULL);
	if ((err < 0) && (err != -EALREADY)) {
		return err;
	}
#else
	/*
	 * Host/unit builds compile ble.c without CONFIG_BT and exercise the
	 * adapter through spaghetti_ble_test_* hooks.
	 */
	ARG_UNUSED(err);
#endif
	err = start_advertising_locked();
	return err;
}

static int stop_radio_locked(void)
{
	int err = stop_advertising_locked();

	return err;
}

int spaghetti_ble_set_radio(bool enabled)
{
	int err;

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.started) {
		k_mutex_unlock(&ble_lock);
		return -EACCES;
	}
	err = enabled ? start_advertising_locked() : stop_advertising_locked();
	k_mutex_unlock(&ble_lock);
	return err;
}

int spaghetti_ble_start(void)
{
	int err;

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (context.started) {
		k_mutex_unlock(&ble_lock);
		return -EALREADY;
	}

	err = start_radio_locked();
	if (err < 0) {
		context.started = false;
		context.radio_enabled = false;
		context.state = SPAGHETTI_BLE_STATE_OFF;
		k_mutex_unlock(&ble_lock);
		return err;
	}
	context.started = true;
	refresh_state_locked();
	k_mutex_unlock(&ble_lock);
	LOG_INF("ble started");
	return 0;
}

int spaghetti_ble_stop(k_timeout_t timeout)
{
	int err;

	if (K_TIMEOUT_EQ(timeout, K_FOREVER)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.started) {
		k_mutex_unlock(&ble_lock);
		return -EALREADY;
	}

	err = stop_radio_locked();
	context.started = false;
	context.state = SPAGHETTI_BLE_STATE_OFF;
	(void)spaghetti_record_delivery_set_consumer_active(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, false);
	k_mutex_unlock(&ble_lock);
	ARG_UNUSED(timeout);
	LOG_INF("ble stopped");
	return err;
}

int spaghetti_ble_get_status(struct spaghetti_ble_status *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	*out = (struct spaghetti_ble_status) {
		.state = context.state,
		.negotiated_mtu = context.negotiated_mtu,
		.peer_count = context.peer_count,
		.rx_rejected = context.rx_rejected,
		.event_dropped = context.event_dropped,
	};
	k_mutex_unlock(&ble_lock);
	return 0;
}

int spaghetti_ble_credential_set(
	uint16_t credential_id,
	spaghetti_principal_id_t principal_id,
	const uint8_t key[SPAGHETTI_BLE_KEY_SIZE])
{
	struct spaghetti_ble_credential_record record;
	struct spaghetti_principal principal;
	int err;

	if ((credential_id == 0U) || (principal_id == 0U) || (key == NULL)) {
		return -EINVAL;
	}
	if (!maintenance_active()) {
		return -EACCES;
	}

	err = spaghetti_principal_get(principal_id, &principal);
	if ((err < 0) || !principal.enabled) {
		return (err < 0) ? err : -ENOENT;
	}

	record = (struct spaghetti_ble_credential_record) {
		.magic = SPAGHETTI_BLE_RECORD_MAGIC,
		.version = SPAGHETTI_BLE_RECORD_VERSION,
		.credential_id = credential_id,
		.principal_id = principal_id,
	};
	memcpy(record.key, key, SPAGHETTI_BLE_KEY_SIZE);
	err = write_credential_record(&record);
	wipe_sensitive(&record, sizeof(record));
	return err;
}

int spaghetti_ble_credential_clear(uint16_t credential_id)
{
	int err;

	if (credential_id == 0U) {
		return -EINVAL;
	}
	if (!maintenance_active()) {
		return -EACCES;
	}
	err = remove_credential_record(credential_id);
	return err;
}

int spaghetti_ble_credential_exists(
	uint16_t credential_id,
	bool *out_exists)
{
	struct spaghetti_ble_credential_record record;
	int err;

	if ((credential_id == 0U) || (out_exists == NULL)) {
		return -EINVAL;
	}

	err = read_credential_record(credential_id, &record);
	if (err == -ENOENT) {
		*out_exists = false;
		return 0;
	}
	if (err < 0) {
		return err;
	}
	wipe_sensitive(&record, sizeof(record));
	*out_exists = true;
	return 0;
}

int spaghetti_ble_erase_credentials(void)
{
	int first_error = 0;

	for (uint16_t credential_id = 1U;
	     credential_id <= SPAGHETTI_BLE_CREDENTIAL_SLOTS;
	     ++credential_id) {
		int err = remove_credential_record(credential_id);

		if ((err < 0) && (err != -ENOENT) && (first_error == 0)) {
			first_error = err;
		}
	}
	return first_error;
}

int spaghetti_ble_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	bool found = false;
	int first_error = 0;

	if (principal_id == 0U) {
		return -EINVAL;
	}

	for (uint16_t credential_id = 1U;
	     credential_id <= SPAGHETTI_BLE_CREDENTIAL_SLOTS;
	     ++credential_id) {
		struct spaghetti_ble_credential_record record;
		int err = read_credential_record(credential_id, &record);

		if (err == -ENOENT) {
			continue;
		}
		if (err < 0) {
			if (first_error == 0) {
				first_error = err;
			}
			continue;
		}
		if (record.principal_id == principal_id) {
			found = true;
			err = remove_credential_record(credential_id);
			if ((err < 0) && (err != -ENOENT) &&
			    (first_error == 0)) {
				first_error = err;
			}
		}
		wipe_sensitive(&record, sizeof(record));
	}

	spaghetti_ble_close_peers_for_principal(principal_id);
	if (first_error < 0) {
		return first_error;
	}
	return found ? 0 : -ENOENT;
}

void spaghetti_ble_close_peers_for_principal(
	spaghetti_principal_id_t principal_id)
{
	if (principal_id == 0U) {
		return;
	}

	(void)k_mutex_lock(&ble_lock, K_FOREVER);
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		if ((context.peers[idx].phase != SPAGHETTI_BLE_PEER_FREE) &&
		    (context.peers[idx].principal_id == principal_id)) {
#if IS_ENABLED(CONFIG_BT)
			if (context.peers[idx].conn != NULL) {
				(void)bt_conn_disconnect(
					context.peers[idx].conn,
					BT_HCI_ERR_REMOTE_USER_TERM_CONN);
			}
#endif
			release_peer_locked(&context.peers[idx]);
		}
	}
	k_mutex_unlock(&ble_lock);
}

int spaghetti_ble_clear_bonds(void)
{
	int err = spaghetti_ble_erase_credentials();

#if IS_ENABLED(CONFIG_BT)
	if (IS_ENABLED(CONFIG_BT_SMP)) {
		int unpair = bt_unpair(BT_ID_DEFAULT, NULL);

		if ((unpair < 0) && (unpair != -ENOENT) && (err == 0)) {
			err = unpair;
		}
	}
#endif
	(void)k_mutex_lock(&ble_lock, K_FOREVER);
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		if (context.peers[idx].phase != SPAGHETTI_BLE_PEER_FREE) {
			release_peer_locked(&context.peers[idx]);
		}
	}
	k_mutex_unlock(&ble_lock);
	return err;
}

int spaghetti_ble_inject_request(
	uint8_t peer_index,
	const uint8_t *bytes,
	size_t size)
{
	int err;

	if ((bytes == NULL) || (size == 0U) ||
	    (peer_index >= ARRAY_SIZE(context.peers))) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.started ||
	    (context.peers[peer_index].phase == SPAGHETTI_BLE_PEER_FREE)) {
		k_mutex_unlock(&ble_lock);
		return -EACCES;
	}
	err = handle_request_bytes_locked(&context.peers[peer_index], bytes,
					  size);
	k_mutex_unlock(&ble_lock);
	return err;
}

int spaghetti_ble_test_connect(uint8_t *peer_index)
{
	struct spaghetti_ble_peer *peer;
	int err;

	if (peer_index == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.started) {
		k_mutex_unlock(&ble_lock);
		return -EACCES;
	}
	err = open_peer_locked(&peer);
	if (err == 0) {
		*peer_index = peer_index_of(peer);
	}
	k_mutex_unlock(&ble_lock);
	return err;
}

int spaghetti_ble_test_disconnect(uint8_t peer_index)
{
	int err;

	if (peer_index >= ARRAY_SIZE(context.peers)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (context.peers[peer_index].phase == SPAGHETTI_BLE_PEER_FREE) {
		k_mutex_unlock(&ble_lock);
		return -EINVAL;
	}
	release_peer_locked(&context.peers[peer_index]);
	k_mutex_unlock(&ble_lock);
	return 0;
}

int spaghetti_ble_test_get_challenge(
	uint8_t peer_index,
	uint8_t *out,
	size_t capacity,
	size_t *out_size)
{
	int err;

	if ((out == NULL) || (out_size == NULL) ||
	    (peer_index >= ARRAY_SIZE(context.peers)) ||
	    (capacity < SPAGHETTI_BLE_AUTH_CHALLENGE_SIZE)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.peers[peer_index].challenge_valid) {
		k_mutex_unlock(&ble_lock);
		return -ENOENT;
	}
	memcpy(out, context.peers[peer_index].challenge,
	       SPAGHETTI_BLE_AUTH_CHALLENGE_SIZE);
	*out_size = SPAGHETTI_BLE_AUTH_CHALLENGE_SIZE;
	k_mutex_unlock(&ble_lock);
	return 0;
}

int spaghetti_ble_test_get_response(
	uint8_t peer_index,
	uint8_t *out,
	size_t capacity,
	size_t *out_size)
{
	int err;

	if ((out == NULL) || (out_size == NULL) ||
	    (peer_index >= ARRAY_SIZE(context.peers))) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (context.peers[peer_index].response_size == 0U) {
		k_mutex_unlock(&ble_lock);
		return -ENOENT;
	}
	if (capacity < context.peers[peer_index].response_size) {
		k_mutex_unlock(&ble_lock);
		return -EMSGSIZE;
	}
	memcpy(out, context.peers[peer_index].response,
	       context.peers[peer_index].response_size);
	*out_size = context.peers[peer_index].response_size;
	context.peers[peer_index].response_size = 0U;
	k_mutex_unlock(&ble_lock);
	return 0;
}

int spaghetti_ble_test_set_device_id(const uint8_t device_id[32])
{
	if (device_id == NULL) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&ble_lock, K_FOREVER);
	memcpy(context.device_id, device_id, sizeof(context.device_id));
	context.device_id_override = true;
	k_mutex_unlock(&ble_lock);
	return 0;
}

int spaghetti_ble_find_update_principal(spaghetti_principal_id_t *out_principal)
{
	int err;

	if (out_principal == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		struct spaghetti_principal principal;

		if (context.peers[idx].phase !=
		    SPAGHETTI_BLE_PEER_AUTHENTICATED) {
			continue;
		}
		err = spaghetti_principal_get(context.peers[idx].principal_id,
					      &principal);
		if (err < 0) {
			k_mutex_unlock(&ble_lock);
			return err;
		}
		if ((principal.permissions & SPAGHETTI_PERMISSION_UPDATE) !=
		    0U) {
			*out_principal = principal.id;
			k_mutex_unlock(&ble_lock);
			return 0;
		}
	}
	k_mutex_unlock(&ble_lock);
	return -ENOENT;
}

int spaghetti_ble_principal_is_authenticated(
	spaghetti_principal_id_t principal_id)
{
	int err;

	if (principal_id == 0U) {
		return -EINVAL;
	}
	if (handover_test_principal == principal_id) {
		return 0;
	}

	err = k_mutex_lock(&ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	for (size_t idx = 0U; idx < ARRAY_SIZE(context.peers); ++idx) {
		if ((context.peers[idx].phase ==
		     SPAGHETTI_BLE_PEER_AUTHENTICATED) &&
		    (context.peers[idx].principal_id == principal_id)) {
			k_mutex_unlock(&ble_lock);
			return 0;
		}
	}
	k_mutex_unlock(&ble_lock);
	return -ENOENT;
}

void spaghetti_ble_wifi_handover_set_test_authenticated(
	spaghetti_principal_id_t principal_id)
{
	handover_test_principal = principal_id;
}

void spaghetti_ble_wifi_handover_request_disconnect(
	spaghetti_principal_id_t principal_id)
{
	(void)k_mutex_lock(&ble_handover_lock, K_FOREVER);
	handover_pending_disconnect = principal_id;
	handover_disconnect_pending = (principal_id != 0U);
	k_mutex_unlock(&ble_handover_lock);
}

bool spaghetti_ble_wifi_handover_take_pending_disconnect(
	spaghetti_principal_id_t *out_principal)
{
	bool pending;

	(void)k_mutex_lock(&ble_handover_lock, K_FOREVER);
	pending = handover_disconnect_pending;
	if (pending) {
		if (out_principal != NULL) {
			*out_principal = handover_pending_disconnect;
		}
		handover_disconnect_pending = false;
		handover_pending_disconnect = 0U;
	}
	k_mutex_unlock(&ble_handover_lock);
	return pending;
}
