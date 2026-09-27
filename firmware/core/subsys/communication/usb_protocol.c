#include "communication_internal.h"
#include "usb_protocol_framing.h"

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/drivers/uart.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/shell/shell.h>
#include <zephyr/shell/shell_uart.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/ring_buffer.h>
#include <zephyr/sys/util.h>

#include <spaghetti/access_control.h>
#include <spaghetti/communication.h>
#include <spaghetti/core.h>
#if IS_ENABLED(CONFIG_SPAGHETTI_FIELD_UPDATE)
#include <spaghetti/field_update.h>
#endif
#include <spaghetti/protocol.h>

LOG_MODULE_REGISTER(spaghetti_usb_protocol,
		    CONFIG_SPAGHETTI_COMMUNICATION_LOG_LEVEL);

#define SPAGHETTI_USB_CTRL_C 0x03U
#define SPAGHETTI_USB_WORKER_STACK 4096
#define SPAGHETTI_USB_IDLE_SECONDS 30

#if IS_ENABLED(CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG)

static struct shell_uart_int_driven *uart_ctx;
static struct spaghetti_usb_frame_decoder decoder;
static struct spaghetti_protocol_request usb_request;
static struct spaghetti_protocol_response usb_response;
static const uint8_t *tx_ptr;
static size_t tx_frame_size;
static size_t tx_frame_sent;
static atomic_t protocol_mode;
static atomic_t work_pending;
static atomic_t tx_pending;
K_SEM_DEFINE(work_sem, 0, 1);
K_SEM_DEFINE(tx_done_sem, 0, 1);
K_THREAD_STACK_DEFINE(usb_worker_stack, SPAGHETTI_USB_WORKER_STACK);
static struct k_thread usb_worker_thread;
static struct k_work_delayable idle_work;

static void usb_idle_handler(struct k_work *work)
{
	ARG_UNUSED(work);
	if (atomic_get(&work_pending) != 0) {
		(void)k_work_reschedule(&idle_work,
					K_SECONDS(SPAGHETTI_USB_IDLE_SECONDS));
		return;
	}

	atomic_set(&protocol_mode, 0);
	spaghetti_usb_frame_decoder_reset(&decoder);
}

static void usb_feed_shell(uint8_t byte)
{
	uint32_t stored;

	if ((uart_ctx == NULL) || (uart_ctx->common.handler == NULL)) {
		return;
	}

	stored = ring_buf_put(&uart_ctx->rx_ringbuf, &byte, 1U);
	if (stored == 1U) {
		uart_ctx->common.handler(SHELL_TRANSPORT_EVT_RX_RDY,
					 uart_ctx->common.context);
	}
}

static void usb_handle_rx_byte(uint8_t byte)
{
	enum spaghetti_usb_frame_push result;

#if IS_ENABLED(CONFIG_SPAGHETTI_FIELD_UPDATE)
	if (spaghetti_field_update_usb_feed(byte)) {
		return;
	}
#endif

	if (atomic_get(&work_pending) != 0) {
		return;
	}

	if ((decoder.filled == 0U) && (byte == SPAGHETTI_USB_CTRL_C)) {
		atomic_set(&protocol_mode, 0);
		spaghetti_usb_frame_decoder_reset(&decoder);
		(void)k_work_cancel_delayable(&idle_work);
		usb_feed_shell(byte);
		return;
	}

	if ((decoder.filled == 0U) &&
	    (byte != SPAGHETTI_USB_FRAME_KIND_REQUEST)) {
		if (atomic_get(&protocol_mode) == 0) {
			usb_feed_shell(byte);
		}
		return;
	}

	result = spaghetti_usb_frame_decoder_push(&decoder, byte);
	if (result == SPAGHETTI_USB_FRAME_NEED_MORE) {
		return;
	}
	if (result != SPAGHETTI_USB_FRAME_READY) {
		return;
	}

	if (!atomic_cas(&work_pending, 0, 1)) {
		spaghetti_usb_frame_decoder_reset(&decoder);
		return;
	}

	atomic_set(&protocol_mode, 1);
	(void)k_work_reschedule(&idle_work, K_SECONDS(SPAGHETTI_USB_IDLE_SECONDS));
	k_sem_give(&work_sem);
}

static void usb_uart_tx_handle(const struct device *dev)
{
	uint32_t len;
	uint8_t *data;

	if (atomic_get(&tx_pending) != 0) {
		size_t remain = tx_frame_size - tx_frame_sent;
		int filled;

		if (remain == 0U) {
			atomic_set(&tx_pending, 0);
			k_sem_give(&tx_done_sem);
			uart_irq_tx_disable(dev);
			return;
		}

		filled = uart_fifo_fill(dev, &tx_ptr[tx_frame_sent], remain);
		if (filled > 0) {
			tx_frame_sent += (size_t)filled;
		}
		if (tx_frame_sent >= tx_frame_size) {
			atomic_set(&tx_pending, 0);
			k_sem_give(&tx_done_sem);
			uart_irq_tx_disable(dev);
		}
		return;
	}

	if (atomic_get(&protocol_mode) != 0) {
		len = ring_buf_get_claim(&uart_ctx->tx_ringbuf, &data,
					 uart_ctx->tx_ringbuf.size);
		if (len > 0U) {
			(void)ring_buf_get_finish(&uart_ctx->tx_ringbuf, len);
		} else {
			uart_irq_tx_disable(dev);
			atomic_set(&uart_ctx->tx_busy, 0);
		}
		return;
	}

	len = ring_buf_get_claim(&uart_ctx->tx_ringbuf, &data,
				 uart_ctx->tx_ringbuf.size);
	if (len > 0U) {
		len = uart_fifo_fill(dev, data, len);
		(void)ring_buf_get_finish(&uart_ctx->tx_ringbuf, len);
	} else {
		uart_irq_tx_disable(dev);
		atomic_set(&uart_ctx->tx_busy, 0);
	}

	if (uart_ctx->common.handler != NULL) {
		uart_ctx->common.handler(SHELL_TRANSPORT_EVT_TX_RDY,
					 uart_ctx->common.context);
	}
}

