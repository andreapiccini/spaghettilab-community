#include "field_update_internal.h"

#include <errno.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/net/net_if.h>
#include <zephyr/net/net_ip.h>
#include <zephyr/net/socket.h>
#include <zephyr/sys/util.h>

#include <esp_wifi.h>

#include <spaghetti/field_update.h>
#include <spaghetti/update.h>

LOG_MODULE_DECLARE(spaghetti_field_update);

#define SPAGHETTI_FIELD_ESPNOW_SEND_ATTEMPTS 8U
#define SPAGHETTI_FIELD_ESPNOW_ACK_WAIT_MS 500U
#define SPAGHETTI_FIELD_ESPNOW_UDP_PORT 1339U
#define SPAGHETTI_FIELD_ESPNOW_RX_STACK 1536
#define SPAGHETTI_FIELD_ESPNOW_SUBNET 0x0AFFFF00U

static int udp_sock = -1;
static struct k_thread field_espnow_rx_thread;
static k_tid_t field_espnow_rx_tid;
K_THREAD_STACK_DEFINE(field_espnow_rx_stack, SPAGHETTI_FIELD_ESPNOW_RX_STACK);

static void encode_ipv4(uint8_t out[6], uint32_t addr)
{
	memset(out, 0, 6);
	out[0] = (uint8_t)(addr >> 24);
	out[1] = (uint8_t)(addr >> 16);
	out[2] = (uint8_t)(addr >> 8);
	out[3] = (uint8_t)addr;
}

static uint32_t decode_ipv4(const uint8_t src[6])
{
	return ((uint32_t)src[0] << 24) | ((uint32_t)src[1] << 16) |
	       ((uint32_t)src[2] << 8) | (uint32_t)src[3];
}

static int send_bytes(uint32_t dest_addr, const void *data, size_t length)
{
	struct sockaddr_in dest = {
		.sin_family = AF_INET,
		.sin_port = htons(SPAGHETTI_FIELD_ESPNOW_UDP_PORT),
		.sin_addr.s_addr = htonl(dest_addr),
	};

	if ((udp_sock < 0) || (data == NULL) || (length == 0U)) {
		return -EACCES;
	}
	if (zsock_sendto(udp_sock, data, length, 0,
			 (struct sockaddr *)&dest, sizeof(dest)) < 0) {
		return -EIO;
	}
	return 0;
}

static void field_espnow_rx_worker(void *p1, void *p2, void *p3)
{
	uint8_t src[6];
	uint8_t buffer[sizeof(struct spaghetti_espnow_ota_packet)];
	struct sockaddr_in from;
	socklen_t from_len;

	ARG_UNUSED(p1);
	ARG_UNUSED(p2);
	ARG_UNUSED(p3);

	while (true) {
		const struct spaghetti_espnow_ota_packet *packet;
		int received;

		from_len = sizeof(from);
		received = zsock_recvfrom(udp_sock, buffer, sizeof(buffer), 0,
					  (struct sockaddr *)&from, &from_len);
		if (received < (int)SPAGHETTI_ESPNOW_OTA_HEADER_SIZE) {
			continue;
		}

		packet = (const struct spaghetti_espnow_ota_packet *)buffer;
		if ((packet->magic != SPAGHETTI_ESPNOW_OTA_MAGIC) ||
		    (packet->version != SPAGHETTI_ESPNOW_OTA_VERSION) ||
		    (packet->payload_len > SPAGHETTI_ESPNOW_OTA_PAYLOAD_MAX) ||
		    ((SPAGHETTI_ESPNOW_OTA_HEADER_SIZE +
		      packet->payload_len) != (size_t)received)) {
			continue;
		}

		encode_ipv4(src, ntohl(from.sin_addr.s_addr));
		(void)spaghetti_field_update_post_espnow(src, buffer,
							 (size_t)received);
	}
}

