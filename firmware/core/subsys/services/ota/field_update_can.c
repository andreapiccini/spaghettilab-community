#include "field_update_internal.h"

#include <errno.h>
#include <string.h>

#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/can.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/printk.h>
#include <zephyr/sys/util.h>

#include <spaghetti/field_update.h>
#include <spaghetti/update.h>

LOG_MODULE_DECLARE(spaghetti_field_update);

#ifndef CONFIG_SPAGHETTI_FIELD_UPDATE_CAN_BITRATE
#define CONFIG_SPAGHETTI_FIELD_UPDATE_CAN_BITRATE 500000
#endif

#define SPAGHETTI_FIELD_CAN_SEND_ATTEMPTS 5U
#define SPAGHETTI_FIELD_CAN_ACK_WAIT_MS 250U
#define SPAGHETTI_FIELD_CAN_BEGIN_WAIT_MS 90000U
#define SPAGHETTI_FIELD_CAN_BEGIN_ATTEMPTS 2U
#define SPAGHETTI_FIELD_CAN_END_WAIT_MS 10000U
#define SPAGHETTI_FIELD_CAN_END_ATTEMPTS 3U

static const struct device *can_dev;

static void can_rx_handler(const struct device *dev, struct can_frame *frame,
			   void *user_data)
{
	ARG_UNUSED(dev);
	ARG_UNUSED(user_data);

	if ((frame == NULL) || ((frame->flags & CAN_FRAME_RTR) != 0U)) {
		return;
	}
	(void)spaghetti_field_update_post_can(frame->id, frame->data,
					      frame->dlc);
}

static int send_frame(uint32_t id, bool ide, const uint8_t *data, uint8_t dlc)
{
	struct can_frame frame = {
		.id = id,
		.dlc = dlc,
		.flags = ide ? CAN_FRAME_IDE : 0U,
	};

	if ((data == NULL) && (dlc != 0U)) {
		return -EINVAL;
	}
	if (dlc > 0U) {
		memcpy(frame.data, data, dlc);
	}
	return can_send(can_dev, &frame, K_MSEC(50), NULL, NULL);
}

