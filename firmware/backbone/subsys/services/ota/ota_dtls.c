#include "ota_internal.h"

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <mbedtls/ssl_ciphersuites.h>
#include <psa/internal_trusted_storage.h>

#include <zephyr/kernel.h>
#include <zephyr/mgmt/mcumgr/mgmt/mgmt.h>
#include <zephyr/mgmt/mcumgr/smp/smp.h>
#include <zephyr/mgmt/mcumgr/transport/smp.h>
#include <zephyr/net/net_event.h>
#include <zephyr/net/net_mgmt.h>
#include <zephyr/net/socket.h>
#include <zephyr/net/tls_credentials.h>
#include <zephyr/net/wifi_mgmt.h>
#include <zephyr/sys/util.h>
#include <zephyr/sys/atomic.h>

#include <mgmt/mcumgr/transport/smp_internal.h>

#include <spaghetti/ota.h>

#include "../service_thread.h"

#define SPAGHETTI_OTA_RECORD_UID ((psa_storage_uid_t)0x0057FFE1U)
#define SPAGHETTI_OTA_RECORD_MAGIC 0x534F5441U
#define SPAGHETTI_OTA_RECORD_VERSION 1U
#define SPAGHETTI_OTA_TLS_TAG 2

struct spaghetti_ota_record {
	uint32_t magic;
	uint32_t pending_timeout_ms;
	uint8_t version;
	uint8_t identity_size;
	uint8_t pending;
	uint8_t reserved;
	uint8_t psk[SPAGHETTI_OTA_PSK_SIZE];
	uint8_t identity[SPAGHETTI_OTA_IDENTITY_MAX_SIZE];
};

struct spaghetti_ota_backend_context {
	struct smp_transport transport;
	struct net_mgmt_event_callback network_callback;
	struct spaghetti_ota_record active_record;
	int socket;
	bool initialized;
	bool listener_running;
	bool credentials_registered;
	bool network_callback_registered;
};

static struct spaghetti_ota_backend_context context = {
	.socket = -1,
};
static struct spaghetti_service_thread listener_thread;
static atomic_t listener_stop_requested;
K_MUTEX_DEFINE(backend_lock);

BUILD_ASSERT(sizeof(struct spaghetti_ota_record) <=
	     CONFIG_SECURE_STORAGE_ITS_MAX_DATA_SIZE);
BUILD_ASSERT(sizeof(struct net_sockaddr) <=
	     CONFIG_MCUMGR_TRANSPORT_NETBUF_USER_DATA_SIZE);

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
	case PSA_ERROR_NOT_PERMITTED:
		return -EACCES;
	default:
		return -EIO;
	}
}

static int read_record(struct spaghetti_ota_record *record)
{
	size_t record_size = 0U;
	psa_status_t status;

	if (record == NULL) {
		return -EINVAL;
	}
	status = psa_its_get(SPAGHETTI_OTA_RECORD_UID, 0U, sizeof(*record),
			     record, &record_size);
	if (status != PSA_SUCCESS) {
		return map_psa_status(status);
	}
	if ((record_size != sizeof(*record)) ||
	    (record->magic != SPAGHETTI_OTA_RECORD_MAGIC) ||
	    (record->version != SPAGHETTI_OTA_RECORD_VERSION) ||
	    (record->identity_size == 0U) ||
	    (record->identity_size > sizeof(record->identity)) ||
	    (record->reserved != 0U) || (record->pending > 1U)) {
		wipe_sensitive(record, sizeof(*record));
		return -EBADMSG;
	}
	return 0;
}

static int write_record(const struct spaghetti_ota_record *record)
{
	return map_psa_status(psa_its_set(
		SPAGHETTI_OTA_RECORD_UID, sizeof(*record), record,
		PSA_STORAGE_FLAG_NONE));
}

static uint16_t ota_get_mtu(const struct net_buf *request)
{
	ARG_UNUSED(request);
	return CONFIG_SPAGHETTI_OTA_MTU;
}

static int ota_user_data_copy(struct net_buf *destination,
			      const struct net_buf *source)
{
	memcpy(net_buf_user_data(destination), net_buf_user_data(source),
	       sizeof(struct net_sockaddr));
	return MGMT_ERR_EOK;
}

static void ota_user_data_init(struct net_buf *buffer, void *private_data)
{
	if (private_data != NULL) {
		memcpy(net_buf_user_data(buffer), private_data,
		       sizeof(struct net_sockaddr));
	}
}

static int ota_output(struct net_buf *buffer)
{
	const struct net_sockaddr *address = net_buf_user_data(buffer);
	const int socket_fd = context.socket;
	int result;

	if (socket_fd < 0) {
		smp_packet_free(buffer);
		return MGMT_ERR_EINVAL;
	}
	result = zsock_sendto(socket_fd, buffer->data, buffer->len, 0,
			      address, sizeof(*address));
	smp_packet_free(buffer);
	if (result < 0) {
		return (errno == ENOMEM) ? MGMT_ERR_EMSGSIZE : MGMT_ERR_EINVAL;
	}
	return MGMT_ERR_EOK;
}

