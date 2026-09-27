#include <spaghetti/field_update.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/spinlock.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/printk.h>
#include <zephyr/sys/util.h>

#if defined(CONFIG_FLASH_MAP)
#include <zephyr/dfu/mcuboot.h>
#include <zephyr/storage/flash_map.h>
#endif

#if defined(CONFIG_SHELL)
#include <zephyr/shell/shell.h>
#endif

#if defined(CONFIG_SOC_SERIES_ESP32S3)
#include <esp_mac.h>
#endif

#include <zephyr/devicetree.h>

#if DT_HAS_ALIAS(led0)
#include <zephyr/drivers/gpio.h>
#endif

#if defined(CONFIG_UART_LINE_CTRL)
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>
#endif

#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN) || \
	defined(CONFIG_SPAGHETTI_FIELD_UPDATE_ESPNOW)
#include <zephyr/sys/reboot.h>
#endif

#include <spaghetti/core.h>
#include <spaghetti/identity.h>
#include <spaghetti/nfc.h>

#include "field_update_internal.h"
#include "../update/update_internal.h"

#ifndef CONFIG_SPAGHETTI_FIELD_UPDATE_WINDOW_MS
#define CONFIG_SPAGHETTI_FIELD_UPDATE_WINDOW_MS 300000
#endif

#ifndef CONFIG_SPAGHETTI_FIELD_UPDATE_STACK_SIZE
#define CONFIG_SPAGHETTI_FIELD_UPDATE_STACK_SIZE 2048
#endif

LOG_MODULE_REGISTER(spaghetti_field_update,
		    CONFIG_SPAGHETTI_FIELD_UPDATE_LOG_LEVEL);

BUILD_ASSERT(SPAGHETTI_SLUP_VERSION_SIZE == SPAGHETTI_CORE_VERSION_SIZE);

#define SLUP_VERSION_CHUNK 6U
#define SLUP_VERSION_CHUNKS \
	((SPAGHETTI_SLUP_VERSION_SIZE + SLUP_VERSION_CHUNK - 1U) / \
	 SLUP_VERSION_CHUNK)

#define SPAGHETTI_FIELD_IMAGE_MAGIC 0x96F3B83DU
#define SPAGHETTI_FIELD_IMAGE_TLV_INFO_MAGIC 0x6907U
#define SPAGHETTI_FIELD_IMAGE_TLV_PROT_INFO_MAGIC 0x6908U

struct image_header_wire {
	uint32_t magic;
	uint32_t load_addr;
	uint16_t hdr_size;
	uint16_t protect_tlv_size;
	uint32_t img_size;
	uint32_t flags;
	uint8_t version[8];
	uint32_t pad1;
} __packed;

struct image_tlv_info_wire {
	uint16_t magic;
	uint16_t tlv_tot;
} __packed;

enum field_update_rx_kind {
	FIELD_UPDATE_RX_CAN = 1,
	FIELD_UPDATE_RX_ESPNOW = 2,
};

struct field_update_rx {
	uint8_t kind;
	uint8_t dlc;
	uint8_t src[6];
	uint32_t can_id;
	union {
		uint8_t can[8];
		struct spaghetti_espnow_ota_packet espnow;
	} u;
};

struct field_update_session {
	bool initialized;
	bool receiving;
	bool load_armed;
	enum spaghetti_update_transport transport;
	uint32_t node_id;
	uint32_t expected_size;
	uint32_t expected_crc;
	uint32_t written;
	uint32_t crc_acc;
	uint8_t mac[6];
	uint8_t chain_index;
	uint8_t last_pct;
};

static struct field_update_session session;
static struct field_update_rx last_ack;
static bool last_ack_valid;
static atomic_t slup_install_pct;
static atomic_t slup_progress_can;
static atomic_t slup_xfer_active;
static struct spaghetti_slup_peer slup_peers[SPAGHETTI_SLUP_PEERS_MAX];
static size_t slup_peer_count;
static struct spaghetti_nfc_tag slup_nfc_remotes[SPAGHETTI_NFC_TAGS_MAX];
static size_t slup_nfc_remote_count;

#define SLUP_PRESENCE_PERIOD_MS 2000U
#define SLUP_PRESENCE_FIRST_MS 400U

