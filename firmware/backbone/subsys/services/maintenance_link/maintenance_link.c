#include <spaghetti/maintenance_link.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <psa/crypto.h>
#include <psa/internal_trusted_storage.h>

#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/hwinfo.h>
#include <zephyr/drivers/pinctrl.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>

LOG_MODULE_REGISTER(spaghetti_maintenance_link,
			CONFIG_SPAGHETTI_MAINTENANCE_LINK_LOG_LEVEL);

#define SPAGHETTI_MAINTENANCE_NODE \
	DT_COMPAT_GET_ANY_STATUS_OKAY(spaghettilab_maintenance_link)
#define SPAGHETTI_MAINTENANCE_NORMAL_NODE \
	DT_PHANDLE(SPAGHETTI_MAINTENANCE_NODE, normal_bus)
#define SPAGHETTI_MAINTENANCE_UART_NODE \
	DT_PHANDLE(SPAGHETTI_MAINTENANCE_NODE, maintenance_uart)
#define SPAGHETTI_MAINTENANCE_BOOTSTRAP_MAGIC_SIZE 4U
#define SPAGHETTI_MAINTENANCE_BOOTSTRAP_HEADER_SIZE 8U
#define SPAGHETTI_MAINTENANCE_BOOTSTRAP_TAG_SIZE 32U
#define SPAGHETTI_MAINTENANCE_BOOTSTRAP_FRAME_SIZE \
	(SPAGHETTI_MAINTENANCE_BOOTSTRAP_HEADER_SIZE + \
	 SPAGHETTI_MAINTENANCE_BOOTSTRAP_TAG_SIZE)
#define SPAGHETTI_MAINTENANCE_BOOTSTRAP_VERSION 1U
#define SPAGHETTI_MAINTENANCE_BOOTSTRAP_ENTER_COMMAND 1U
#define SPAGHETTI_MAINTENANCE_DEVICE_ID_MAX_SIZE 32U
#define SPAGHETTI_MAINTENANCE_KEY_UID \
	((psa_storage_uid_t)0x0057FFE0U)

BUILD_ASSERT(!IS_ENABLED(CONFIG_PM_DEVICE),
	     "maintenance UART reserves the sleep pinctrl state");

PINCTRL_DT_DEV_CONFIG_DECLARE(SPAGHETTI_MAINTENANCE_NORMAL_NODE);
PINCTRL_DT_DEV_CONFIG_DECLARE(SPAGHETTI_MAINTENANCE_UART_NODE);

static const struct device *const normal_device =
	DEVICE_DT_GET(SPAGHETTI_MAINTENANCE_NORMAL_NODE);
static const struct device *const maintenance_uart =
	DEVICE_DT_GET(SPAGHETTI_MAINTENANCE_UART_NODE);
static atomic_t link_state =
	ATOMIC_INIT(SPAGHETTI_MAINTENANCE_LINK_UNINITIALIZED);
static enum spaghetti_maintenance_entry_reason entry_reason;
K_MUTEX_DEFINE(link_lock);

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

static int apply_normal_pins(void)
{
	return pinctrl_apply_state(PINCTRL_DT_DEV_CONFIG_GET(
				   SPAGHETTI_MAINTENANCE_NORMAL_NODE),
				   PINCTRL_STATE_DEFAULT);
}

static int apply_probe_pins(void)
{
	return pinctrl_apply_state(PINCTRL_DT_DEV_CONFIG_GET(
				   SPAGHETTI_MAINTENANCE_UART_NODE),
				   PINCTRL_STATE_DEFAULT);
}

static int apply_uart_pins(void)
{
	return pinctrl_apply_state(PINCTRL_DT_DEV_CONFIG_GET(
				   SPAGHETTI_MAINTENANCE_UART_NODE),
				   PINCTRL_STATE_SLEEP);
}

static void drain_maintenance_uart(void)
{
	uint8_t byte;

	while (uart_fifo_read(maintenance_uart, &byte, 1) > 0) {
	}
}