static void listener_entry(void *first, void *second, void *third)
{
	ARG_UNUSED(first);
	ARG_UNUSED(second);
	ARG_UNUSED(third);

	while (atomic_get(&listener_stop_requested) == 0) {
		uint8_t receive_buffer[CONFIG_SPAGHETTI_OTA_MTU];
		struct net_sockaddr address;
		net_socklen_t address_size = sizeof(address);
		const int received = zsock_recvfrom(
			context.socket, receive_buffer, sizeof(receive_buffer), 0,
			&address, &address_size);

		if (received > 0) {
			struct net_buf *packet = smp_packet_alloc();

			if (packet == NULL) {
				continue;
			}
			net_buf_add_mem(packet, receive_buffer, (size_t)received);
			memcpy(net_buf_user_data(packet), &address,
			       sizeof(address));
			smp_rx_req(&context.transport, packet);
		} else if ((received < 0) && (errno != EINTR) &&
			   (errno != EBADF)) {
			spaghetti_ota_network_lost();
			return;
		}
	}
}

static void network_event_handler(
	struct net_mgmt_event_callback *callback,
	uint64_t event, struct net_if *interface)
{
	ARG_UNUSED(callback);
	ARG_UNUSED(interface);
	if ((event == NET_EVENT_IPV4_ADDR_DEL) ||
	    (event == NET_EVENT_WIFI_DISCONNECT_RESULT)) {
		spaghetti_ota_network_lost();
	}
}

static int register_credentials(void)
{
	int err = tls_credential_add(
		SPAGHETTI_OTA_TLS_TAG, TLS_CREDENTIAL_PSK,
		context.active_record.psk, sizeof(context.active_record.psk));

	if (err < 0) {
		return err;
	}
	err = tls_credential_add(
		SPAGHETTI_OTA_TLS_TAG, TLS_CREDENTIAL_PSK_ID,
		context.active_record.identity,
		context.active_record.identity_size);
	if (err < 0) {
		(void)tls_credential_delete(
			SPAGHETTI_OTA_TLS_TAG, TLS_CREDENTIAL_PSK);
		return err;
	}
	context.credentials_registered = true;
	return 0;
}

static void unregister_credentials(void)
{
	if (context.credentials_registered) {
		(void)tls_credential_delete(
			SPAGHETTI_OTA_TLS_TAG, TLS_CREDENTIAL_PSK_ID);
		(void)tls_credential_delete(
			SPAGHETTI_OTA_TLS_TAG, TLS_CREDENTIAL_PSK);
		context.credentials_registered = false;
	}
	wipe_sensitive(&context.active_record, sizeof(context.active_record));
}

int spaghetti_ota_backend_init(void)
{
	int err = k_mutex_lock(&backend_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (context.initialized) {
		err = -EALREADY;
		goto unlock;
	}
	context.transport.functions.output = ota_output;
	context.transport.functions.get_mtu = ota_get_mtu;
	context.transport.functions.ud_copy = ota_user_data_copy;
	context.transport.functions.ud_init = ota_user_data_init;
	err = smp_transport_init(&context.transport);
	if (err < 0) {
		goto unlock;
	}
	context.initialized = true;
unlock:
	k_mutex_unlock(&backend_lock);
	return err;
}

int spaghetti_ota_backend_has_credentials(bool *present)
{
	struct spaghetti_ota_record record;
	int err;

	if (present == NULL) {
		return -EINVAL;
	}
	err = read_record(&record);
	if (err == -ENOENT) {
		*present = false;
		return 0;
	}
	if (err < 0) {
		return err;
	}
	*present = true;
	wipe_sensitive(&record, sizeof(record));
	return 0;
}

int spaghetti_ota_backend_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size)
{
	struct spaghetti_ota_record record = {
		.magic = SPAGHETTI_OTA_RECORD_MAGIC,
		.version = SPAGHETTI_OTA_RECORD_VERSION,
		.identity_size = identity_size,
	};
	int err;

	if ((psk == NULL) || (psk_size != sizeof(record.psk)) ||
	    (identity == NULL) || (identity_size == 0U) ||
	    (identity_size > sizeof(record.identity))) {
		return -EINVAL;
	}
	memcpy(record.psk, psk, psk_size);
	memcpy(record.identity, identity, identity_size);
	err = write_record(&record);
	wipe_sensitive(&record, sizeof(record));
	return err;
}

int spaghetti_ota_backend_clear_credentials(void)
{
	return map_psa_status(psa_its_remove(SPAGHETTI_OTA_RECORD_UID));
}

int spaghetti_ota_backend_request_once(uint32_t timeout_ms)
{
	struct spaghetti_ota_record record;
	int err = read_record(&record);

	if (err < 0) {
		return err;
	}
	record.pending = 1U;
	record.pending_timeout_ms = timeout_ms;
	err = write_record(&record);
	wipe_sensitive(&record, sizeof(record));
	return err;
}