static void slup_presence_work(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(slup_presence_dwork, slup_presence_work);

static bool slup_xfer_is_active(void)
{
	return atomic_get(&slup_xfer_active) != 0;
}

static void slup_xfer_begin(void)
{
	atomic_set(&slup_xfer_active, 1);
	(void)k_work_cancel_delayable(&slup_presence_dwork);
}

static void slup_xfer_end(void)
{
	atomic_set(&slup_xfer_active, 0);
	(void)k_work_schedule(&slup_presence_dwork,
			      K_MSEC(SLUP_PRESENCE_PERIOD_MS));
}

#define SLUP_USB_RING 1024U
#define SLUP_USB_CREDIT 256U
#define SLUP_USB_BYTE_MS 5000U

static uint8_t slup_usb_ring[SLUP_USB_RING];
static uint16_t slup_usb_put;
static uint16_t slup_usb_get;
static uint16_t slup_usb_count;
static atomic_t slup_usb_active;
static atomic_t slup_usb_overflow;
static uint32_t slup_usb_total;
static uint8_t slup_usb_last_pct;
static struct k_spinlock slup_usb_lock;
K_SEM_DEFINE(slup_usb_sem, 0, SLUP_USB_RING);
#if DT_HAS_ALIAS(led0)
static const struct gpio_dt_spec slup_led =
	GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
#endif

#define SPAGHETTI_SLUP_LED_IDLE 0
#define SPAGHETTI_SLUP_LED_LOAD 1
#define SPAGHETTI_SLUP_LED_HOLD 2
#define SPAGHETTI_SLUP_LED_PWM_US 1000U
#define SPAGHETTI_SLUP_LED_BREATH_STEPS 128U
#define SPAGHETTI_SLUP_LED_BREATH_HOLD 10U
#define SPAGHETTI_SLUP_LED_LOAD_MS 120U
#define SPAGHETTI_SLUP_LED_STACK 1024

static atomic_t slup_led_mode = ATOMIC_INIT(SPAGHETTI_SLUP_LED_IDLE);
static uint16_t slup_led_phase;
static uint8_t slup_led_pwm_tick;
static struct k_thread slup_led_thread;
static k_tid_t slup_led_tid;
K_THREAD_STACK_DEFINE(slup_led_stack, SPAGHETTI_SLUP_LED_STACK);

static void slup_led_pin(bool on)
{
#if DT_HAS_ALIAS(led0)
	if (gpio_is_ready_dt(&slup_led)) {
		(void)gpio_pin_set_dt(&slup_led, on ? 1 : 0);
	}
#else
	ARG_UNUSED(on);
#endif
}

static void slup_led_idle_slice(void)
{
	uint16_t tri;
	uint32_t duty_us;
	uint32_t off_us;

	if (slup_led_phase < SPAGHETTI_SLUP_LED_BREATH_STEPS) {
		tri = slup_led_phase;
	} else {
		tri = (uint16_t)((SPAGHETTI_SLUP_LED_BREATH_STEPS * 2U) -
				 slup_led_phase);
	}

	duty_us = ((uint32_t)tri * (uint32_t)tri *
		   SPAGHETTI_SLUP_LED_PWM_US) /
		  (SPAGHETTI_SLUP_LED_BREATH_STEPS *
		   SPAGHETTI_SLUP_LED_BREATH_STEPS);

	if (duty_us > 0U) {
		slup_led_pin(true);
		k_busy_wait(duty_us);
	}
	slup_led_pin(false);
	off_us = SPAGHETTI_SLUP_LED_PWM_US - duty_us;
	if (off_us >= 100U) {
		k_usleep(off_us);
	} else if (off_us > 0U) {
		k_busy_wait(off_us);
	}

	slup_led_pwm_tick += 1U;
	if (slup_led_pwm_tick >= SPAGHETTI_SLUP_LED_BREATH_HOLD) {
		slup_led_pwm_tick = 0U;
		slup_led_phase += 1U;
		if (slup_led_phase >= (SPAGHETTI_SLUP_LED_BREATH_STEPS * 2U)) {
			slup_led_phase = 0U;
		}
	}
}

static void slup_led_thread_fn(void *p1, void *p2, void *p3)
{
	ARG_UNUSED(p1);
	ARG_UNUSED(p2);
	ARG_UNUSED(p3);

	while (true) {
		const int mode = atomic_get(&slup_led_mode);

		if (mode == SPAGHETTI_SLUP_LED_HOLD) {
			k_sleep(K_MSEC(20));
			continue;
		}
		if (mode == SPAGHETTI_SLUP_LED_LOAD) {
			slup_led_pin(true);
			k_sleep(K_MSEC(SPAGHETTI_SLUP_LED_LOAD_MS));
			if (atomic_get(&slup_led_mode) !=
			    SPAGHETTI_SLUP_LED_LOAD) {
				continue;
			}
			slup_led_pin(false);
			k_sleep(K_MSEC(SPAGHETTI_SLUP_LED_LOAD_MS));
			continue;
		}
		slup_led_idle_slice();
	}
}

static void slup_led_set_mode(int mode)
{
	const int previous = atomic_set(&slup_led_mode, mode);

	if ((mode == SPAGHETTI_SLUP_LED_IDLE) &&
	    (previous != SPAGHETTI_SLUP_LED_IDLE)) {
		slup_led_phase = 0U;
		slup_led_pwm_tick = 0U;
	}
}

static void slup_led_start(void)
{
#if DT_HAS_ALIAS(led0)
	if (gpio_is_ready_dt(&slup_led)) {
		(void)gpio_pin_configure_dt(&slup_led, GPIO_OUTPUT_INACTIVE);
	}
#endif
	slup_led_phase = 0U;
	slup_led_pwm_tick = 0U;
	atomic_set(&slup_led_mode, SPAGHETTI_SLUP_LED_IDLE);
	slup_led_tid = k_thread_create(
		&slup_led_thread, slup_led_stack,
		K_THREAD_STACK_SIZEOF(slup_led_stack), slup_led_thread_fn,
		NULL, NULL, NULL, K_PRIO_PREEMPT(14), 0, K_NO_WAIT);
	k_thread_name_set(slup_led_tid, "slup_led");
}

#if defined(CONFIG_SHELL)
static const void *slup_ui;
#endif

void spaghetti_field_update_ui_text(const char *text)
{
	if (text == NULL) {
		return;
	}
#if defined(CONFIG_SHELL)
	if (slup_ui != NULL) {
		shell_print((const struct shell *)slup_ui, "%s", text);
		return;
	}
#endif
	LOG_INF("%s", text);
}

void spaghetti_field_update_ui_pct(const char *stage, uint8_t pct)
{
	char line[40];

	if (stage == NULL) {
		return;
	}
	(void)snprintk(line, sizeof(line), "SLUP %s %u%%", stage, pct);
	spaghetti_field_update_ui_text(line);
}

#if defined(CONFIG_SHELL)
static void slup_ui_bind(const void *shell)
{
	slup_ui = shell;
}
#endif
K_MUTEX_DEFINE(field_update_lock);
K_SEM_DEFINE(field_update_ack_sem, 0, 1);

#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN) || \
	defined(CONFIG_SPAGHETTI_FIELD_UPDATE_ESPNOW)
#define SPAGHETTI_SLUP_RX_QUEUE 24U

K_MSGQ_DEFINE(field_update_msgq, sizeof(struct field_update_rx),
	      SPAGHETTI_SLUP_RX_QUEUE, 4);
K_THREAD_STACK_DEFINE(field_update_stack,
		      CONFIG_SPAGHETTI_FIELD_UPDATE_STACK_SIZE);
static struct k_thread field_update_thread;
static k_tid_t field_update_tid;
#endif

__weak int spaghetti_field_update_can_init(void)
{
	return 0;
}

__weak int spaghetti_field_update_espnow_init(void)
{
	return 0;
}

__weak int spaghetti_field_update_can_send(uint32_t dest_node_id)
{
	ARG_UNUSED(dest_node_id);
	return -ENOTSUP;
}

__weak int spaghetti_field_update_can_push(
	uint32_t dest_node_id, uint32_t size, uint32_t crc,
	int (*read_fn)(uint32_t offset, uint8_t *data, size_t length, void *ctx),
	void *ctx)
{
	ARG_UNUSED(dest_node_id);
	ARG_UNUSED(size);
	ARG_UNUSED(crc);
	ARG_UNUSED(read_fn);
	ARG_UNUSED(ctx);
	return -ENOTSUP;
}

__weak int spaghetti_field_update_espnow_send(uint32_t dest_node_id)
{
	ARG_UNUSED(dest_node_id);
	return -ENOTSUP;
}

__weak int spaghetti_field_update_can_send_ack(uint8_t type, uint8_t status,
					       uint32_t written)
{
	ARG_UNUSED(type);
	ARG_UNUSED(status);
	ARG_UNUSED(written);
	return 0;
}

void spaghetti_update_notify_progress(uint8_t stage, uint8_t percent)
{
	if (percent > 100U) {
		percent = 100U;
	}
	atomic_set(&slup_install_pct, percent);
	if ((stage == SPAGHETTI_UPDATE_PROGRESS_ERASE) &&
	    (atomic_get(&slup_progress_can) != 0)) {
		(void)spaghetti_field_update_can_send_ack(
			SPAGHETTI_ESPNOW_OTA_BEGIN, SPAGHETTI_SLUP_ACK_PROGRESS,
			percent);
	}
}

__weak int spaghetti_field_update_can_ctrl(uint32_t dest_node_id, uint8_t cmd,
					   const uint8_t *extra,
					   uint8_t extra_len)
{
	ARG_UNUSED(dest_node_id);
	ARG_UNUSED(cmd);
	ARG_UNUSED(extra);
	ARG_UNUSED(extra_len);
	return -ENOTSUP;
}

__weak int spaghetti_field_update_can_reply(uint32_t dest_node_id,
					    const uint8_t *data, uint8_t dlc)
{
	ARG_UNUSED(dest_node_id);
	ARG_UNUSED(data);
	ARG_UNUSED(dlc);
	return -ENOTSUP;
}

__weak int spaghetti_field_update_espnow_send_ack(
	const uint8_t mac[6],
	const struct spaghetti_espnow_ota_packet *request, uint8_t status)
{
	ARG_UNUSED(mac);
	ARG_UNUSED(request);
	ARG_UNUSED(status);
	return 0;
}

static bool transport_is_field(enum spaghetti_update_transport transport)
{
	return (transport == SPAGHETTI_UPDATE_TRANSPORT_CAN) ||
	       (transport == SPAGHETTI_UPDATE_TRANSPORT_ESPNOW);
}

uint32_t spaghetti_field_update_crc32_update(uint32_t acc, const uint8_t *data,
					     size_t length)
{
	size_t i;
	int bit;

	if ((data == NULL) && (length != 0U)) {
		return acc;
	}

	for (i = 0U; i < length; ++i) {
		acc ^= data[i];
		for (bit = 0; bit < 8; ++bit) {
			const uint32_t mask =
				(uint32_t)-(int32_t)(acc & 1U);

			acc = (acc >> 1) ^ (0xEDB88320U & mask);
		}
	}

	return acc;
}

uint32_t spaghetti_field_update_crc32_finish(uint32_t acc)
{
	return acc ^ 0xFFFFFFFFU;
}

uint32_t spaghetti_field_update_crc32(const uint8_t *data, size_t length)
{
	return spaghetti_field_update_crc32_finish(
		spaghetti_field_update_crc32_update(0xFFFFFFFFU, data, length));
}

static uint32_t node_id_from_mac(const uint8_t mac[6])
{
	uint32_t node_id = ((uint32_t)mac[3] << 16) |
			   ((uint32_t)mac[4] << 8) |
			   (uint32_t)mac[5];

	if (node_id == 0x00FFFFFFU) {
		node_id -= 1U;
	}

	return node_id;
}

static bool slup_usb_present(void)
{
#if defined(CONFIG_UART_LINE_CTRL)
#if DT_HAS_CHOSEN(zephyr_shell_uart)
	const struct device *dev = DEVICE_DT_GET(DT_CHOSEN(zephyr_shell_uart));
	uint32_t dtr = 0U;

	if (device_is_ready(dev) &&
	    (uart_line_ctrl_get(dev, UART_LINE_CTRL_DTR, &dtr) == 0)) {
		return dtr != 0U;
	}
#endif
#endif
	return false;
}

static void resolve_local_identity(void)
{
#if defined(CONFIG_SOC_SERIES_ESP32S3)
	if (esp_read_mac(session.mac, ESP_MAC_WIFI_STA) == 0) {
		session.node_id = node_id_from_mac(session.mac);
		return;
	}
#endif
	struct spaghetti_identity identity;

	if (spaghetti_identity_get(&identity) == 0) {
		memcpy(session.mac, identity.device_id, sizeof(session.mac));
		session.node_id = node_id_from_mac(session.mac);
		return;
	}

	memset(session.mac, 0, sizeof(session.mac));
	session.node_id = 0U;
}

static void reset_session_locked(void)
{
	session.receiving = false;
	session.transport = SPAGHETTI_UPDATE_TRANSPORT_NONE;
	session.expected_size = 0U;
	session.expected_crc = 0U;
	session.written = 0U;
	session.crc_acc = 0xFFFFFFFFU;
	session.last_pct = 0U;
	atomic_set(&slup_install_pct, 0);
	atomic_set(&slup_progress_can, 0);
}

uint32_t spaghetti_field_update_local_node_id(void)
{
	return session.node_id;
}

uint8_t spaghetti_field_update_local_flags(void)
{
	return slup_usb_present() ? SPAGHETTI_SLUP_FLAG_USB : 0U;
}

uint8_t spaghetti_field_update_local_chain_index(void)
{
	return session.chain_index;
}

int spaghetti_field_update_set_chain_index(uint8_t index)
{
	if (index > SPAGHETTI_SLUP_PEERS_MAX) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	session.chain_index = index;
	k_mutex_unlock(&field_update_lock);
	return 0;
}

bool spaghetti_field_update_node_matches(uint32_t dest)
{
	return (dest == 0U) ||
	       (dest == SPAGHETTI_FIELD_UPDATE_BROADCAST) ||
	       (dest == session.node_id);
}

static void slup_copy_local_version(char *out)
{
	struct spaghetti_core_info info;

	memset(out, 0, SPAGHETTI_SLUP_VERSION_SIZE);
	if (spaghetti_core_get_info(&info) == 0) {
		memcpy(out, info.version, SPAGHETTI_SLUP_VERSION_SIZE);
		out[SPAGHETTI_SLUP_VERSION_SIZE - 1U] = '\0';
	}
}

static void slup_fill_self(struct spaghetti_slup_peer *peer)
{
	peer->node_id = session.node_id;
	memcpy(peer->mac, session.mac, sizeof(peer->mac));
	peer->flags = (uint8_t)(spaghetti_field_update_local_flags() |
				SPAGHETTI_SLUP_FLAG_LOCAL);
	peer->chain_index = session.chain_index;
	slup_copy_local_version(peer->version);
}

#if defined(CONFIG_SHELL) || defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN) || \
	defined(CONFIG_SPAGHETTI_FIELD_UPDATE_ESPNOW)
static void slup_note_peer_locked(uint32_t node_id, const uint8_t mac[6],
				  uint8_t flags, uint8_t chain_index)
{
	size_t i;

	node_id &= SPAGHETTI_SLUP_NODE_MASK;
	for (i = 0U; i < slup_peer_count; ++i) {
		if (slup_peers[i].node_id == node_id) {
			if (mac != NULL) {
				memcpy(slup_peers[i].mac, mac, 6U);
			}
			slup_peers[i].flags = (uint8_t)(
				(slup_peers[i].flags & SPAGHETTI_SLUP_FLAG_LOCAL) |
				(flags & (uint8_t)~SPAGHETTI_SLUP_FLAG_LOCAL));
			if (chain_index != SPAGHETTI_SLUP_CHAIN_UNKNOWN) {
				slup_peers[i].chain_index = chain_index;
			}
			return;
		}
	}
	if (slup_peer_count >= SPAGHETTI_SLUP_PEERS_MAX) {
		return;
	}
	slup_peers[slup_peer_count].node_id = node_id;
	if (mac != NULL) {
		memcpy(slup_peers[slup_peer_count].mac, mac, 6U);
	} else {
		memset(slup_peers[slup_peer_count].mac, 0, 6U);
	}
	slup_peers[slup_peer_count].flags =
		(uint8_t)(flags & (uint8_t)~SPAGHETTI_SLUP_FLAG_LOCAL);
	slup_peers[slup_peer_count].chain_index = chain_index;
	memset(slup_peers[slup_peer_count].version, 0,
	       sizeof(slup_peers[slup_peer_count].version));
	slup_peer_count += 1U;
}
#endif

static int slup_peer_order(const struct spaghetti_slup_peer *left,
			   const struct spaghetti_slup_peer *right)
{
	const bool left_local =
		(left->flags & SPAGHETTI_SLUP_FLAG_LOCAL) != 0U;
	const bool right_local =
		(right->flags & SPAGHETTI_SLUP_FLAG_LOCAL) != 0U;

	if (left_local != right_local) {
		return left_local ? -1 : 1;
	}
	if (left->node_id < right->node_id) {
		return -1;
	}
	if (left->node_id > right->node_id) {
		return 1;
	}
	return 0;
}

static void slup_sort_peers_locked(void)
{
	size_t i;
	size_t j;

	for (i = 1U; i < slup_peer_count; ++i) {
		struct spaghetti_slup_peer key = slup_peers[i];

		j = i;
		while ((j > 0U) &&
		       (slup_peer_order(&key, &slup_peers[j - 1U]) < 0)) {
			slup_peers[j] = slup_peers[j - 1U];
			j -= 1U;
		}
		slup_peers[j] = key;
	}
}

#if defined(CONFIG_SHELL) || defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN) || \
	defined(CONFIG_SPAGHETTI_FIELD_UPDATE_ESPNOW)
static void slup_note_peer(uint32_t node_id, const uint8_t mac[6],
			   uint8_t flags, uint8_t chain_index)
{
	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	slup_note_peer_locked(node_id, mac, flags, chain_index);
	k_mutex_unlock(&field_update_lock);
}
#endif

#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN) || \
	defined(CONFIG_SPAGHETTI_FIELD_UPDATE_ESPNOW)
static void slup_note_peer_version(uint32_t node_id, uint8_t chunk,
				   const uint8_t *data)
{
	size_t i;
	size_t offset;

	if ((data == NULL) || (chunk >= SLUP_VERSION_CHUNKS)) {
		return;
	}

	offset = (size_t)chunk * SLUP_VERSION_CHUNK;
	node_id &= SPAGHETTI_SLUP_NODE_MASK;
	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	for (i = 0U; i < slup_peer_count; ++i) {
		if (slup_peers[i].node_id != node_id) {
			continue;
		}
		memcpy(&slup_peers[i].version[offset], data,
		       MIN(SLUP_VERSION_CHUNK,
			   SPAGHETTI_SLUP_VERSION_SIZE - offset));
		slup_peers[i].version[SPAGHETTI_SLUP_VERSION_SIZE - 1U] = '\0';
		break;
	}
	k_mutex_unlock(&field_update_lock);
}
#endif

#if defined(CONFIG_SHELL)
static bool slup_dest_is_remote(uint32_t dest_node_id);

static void slup_clear_peer_version(uint32_t node_id)
{
	size_t i;

	node_id &= SPAGHETTI_SLUP_NODE_MASK;
	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	for (i = 0U; i < slup_peer_count; ++i) {
		if (slup_peers[i].node_id == node_id) {
			memset(slup_peers[i].version, 0,
			       sizeof(slup_peers[i].version));
			break;
		}
	}
	k_mutex_unlock(&field_update_lock);
}

static int slup_copy_peer_version(uint32_t node_id, char *out)
{
	size_t i;
	int err = -ENOENT;

	if (out == NULL) {
		return -EINVAL;
	}

	node_id &= SPAGHETTI_SLUP_NODE_MASK;
	memset(out, 0, SPAGHETTI_SLUP_VERSION_SIZE);
	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	for (i = 0U; i < slup_peer_count; ++i) {
		if (slup_peers[i].node_id != node_id) {
			continue;
		}
		memcpy(out, slup_peers[i].version, SPAGHETTI_SLUP_VERSION_SIZE);
		out[SPAGHETTI_SLUP_VERSION_SIZE - 1U] = '\0';
		err = (out[0] != '\0') ? 0 : -EAGAIN;
		break;
	}
	k_mutex_unlock(&field_update_lock);
	return err;
}

static int slup_fetch_peer_version(uint32_t dest_node_id, char *out)
{
	int err;

	if (dest_node_id == session.node_id) {
		slup_copy_local_version(out);
		return (out[0] != '\0') ? 0 : -ENOENT;
	}
	if (!slup_dest_is_remote(dest_node_id)) {
		return -EINVAL;
	}

	slup_note_peer(dest_node_id, NULL, 0U, SPAGHETTI_SLUP_CHAIN_UNKNOWN);
	slup_clear_peer_version(dest_node_id);
	err = spaghetti_field_update_can_ctrl(dest_node_id,
					      SPAGHETTI_SLUP_CMD_VERSION,
					      NULL, 0U);
	if (err < 0) {
		return err;
	}
	k_sleep(K_MSEC(120));
	return slup_copy_peer_version(dest_node_id, out);
}

static int slup_ping_peer(uint32_t dest_node_id)
{
	uint8_t status = 0U;
	int err;

	if (!slup_dest_is_remote(dest_node_id)) {
		return -EINVAL;
	}

	spaghetti_field_update_prepare_ack();
	err = spaghetti_field_update_can_ctrl(dest_node_id,
					      SPAGHETTI_SLUP_CMD_PING, NULL,
					      0U);
	if (err < 0) {
		return err;
	}
	return spaghetti_field_update_wait_ack(
		SPAGHETTI_SLUP_CMD_PING,
		dest_node_id & SPAGHETTI_SLUP_NODE_MASK, &status,
		K_MSEC(SPAGHETTI_SLUP_PING_MS));
}
#endif /* CONFIG_SHELL */

static bool slup_dest_is_remote(uint32_t dest_node_id)
{
	dest_node_id &= SPAGHETTI_SLUP_NODE_MASK;
	return (dest_node_id != 0U) && (dest_node_id != session.node_id);
}

static uint8_t slup_blink_count(uint8_t flashes)
{
	if (flashes == 0U) {
		return SPAGHETTI_SLUP_BLINK_DEFAULT;
	}
	return MIN(flashes, SPAGHETTI_SLUP_BLINK_MAX);
}

static void slup_blink_led(uint8_t flashes)
{
	uint8_t i;

	flashes = slup_blink_count(flashes);
	slup_led_set_mode(SPAGHETTI_SLUP_LED_HOLD);
#if DT_HAS_ALIAS(led0)
	if (!gpio_is_ready_dt(&slup_led)) {
		slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
		return;
	}
	if (gpio_pin_configure_dt(&slup_led, GPIO_OUTPUT_ACTIVE) < 0) {
		slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
		return;
	}
	for (i = 0U; i < flashes; ++i) {
		(void)gpio_pin_set_dt(&slup_led, 0);
		k_sleep(K_MSEC(SPAGHETTI_SLUP_BLINK_OFF_MS));
		(void)gpio_pin_set_dt(&slup_led, 1);
		k_sleep(K_MSEC(SPAGHETTI_SLUP_BLINK_ON_MS));
	}
	slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
#else
	ARG_UNUSED(i);
	k_sleep(K_MSEC((uint32_t)flashes *
		       (SPAGHETTI_SLUP_BLINK_ON_MS +
			SPAGHETTI_SLUP_BLINK_OFF_MS)));
	slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
#endif
}

int spaghetti_field_update_blink(uint32_t dest_node_id, uint8_t flashes)
{
	uint8_t extra[1];
	uint8_t status = 0U;
	int err;

	flashes = slup_blink_count(flashes);
	dest_node_id &= SPAGHETTI_SLUP_NODE_MASK;
	if (dest_node_id == 0U) {
		return -EINVAL;
	}
	if (dest_node_id == session.node_id) {
		slup_blink_led(flashes);
		return 0;
	}
	if (!slup_dest_is_remote(dest_node_id)) {
		return -EINVAL;
	}

	extra[0] = flashes;
	spaghetti_field_update_prepare_ack();
	err = spaghetti_field_update_can_ctrl(dest_node_id,
					      SPAGHETTI_SLUP_CMD_BLINK, extra,
					      1U);
	if (err < 0) {
		return err;
	}
	err = spaghetti_field_update_wait_ack(
		SPAGHETTI_SLUP_CMD_BLINK, dest_node_id, &status,
		K_MSEC(((uint32_t)flashes *
			(SPAGHETTI_SLUP_BLINK_ON_MS +
			 SPAGHETTI_SLUP_BLINK_OFF_MS)) +
		       400U));
	if (err < 0) {
		return err;
	}
	return (status == 0U) ? 0 : -EIO;
}

bool spaghetti_field_update_usb_feed(uint8_t byte)
{
	k_spinlock_key_t key;

	if (atomic_get(&slup_usb_active) == 0) {
		return false;
	}

	key = k_spin_lock(&slup_usb_lock);
	if (slup_usb_count >= SLUP_USB_RING) {
		atomic_set(&slup_usb_overflow, 1);
		k_spin_unlock(&slup_usb_lock, key);
		return true;
	}
	slup_usb_ring[slup_usb_put] = byte;
	slup_usb_put = (uint16_t)((slup_usb_put + 1U) % SLUP_USB_RING);
	slup_usb_count += 1U;
	k_spin_unlock(&slup_usb_lock, key);
	k_sem_give(&slup_usb_sem);
	return true;
}

static int slup_usb_get_byte(k_timeout_t timeout)
{
	k_spinlock_key_t key;
	uint8_t byte;
	int err;

	while (true) {
		if (atomic_get(&slup_usb_overflow) != 0) {
			return -EIO;
		}
		key = k_spin_lock(&slup_usb_lock);
		if (slup_usb_count > 0U) {
			byte = slup_usb_ring[slup_usb_get];
			slup_usb_get = (uint16_t)((slup_usb_get + 1U) %
						  SLUP_USB_RING);
			slup_usb_count -= 1U;
			k_spin_unlock(&slup_usb_lock, key);
			return (int)byte;
		}
		k_spin_unlock(&slup_usb_lock, key);
		err = k_sem_take(&slup_usb_sem, timeout);
		if (err < 0) {
			return err;
		}
	}
}

static int slup_usb_read_cb(uint32_t offset, uint8_t *data, size_t length,
			    void *ctx)
{
	uint32_t *credited = ctx;
	size_t i;

	ARG_UNUSED(offset);
	if (data == NULL) {
		return -EINVAL;
	}

	for (i = 0U; i < length; ++i) {
		const int byte = slup_usb_get_byte(K_MSEC(SLUP_USB_BYTE_MS));

		if (byte < 0) {
			return byte;
		}
		data[i] = (uint8_t)byte;
		if (credited != NULL) {
			*credited += 1U;
			if (*credited >= SLUP_USB_CREDIT) {
				printk(".\n");
				*credited = 0U;
			}
		}
	}
	if (slup_usb_total > 0U) {
		const uint8_t pct =
			(uint8_t)(((offset + (uint32_t)length) * 100U) /
				  slup_usb_total);

		if ((pct >= (uint8_t)(slup_usb_last_pct + 1U)) ||
		    ((offset + (uint32_t)length) >= slup_usb_total)) {
			slup_usb_last_pct = pct;
			spaghetti_field_update_ui_pct("usb", pct);
		}
	}
	return 0;
}

static void slup_usb_reset_ring(void)
{
	k_spinlock_key_t key = k_spin_lock(&slup_usb_lock);

	slup_usb_put = 0U;
	slup_usb_get = 0U;
	slup_usb_count = 0U;
	k_spin_unlock(&slup_usb_lock, key);
	atomic_set(&slup_usb_overflow, 0);
	k_sem_reset(&slup_usb_sem);
}

int spaghetti_field_update_recv_usb(uint32_t dest_node_id)
{
	uint8_t header[8];
	uint32_t size;
	uint32_t crc;
	uint32_t credited = 0U;
	size_t i;
	int err;

	if (!slup_dest_is_remote(dest_node_id)) {
		return -EINVAL;
	}

	slup_led_set_mode(SPAGHETTI_SLUP_LED_LOAD);
	slup_usb_reset_ring();
	atomic_set(&slup_usb_active, 1);
	printk("SLUP_RECV\n");

	for (i = 0U; i < sizeof(header); ++i) {
		const int byte = slup_usb_get_byte(K_MSEC(SLUP_USB_BYTE_MS));

		if (byte < 0) {
			atomic_set(&slup_usb_active, 0);
			slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
			return byte;
		}
		header[i] = (uint8_t)byte;
	}

	size = sys_get_le32(&header[0]);
	crc = sys_get_le32(&header[4]);
	if (size == 0U) {
		atomic_set(&slup_usb_active, 0);
		slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
		return -EINVAL;
	}

	slup_usb_total = size;
	slup_usb_last_pct = 0U;
	spaghetti_field_update_ui_pct("usb", 0U);

	slup_xfer_begin();
	err = spaghetti_field_update_enter_update(dest_node_id);
	if (err < 0) {
		slup_usb_total = 0U;
		atomic_set(&slup_usb_active, 0);
		slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
		slup_xfer_end();
		return err;
	}
	err = spaghetti_field_update_confirm_peer(dest_node_id);
	if (err < 0) {
		slup_usb_total = 0U;
		atomic_set(&slup_usb_active, 0);
		slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
		slup_xfer_end();
		return err;
	}

	err = spaghetti_field_update_can_push(dest_node_id, size, crc,
					      slup_usb_read_cb, &credited);
	slup_usb_total = 0U;
	atomic_set(&slup_usb_active, 0);
	slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
	slup_xfer_end();
	if (err < 0) {
		return err;
	}
	if (credited > 0U) {
		printk(".\n");
	}
	printk("SLUP_OK\n");
	return 0;
}

int spaghetti_field_update_discover(struct spaghetti_slup_peer *out, size_t max,
				    size_t *count)
{
	int err;

	if (count == NULL) {
		return -EINVAL;
	}
	if ((out == NULL) && (max != 0U)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	slup_peer_count = 0U;
	slup_nfc_remote_count = 0U;
	slup_fill_self(&slup_peers[0]);
	slup_peer_count = 1U;
	k_mutex_unlock(&field_update_lock);

	err = spaghetti_field_update_can_ctrl(SPAGHETTI_FIELD_UPDATE_BROADCAST,
					      SPAGHETTI_SLUP_CMD_DISCOVER,
					      NULL, 0U);
	if ((err == 0) && !slup_xfer_is_active()) {
		struct spaghetti_slup_peer remotes[SPAGHETTI_SLUP_PEERS_MAX];
		size_t remote_count = 0U;
		size_t i;

		k_sleep(K_MSEC(SPAGHETTI_SLUP_DISCOVER_MS));

		(void)k_mutex_lock(&field_update_lock, K_FOREVER);
		for (i = 0U; i < slup_peer_count; ++i) {
			if ((slup_peers[i].flags & SPAGHETTI_SLUP_FLAG_LOCAL) !=
			    0U) {
				continue;
			}
			remotes[remote_count] = slup_peers[i];
			remote_count += 1U;
		}
		k_mutex_unlock(&field_update_lock);

		for (i = 0U; (i < remote_count) && !slup_xfer_is_active();
		     ++i) {
			(void)spaghetti_field_update_can_ctrl(
				remotes[i].node_id, SPAGHETTI_SLUP_CMD_STATUS,
				NULL, 0U);
			k_sleep(K_MSEC(40));
			if (slup_xfer_is_active()) {
				break;
			}
			(void)spaghetti_field_update_can_ctrl(
				remotes[i].node_id, SPAGHETTI_SLUP_CMD_VERSION,
				NULL, 0U);
			k_sleep(K_MSEC(40));
			if (slup_xfer_is_active()) {
				break;
			}
			(void)spaghetti_field_update_can_ctrl(
				remotes[i].node_id, SPAGHETTI_SLUP_CMD_NFC,
				NULL, 0U);
			k_sleep(K_MSEC(80));
		}
	} else if ((err != 0) && (err != -ENOTSUP) && (err != -EACCES) &&
		   (err != -ENODEV)) {
		return err;
	}

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	{
		size_t i;

		for (i = 0U; i < slup_peer_count; ++i) {
			if (slup_peers[i].node_id == session.node_id) {
				slup_fill_self(&slup_peers[i]);
			}
		}
	}
	slup_sort_peers_locked();
	if (out == NULL) {
		*count = slup_peer_count;
	} else {
		*count = MIN(slup_peer_count, max);
		memcpy(out, slup_peers, (*count) * sizeof(*out));
	}
	k_mutex_unlock(&field_update_lock);
	return 0;
}

int spaghetti_field_update_copy_peers(struct spaghetti_slup_peer *out,
				      size_t max, size_t *count)
{
	if (count == NULL) {
		return -EINVAL;
	}
	if ((out == NULL) && (max != 0U)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	if (!session.initialized) {
		k_mutex_unlock(&field_update_lock);
		*count = 0U;
		return -EAGAIN;
	}
	if (slup_peer_count == 0U) {
		slup_fill_self(&slup_peers[0]);
		slup_peer_count = 1U;
	}
	if (out == NULL) {
		*count = slup_peer_count;
	} else {
		*count = MIN(slup_peer_count, max);
		memcpy(out, slup_peers, (*count) * sizeof(*out));
	}
	k_mutex_unlock(&field_update_lock);
	return 0;
}

int spaghetti_field_update_copy_nfc_tags(struct spaghetti_nfc_tag *out,
					 size_t max, size_t *count)
{
	struct spaghetti_nfc_tag local[SPAGHETTI_NFC_TAGS_MAX];
	size_t local_count = 0U;
	size_t total = 0U;

	if (count == NULL) {
		return -EINVAL;
	}
	if ((out == NULL) && (max != 0U)) {
		return -EINVAL;
	}

	(void)spaghetti_nfc_copy_tags(local, ARRAY_SIZE(local), &local_count);
	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	if (out == NULL) {
		*count = local_count + slup_nfc_remote_count;
		k_mutex_unlock(&field_update_lock);
		return 0;
	}

	for (size_t i = 0U; (i < local_count) && (total < max); ++i) {
		out[total] = local[i];
		out[total].node_id = session.node_id;
		out[total].local = true;
		total += 1U;
	}
	for (size_t i = 0U; (i < slup_nfc_remote_count) && (total < max); ++i) {
		out[total] = slup_nfc_remotes[i];
		out[total].local = false;
		total += 1U;
	}
	*count = total;
	k_mutex_unlock(&field_update_lock);
	return 0;
}

static void slup_presence_work(struct k_work *work)
{
	bool armed;
	size_t count = 0U;

	ARG_UNUSED(work);
	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	armed = session.load_armed;
	k_mutex_unlock(&field_update_lock);
	if (!armed && !slup_xfer_is_active()) {
		(void)spaghetti_field_update_discover(NULL, 0U, &count);
	}
	(void)k_work_schedule(&slup_presence_dwork, K_MSEC(SLUP_PRESENCE_PERIOD_MS));
}

int spaghetti_field_update_enter_update(uint32_t dest_node_id)
{
	const uint32_t node = dest_node_id & SPAGHETTI_SLUP_NODE_MASK;
	uint8_t attempt;
	uint8_t status = 0U;
	int err = -ETIMEDOUT;

	if (!slup_dest_is_remote(dest_node_id)) {
		return -EINVAL;
	}

	for (attempt = 0U; attempt < SPAGHETTI_SLUP_CTRL_ATTEMPTS; ++attempt) {
		spaghetti_field_update_prepare_ack();
		err = spaghetti_field_update_can_ctrl(
			dest_node_id, SPAGHETTI_SLUP_CMD_ENTER_UPDATE, NULL,
			0U);
		if (err < 0) {
			k_sleep(K_MSEC(20));
			continue;
		}
		err = spaghetti_field_update_wait_ack(
			SPAGHETTI_SLUP_CMD_ENTER_UPDATE, node, &status,
			K_MSEC(SPAGHETTI_SLUP_CTRL_ACK_MS));
		if ((err == 0) && (status == 0U)) {
			return 0;
		}
		if ((err == 0) && (status != 0U)) {
			return -EIO;
		}
	}

	return err;
}

int spaghetti_field_update_confirm_peer(uint32_t dest_node_id)
{
	const uint32_t node = dest_node_id & SPAGHETTI_SLUP_NODE_MASK;
	uint8_t attempt;
	uint8_t status = 0U;
	int err = -ENOTCONN;

	if (!slup_dest_is_remote(dest_node_id)) {
		return -EINVAL;
	}

	k_sleep(K_MSEC(100));
	for (attempt = 0U; attempt < 3U; ++attempt) {
		spaghetti_field_update_prepare_ack();
		err = spaghetti_field_update_can_ctrl(
			dest_node_id, SPAGHETTI_SLUP_CMD_PING, NULL, 0U);
		if (err < 0) {
			continue;
		}
		err = spaghetti_field_update_wait_ack(
			SPAGHETTI_SLUP_CMD_PING, node, &status,
			K_MSEC(SPAGHETTI_SLUP_PING_MS));
		if (err == 0) {
			return 0;
		}
	}

	LOG_WRN("SLUP peer left CAN after EnterUpdate; flash that board over USB once");
	return -ENOTCONN;
}

int spaghetti_field_update_assign_chain(uint32_t dest_node_id, uint8_t index)
{
	uint8_t extra[1];
	uint8_t status = 0U;
	int err;

	if ((index == SPAGHETTI_SLUP_CHAIN_UNKNOWN) ||
	    (index > SPAGHETTI_SLUP_PEERS_MAX)) {
		return -EINVAL;
	}
	if (dest_node_id == session.node_id) {
		return spaghetti_field_update_set_chain_index(index);
	}
	if (!slup_dest_is_remote(dest_node_id)) {
		return -EINVAL;
	}

	extra[0] = index;
	spaghetti_field_update_prepare_ack();
	err = spaghetti_field_update_can_ctrl(dest_node_id,
					      SPAGHETTI_SLUP_CMD_SET_CHAIN,
					      extra, 1U);
	if (err < 0) {
		return err;
	}
	err = spaghetti_field_update_wait_ack(SPAGHETTI_SLUP_CMD_SET_CHAIN,
					      dest_node_id & SPAGHETTI_SLUP_NODE_MASK,
					      &status,
					      K_MSEC(SPAGHETTI_SLUP_CTRL_ACK_MS));
	if (err < 0) {
		return err;
	}
	return (status == 0U) ? 0 : -EIO;
}

int spaghetti_field_update_number_chain(void)
{
	struct spaghetti_slup_peer peers[SPAGHETTI_SLUP_PEERS_MAX];
	size_t count = 0U;
	size_t i;
	int err;

	err = spaghetti_field_update_discover(peers, ARRAY_SIZE(peers), &count);
	if (err < 0) {
		return err;
	}

	for (i = 0U; i < count; ++i) {
		const uint8_t index = (uint8_t)(i + 1U);

		err = spaghetti_field_update_assign_chain(peers[i].node_id,
							  index);
		if (err < 0) {
			return err;
		}
	}

	return 0;
}

int spaghetti_field_update_ingest_begin(
	enum spaghetti_update_transport transport, uint32_t image_size,
	uint32_t image_crc32)
{
	size_t capacity = 0U;
	int err;

	if (!transport_is_field(transport) || (image_size == 0U)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	if (session.receiving && (session.transport == transport) &&
	    (session.expected_size == image_size) &&
	    (session.expected_crc == image_crc32) &&
	    (session.written == 0U)) {
		k_mutex_unlock(&field_update_lock);
		return 0;
	}
	if (session.receiving) {
		(void)spaghetti_update_cancel();
		reset_session_locked();
	}

	err = spaghetti_update_get_capacity(&capacity);
	if (err < 0) {
		k_mutex_unlock(&field_update_lock);
		return err;
	}
	if (image_size > capacity) {
		k_mutex_unlock(&field_update_lock);
		return -ENOSPC;
	}

	err = spaghetti_update_arm(CONFIG_SPAGHETTI_FIELD_UPDATE_WINDOW_MS);
	if ((err < 0) && (err != -EALREADY)) {
		k_mutex_unlock(&field_update_lock);
		return err;
	}
	session.transport = transport;
	if (transport == SPAGHETTI_UPDATE_TRANSPORT_CAN) {
		atomic_set(&slup_progress_can, 1);
	}
	err = spaghetti_update_begin(transport);
	atomic_set(&slup_progress_can, 0);
	if (err < 0) {
		(void)spaghetti_update_cancel();
		reset_session_locked();
		k_mutex_unlock(&field_update_lock);
		return err;
	}

	session.receiving = true;
	session.transport = transport;
	session.expected_size = image_size;
	session.expected_crc = image_crc32;
	session.written = 0U;
	session.crc_acc = 0xFFFFFFFFU;
	session.last_pct = 0U;
	atomic_set(&slup_install_pct, 0);
	k_mutex_unlock(&field_update_lock);
	LOG_INF("SLUP begin: transport=%u size=%u",
		(uint32_t)transport, image_size);
	return 0;
}

int spaghetti_field_update_ingest_data(
	enum spaghetti_update_transport transport, uint32_t offset,
	const uint8_t *data, size_t data_size)
{
	bool last;
	int err;

	if (!transport_is_field(transport) || (data == NULL) ||
	    (data_size == 0U)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	if (!session.receiving || (session.transport != transport)) {
		k_mutex_unlock(&field_update_lock);
		return -EPERM;
	}
	if ((offset < session.written) &&
	    ((offset + (uint32_t)data_size) <= session.written)) {
		k_mutex_unlock(&field_update_lock);
		return 0;
	}
	if ((offset != session.written) ||
	    ((session.written + (uint32_t)data_size) >
	     session.expected_size)) {
		k_mutex_unlock(&field_update_lock);
		return -EINVAL;
	}

	last = (session.written + (uint32_t)data_size) ==
	       session.expected_size;
	err = spaghetti_update_write(offset, data, data_size, last);
	if (err < 0) {
		(void)spaghetti_update_cancel();
		reset_session_locked();
		k_mutex_unlock(&field_update_lock);
		return err;
	}

	session.crc_acc = spaghetti_field_update_crc32_update(
		session.crc_acc, data, data_size);
	session.written += (uint32_t)data_size;
	if (session.expected_size > 0U) {
		const uint8_t pct = (uint8_t)((session.written * 100U) /
					      session.expected_size);

		if ((pct >= (uint8_t)(session.last_pct + 1U)) ||
		    (session.written == session.expected_size)) {
			session.last_pct = pct;
			atomic_set(&slup_install_pct, pct);
			LOG_INF("SLUP %u%%", pct);
		}
	}
	k_mutex_unlock(&field_update_lock);
	return 0;
}

int spaghetti_field_update_ingest_end(
	enum spaghetti_update_transport transport, uint32_t image_size,
	uint32_t image_crc32)
{
	uint32_t actual_crc;
	int err;

	if (!transport_is_field(transport)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	if (!session.receiving || (session.transport != transport)) {
		k_mutex_unlock(&field_update_lock);
		return -EPERM;
	}
	if ((image_size != session.expected_size) ||
	    (session.written != session.expected_size)) {
		k_mutex_unlock(&field_update_lock);
		return -EBADMSG;
	}

	actual_crc = spaghetti_field_update_crc32_finish(session.crc_acc);
	if ((session.expected_crc != 0U) &&
	    (actual_crc != session.expected_crc)) {
		k_mutex_unlock(&field_update_lock);
		return -EBADMSG;
	}
	ARG_UNUSED(image_crc32);

	err = spaghetti_update_finish();
	reset_session_locked();
	k_mutex_unlock(&field_update_lock);
	if (err == 0) {
		LOG_INF("SLUP complete; reboot when the ACK is sent");
	}
	return err;
}

void spaghetti_field_update_prepare_ack(void)
{
	k_sem_reset(&field_update_ack_sem);
	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	last_ack_valid = false;
	k_mutex_unlock(&field_update_lock);
}

void spaghetti_field_update_note_ack(uint8_t type, uint32_t offset,
				     uint8_t status, uint32_t written)
{
	ARG_UNUSED(written);
	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	last_ack.kind = 0U;
	last_ack.dlc = type;
	last_ack.can_id = offset;
	last_ack.u.can[0] = status;
	last_ack_valid = true;
	k_mutex_unlock(&field_update_lock);
	k_sem_give(&field_update_ack_sem);
}

int spaghetti_field_update_wait_ack(uint8_t type, uint32_t offset,
				    uint8_t *status, k_timeout_t timeout)
{
	int err;

	if (status == NULL) {
		return -EINVAL;
	}

	err = k_sem_take(&field_update_ack_sem, timeout);
	if (err < 0) {
		return err;
	}

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	if (!last_ack_valid || (last_ack.dlc != type)) {
		k_mutex_unlock(&field_update_lock);
		return -EAGAIN;
	}
	if (last_ack.u.can[0] == SPAGHETTI_SLUP_ACK_PROGRESS) {
		*status = SPAGHETTI_SLUP_ACK_PROGRESS;
		k_mutex_unlock(&field_update_lock);
		return 0;
	}
	if (last_ack.can_id != offset) {
		k_mutex_unlock(&field_update_lock);
		return -EAGAIN;
	}
	*status = last_ack.u.can[0];
	k_mutex_unlock(&field_update_lock);
	return 0;
}

uint32_t spaghetti_field_update_last_ack_value(void)
{
	uint32_t value;

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	value = last_ack.can_id;
	k_mutex_unlock(&field_update_lock);
	return value;
}

#if defined(CONFIG_FLASH_MAP)
static int open_running_area(const struct flash_area **area)
{
	const uint8_t area_id = boot_fetch_active_slot();

	return flash_area_open(area_id, area);
}

static int running_image_size(const struct flash_area *area, uint32_t *size)
{
	struct image_header_wire header;
	struct image_tlv_info_wire tlv;
	uint32_t tlv_off;
	int err;

	err = flash_area_read(area, 0, &header, sizeof(header));
	if (err < 0) {
		return err;
	}
	if (sys_le32_to_cpu(header.magic) != SPAGHETTI_FIELD_IMAGE_MAGIC) {
		return -EBADMSG;
	}

	tlv_off = (uint32_t)sys_le16_to_cpu(header.hdr_size) +
		  sys_le32_to_cpu(header.img_size);
	err = flash_area_read(area, tlv_off, &tlv, sizeof(tlv));
	if (err < 0) {
		return err;
	}
	if ((sys_le16_to_cpu(tlv.magic) !=
	     SPAGHETTI_FIELD_IMAGE_TLV_INFO_MAGIC) &&
	    (sys_le16_to_cpu(tlv.magic) !=
	     SPAGHETTI_FIELD_IMAGE_TLV_PROT_INFO_MAGIC)) {
		return -EBADMSG;
	}

	*size = tlv_off + sys_le16_to_cpu(tlv.tlv_tot);
	if (*size > area->fa_size) {
		return -EIO;
	}
	return 0;
}

int spaghetti_field_update_running_image_info(uint32_t *size, uint32_t *crc32)
{
	const struct flash_area *area;
	uint8_t chunk[64];
	uint32_t remaining;
	uint32_t offset = 0U;
	uint32_t acc = 0xFFFFFFFFU;
	int err;

	if ((size == NULL) || (crc32 == NULL)) {
		return -EINVAL;
	}

	err = open_running_area(&area);
	if (err < 0) {
		return err;
	}
	err = running_image_size(area, size);
	if (err < 0) {
		flash_area_close(area);
		return err;
	}

	remaining = *size;
	{
		uint8_t last_pct = 0U;

		spaghetti_field_update_ui_pct("hash", 0U);
		while (remaining > 0U) {
			const size_t n = MIN(remaining, sizeof(chunk));
			uint8_t pct;

			err = flash_area_read(area, offset, chunk, n);
			if (err < 0) {
				flash_area_close(area);
				return err;
			}
			acc = spaghetti_field_update_crc32_update(acc, chunk,
								  n);
			offset += (uint32_t)n;
			remaining -= (uint32_t)n;
			pct = (uint8_t)((offset * 100U) / *size);
			if ((pct >= (uint8_t)(last_pct + 1U)) ||
			    (remaining == 0U)) {
				last_pct = pct;
				spaghetti_field_update_ui_pct("hash", pct);
			}
		}
	}
	flash_area_close(area);
	*crc32 = spaghetti_field_update_crc32_finish(acc);
	return 0;
}

int spaghetti_field_update_read_running_image(uint32_t offset, uint8_t *data,
					      size_t length)
{
	const struct flash_area *area;
	int err;

	if ((data == NULL) || (length == 0U)) {
		return -EINVAL;
	}

	err = open_running_area(&area);
	if (err < 0) {
		return err;
	}
	err = flash_area_read(area, offset, data, length);
	flash_area_close(area);
	return err;
}
#else
int spaghetti_field_update_running_image_info(uint32_t *size, uint32_t *crc32)
{
	ARG_UNUSED(size);
	ARG_UNUSED(crc32);
	return -ENOTSUP;
}

int spaghetti_field_update_read_running_image(uint32_t offset, uint8_t *data,
					      size_t length)
{
	ARG_UNUSED(offset);
	ARG_UNUSED(data);
	ARG_UNUSED(length);
	return -ENOTSUP;
}
#endif

int spaghetti_field_update_send(enum spaghetti_update_transport transport,
				uint32_t dest_node_id)
{
	if (transport == SPAGHETTI_UPDATE_TRANSPORT_CAN) {
		int err;

		if (!slup_dest_is_remote(dest_node_id)) {
			return -EINVAL;
		}
		slup_xfer_begin();
		slup_led_set_mode(SPAGHETTI_SLUP_LED_LOAD);
		err = spaghetti_field_update_can_send(dest_node_id);
		slup_led_set_mode(SPAGHETTI_SLUP_LED_IDLE);
		slup_xfer_end();
		return err;
	}
	if (transport == SPAGHETTI_UPDATE_TRANSPORT_ESPNOW) {
		return spaghetti_field_update_espnow_send(dest_node_id);
	}
	return -EINVAL;
}

#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN) || \
	defined(CONFIG_SPAGHETTI_FIELD_UPDATE_ESPNOW)
static bool slup_is_image_id(uint32_t id)
{
	return (id >= SPAGHETTI_FIELD_CAN_ID_BEGIN) &&
	       (id <= SPAGHETTI_FIELD_CAN_ID_ACK);
}

static bool slup_is_cmd_id(uint32_t id)
{
	return (id == SPAGHETTI_SLUP_TWAI_CMD_ID) ||
	       ((id & 0x1F000000U) == SPAGHETTI_SLUP_TWAI_NODE_CMD_BASE);
}

static bool slup_is_rsp_id(uint32_t id)
{
	return (id == SPAGHETTI_SLUP_TWAI_RSP_ID) ||
	       ((id & 0x1F000000U) == SPAGHETTI_SLUP_TWAI_NODE_RSP_BASE);
}

static uint32_t slup_ext_node(uint32_t id)
{
	return id & SPAGHETTI_SLUP_TWAI_NODE_MASK;
}

static void slup_reply(uint8_t cmd, const uint8_t *extra, uint8_t extra_len)
{
	uint8_t data[8];

	memset(data, 0, sizeof(data));
	data[0] = cmd;
	if ((extra != NULL) && (extra_len > 0U) && (extra_len < 8U)) {
		memcpy(&data[1], extra, extra_len);
	}
	(void)spaghetti_field_update_can_reply(session.node_id, data,
					       (uint8_t)(1U + extra_len));
}

static void handle_slup_command(const struct field_update_rx *msg)
{
	const uint8_t cmd = msg->u.can[0];
	uint8_t extra[7];

	if (((msg->can_id & 0x1F000000U) == SPAGHETTI_SLUP_TWAI_NODE_CMD_BASE) &&
	    (slup_ext_node(msg->can_id) != session.node_id)) {
		return;
	}

	switch (cmd) {
	case SPAGHETTI_SLUP_CMD_PING:
		slup_reply(SPAGHETTI_SLUP_RSP_PONG, NULL, 0U);
		break;
	case SPAGHETTI_SLUP_CMD_DISCOVER:
		if (msg->can_id != SPAGHETTI_SLUP_TWAI_CMD_ID) {
			break;
		}
		extra[0] = SPAGHETTI_SLUP_PROTO;
		memcpy(&extra[1], session.mac, sizeof(session.mac));
		slup_reply(SPAGHETTI_SLUP_RSP_DISCOVER, extra, 7U);
		break;
	case SPAGHETTI_SLUP_CMD_STATUS: {
		uint8_t payload[5];

		payload[0] = spaghetti_field_update_local_flags();
		payload[1] = session.chain_index;
		payload[2] = SPAGHETTI_SLUP_PROTO;
		payload[3] = session.load_armed ? 1U : 0U;
		payload[4] = (uint8_t)atomic_get(&slup_install_pct);
		slup_reply(SPAGHETTI_SLUP_RSP_STATUS, payload, 5U);
		break;
	}
	case SPAGHETTI_SLUP_CMD_VERSION: {
		char version[SPAGHETTI_SLUP_VERSION_SIZE];
		uint8_t chunk;

		slup_copy_local_version(version);
		for (chunk = 0U; chunk < SLUP_VERSION_CHUNKS; ++chunk) {
			uint8_t payload[7];
			const size_t offset = (size_t)chunk * SLUP_VERSION_CHUNK;
			const size_t remain = SPAGHETTI_SLUP_VERSION_SIZE - offset;
			const size_t copy = MIN(SLUP_VERSION_CHUNK, remain);

			payload[0] = chunk;
			memset(&payload[1], 0, SLUP_VERSION_CHUNK);
			memcpy(&payload[1], &version[offset], copy);
			slup_reply(SPAGHETTI_SLUP_RSP_VERSION, payload,
				   (uint8_t)(1U + copy));
		}
		break;
	}
	case SPAGHETTI_SLUP_CMD_NFC: {
		struct spaghetti_nfc_tag tags[SPAGHETTI_NFC_TAGS_MAX];
		size_t tag_count = 0U;
		size_t i;

		(void)spaghetti_nfc_copy_tags(tags, ARRAY_SIZE(tags),
					      &tag_count);
		if (tag_count == 0U) {
			uint8_t payload[7] = { 0 };

			slup_reply(SPAGHETTI_SLUP_RSP_NFC, payload, 7U);
			break;
		}
		for (i = 0U; i < tag_count; ++i) {
			uint8_t part0[7];
			uint8_t part1[7];

			part0[0] = (uint8_t)((i << 4) | 0U);
			part0[1] = tags[i].antenna;
			part0[2] = tags[i].type;
			part0[3] = tags[i].uid_len;
			part0[4] = (tags[i].uid_len > 0U) ? tags[i].uid[0] : 0U;
			part0[5] = (tags[i].uid_len > 1U) ? tags[i].uid[1] : 0U;
			part0[6] = (tags[i].uid_len > 2U) ? tags[i].uid[2] : 0U;
			slup_reply(SPAGHETTI_SLUP_RSP_NFC, part0, 7U);
			part1[0] = (uint8_t)((i << 4) | 1U);
			part1[1] = (tags[i].uid_len > 3U) ? tags[i].uid[3] : 0U;
			part1[2] = (tags[i].uid_len > 4U) ? tags[i].uid[4] : 0U;
			part1[3] = (tags[i].uid_len > 5U) ? tags[i].uid[5] : 0U;
			part1[4] = (tags[i].uid_len > 6U) ? tags[i].uid[6] : 0U;
			part1[5] = (tags[i].uid_len > 7U) ? tags[i].uid[7] : 0U;
			part1[6] = (tags[i].uid_len > 8U) ? tags[i].uid[8] : 0U;
			slup_reply(SPAGHETTI_SLUP_RSP_NFC, part1, 7U);
		}
		break;
	}
	case SPAGHETTI_SLUP_CMD_ENTER_UPDATE:
		(void)k_mutex_lock(&field_update_lock, K_FOREVER);
		session.load_armed = true;
		k_mutex_unlock(&field_update_lock);
		slup_led_set_mode(SPAGHETTI_SLUP_LED_LOAD);
		LOG_INF("SLUP load armed for node=0x%06x", session.node_id);
		slup_reply(SPAGHETTI_SLUP_RSP_ACK, NULL, 0U);
		break;
	case SPAGHETTI_SLUP_CMD_SET_CHAIN:
		if (msg->dlc < 2U) {
			break;
		}
		if (spaghetti_field_update_set_chain_index(msg->u.can[1]) == 0) {
			extra[0] = msg->u.can[1];
			slup_reply(SPAGHETTI_SLUP_RSP_SET_CHAIN, extra, 1U);
		}
		break;
	case SPAGHETTI_SLUP_CMD_BLINK:
		slup_blink_led((msg->dlc >= 2U) ? msg->u.can[1] : 0U);
		slup_reply(SPAGHETTI_SLUP_RSP_BLINK, NULL, 0U);
		break;
	default:
		break;
	}
}

static void handle_slup_response(const struct field_update_rx *msg)
{
	const uint32_t node = ((msg->can_id & 0x1F000000U) ==
			       SPAGHETTI_SLUP_TWAI_NODE_RSP_BASE) ?
				      slup_ext_node(msg->can_id) :
				      0U;
	const uint8_t cmd = msg->u.can[0];

	if (cmd == SPAGHETTI_SLUP_RSP_DISCOVER) {
		if (msg->dlc >= 8U) {
			slup_note_peer(node, &msg->u.can[2], 0U,
				       SPAGHETTI_SLUP_CHAIN_UNKNOWN);
		}
		return;
	}
	if (cmd == SPAGHETTI_SLUP_RSP_STATUS) {
		if (msg->dlc >= 3U) {
			slup_note_peer(node, NULL, msg->u.can[1], msg->u.can[2]);
		}
		if (!slup_xfer_is_active()) {
			spaghetti_field_update_note_ack(
				SPAGHETTI_SLUP_CMD_STATUS, node, 0U, 0U);
		}
		return;
	}
	if (cmd == SPAGHETTI_SLUP_RSP_VERSION) {
		if (msg->dlc >= 3U) {
			slup_note_peer_version(node, msg->u.can[1],
					       &msg->u.can[2]);
		}
		if (!slup_xfer_is_active()) {
			spaghetti_field_update_note_ack(
				SPAGHETTI_SLUP_CMD_VERSION, node, 0U, 0U);
		}
		return;
	}
	if (cmd == SPAGHETTI_SLUP_RSP_NFC) {
		if (msg->dlc >= 5U) {
			const uint8_t idx = (uint8_t)(msg->u.can[1] >> 4);
			const uint8_t part = (uint8_t)(msg->u.can[1] & 0x0FU);

			(void)k_mutex_lock(&field_update_lock, K_FOREVER);
			if (part == 0U) {
				const uint8_t uid_len = msg->u.can[4];

				if ((uid_len > 0U) &&
				    (slup_nfc_remote_count <
				     SPAGHETTI_NFC_TAGS_MAX)) {
					struct spaghetti_nfc_tag *tag =
						&slup_nfc_remotes[slup_nfc_remote_count];

					memset(tag, 0, sizeof(*tag));
					tag->antenna = msg->u.can[2];
					tag->type = msg->u.can[3];
					tag->uid_len =
						MIN(uid_len, SPAGHETTI_NFC_UID_SIZE);
					if (msg->dlc > 5U) {
						tag->uid[0] = msg->u.can[5];
					}
					if (msg->dlc > 6U) {
						tag->uid[1] = msg->u.can[6];
					}
					if (msg->dlc > 7U) {
						tag->uid[2] = msg->u.can[7];
					}
					tag->node_id = node;
					tag->local = false;
					slup_nfc_remote_count += 1U;
				}
			} else if ((part == 1U) && (idx < slup_nfc_remote_count)) {
				struct spaghetti_nfc_tag *tag =
					&slup_nfc_remotes[slup_nfc_remote_count - 1U];

				if (msg->dlc > 2U) {
					tag->uid[3] = msg->u.can[2];
				}
				if (msg->dlc > 3U) {
					tag->uid[4] = msg->u.can[3];
				}
				if (msg->dlc > 4U) {
					tag->uid[5] = msg->u.can[4];
				}
				if (msg->dlc > 5U) {
					tag->uid[6] = msg->u.can[5];
				}
				if (msg->dlc > 6U) {
					tag->uid[7] = msg->u.can[6];
				}
				if (msg->dlc > 7U) {
					tag->uid[8] = msg->u.can[7];
				}
			}
			k_mutex_unlock(&field_update_lock);
		}
		if (!slup_xfer_is_active()) {
			spaghetti_field_update_note_ack(SPAGHETTI_SLUP_CMD_NFC,
							node, 0U, 0U);
		}
		return;
	}
	if (cmd == SPAGHETTI_SLUP_RSP_ACK) {
		spaghetti_field_update_note_ack(SPAGHETTI_SLUP_CMD_ENTER_UPDATE,
						node, 0U, 0U);
		return;
	}
	if (cmd == SPAGHETTI_SLUP_RSP_SET_CHAIN) {
		spaghetti_field_update_note_ack(SPAGHETTI_SLUP_CMD_SET_CHAIN,
						node, 0U, 0U);
		return;
	}
	if (cmd == SPAGHETTI_SLUP_RSP_PONG) {
		spaghetti_field_update_note_ack(SPAGHETTI_SLUP_CMD_PING, node,
						0U, 0U);
		return;
	}
	if (cmd == SPAGHETTI_SLUP_RSP_BLINK) {
		spaghetti_field_update_note_ack(SPAGHETTI_SLUP_CMD_BLINK, node,
						0U, 0U);
	}
}

static void handle_can_frame(const struct field_update_rx *msg)
{
	uint32_t size;
	uint32_t crc;
	uint32_t offset;
	uint8_t status = 0U;
	int err = 0;
	bool armed;

	if (msg->dlc < 1U) {
		return;
	}
	if (slup_is_cmd_id(msg->can_id)) {
		handle_slup_command(msg);
		return;
	}
	if (slup_is_rsp_id(msg->can_id)) {
		handle_slup_response(msg);
		return;
	}
	if (!slup_is_image_id(msg->can_id)) {
		return;
	}

	if (msg->can_id == SPAGHETTI_FIELD_CAN_ID_ACK) {
		if (msg->dlc >= 6U) {
			spaghetti_field_update_note_ack(
				msg->u.can[0],
				sys_get_le32(&msg->u.can[2]),
				msg->u.can[1], 0U);
		}
		return;
	}

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	armed = session.load_armed;
	k_mutex_unlock(&field_update_lock);
	if (!armed) {
		return;
	}

	if (msg->can_id == SPAGHETTI_FIELD_CAN_ID_BEGIN) {
		if (msg->dlc < 8U) {
			status = 1U;
		} else {
			size = sys_get_le32(&msg->u.can[0]);
			crc = sys_get_le32(&msg->u.can[4]);
			err = spaghetti_field_update_ingest_begin(
				SPAGHETTI_UPDATE_TRANSPORT_CAN, size, crc);
			status = (err == 0) ? 0U : 1U;
		}
		(void)spaghetti_field_update_can_send_ack(
			SPAGHETTI_ESPNOW_OTA_BEGIN, status, 0U);
		return;
	}
	if (msg->can_id == SPAGHETTI_FIELD_CAN_ID_DATA) {
		if (msg->dlc < 4U) {
			status = 3U;
			offset = 0U;
		} else {
			offset = spaghetti_field_get_le24(&msg->u.can[0]);
			err = spaghetti_field_update_ingest_data(
				SPAGHETTI_UPDATE_TRANSPORT_CAN, offset,
				&msg->u.can[3], (size_t)(msg->dlc - 3U));
			status = (err == 0) ? 0U : 3U;
		}
		(void)spaghetti_field_update_can_send_ack(
			SPAGHETTI_ESPNOW_OTA_DATA, status, offset);
		return;
	}
	if (msg->can_id == SPAGHETTI_FIELD_CAN_ID_END) {
		if (msg->dlc < 8U) {
			status = 4U;
			size = 0U;
		} else {
			size = sys_get_le32(&msg->u.can[0]);
			crc = sys_get_le32(&msg->u.can[4]);
			err = spaghetti_field_update_ingest_end(
				SPAGHETTI_UPDATE_TRANSPORT_CAN, size, crc);
			status = (err == 0) ? 0U : 4U;
		}
		(void)spaghetti_field_update_can_send_ack(
			SPAGHETTI_ESPNOW_OTA_END, status, size);
		if (err == 0) {
			k_sleep(K_MSEC(300));
			sys_reboot(SYS_REBOOT_WARM);
		}
	}
}

static void handle_espnow_packet(const struct field_update_rx *msg)
{
	const struct spaghetti_espnow_ota_packet *packet = &msg->u.espnow;
	uint8_t status = 0U;
	int err = 0;

	if (!spaghetti_field_update_node_matches(packet->node_id)) {
		return;
	}
	if (packet->type == SPAGHETTI_ESPNOW_OTA_ACK) {
		spaghetti_field_update_note_ack(packet->reserved[0],
						packet->offset, packet->status,
						packet->image_size);
		return;
	}
	if (packet->type == SPAGHETTI_ESPNOW_OTA_BEGIN) {
		err = spaghetti_field_update_ingest_begin(
			SPAGHETTI_UPDATE_TRANSPORT_ESPNOW, packet->image_size,
			packet->image_crc32);
		status = (err == 0) ? 0U : 1U;
	} else if (packet->type == SPAGHETTI_ESPNOW_OTA_DATA) {
		err = spaghetti_field_update_ingest_data(
			SPAGHETTI_UPDATE_TRANSPORT_ESPNOW, packet->offset,
			packet->payload, packet->payload_len);
		status = (err == 0) ? 0U : 3U;
	} else if (packet->type == SPAGHETTI_ESPNOW_OTA_END) {
		err = spaghetti_field_update_ingest_end(
			SPAGHETTI_UPDATE_TRANSPORT_ESPNOW, packet->image_size,
			packet->image_crc32);
		status = (err == 0) ? 0U : 4U;
	} else {
		status = 2U;
	}

	(void)spaghetti_field_update_espnow_send_ack(msg->src, packet, status);
	if ((packet->type == SPAGHETTI_ESPNOW_OTA_END) && (err == 0)) {
		k_sleep(K_MSEC(300));
		sys_reboot(SYS_REBOOT_WARM);
	}
}

static void field_update_worker(void *p1, void *p2, void *p3)
{
	struct field_update_rx msg;

	ARG_UNUSED(p1);
	ARG_UNUSED(p2);
	ARG_UNUSED(p3);

	while (true) {
		if (k_msgq_get(&field_update_msgq, &msg, K_FOREVER) != 0) {
			continue;
		}
		if (msg.kind == FIELD_UPDATE_RX_CAN) {
			handle_can_frame(&msg);
		} else if (msg.kind == FIELD_UPDATE_RX_ESPNOW) {
			handle_espnow_packet(&msg);
		}
	}
}

int spaghetti_field_update_post_can(uint32_t id, const uint8_t *data,
				    uint8_t dlc)
{
	struct field_update_rx msg = {
		.kind = FIELD_UPDATE_RX_CAN,
		.dlc = dlc,
		.can_id = id,
	};

	if ((data == NULL) || (dlc > 8U)) {
		return -EINVAL;
	}
	memcpy(msg.u.can, data, dlc);
	return k_msgq_put(&field_update_msgq, &msg, K_NO_WAIT);
}

int spaghetti_field_update_post_espnow(const uint8_t src[6],
				       const void *packet, size_t length)
{
	struct field_update_rx msg = {
		.kind = FIELD_UPDATE_RX_ESPNOW,
	};

	if ((src == NULL) || (packet == NULL) ||
	    (length < SPAGHETTI_ESPNOW_OTA_HEADER_SIZE) ||
	    (length > sizeof(struct spaghetti_espnow_ota_packet))) {
		return -EINVAL;
	}
	memcpy(msg.src, src, sizeof(msg.src));
	memcpy(&msg.u.espnow, packet, length);
	return k_msgq_put(&field_update_msgq, &msg, K_NO_WAIT);
}
#else
int spaghetti_field_update_post_can(uint32_t id, const uint8_t *data,
				    uint8_t dlc)
{
	ARG_UNUSED(id);
	ARG_UNUSED(data);
	ARG_UNUSED(dlc);
	return -ENOTSUP;
}

int spaghetti_field_update_post_espnow(const uint8_t src[6],
				       const void *packet, size_t length)
{
	ARG_UNUSED(src);
	ARG_UNUSED(packet);
	ARG_UNUSED(length);
	return -ENOTSUP;
}
#endif

int spaghetti_field_update_init(void)
{
	int first_error = 0;
	int err;

	(void)k_mutex_lock(&field_update_lock, K_FOREVER);
	if (session.initialized) {
		k_mutex_unlock(&field_update_lock);
		return -EALREADY;
	}
	resolve_local_identity();
	reset_session_locked();
	session.load_armed = false;
	session.chain_index = slup_usb_present() ? 1U : SPAGHETTI_SLUP_CHAIN_UNKNOWN;
	session.initialized = true;
	k_mutex_unlock(&field_update_lock);
	slup_led_start();

#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN) || \
	defined(CONFIG_SPAGHETTI_FIELD_UPDATE_ESPNOW)
	field_update_tid = k_thread_create(
		&field_update_thread, field_update_stack,
		K_THREAD_STACK_SIZEOF(field_update_stack),
		field_update_worker, NULL, NULL, NULL,
		K_PRIO_PREEMPT(7), 0, K_NO_WAIT);
	k_thread_name_set(field_update_tid, "slup");
#endif

	err = spaghetti_field_update_can_init();
	if (err < 0) {
		LOG_WRN("SLUP CAN not started: err=%d", err);
		first_error = err;
	}
	err = spaghetti_field_update_espnow_init();
	if (err < 0) {
		LOG_WRN("SLUP ESP-NOW not started: err=%d", err);
		if (first_error == 0) {
			first_error = err;
		}
	}

	LOG_INF("SLUP ready: node=0x%06x", session.node_id);
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN)
	(void)k_work_schedule(&slup_presence_dwork, K_MSEC(SLUP_PRESENCE_FIRST_MS));
#endif
	return first_error;
}

#if defined(CONFIG_SHELL)
static struct spaghetti_slup_peer slup_last_list[SPAGHETTI_SLUP_PEERS_MAX];
static size_t slup_last_list_count;

static void slup_print_peer(const struct shell *shell, size_t index,
			    const struct spaghetti_slup_peer *peer)
{
	const bool master = (peer->flags & SPAGHETTI_SLUP_FLAG_LOCAL) != 0U;

	shell_print(shell,
		    "%u  %-6s  0x%06x  %02x:%02x:%02x:%02x:%02x:%02x  %s",
		    (unsigned int)index, master ? "master" : "peer",
		    peer->node_id, peer->mac[0], peer->mac[1], peer->mac[2],
		    peer->mac[3], peer->mac[4], peer->mac[5],
		    peer->version[0] != '\0' ? peer->version : "-");
}

static int slup_parse_dest(const struct shell *shell, const char *text,
			   uint32_t *dest)
{
	char *end = NULL;
	const unsigned long value = strtoul(text, &end, 0);

	if ((text[0] == '\0') || (end == NULL) || (*end != '\0')) {
		shell_error(shell, "expected 0xNODE or list index 1..%u",
			    (unsigned int)SPAGHETTI_SLUP_PEERS_MAX);
		return -EINVAL;
	}

	if ((text[0] != '0') && (value >= 1UL) &&
	    (value <= (unsigned long)SPAGHETTI_SLUP_PEERS_MAX)) {
		if ((slup_last_list_count == 0U) ||
		    (value > slup_last_list_count)) {
			shell_error(shell,
				    "run slup list first, or pass 0xNODE");
			return -EINVAL;
		}
		*dest = slup_last_list[value - 1UL].node_id;
		return 0;
	}

	*dest = (uint32_t)value;
	return 0;
}

static int cmd_slup_who(const struct shell *shell, size_t argc, char **argv)
{
	ARG_UNUSED(argc);
	ARG_UNUSED(argv);
	shell_print(shell, "master node_id=0x%06x  (type slup here; peers need no USB)",
		    spaghetti_field_update_local_node_id());
	return 0;
}

static int cmd_slup_list(const struct shell *shell, size_t argc, char **argv)
{
	size_t i;
	int err;

	ARG_UNUSED(argc);
	ARG_UNUSED(argv);

	err = spaghetti_field_update_discover(slup_last_list,
					      ARRAY_SIZE(slup_last_list),
					      &slup_last_list_count);
	if (err < 0) {
		shell_error(shell, "SLUP list failed: %d", err);
		return err;
	}

	shell_print(shell, "idx  role    node_id   mac                 version");
	for (i = 0U; i < slup_last_list_count; ++i) {
		slup_print_peer(shell, i + 1U, &slup_last_list[i]);
	}
	shell_print(shell, "load/blink with idx or 0xNODE  (1 is this master)");
	return 0;
}

static int cmd_slup_number(const struct shell *shell, size_t argc, char **argv)
{
	int err;

	ARG_UNUSED(argc);
	ARG_UNUSED(argv);

	err = spaghetti_field_update_number_chain();
	if (err < 0) {
		shell_error(shell, "SLUP number failed: %d", err);
		return err;
	}
	shell_print(shell,
		    "session labels only; not cable order. use slup locate");
	return cmd_slup_list(shell, 0U, NULL);
}

static int cmd_slup_assign(const struct shell *shell, size_t argc, char **argv)
{
	uint32_t dest = 0U;
	unsigned long index;
	char *end = NULL;
	int err;

	if (argc < 3U) {
		shell_error(shell, "usage: slup assign <0xNODE|#> <1..8>");
		return -EINVAL;
	}
	err = slup_parse_dest(shell, argv[1], &dest);
	if (err < 0) {
		return err;
	}
	index = strtoul(argv[2], &end, 0);
	if ((end == NULL) || (*end != '\0') || (index < 1UL) ||
	    (index > (unsigned long)SPAGHETTI_SLUP_PEERS_MAX)) {
		shell_error(shell, "chain slot must be 1..%u",
			    (unsigned int)SPAGHETTI_SLUP_PEERS_MAX);
		return -EINVAL;
	}

	err = spaghetti_field_update_assign_chain(dest, (uint8_t)index);
	if (err < 0) {
		shell_error(shell, "SLUP assign failed: %d", err);
		return err;
	}
	shell_print(shell, "node 0x%06x is now chain %lu", dest, index);
	return 0;
}

static int cmd_slup_blink(const struct shell *shell, size_t argc, char **argv)
{
	uint32_t dest = 0U;
	int err;

	if (argc < 2U) {
		shell_error(shell, "usage: slup blink <0xNODE|#>");
		return -EINVAL;
	}
	err = slup_parse_dest(shell, argv[1], &dest);
	if (err < 0) {
		return err;
	}

	shell_print(shell, "blink idx target node_id=0x%06x  (watch D5)", dest);
	err = spaghetti_field_update_blink(dest, 0U);
	if (err < 0) {
		shell_error(shell, "SLUP blink failed: %d", err);
		return err;
	}
	return 0;
}

static int cmd_slup_locate(const struct shell *shell, size_t argc, char **argv)
{
	size_t i;
	int err;

	ARG_UNUSED(argc);
	ARG_UNUSED(argv);

	err = cmd_slup_list(shell, 0U, NULL);
	if (err < 0) {
		return err;
	}
	if (slup_last_list_count == 0U) {
		shell_error(shell, "no boards on the bus");
		return -ENOENT;
	}

	shell_print(shell, "watch D5; idx is from the list above");
	for (i = 0U; i < slup_last_list_count; ++i) {
		const uint32_t dest = slup_last_list[i].node_id;

		shell_print(shell, "blink idx=%u node_id=0x%06x%s",
			    (unsigned int)(i + 1U), dest,
			    ((slup_last_list[i].flags &
			      SPAGHETTI_SLUP_FLAG_LOCAL) != 0U) ?
				    "  master" :
				    "");
		err = spaghetti_field_update_blink(dest, 0U);
		if (err < 0) {
			shell_error(shell, "SLUP blink 0x%06x failed: %d", dest,
				    err);
			return err;
		}
	}
	shell_print(shell, "then slup load <idx|0xNODE>");
	return 0;
}

static int cmd_slup_recv(const struct shell *shell, size_t argc, char **argv)
{
	uint32_t dest = 0U;
	int err;

	if (argc < 2U) {
		shell_error(shell, "usage: slup recv <idx|0xNODE>");
		return -EINVAL;
	}
	err = slup_parse_dest(shell, argv[1], &dest);
	if (err < 0) {
		return err;
	}
	if (dest == spaghetti_field_update_local_node_id()) {
		shell_error(shell, "recv a peer, not this master");
		return -EINVAL;
	}

	shell_print(shell, "waiting for host image dest=0x%06x", dest);
	slup_ui_bind(shell);
	err = spaghetti_field_update_recv_usb(dest);
	slup_ui_bind(NULL);
	if (err < 0) {
		shell_error(shell, "SLUP recv failed: %d", err);
		return err;
	}
	return 0;
}

static int cmd_slup_load(const struct shell *shell, size_t argc, char **argv)
{
	uint32_t dest = 0U;
	int err;

	if (argc < 2U) {
		shell_error(shell, "usage: slup load <0xNODE|#>");
		return -EINVAL;
	}
	err = slup_parse_dest(shell, argv[1], &dest);
	if (err < 0) {
		return err;
	}
	if (dest == spaghetti_field_update_local_node_id()) {
		shell_error(shell, "idx 1 is this master; load a peer");
		return -EINVAL;
	}

	shell_print(shell, "SLUP load dest=0x%06x (clone this master)", dest);
	slup_ui_bind(shell);
	err = spaghetti_field_update_send(SPAGHETTI_UPDATE_TRANSPORT_CAN, dest);
	slup_ui_bind(NULL);
	if (err == -ENOTCONN) {
		shell_error(shell,
			    "peer left CAN; flash that board over USB once");
		return err;
	}
	if (err < 0) {
		shell_error(shell, "SLUP load failed: %d", err);
		return err;
	}

	shell_print(shell, "SLUP image written; waiting for 0x%06x reboot",
		    dest);
	k_sleep(K_SECONDS(2));
	{
		char version[SPAGHETTI_SLUP_VERSION_SIZE];
		uint8_t attempt;

		for (attempt = 0U; attempt < 15U; ++attempt) {
			if (slup_ping_peer(dest) != 0) {
				k_sleep(K_SECONDS(1));
				continue;
			}
			if (slup_fetch_peer_version(dest, version) != 0) {
				k_sleep(K_SECONDS(1));
				continue;
			}
			shell_print(shell,
				    "firmware update done on 0x%06x version: %s",
				    dest, version);
			return 0;
		}
	}
	shell_warn(shell,
		   "image sent; 0x%06x did not report version yet. run slup version 0x%06x",
		   dest, dest);
	return 0;
}

static int cmd_slup_version(const struct shell *shell, size_t argc, char **argv)
{
	char version[SPAGHETTI_SLUP_VERSION_SIZE];
	uint32_t dest = 0U;
	int err;

	if (argc < 2U) {
		slup_copy_local_version(version);
		shell_print(shell, "master 0x%06x version: %s",
			    spaghetti_field_update_local_node_id(),
			    version[0] != '\0' ? version : "-");
		shell_print(shell,
			    "peer: slup version <idx|0xNODE>   all: slup list");
		return 0;
	}

	err = slup_parse_dest(shell, argv[1], &dest);
	if (err < 0) {
		return err;
	}

	err = slup_fetch_peer_version(dest, version);
	if (err < 0) {
		shell_error(shell, "no version from 0x%06x (%d)", dest, err);
		return err;
	}
	shell_print(shell, "0x%06x version: %s", dest, version);
	return 0;
}

static int cmd_slup_espnow(const struct shell *shell, size_t argc, char **argv)
{
	uint32_t dest = SPAGHETTI_FIELD_UPDATE_BROADCAST;
	int err;

	if (argc > 1U) {
		err = slup_parse_dest(shell, argv[1], &dest);
		if (err < 0) {
			return err;
		}
	}

	shell_print(shell, "SLUP espnow dest=0x%08x", dest);
	err = spaghetti_field_update_send(SPAGHETTI_UPDATE_TRANSPORT_ESPNOW,
					  dest);
	if (err < 0) {
		shell_error(shell, "SLUP espnow failed: %d", err);
		return err;
	}
	shell_print(shell, "SLUP espnow complete");
	return 0;
}

SHELL_STATIC_SUBCMD_SET_CREATE(
	slup_subcommands,
	SHELL_CMD(who, NULL, "Print this master node_id", cmd_slup_who),
	SHELL_CMD(list, NULL, "Assign idx 1=master, 2..N=peers (node_id/MAC)",
		  cmd_slup_list),
	SHELL_CMD(blink, NULL, "Pulse D5: blink <idx|0xNODE>", cmd_slup_blink),
	SHELL_CMD(locate, NULL, "Blink every listed board in turn",
		  cmd_slup_locate),
	SHELL_CMD(recv, NULL,
		  "Accept a PC image over USB and push it: recv <idx|0xNODE>",
		  cmd_slup_recv),
	SHELL_CMD(load, NULL, "Push running image over CAN: load <idx|0xNODE>",
		  cmd_slup_load),
	SHELL_CMD(version, NULL,
		  "Ask image version: version [idx|0xNODE]",
		  cmd_slup_version),
	SHELL_CMD(espnow, NULL, "Send the running image over ESP-NOW [node]",
		  cmd_slup_espnow),
	SHELL_CMD(number, NULL, "Push list idx onto peers (optional)",
		  cmd_slup_number),
	SHELL_CMD(assign, NULL, "Optional: assign <idx|0xNODE> <n>",
		  cmd_slup_assign),
	SHELL_SUBCMD_SET_END
);

SHELL_CMD_REGISTER(slup, &slup_subcommands,
		   "SLUP: USB master lists peers and loads one over CAN",
		   NULL);
SHELL_CMD_REGISTER(field_update, &slup_subcommands, "Alias for slup", NULL);
#endif