static uint32_t local_ipv4(struct net_if *iface)
{
	uint8_t mac[6] = { 0 };
	uint32_t host;

	if (net_if_get_link_addr(iface) != NULL) {
		memcpy(mac, net_if_get_link_addr(iface)->addr,
		       MIN(net_if_get_link_addr(iface)->len, sizeof(mac)));
	}
	host = mac[5];
	if ((host == 0U) || (host == 255U)) {
		host = 1U;
	}
	return SPAGHETTI_FIELD_ESPNOW_SUBNET | host;
}

static int start_sta_radio(void)
{
	struct net_if *iface = net_if_get_first_wifi();
	struct in_addr addr;
	struct in_addr mask;
	esp_err_t wifi_err;
	int err;

	if (iface == NULL) {
		return -ENODEV;
	}
	if (!net_if_is_up(iface)) {
		err = net_if_up(iface);
		if ((err < 0) && (err != -EALREADY)) {
			return err;
		}
	}

	k_sleep(K_MSEC(100));
	wifi_err = esp_wifi_start();
	if (wifi_err != ESP_OK) {
		LOG_WRN("field-update wifi_start: %d", (int)wifi_err);
	}
	wifi_err = esp_wifi_set_channel(SPAGHETTI_ESPNOW_OTA_CHANNEL,
					WIFI_SECOND_CHAN_NONE);
	if (wifi_err != ESP_OK) {
		LOG_WRN("field-update set_channel: %d", (int)wifi_err);
	}

	addr.s_addr = htonl(local_ipv4(iface));
	mask.s_addr = htonl(0xFFFFFF00U);
	if (net_if_ipv4_addr_add(iface, &addr, NET_ADDR_MANUAL, 0) == NULL) {
		return -EIO;
	}
	(void)net_if_ipv4_set_netmask_by_addr(iface, &addr, &mask);
	return 0;
}

int spaghetti_field_update_espnow_send_ack(
	const uint8_t mac[6],
	const struct spaghetti_espnow_ota_packet *request, uint8_t status)
{
	struct spaghetti_espnow_ota_packet ack;

	if ((mac == NULL) || (request == NULL)) {
		return -EINVAL;
	}

	memset(&ack, 0, sizeof(ack));
	ack.magic = SPAGHETTI_ESPNOW_OTA_MAGIC;
	ack.version = SPAGHETTI_ESPNOW_OTA_VERSION;
	ack.type = SPAGHETTI_ESPNOW_OTA_ACK;
	ack.node_id = spaghetti_field_update_local_node_id();
	ack.offset = request->offset;
	ack.image_size = request->image_size;
	ack.image_crc32 = request->image_crc32;
	ack.status = status;
	ack.reserved[0] = request->type;
	return send_bytes(decode_ipv4(mac), &ack, SPAGHETTI_ESPNOW_OTA_HEADER_SIZE);
}

static int exchange(struct spaghetti_espnow_ota_packet *packet)
{
	const size_t wire_size =
		SPAGHETTI_ESPNOW_OTA_HEADER_SIZE + packet->payload_len;
	uint8_t attempt;
	uint8_t status = 0U;

	for (attempt = 0U; attempt < SPAGHETTI_FIELD_ESPNOW_SEND_ATTEMPTS;
	     ++attempt) {
		int err;

		spaghetti_field_update_prepare_ack();
		err = send_bytes(SPAGHETTI_FIELD_ESPNOW_SUBNET | 0xFFU, packet,
				 wire_size);
		if (err < 0) {
			k_sleep(K_MSEC(30));
			continue;
		}
		err = spaghetti_field_update_wait_ack(
			packet->type, packet->offset, &status,
			K_MSEC(SPAGHETTI_FIELD_ESPNOW_ACK_WAIT_MS));
		if (err == -EAGAIN) {
			continue;
		}
		if (err < 0) {
			continue;
		}
		if (status != 0U) {
			return -EIO;
		}
		return 0;
	}

	return -ETIMEDOUT;
}