static bool tags_match(const uint8_t *first, const uint8_t *second,
		       size_t size)
{
	uint8_t difference = 0U;

	for (size_t byte_idx = 0U; byte_idx < size; ++byte_idx) {
		difference |= first[byte_idx] ^ second[byte_idx];
	}

	return difference == 0U;
}

static int read_key(uint8_t key[SPAGHETTI_MAINTENANCE_KEY_SIZE])
{
	size_t key_size = 0U;
	psa_status_t status = psa_its_get(
		SPAGHETTI_MAINTENANCE_KEY_UID, 0U,
		SPAGHETTI_MAINTENANCE_KEY_SIZE,
		key, &key_size);

	if (status != PSA_SUCCESS) {
		return map_psa_status(status);
	}
	if (key_size != SPAGHETTI_MAINTENANCE_KEY_SIZE) {
		return -EBADMSG;
	}

	return 0;
}

static int authenticate_frame(
	const uint8_t frame[SPAGHETTI_MAINTENANCE_BOOTSTRAP_FRAME_SIZE])
{
	static const uint8_t magic[
		SPAGHETTI_MAINTENANCE_BOOTSTRAP_MAGIC_SIZE] = {
		'S', 'P', 'L', 'M',
	};
	uint8_t message[SPAGHETTI_MAINTENANCE_BOOTSTRAP_HEADER_SIZE +
			SPAGHETTI_MAINTENANCE_DEVICE_ID_MAX_SIZE];
	uint8_t expected_tag[SPAGHETTI_MAINTENANCE_BOOTSTRAP_TAG_SIZE];
	uint8_t key[SPAGHETTI_MAINTENANCE_KEY_SIZE];
	psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
	psa_key_id_t key_id = 0U;
	size_t expected_tag_size = 0U;
	ssize_t device_id_size;
	psa_status_t status;
	int err;

	if ((memcmp(frame, magic, sizeof(magic)) != 0) ||
	    (frame[4] != SPAGHETTI_MAINTENANCE_BOOTSTRAP_VERSION) ||
	    (frame[5] != SPAGHETTI_MAINTENANCE_BOOTSTRAP_ENTER_COMMAND) ||
	    (frame[6] != 0U) || (frame[7] != 0U)) {
		return -EBADMSG;
	}

	err = read_key(key);
	if (err < 0) {
		wipe_sensitive(key, sizeof(key));
		return err;
	}
	memcpy(message, frame, SPAGHETTI_MAINTENANCE_BOOTSTRAP_HEADER_SIZE);
	device_id_size = hwinfo_get_device_id(
		&message[SPAGHETTI_MAINTENANCE_BOOTSTRAP_HEADER_SIZE],
		SPAGHETTI_MAINTENANCE_DEVICE_ID_MAX_SIZE);
	if (device_id_size <= 0) {
		err = -EIO;
		goto out;
	}

	status = psa_crypto_init();
	if (status != PSA_SUCCESS) {
		err = map_psa_status(status);
		goto out;
	}
	psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_SIGN_MESSAGE);
	psa_set_key_algorithm(&attributes, PSA_ALG_HMAC(PSA_ALG_SHA_256));
	psa_set_key_type(&attributes, PSA_KEY_TYPE_HMAC);
	psa_set_key_bits(&attributes, SPAGHETTI_MAINTENANCE_KEY_SIZE * 8U);
	status = psa_import_key(&attributes, key, sizeof(key), &key_id);
	if (status != PSA_SUCCESS) {
		err = map_psa_status(status);
		goto out;
	}
	status = psa_mac_compute(
		key_id, PSA_ALG_HMAC(PSA_ALG_SHA_256), message,
		SPAGHETTI_MAINTENANCE_BOOTSTRAP_HEADER_SIZE +
			(size_t)device_id_size,
		expected_tag, sizeof(expected_tag), &expected_tag_size);
	if ((status != PSA_SUCCESS) ||
	    (expected_tag_size != SPAGHETTI_MAINTENANCE_BOOTSTRAP_TAG_SIZE)) {
		err = (status == PSA_SUCCESS) ? -EIO : map_psa_status(status);
		goto out;
	}

	err = tags_match(expected_tag,
			 &frame[SPAGHETTI_MAINTENANCE_BOOTSTRAP_HEADER_SIZE],
			 sizeof(expected_tag)) ? 0 : -EACCES;