static int exchange(uint32_t id, const uint8_t *data, uint8_t dlc,
		    uint8_t type, uint32_t offset, uint32_t ack_ms,
		    uint8_t attempts)
{
	uint8_t attempt;
	uint8_t status = 0U;

	for (attempt = 0U; attempt < attempts; ++attempt) {
		int err;

		spaghetti_field_update_prepare_ack();
		err = send_frame(id, false, data, dlc);
		if (err < 0) {
			k_sleep(K_MSEC(10));
			continue;
		}
		err = spaghetti_field_update_wait_ack(type, offset, &status,
						      K_MSEC(ack_ms));
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

int spaghetti_field_update_can_send_ack(uint8_t type, uint8_t status,
					uint32_t written)
{
	uint8_t data[6];

	data[0] = type;
	data[1] = status;
	sys_put_le32(written, &data[2]);
	return send_frame(SPAGHETTI_FIELD_CAN_ID_ACK, false, data, sizeof(data));
}

int spaghetti_field_update_can_ctrl(uint32_t dest_node_id, uint8_t cmd,
				    const uint8_t *extra, uint8_t extra_len)
{
	uint8_t data[8];

	if ((extra_len > 7U) || ((extra == NULL) && (extra_len != 0U))) {
		return -EINVAL;
	}
	if (can_dev == NULL) {
		return -EACCES;
	}

	memset(data, 0, sizeof(data));
	data[0] = cmd;
	if (extra_len > 0U) {
		memcpy(&data[1], extra, extra_len);
	}

	if ((dest_node_id == 0U) ||
	    (dest_node_id == SPAGHETTI_FIELD_UPDATE_BROADCAST)) {
		return send_frame(SPAGHETTI_SLUP_TWAI_CMD_ID, false, data,
				  (uint8_t)(1U + extra_len));
	}

	return send_frame(SPAGHETTI_SLUP_TWAI_NODE_CMD_BASE |
				  (dest_node_id & SPAGHETTI_SLUP_TWAI_NODE_MASK),
			  true, data, (uint8_t)(1U + extra_len));
}

int spaghetti_field_update_can_reply(uint32_t dest_node_id, const uint8_t *data,
				     uint8_t dlc)
{
	if ((data == NULL) || (dlc == 0U) || (dlc > 8U)) {
		return -EINVAL;
	}
	if (can_dev == NULL) {
		return -EACCES;
	}

	if ((dest_node_id == 0U) ||
	    (dest_node_id == SPAGHETTI_FIELD_UPDATE_BROADCAST)) {
		return send_frame(SPAGHETTI_SLUP_TWAI_RSP_ID, false, data, dlc);
	}

	return send_frame(SPAGHETTI_SLUP_TWAI_NODE_RSP_BASE |
				  (dest_node_id & SPAGHETTI_SLUP_TWAI_NODE_MASK),
			  true, data, dlc);
}

int spaghetti_field_update_can_init(void)
{
	const struct can_filter std_filter = {
		.id = 0U,
		.mask = 0U,
	};
	const struct can_filter ext_filter = {
		.id = 0U,
		.mask = 0U,
		.flags = CAN_FILTER_IDE,
	};
	int err;

#if !DT_NODE_HAS_STATUS(DT_NODELABEL(twai), okay)
	ARG_UNUSED(std_filter);
	ARG_UNUSED(ext_filter);
	ARG_UNUSED(err);
	return -ENODEV;
#else
	can_dev = DEVICE_DT_GET(DT_NODELABEL(twai));
	if (!device_is_ready(can_dev)) {
		return -ENODEV;
	}

	err = can_set_bitrate(can_dev, CONFIG_SPAGHETTI_FIELD_UPDATE_CAN_BITRATE);
	if ((err < 0) && (err != -EALREADY)) {
		return err;
	}
	err = can_start(can_dev);
	if ((err < 0) && (err != -EALREADY)) {
		return err;
	}
	err = can_add_rx_filter(can_dev, can_rx_handler, NULL, &std_filter);
	if (err < 0) {
		return err;
	}
	err = can_add_rx_filter(can_dev, can_rx_handler, NULL, &ext_filter);
	if (err < 0) {
		return err;
	}

	LOG_INF("SLUP CAN listening at %u bit/s",
		CONFIG_SPAGHETTI_FIELD_UPDATE_CAN_BITRATE);
	return 0;
#endif
}

int spaghetti_field_update_can_push(
	uint32_t dest_node_id, uint32_t size, uint32_t crc,
	int (*read_fn)(uint32_t offset, uint8_t *data, size_t length, void *ctx),
	void *ctx)
{
	uint8_t chunk[8];
	uint32_t offset = 0U;
	uint8_t last_pct = 0U;
	int err;

	if ((can_dev == NULL) || (read_fn == NULL) || (size == 0U)) {
		return -EINVAL;
	}

	sys_put_le32(size, &chunk[0]);
	sys_put_le32(crc, &chunk[4]);
	spaghetti_field_update_ui_text("SLUP erase peer slot");
	spaghetti_field_update_prepare_ack();
	err = send_frame(SPAGHETTI_FIELD_CAN_ID_BEGIN, false, chunk, 8U);
	if (err < 0) {
		LOG_ERR("SLUP image begin send failed: %d", err);
		return err;
	}
	{
		const int64_t started = k_uptime_get();
		const int64_t deadline =
			started + (int64_t)SPAGHETTI_FIELD_CAN_BEGIN_WAIT_MS;
		uint8_t status = 0U;

		err = -ETIMEDOUT;
		while (k_uptime_get() < deadline) {
			const int64_t elapsed = k_uptime_get() - started;
			uint8_t wait_pct;

			err = spaghetti_field_update_wait_ack(
				SPAGHETTI_ESPNOW_OTA_BEGIN, 0U, &status,
				K_MSEC(5000));
			if (err == 0) {
				if (status != 0U) {
					LOG_ERR("SLUP image begin status=%u",
						status);
					return -EIO;
				}
				break;
			}
			wait_pct = (uint8_t)MIN(
				99,
				(elapsed * 100) /
				(int64_t)SPAGHETTI_FIELD_CAN_BEGIN_WAIT_MS);
			spaghetti_field_update_ui_pct("erase", wait_pct);
		}
		if (err < 0) {
			LOG_ERR("SLUP image begin failed: %d", err);
			return err;
		}
	}
	spaghetti_field_update_ui_pct("send", 0U);

	while (offset < size) {
		const uint8_t n = (uint8_t)MIN(size - offset,
					       SPAGHETTI_FIELD_CAN_DATA_BYTES);

		spaghetti_field_put_le24(&chunk[0], offset);
		err = read_fn(offset, &chunk[3], n, ctx);
		if (err < 0) {
			return err;
		}
		err = exchange(SPAGHETTI_FIELD_CAN_ID_DATA, chunk,
			       (uint8_t)(3U + n), SPAGHETTI_ESPNOW_OTA_DATA,
			       offset, SPAGHETTI_FIELD_CAN_ACK_WAIT_MS,
			       SPAGHETTI_FIELD_CAN_SEND_ATTEMPTS);
		if (err < 0) {
			return err;
		}
		offset += n;
		{
			const uint8_t pct =
				(uint8_t)((offset * 100U) / size);

			if ((pct >= (uint8_t)(last_pct + 5U)) ||
			    (offset == size)) {
				last_pct = pct;
				spaghetti_field_update_ui_pct("send", pct);
			}
		}
	}

	sys_put_le32(size, &chunk[0]);
	sys_put_le32(crc, &chunk[4]);
	err = exchange(SPAGHETTI_FIELD_CAN_ID_END, chunk, 8U,
		       SPAGHETTI_ESPNOW_OTA_END, size,
		       SPAGHETTI_FIELD_CAN_END_WAIT_MS,
		       SPAGHETTI_FIELD_CAN_END_ATTEMPTS);
	if (err < 0) {
		LOG_ERR("SLUP image end failed: %d", err);
	}
	return err;
}

static int read_running_cb(uint32_t offset, uint8_t *data, size_t length,
			   void *ctx)
{
	ARG_UNUSED(ctx);
	return spaghetti_field_update_read_running_image(offset, data, length);
}

int spaghetti_field_update_can_send(uint32_t dest_node_id)
{
	uint32_t size = 0U;
	uint32_t crc = 0U;
	int err;

	if (can_dev == NULL) {
		return -EACCES;
	}

	LOG_INF("SLUP hashing local image");
	err = spaghetti_field_update_running_image_info(&size, &crc);
	if (err < 0) {
		LOG_ERR("SLUP local image failed: %d", err);
		return err;
	}

	LOG_INF("SLUP enter dest=0x%06x size=%u",
		dest_node_id & SPAGHETTI_SLUP_TWAI_NODE_MASK, size);
	err = spaghetti_field_update_enter_update(dest_node_id);
	if (err < 0) {
		LOG_ERR("SLUP EnterUpdate failed: %d", err);
		return err;
	}

	err = spaghetti_field_update_confirm_peer(dest_node_id);
	if (err < 0) {
		return err;
	}

	return spaghetti_field_update_can_push(dest_node_id, size, crc,
					       read_running_cb, NULL);
}