int spaghetti_field_update_espnow_init(void)
{
	struct sockaddr_in bind_addr = {
		.sin_family = AF_INET,
		.sin_port = htons(SPAGHETTI_FIELD_ESPNOW_UDP_PORT),
		.sin_addr.s_addr = htonl(INADDR_ANY),
	};
	int reuse = 1;
	int err = start_sta_radio();

	if (err < 0) {
		return err;
	}

	udp_sock = zsock_socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
	if (udp_sock < 0) {
		return -EIO;
	}
	(void)zsock_setsockopt(udp_sock, SOL_SOCKET, SO_REUSEADDR, &reuse,
			       sizeof(reuse));
	(void)zsock_setsockopt(udp_sock, SOL_SOCKET, SO_BROADCAST, &reuse,
			       sizeof(reuse));
	if (zsock_bind(udp_sock, (struct sockaddr *)&bind_addr,
		       sizeof(bind_addr)) < 0) {
		return -EIO;
	}

	field_espnow_rx_tid = k_thread_create(
		&field_espnow_rx_thread, field_espnow_rx_stack,
		K_THREAD_STACK_SIZEOF(field_espnow_rx_stack),
		field_espnow_rx_worker, NULL, NULL, NULL, K_PRIO_PREEMPT(8), 0,
		K_NO_WAIT);
	k_thread_name_set(field_espnow_rx_tid, "field_udp");
	LOG_INF("wireless field update listening on UDP %u channel %u",
		SPAGHETTI_FIELD_ESPNOW_UDP_PORT,
		SPAGHETTI_ESPNOW_OTA_CHANNEL);
	return 0;
}

int spaghetti_field_update_espnow_send(uint32_t dest_node_id)
{
	struct spaghetti_espnow_ota_packet packet;
	uint32_t size = 0U;
	uint32_t crc = 0U;
	uint32_t offset = 0U;
	int err;

	err = spaghetti_field_update_running_image_info(&size, &crc);
	if (err < 0) {
		return err;
	}

	memset(&packet, 0, sizeof(packet));
	packet.magic = SPAGHETTI_ESPNOW_OTA_MAGIC;
	packet.version = SPAGHETTI_ESPNOW_OTA_VERSION;
	packet.type = SPAGHETTI_ESPNOW_OTA_BEGIN;
	packet.node_id = dest_node_id;
	packet.image_size = size;
	packet.image_crc32 = crc;
	err = exchange(&packet);
	if (err < 0) {
		return err;
	}

	while (offset < size) {
		const uint16_t n = (uint16_t)MIN(
			size - offset, (uint32_t)SPAGHETTI_ESPNOW_OTA_PAYLOAD_MAX);

		memset(&packet, 0, sizeof(packet));
		packet.magic = SPAGHETTI_ESPNOW_OTA_MAGIC;
		packet.version = SPAGHETTI_ESPNOW_OTA_VERSION;
		packet.type = SPAGHETTI_ESPNOW_OTA_DATA;
		packet.node_id = dest_node_id;
		packet.offset = offset;
		packet.image_size = size;
		packet.image_crc32 = crc;
		packet.payload_len = n;
		err = spaghetti_field_update_read_running_image(
			offset, packet.payload, n);
		if (err < 0) {
			return err;
		}
		err = exchange(&packet);
		if (err < 0) {
			return err;
		}
		offset += n;
	}

	memset(&packet, 0, sizeof(packet));
	packet.magic = SPAGHETTI_ESPNOW_OTA_MAGIC;
	packet.version = SPAGHETTI_ESPNOW_OTA_VERSION;
	packet.type = SPAGHETTI_ESPNOW_OTA_END;
	packet.node_id = dest_node_id;
	packet.offset = size;
	packet.image_size = size;
	packet.image_crc32 = crc;
	return exchange(&packet);
}
