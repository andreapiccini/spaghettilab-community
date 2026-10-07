#ifndef SPAGHETTI_FIELD_UPDATE_INTERNAL_H
#define SPAGHETTI_FIELD_UPDATE_INTERNAL_H

#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

#include <spaghetti/update.h>

#define SPAGHETTI_ESPNOW_OTA_MAGIC 0x574F4E42U
#define SPAGHETTI_ESPNOW_OTA_VERSION 1U
#define SPAGHETTI_ESPNOW_OTA_CHANNEL 1U
#define SPAGHETTI_ESPNOW_OTA_PAYLOAD_MAX 200U

#define SPAGHETTI_ESPNOW_OTA_BEGIN 1U
#define SPAGHETTI_ESPNOW_OTA_DATA 2U
#define SPAGHETTI_ESPNOW_OTA_END 3U
#define SPAGHETTI_ESPNOW_OTA_ACK 0x80U
#define SPAGHETTI_SLUP_ACK_PROGRESS 0xFEU

#define SPAGHETTI_FIELD_CAN_ID_BEGIN 0x1B0U
#define SPAGHETTI_FIELD_CAN_ID_DATA 0x1B1U
#define SPAGHETTI_FIELD_CAN_ID_END 0x1B2U
#define SPAGHETTI_FIELD_CAN_ID_ACK 0x1B3U
#define SPAGHETTI_FIELD_CAN_DATA_BYTES 5U

#define SPAGHETTI_SLUP_TWAI_CMD_ID 0x10U
#define SPAGHETTI_SLUP_TWAI_RSP_ID 0x11U
#define SPAGHETTI_SLUP_TWAI_NODE_CMD_BASE 0x12000000U
#define SPAGHETTI_SLUP_TWAI_NODE_RSP_BASE 0x13000000U
#define SPAGHETTI_SLUP_TWAI_NODE_MASK 0x00FFFFFFU

#define SPAGHETTI_SLUP_CMD_PING 0x01U
#define SPAGHETTI_SLUP_CMD_ENTER_UPDATE 0x03U
#define SPAGHETTI_SLUP_CMD_STATUS 0x05U
#define SPAGHETTI_SLUP_CMD_DISCOVER 0x06U
#define SPAGHETTI_SLUP_CMD_SET_CHAIN 0x09U
#define SPAGHETTI_SLUP_CMD_VERSION 0x07U
#define SPAGHETTI_SLUP_CMD_NFC 0x08U
#define SPAGHETTI_SLUP_CMD_BLINK 0x0AU
#define SPAGHETTI_SLUP_CMD_PHYSICAL 0x0BU
#define SPAGHETTI_SLUP_CMD_APPLY_PHYSICAL 0x0CU
#define SPAGHETTI_SLUP_CMD_PHYSICAL_IDENTITY 0x0DU
#define SPAGHETTI_SLUP_RSP_PHYSICAL 0x8BU
#define SPAGHETTI_SLUP_RSP_APPLY_PHYSICAL 0x8CU
#define SPAGHETTI_SLUP_RSP_NFC_CHANGED 0x8DU
#define SPAGHETTI_SLUP_RSP_PONG 0x81U
#define SPAGHETTI_SLUP_RSP_ACK 0x82U
#define SPAGHETTI_SLUP_RSP_STATUS 0x85U
#define SPAGHETTI_SLUP_RSP_DISCOVER 0x86U
#define SPAGHETTI_SLUP_RSP_VERSION 0x87U
#define SPAGHETTI_SLUP_RSP_NFC 0x88U
#define SPAGHETTI_SLUP_RSP_SET_CHAIN 0x89U
#define SPAGHETTI_SLUP_RSP_BLINK 0x8AU
#define SPAGHETTI_SLUP_PROTO 1U
#define SPAGHETTI_SLUP_DISCOVER_MS 300U
#define SPAGHETTI_SLUP_CTRL_ACK_MS 400U
#define SPAGHETTI_SLUP_CTRL_ATTEMPTS 5U
#define SPAGHETTI_SLUP_PING_MS 400U
#define SPAGHETTI_SLUP_BLINK_DEFAULT 5U
#define SPAGHETTI_SLUP_BLINK_MAX 12U
#define SPAGHETTI_SLUP_BLINK_ON_MS 200U
#define SPAGHETTI_SLUP_BLINK_OFF_MS 200U

struct spaghetti_espnow_ota_packet {
	uint32_t magic;
	uint8_t version;
	uint8_t type;
	uint16_t payload_len;
	uint32_t node_id;
	uint32_t offset;
	uint32_t image_size;
	uint32_t image_crc32;
	uint8_t status;
	uint8_t reserved[3];
	uint8_t payload[SPAGHETTI_ESPNOW_OTA_PAYLOAD_MAX];
} __packed;

#define SPAGHETTI_ESPNOW_OTA_HEADER_SIZE \
	offsetof(struct spaghetti_espnow_ota_packet, payload)

int spaghetti_field_update_can_init(void);
int spaghetti_field_update_espnow_init(void);
int spaghetti_field_update_can_send(uint32_t dest_node_id);
int spaghetti_field_update_can_push(
	uint32_t dest_node_id, uint32_t size, uint32_t crc,
	int (*read_fn)(uint32_t offset, uint8_t *data, size_t length, void *ctx),
	void *ctx);
int spaghetti_field_update_espnow_send(uint32_t dest_node_id);
int spaghetti_field_update_can_send_ack(uint8_t type, uint8_t status,
					uint32_t written);
int spaghetti_field_update_can_ctrl(uint32_t dest_node_id, uint8_t cmd,
				    const uint8_t *extra, uint8_t extra_len);
int spaghetti_field_update_can_reply(uint32_t dest_node_id, const uint8_t *data,
				     uint8_t dlc);
int spaghetti_field_update_espnow_send_ack(const uint8_t mac[6],
					   const struct spaghetti_espnow_ota_packet *request,
					   uint8_t status);

static inline uint32_t spaghetti_field_get_le24(const uint8_t *p)
{
	return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16);
}

static inline void spaghetti_field_put_le24(uint8_t *p, uint32_t value)
{
	p[0] = (uint8_t)value;
	p[1] = (uint8_t)(value >> 8);
	p[2] = (uint8_t)(value >> 16);
}

void spaghetti_field_update_prepare_ack(void);
void spaghetti_field_update_note_ack(uint8_t type, uint32_t offset,
				     uint8_t status, uint32_t written);
int spaghetti_field_update_wait_ack(uint8_t type, uint32_t offset,
				    uint8_t *status, k_timeout_t timeout);
uint32_t spaghetti_field_update_last_ack_value(void);
int spaghetti_field_update_confirm_peer(uint32_t dest_node_id);
void spaghetti_field_update_ui_text(const char *text);
void spaghetti_field_update_ui_pct(const char *stage, uint8_t pct);
int spaghetti_field_update_post_can(uint32_t id, const uint8_t *data,
				    uint8_t dlc);
int spaghetti_field_update_post_espnow(const uint8_t src[6],
				       const void *packet, size_t length);
uint32_t spaghetti_field_update_crc32(const uint8_t *data, size_t length);
uint32_t spaghetti_field_update_crc32_update(uint32_t acc, const uint8_t *data,
					     size_t length);
uint32_t spaghetti_field_update_crc32_finish(uint32_t acc);
int spaghetti_field_update_read_running_image(uint32_t offset, uint8_t *data,
					      size_t length);
int spaghetti_field_update_running_image_info(uint32_t *size, uint32_t *crc32);

#endif /* SPAGHETTI_FIELD_UPDATE_INTERNAL_H */