int spaghetti_ota_backend_consume_request(uint32_t *timeout_ms)
{
	struct spaghetti_ota_record record;
	int err;

	if (timeout_ms == NULL) {
		return -EINVAL;
	}
	err = read_record(&record);
	if (err < 0) {
		return err;
	}
	if ((record.pending == 0U) || (record.pending_timeout_ms == 0U)) {
		wipe_sensitive(&record, sizeof(record));
		return -ENOENT;
	}
	if (record.pending_timeout_ms > CONFIG_SPAGHETTI_OTA_MAX_WINDOW_MS) {
		wipe_sensitive(&record, sizeof(record));
		return -EBADMSG;
	}
	*timeout_ms = record.pending_timeout_ms;
	record.pending = 0U;
	record.pending_timeout_ms = 0U;
	err = write_record(&record);
	wipe_sensitive(&record, sizeof(record));
	return err;
}

int spaghetti_ota_backend_open(void)
{
	struct net_sockaddr_in address = {
		.sin_family = NET_AF_INET,
		.sin_port = net_htons(CONFIG_SPAGHETTI_OTA_PORT),
		.sin_addr = {
			.s_addr = net_htonl(NET_INADDR_ANY),
		},
	};
	sec_tag_t tags[] = {SPAGHETTI_OTA_TLS_TAG};
	int role = ZSOCK_TLS_DTLS_ROLE_SERVER;
	int ciphersuites[] = {
		MBEDTLS_TLS_PSK_WITH_AES_128_GCM_SHA256,
	};
	int err = k_mutex_lock(&backend_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (context.listener_running) {
		err = -EALREADY;
		goto unlock;
	}
	err = read_record(&context.active_record);
	if (err < 0) {
		goto unlock;
	}
	err = register_credentials();
	if (err < 0) {
		goto cleanup;
	}
	context.socket = zsock_socket(
		NET_AF_INET, NET_SOCK_DGRAM, NET_IPPROTO_DTLS_1_2);
	if (context.socket < 0) {
		err = -errno;
		goto cleanup;
	}
	if ((zsock_setsockopt(context.socket, ZSOCK_SOL_TLS,
			       ZSOCK_TLS_SEC_TAG_LIST,
			       tags, sizeof(tags)) < 0) ||
	    (zsock_setsockopt(context.socket, ZSOCK_SOL_TLS,
			       ZSOCK_TLS_DTLS_ROLE,
			       &role, sizeof(role)) < 0) ||
	    (zsock_setsockopt(context.socket, ZSOCK_SOL_TLS,
			       ZSOCK_TLS_CIPHERSUITE_LIST,
			       ciphersuites, sizeof(ciphersuites)) < 0) ||
	    (zsock_bind(context.socket,
			(struct net_sockaddr *)&address, sizeof(address)) < 0)) {
		err = -errno;
		goto cleanup;
	}
	net_mgmt_init_event_callback(
		&context.network_callback, network_event_handler,
		NET_EVENT_IPV4_ADDR_DEL | NET_EVENT_WIFI_DISCONNECT_RESULT);
	net_mgmt_add_event_callback(&context.network_callback);
	context.network_callback_registered = true;
	atomic_set(&listener_stop_requested, 0);
	err = spaghetti_service_thread_start(
		&listener_thread, CONFIG_SPAGHETTI_OTA_LISTENER_STACK_SIZE,
		listener_entry, NULL, NULL, NULL,
		CONFIG_SPAGHETTI_OTA_WORK_PRIORITY, "spaghetti_ota_rx");
	if (err < 0) {
		goto cleanup;
	}
	context.listener_running = true;
	goto unlock;

cleanup:
	if (context.socket >= 0) {
		(void)zsock_close(context.socket);
		context.socket = -1;
	}
	if (context.network_callback_registered) {
		net_mgmt_del_event_callback(&context.network_callback);
		context.network_callback_registered = false;
	}
	unregister_credentials();
unlock:
	k_mutex_unlock(&backend_lock);
	return err;
}

int spaghetti_ota_backend_close(k_timeout_t timeout)
{
	int err = k_mutex_lock(&backend_lock, K_FOREVER);
	int close_error = 0;

	if (err < 0) {
		return err;
	}
	if (!context.listener_running && (listener_thread.stack == NULL)) {
		err = -EALREADY;
		goto unlock;
	}
	atomic_set(&listener_stop_requested, 1);
	err = (context.socket >= 0) ? zsock_close(context.socket) : 0;
	if (err < 0) {
		close_error = -errno;
	}
	context.socket = -1;
	k_mutex_unlock(&backend_lock);
	if (listener_thread.stack != NULL) {
		err = spaghetti_service_thread_join_and_release(
			&listener_thread, timeout);
		if (err < 0) {
			return err;
		}
	}
	(void)k_mutex_lock(&backend_lock, K_FOREVER);
	smp_rx_clear(&context.transport);
	context.listener_running = false;
	if (context.network_callback_registered) {
		net_mgmt_del_event_callback(&context.network_callback);
		context.network_callback_registered = false;
	}
	unregister_credentials();
unlock:
	k_mutex_unlock(&backend_lock);
	return (err < 0) ? err : close_error;
}

bool spaghetti_ota_backend_is_transport(
	const struct smp_transport *transport)
{
	return context.listener_running && (transport == &context.transport);
}