static void usb_uart_callback(const struct device *dev, void *user_data)
{
	uint8_t byte;

	ARG_UNUSED(user_data);
	uart_irq_update(dev);

	if (uart_irq_rx_ready(dev)) {
		while (uart_fifo_read(dev, &byte, 1U) > 0) {
			usb_handle_rx_byte(byte);
		}
	}

	if (uart_irq_tx_ready(dev)) {
		usb_uart_tx_handle(dev);
	}
}

static int usb_send_frame(const uint8_t *bytes, size_t size)
{
	int err;

	if ((bytes == NULL) || (size == 0U)) {
		return -EINVAL;
	}

	tx_ptr = bytes;
	tx_frame_size = size;
	tx_frame_sent = 0U;
	k_sem_reset(&tx_done_sem);
	atomic_set(&tx_pending, 1);
	uart_irq_tx_enable(uart_ctx->common.dev);
	err = k_sem_take(&tx_done_sem, K_SECONDS(2));
	if (err < 0) {
		atomic_set(&tx_pending, 0);
		return -ETIMEDOUT;
	}
	return 0;
}

static void usb_worker(void *first, void *second, void *third)
{
	ARG_UNUSED(first);
	ARG_UNUSED(second);
	ARG_UNUSED(third);

	while (true) {
		struct spaghetti_request_context context;
		struct spaghetti_core_info info;
		size_t encoded_size = 0U;
		int err;

		(void)k_sem_take(&work_sem, K_FOREVER);

		err = spaghetti_protocol_decode_request(
			spaghetti_usb_frame_envelope(&decoder),
			spaghetti_usb_frame_envelope_size(&decoder),
			&usb_request);
		spaghetti_usb_frame_decoder_reset(&decoder);
		if (err < 0) {
			atomic_set(&work_pending, 0);
			continue;
		}

		err = spaghetti_core_get_info(&info);
		if (err < 0) {
			atomic_set(&work_pending, 0);
			continue;
		}

		context = (struct spaghetti_request_context) {
			.principal_id = SPAGHETTI_PRINCIPAL_MAINTENANCE_ID,
			.permissions = spaghetti_communication_shell_permissions(
				info.mode),
			.local = true,
			.core_mode = info.mode,
		};

		err = spaghetti_communication_handle_request(
			&context, &usb_request, &usb_response);
		if (err < 0) {
			usb_response.version = SPAGHETTI_PROTOCOL_VERSION;
			usb_response.correlation_id = usb_request.correlation_id;
			usb_response.status =
				spaghetti_protocol_status_from_errno(err);
			usb_response.payload.size = 0U;
		}

		err = spaghetti_protocol_encode_response(
			&usb_response, decoder.bytes, SPAGHETTI_USB_ENVELOPE_MAX,
			&encoded_size);
		if (err == 0) {
			memmove(&decoder.bytes[SPAGHETTI_USB_FRAME_HEADER_SIZE],
				decoder.bytes, encoded_size);
			decoder.bytes[0] = SPAGHETTI_USB_FRAME_KIND_RESPONSE;
			sys_put_be32((uint32_t)encoded_size, &decoder.bytes[1]);
			(void)usb_send_frame(
				decoder.bytes,
				SPAGHETTI_USB_FRAME_HEADER_SIZE + encoded_size);
		}
		atomic_set(&work_pending, 0);
	}
}

int spaghetti_usb_protocol_init(void)
{
	const struct shell *sh = shell_backend_uart_get_ptr();
	const struct device *dev;

	if ((sh == NULL) || (sh->iface == NULL) || (sh->iface->ctx == NULL)) {
		return -ENODEV;
	}

	uart_ctx = (struct shell_uart_int_driven *)sh->iface->ctx;
	dev = uart_ctx->common.dev;
	if ((dev == NULL) || !device_is_ready(dev)) {
		return -ENODEV;
	}

	spaghetti_usb_frame_decoder_reset(&decoder);
	k_work_init_delayable(&idle_work, usb_idle_handler);
	k_thread_create(&usb_worker_thread, usb_worker_stack,
			K_THREAD_STACK_SIZEOF(usb_worker_stack), usb_worker,
			NULL, NULL, NULL, K_PRIO_PREEMPT(8), 0, K_NO_WAIT);
	k_thread_name_set(&usb_worker_thread, "usb_protocol");

	uart_irq_rx_disable(dev);
	uart_irq_callback_user_data_set(dev, usb_uart_callback, uart_ctx);
	uart_irq_rx_enable(dev);
	LOG_INF("USB Protocol V1 adapter on shell UART");
	return 0;
}

#else /* !CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG */

int spaghetti_usb_protocol_init(void)
{
	return 0;
}

#endif