out:
	if (key_id != 0U) {
		(void)psa_destroy_key(key_id);
	}
	psa_reset_key_attributes(&attributes);
	wipe_sensitive(expected_tag, sizeof(expected_tag));
	wipe_sensitive(message, sizeof(message));
	wipe_sensitive(key, sizeof(key));
	return err;
}

static size_t append_probe_byte(uint8_t *frame, size_t used, uint8_t byte)
{
	static const uint8_t magic[
		SPAGHETTI_MAINTENANCE_BOOTSTRAP_MAGIC_SIZE] = {
		'S', 'P', 'L', 'M',
	};

	if (used < SPAGHETTI_MAINTENANCE_BOOTSTRAP_MAGIC_SIZE) {
		if (byte == magic[used]) {
			frame[used] = byte;
			return used + 1U;
		}
		if (byte == magic[0]) {
			frame[0] = byte;
			return 1U;
		}
		return 0U;
	}

	frame[used] = byte;
	return used + 1U;
}

int spaghetti_maintenance_link_init(void)
{
	int err = k_mutex_lock(&link_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (atomic_get(&link_state) !=
	    SPAGHETTI_MAINTENANCE_LINK_UNINITIALIZED) {
		err = -EALREADY;
		goto unlock;
	}
	if (!device_is_ready(normal_device) ||
	    !device_is_ready(maintenance_uart)) {
		err = -ENODEV;
		goto failed;
	}

	uart_irq_rx_disable(maintenance_uart);
	uart_irq_tx_disable(maintenance_uart);
	err = apply_normal_pins();
	if (err < 0) {
		goto failed;
	}
	atomic_set(&link_state, SPAGHETTI_MAINTENANCE_LINK_NORMAL);
	LOG_INF("ready: normal bus active");
	goto unlock;

failed:
	atomic_set(&link_state, SPAGHETTI_MAINTENANCE_LINK_ERROR);
unlock:
	k_mutex_unlock(&link_lock);
	return err;
}

int spaghetti_maintenance_link_probe(uint32_t timeout_ms, bool *requested)
{
	uint8_t frame[SPAGHETTI_MAINTENANCE_BOOTSTRAP_FRAME_SIZE] = {0};
	size_t used = 0U;
	int64_t deadline;
	int err;

	if ((timeout_ms == 0U) ||
	    (timeout_ms > DT_PROP(SPAGHETTI_MAINTENANCE_NODE,
				  bootstrap_window_ms)) ||
	    (requested == NULL)) {
		return -EINVAL;
	}
	*requested = false;
	err = k_mutex_lock(&link_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (atomic_get(&link_state) != SPAGHETTI_MAINTENANCE_LINK_NORMAL) {
		err = -EACCES;
		goto unlock;
	}

	err = read_key(frame);
	wipe_sensitive(frame, sizeof(frame));
	if (err == -ENOENT) {
		err = 0;
		goto unlock;
	}
	if (err < 0) {
		goto failed;
	}
	err = apply_probe_pins();
	if (err < 0) {
		goto failed;
	}
	atomic_set(&link_state, SPAGHETTI_MAINTENANCE_LINK_PROBING);
	uart_irq_rx_disable(maintenance_uart);
	deadline = k_uptime_get() + timeout_ms;
	while (k_uptime_get() < deadline) {
		uint8_t byte;

		if (uart_poll_in(maintenance_uart, &byte) != 0) {
			k_sleep(K_MSEC(1));
			continue;
		}
		used = append_probe_byte(frame, used, byte);
		if (used != sizeof(frame)) {
			continue;
		}

		err = authenticate_frame(frame);
		wipe_sensitive(frame, sizeof(frame));
		used = 0U;
		if (err == 0) {
			*requested = true;
			goto unlock;
		}
		if ((err != -EBADMSG) && (err != -EACCES)) {
			goto failed;
		}
	}

	err = apply_normal_pins();
	if (err < 0) {
		goto failed;
	}
	atomic_set(&link_state, SPAGHETTI_MAINTENANCE_LINK_NORMAL);
	err = 0;
	goto unlock;

failed:
	(void)apply_normal_pins();
	atomic_set(&link_state, SPAGHETTI_MAINTENANCE_LINK_ERROR);
unlock:
	wipe_sensitive(frame, sizeof(frame));
	k_mutex_unlock(&link_lock);
	return err;
}

int spaghetti_maintenance_link_enter(
	enum spaghetti_maintenance_entry_reason reason)
{
	int err;

	if ((reason < SPAGHETTI_MAINTENANCE_CONFIG_ABSENT) ||
	    (reason > SPAGHETTI_MAINTENANCE_REBOOT_REQUEST)) {
		return -EINVAL;
	}
	err = k_mutex_lock(&link_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (atomic_get(&link_state) == SPAGHETTI_MAINTENANCE_LINK_ACTIVE) {
		err = -EALREADY;
		goto unlock;
	}
	if ((atomic_get(&link_state) != SPAGHETTI_MAINTENANCE_LINK_NORMAL) &&
	    (atomic_get(&link_state) != SPAGHETTI_MAINTENANCE_LINK_PROBING)) {
		err = -EACCES;
		goto unlock;
	}

	uart_irq_rx_disable(maintenance_uart);
	uart_irq_tx_disable(maintenance_uart);
	err = apply_uart_pins();
	if (err < 0) {
		(void)apply_normal_pins();
		atomic_set(&link_state, SPAGHETTI_MAINTENANCE_LINK_ERROR);
		goto unlock;
	}
	drain_maintenance_uart();
	uart_irq_rx_enable(maintenance_uart);
	entry_reason = reason;
	atomic_set(&link_state, SPAGHETTI_MAINTENANCE_LINK_ACTIVE);
	LOG_INF("active: reason=%u", (uint32_t)entry_reason);

unlock:
	k_mutex_unlock(&link_lock);
	return err;
}

int spaghetti_maintenance_link_leave(void)
{
	int err = k_mutex_lock(&link_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (atomic_get(&link_state) ==
	    SPAGHETTI_MAINTENANCE_LINK_UNINITIALIZED) {
		err = -EACCES;
		goto unlock;
	}
	if (atomic_get(&link_state) == SPAGHETTI_MAINTENANCE_LINK_NORMAL) {
		err = -EALREADY;
		goto unlock;
	}

	uart_irq_rx_disable(maintenance_uart);
	uart_irq_tx_disable(maintenance_uart);
	err = apply_normal_pins();
	atomic_set(&link_state, (err == 0) ?
		SPAGHETTI_MAINTENANCE_LINK_NORMAL :
		SPAGHETTI_MAINTENANCE_LINK_ERROR);

unlock:
	k_mutex_unlock(&link_lock);
	return err;
}

int spaghetti_maintenance_link_set_key(const uint8_t *key, size_t key_size)
{
	psa_status_t status;

	if ((key == NULL) ||
	    (key_size != SPAGHETTI_MAINTENANCE_KEY_SIZE)) {
		return -EINVAL;
	}
	if (atomic_get(&link_state) != SPAGHETTI_MAINTENANCE_LINK_ACTIVE) {
		return -EACCES;
	}

	status = psa_its_set(SPAGHETTI_MAINTENANCE_KEY_UID, key_size, key,
			     PSA_STORAGE_FLAG_NONE);
	return map_psa_status(status);
}

enum spaghetti_maintenance_link_state spaghetti_maintenance_link_get_state(void)
{
	return (enum spaghetti_maintenance_link_state)atomic_get(&link_state);
}
