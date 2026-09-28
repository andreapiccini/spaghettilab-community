#include <spaghetti/port.h>

#include <errno.h>
#include <string.h>

#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#if defined(CONFIG_ADC)
#include <zephyr/drivers/adc.h>
#endif
#if defined(CONFIG_W1)
#include <zephyr/drivers/w1.h>
#endif

#include "port_backend.h"

LOG_MODULE_REGISTER(spaghetti_port, CONFIG_SPAGHETTI_PORT_LOG_LEVEL);

#define SPAGHETTI_PORT_SIGNAL_INDEX_MAX 4U
#define SPAGHETTI_PORT_CONTROLLER_LOCKS 8U

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
	const struct device *i2c;
	const struct device *spi;
	const struct device *uart;
	const struct device *w1;
	const struct gpio_dt_spec *output;
	const struct gpio_dt_spec *input;
	const struct gpio_dt_spec *digital_outputs;
	uint8_t digital_output_count;
	const struct gpio_dt_spec *digital_inputs;
	uint8_t digital_input_count;
#if defined(CONFIG_ADC)
	const struct adc_dt_spec *adc_channels;
	uint8_t adc_channel_count;
#else
	const void *adc_channels;
	uint8_t adc_channel_count;
#endif
	bool transport_active;
	enum spaghetti_port_transport active_transport;
	size_t owner_count;
	spaghetti_port_owner_t owners[CONFIG_SPAGHETTI_MAX_MODULES];
};

struct spaghetti_port_controller_lock {
	bool used;
	enum spaghetti_port_transport transport;
	const struct device *device;
	struct k_mutex lock;
};

#define SPAGHETTI_PORT_CAPS(node_id) \
	(0U \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, i2c), \
		       (SPAGHETTI_PORT_CAP_I2C), (0U)) \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, spi), \
		       (SPAGHETTI_PORT_CAP_SPI), (0U)) \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, uart), \
		       (SPAGHETTI_PORT_CAP_UART), (0U)) \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, input_gpios), \
		       (SPAGHETTI_PORT_CAP_DIGITAL_INPUT), (0U)) \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, output_gpios), \
		       (SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT), (0U)) \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, io_channels), \
		       (SPAGHETTI_PORT_CAP_ADC), (0U)) \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, w1), \
		       (SPAGHETTI_PORT_CAP_W1), (0U)) \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, pwm), \
		       (SPAGHETTI_PORT_CAP_PWM), (0U)) \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, dac), \
		       (SPAGHETTI_PORT_CAP_DAC), (0U)) \
	 | COND_CODE_1(DT_NODE_HAS_PROP(node_id, can), \
		       (SPAGHETTI_PORT_CAP_CAN), (0U)))

#define SPAGHETTI_PORT_VALIDATE(node_id) \
	BUILD_ASSERT(DT_REG_ADDR(node_id) <= UINT8_MAX, \
		     "Spaghetti Port ID must fit spaghetti_port_id_t"); \
	BUILD_ASSERT(SPAGHETTI_PORT_CAPS(node_id) != 0U, \
		     "Spaghetti Port must declare at least one transport");

/*
 * output-gpios/input-gpios are phandle-arrays ("mapped to connector signal
 * indices" per the binding), one Flow always carries exactly five raw
 * signals (topology.c's own BUILD_ASSERT), so a Port's digital lines can be
 * more than the one primary line spaghetti_port_set_output()/get_input()
 * drive — SPAGHETTI_PORT_GPIO_ELEM/_ARRAY/_COUNT below build the full
 * per-signal-index array (spaghetti_port_digital_output_set/input_get,
 * mirroring the existing adc_channels/adc_channel_count + channel-indexed
 * spaghetti_port_adc_read pattern already used for ADC on the same Port).
 */
#define SPAGHETTI_PORT_GPIO_ELEM(idx, node_id, prop) \
	GPIO_DT_SPEC_GET_BY_IDX(node_id, prop, idx)

#define SPAGHETTI_PORT_GPIO_ARRAY(node_id, prop) \
	COND_CODE_1(DT_NODE_HAS_PROP(node_id, prop), \
		((const struct gpio_dt_spec[]){ \
			LISTIFY(DT_PROP_LEN(node_id, prop), \
				SPAGHETTI_PORT_GPIO_ELEM, (,), node_id, prop) \
		}), (NULL))

#define SPAGHETTI_PORT_GPIO_COUNT(node_id, prop) \
	COND_CODE_1(DT_NODE_HAS_PROP(node_id, prop), \
		((uint8_t)DT_PROP_LEN(node_id, prop)), (0U))

#define SPAGHETTI_PORT_DEFINE(node_id) \
	{ \
		.id = DT_REG_ADDR(node_id), \
		.capabilities = SPAGHETTI_PORT_CAPS(node_id), \
		.i2c = COND_CODE_1(DT_NODE_HAS_PROP(node_id, i2c), \
			(DEVICE_DT_GET(DT_PHANDLE(node_id, i2c))), (NULL)), \
		.spi = COND_CODE_1(DT_NODE_HAS_PROP(node_id, spi), \
			(DEVICE_DT_GET(DT_PHANDLE(node_id, spi))), (NULL)), \
		.uart = COND_CODE_1(DT_NODE_HAS_PROP(node_id, uart), \
			(DEVICE_DT_GET(DT_PHANDLE(node_id, uart))), (NULL)), \
		.w1 = COND_CODE_1(DT_NODE_HAS_PROP(node_id, w1), \
			(DEVICE_DT_GET(DT_PHANDLE(node_id, w1))), (NULL)), \
		.output = NULL, \
		.input = NULL, \
		.digital_outputs = SPAGHETTI_PORT_GPIO_ARRAY(node_id, output_gpios), \
		.digital_output_count = SPAGHETTI_PORT_GPIO_COUNT(node_id, output_gpios), \
		.digital_inputs = SPAGHETTI_PORT_GPIO_ARRAY(node_id, input_gpios), \
		.digital_input_count = SPAGHETTI_PORT_GPIO_COUNT(node_id, input_gpios), \
		.adc_channels = NULL, \
		.adc_channel_count = 0U, \
		.transport_active = false, \
		.owner_count = 0U, \
	},

DT_FOREACH_STATUS_OKAY(spaghettilab_port, SPAGHETTI_PORT_VALIDATE)

static struct spaghetti_port ports[] = {
	DT_FOREACH_STATUS_OKAY(spaghettilab_port, SPAGHETTI_PORT_DEFINE)
};

static struct spaghetti_port_controller_lock controller_locks[
	SPAGHETTI_PORT_CONTROLLER_LOCKS];

BUILD_ASSERT(ARRAY_SIZE(ports) > 0U,
	     "The selected Core board must expose a Spaghetti Port");

K_MUTEX_DEFINE(ports_lock);

static bool timeout_is_forever(k_timeout_t timeout)
{
	return K_TIMEOUT_EQ(timeout, K_FOREVER);
}

static bool transport_is_shareable(enum spaghetti_port_transport transport)
{
	/*
	 * GPIO and ADC are channel-indexed transports (digital_outputs/
	 * digital_inputs/adc_channels, addressed by signal index): distinct
	 * Modules on distinct channels of the same Port do not contend for the
	 * same wire, and module_manager.c's endpoints_conflict() already
	 * rejects two Modules claiming the same GPIO_LINE/ADC_CHANNEL value.
	 * Excluding them here would make it impossible for more than one
	 * Module to ever use the connector's multiple lines at once.
	 */
	return (transport == SPAGHETTI_PORT_TRANSPORT_I2C) ||
	       (transport == SPAGHETTI_PORT_TRANSPORT_SPI) ||
	       (transport == SPAGHETTI_PORT_TRANSPORT_W1) ||
	       (transport == SPAGHETTI_PORT_TRANSPORT_GPIO) ||
	       (transport == SPAGHETTI_PORT_TRANSPORT_ADC);
}

static bool transport_capability_present(
	const struct spaghetti_port *port,
	enum spaghetti_port_transport transport)
{
	switch (transport) {
	case SPAGHETTI_PORT_TRANSPORT_I2C:
		return spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_I2C);
	case SPAGHETTI_PORT_TRANSPORT_SPI:
		return spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_SPI);
	case SPAGHETTI_PORT_TRANSPORT_UART:
		return spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_UART);
	case SPAGHETTI_PORT_TRANSPORT_GPIO:
		return spaghetti_port_has_capability(
			       port, SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT) ||
		       spaghetti_port_has_capability(
			       port, SPAGHETTI_PORT_CAP_DIGITAL_INPUT);
	case SPAGHETTI_PORT_TRANSPORT_ADC:
		return spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_ADC);
	case SPAGHETTI_PORT_TRANSPORT_W1:
		return spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_W1);
	default:
		return false;
	}
}

static const struct device *transport_device(
	const struct spaghetti_port *port,
	enum spaghetti_port_transport transport)
{
	switch (transport) {
	case SPAGHETTI_PORT_TRANSPORT_I2C:
		return port->i2c;
	case SPAGHETTI_PORT_TRANSPORT_SPI:
		return port->spi;
	case SPAGHETTI_PORT_TRANSPORT_UART:
		return port->uart;
	case SPAGHETTI_PORT_TRANSPORT_W1:
		return port->w1;
	case SPAGHETTI_PORT_TRANSPORT_GPIO:
	case SPAGHETTI_PORT_TRANSPORT_ADC:
	default:
		return NULL;
	}
}

static struct spaghetti_port *port_mutable(const struct spaghetti_port *port)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(ports); ++idx) {
		if (&ports[idx] == port) {
			return &ports[idx];
		}
	}

	return NULL;
}

static struct spaghetti_port_controller_lock *controller_lock_find(
	enum spaghetti_port_transport transport,
	const struct device *device)
{
	if (device == NULL) {
		return NULL;
	}

	for (size_t idx = 0U; idx < ARRAY_SIZE(controller_locks); ++idx) {
		struct spaghetti_port_controller_lock *slot =
			&controller_locks[idx];

		if (slot->used && (slot->transport == transport) &&
		    (slot->device == device)) {
			return slot;
		}
	}

	return NULL;
}

static struct spaghetti_port_controller_lock *controller_lock_ensure(
	enum spaghetti_port_transport transport,
	const struct device *device)
{
	struct spaghetti_port_controller_lock *slot =
		controller_lock_find(transport, device);
	struct spaghetti_port_controller_lock *free_slot = NULL;

	if (slot != NULL) {
		return slot;
	}
	if (device == NULL) {
		return NULL;
	}

	for (size_t idx = 0U; idx < ARRAY_SIZE(controller_locks); ++idx) {
		if (!controller_locks[idx].used) {
			free_slot = &controller_locks[idx];
			break;
		}
	}
	if (free_slot == NULL) {
		return NULL;
	}

	free_slot->used = true;
	free_slot->transport = transport;
	free_slot->device = device;
	k_mutex_init(&free_slot->lock);
	return free_slot;
}

static int lock_controller(
	enum spaghetti_port_transport transport,
	const struct device *device,
	k_timeout_t timeout)
{
	struct spaghetti_port_controller_lock *slot;
	int err;

	if (timeout_is_forever(timeout)) {
		return -EINVAL;
	}

	slot = controller_lock_ensure(transport, device);
	if (slot == NULL) {
		return -ENOMEM;
	}

	err = k_mutex_lock(&slot->lock, timeout);
	if (err == -EAGAIN) {
		return -EBUSY;
	}

	return err;
}

static void unlock_controller(
	enum spaghetti_port_transport transport,
	const struct device *device)
{
	struct spaghetti_port_controller_lock *slot =
		controller_lock_find(transport, device);

	if (slot != NULL) {
		k_mutex_unlock(&slot->lock);
	}
}

static bool owner_present_locked(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner)
{
	for (size_t idx = 0U; idx < port->owner_count; ++idx) {
		if (port->owners[idx] == owner) {
			return true;
		}
	}

	return false;
}

int spaghetti_port_init_all(void)
{
	memset(controller_locks, 0, sizeof(controller_locks));

	for (size_t port_idx = 0U; port_idx < ARRAY_SIZE(ports); ++port_idx) {
		struct spaghetti_port *port = &ports[port_idx];

		port->transport_active = false;
		port->owner_count = 0U;
		memset(port->owners, 0, sizeof(port->owners));

		if ((port->i2c != NULL) && !device_is_ready(port->i2c)) {
			return -ENODEV;
		}
		if ((port->spi != NULL) && !device_is_ready(port->spi)) {
			return -ENODEV;
		}
		if ((port->uart != NULL) && !device_is_ready(port->uart)) {
			return -ENODEV;
		}
		if ((port->w1 != NULL) && !device_is_ready(port->w1)) {
			return -ENODEV;
		}

		if (port->i2c != NULL) {
			if (controller_lock_ensure(SPAGHETTI_PORT_TRANSPORT_I2C,
						   port->i2c) == NULL) {
				return -ENOMEM;
			}
		}
		if (port->spi != NULL) {
			if (controller_lock_ensure(SPAGHETTI_PORT_TRANSPORT_SPI,
						   port->spi) == NULL) {
				return -ENOMEM;
			}
		}
		if (port->w1 != NULL) {
			if (controller_lock_ensure(SPAGHETTI_PORT_TRANSPORT_W1,
						   port->w1) == NULL) {
				return -ENOMEM;
			}
		}
	}

	return 0;
}

size_t spaghetti_port_count(void)
{
	return ARRAY_SIZE(ports);
}

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	for (size_t port_idx = 0U; port_idx < ARRAY_SIZE(ports); ++port_idx) {
		if (ports[port_idx].id == id) {
			return &ports[port_idx];
		}
	}

	return NULL;
}

bool spaghetti_port_has_capability(
	const struct spaghetti_port *port,
	uint32_t capabilities)
{
	if ((port == NULL) || (capabilities == 0U)) {
		return false;
	}

	return (port->capabilities & capabilities) == capabilities;
}

uint32_t spaghetti_port_capabilities(const struct spaghetti_port *port)
{
	if (port == NULL) {
		return 0U;
	}

	return port->capabilities;
}

int spaghetti_port_acquire(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner,
	enum spaghetti_port_transport transport)
{
	struct spaghetti_port *mutable_port;
	int err;

	if ((port == NULL) || (owner == 0U)) {
		return -EINVAL;
	}

	mutable_port = port_mutable(port);
	if (mutable_port == NULL) {
		return -EINVAL;
	}

	if (!transport_capability_present(mutable_port, transport)) {
		return -ENOTSUP;
	}

	err = k_mutex_lock(&ports_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	if (owner_present_locked(mutable_port, owner)) {
		err = -EALREADY;
		goto unlock;
	}

	if (mutable_port->transport_active) {
		if (mutable_port->active_transport != transport) {
			err = -EBUSY;
			goto unlock;
		}
		if (!transport_is_shareable(transport) &&
		    (mutable_port->owner_count > 0U)) {
			err = -EBUSY;
			goto unlock;
		}
	} else {
		err = spaghetti_port_backend_select(mutable_port->id, transport);
		if (err < 0) {
			goto unlock;
		}
		mutable_port->transport_active = true;
		mutable_port->active_transport = transport;
	}

	if (mutable_port->owner_count >= ARRAY_SIZE(mutable_port->owners)) {
		if (mutable_port->owner_count == 0U) {
			(void)spaghetti_port_backend_safe(mutable_port->id);
			mutable_port->transport_active = false;
		}
		err = -ENOMEM;
		goto unlock;
	}

	mutable_port->owners[mutable_port->owner_count] = owner;
	mutable_port->owner_count++;
	err = 0;

unlock:
	k_mutex_unlock(&ports_lock);
	return err;
}

int spaghetti_port_release(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner)
{
	struct spaghetti_port *mutable_port;
	size_t owner_idx = ARRAY_SIZE(ports[0].owners);
	int err;

	if ((port == NULL) || (owner == 0U)) {
		return -EINVAL;
	}

	mutable_port = port_mutable(port);
	if (mutable_port == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ports_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	for (size_t idx = 0U; idx < mutable_port->owner_count; ++idx) {
		if (mutable_port->owners[idx] == owner) {
			owner_idx = idx;
			break;
		}
	}
	if (owner_idx >= mutable_port->owner_count) {
		err = -ENOENT;
		goto unlock;
	}

	mutable_port->owners[owner_idx] =
		mutable_port->owners[mutable_port->owner_count - 1U];
	mutable_port->owner_count--;
	mutable_port->owners[mutable_port->owner_count] = 0U;

	if (mutable_port->owner_count == 0U) {
		err = spaghetti_port_backend_safe(mutable_port->id);
		mutable_port->transport_active = false;
	} else {
		err = 0;
	}

unlock:
	k_mutex_unlock(&ports_lock);
	return err;
}

int spaghetti_port_get_active_transport(
	const struct spaghetti_port *port,
	enum spaghetti_port_transport *out_transport,
	size_t *out_owner_count)
{
	int err;

	if (port == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ports_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	if (!port->transport_active) {
		err = -ENOENT;
		goto unlock;
	}

	if (out_transport != NULL) {
		*out_transport = port->active_transport;
	}
	if (out_owner_count != NULL) {
		*out_owner_count = port->owner_count;
	}
	err = 0;

unlock:
	k_mutex_unlock(&ports_lock);
	return err;
}

const struct device *spaghetti_port_i2c_device(const struct spaghetti_port *port)
{
	if ((port == NULL) ||
	    !spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_I2C) ||
	    (port->i2c == NULL)) {
		return NULL;
	}

	return port->i2c;
}

int spaghetti_port_i2c_transfer(
	const struct spaghetti_port *port,
	const struct spaghetti_port_i2c_request *request,
	k_timeout_t timeout)
{
	int err;

	if ((port == NULL) || (request == NULL) || (request->messages == NULL) ||
	    (request->message_count == 0U)) {
		return -EINVAL;
	}
	if (!spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_I2C) ||
	    (port->i2c == NULL)) {
		return -ENOTSUP;
	}
	if (!device_is_ready(port->i2c)) {
		return -ENODEV;
	}

	err = lock_controller(SPAGHETTI_PORT_TRANSPORT_I2C, port->i2c, timeout);
	if (err < 0) {
		return err;
	}

	err = i2c_transfer(port->i2c, request->messages, request->message_count,
			   request->address);
	unlock_controller(SPAGHETTI_PORT_TRANSPORT_I2C, port->i2c);
	return err;
}

int spaghetti_port_spi_transceive(
	const struct spaghetti_port *port,
	const struct spaghetti_port_spi_request *request,
	k_timeout_t timeout)
{
#if defined(CONFIG_SPI)
	struct spi_config config = {0};
	struct spi_cs_control cs_control = {0};
	int err;

	if ((port == NULL) || (request == NULL)) {
		return -EINVAL;
	}
	if (request->chip_select > SPAGHETTI_PORT_SIGNAL_INDEX_MAX) {
		return -EINVAL;
	}
	if (!spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_SPI) ||
	    (port->spi == NULL)) {
		return -ENOTSUP;
	}
	if (!device_is_ready(port->spi)) {
		return -ENODEV;
	}

	config.frequency = request->frequency_hz;
	config.operation = request->operation;
	ARG_UNUSED(cs_control);

	err = lock_controller(SPAGHETTI_PORT_TRANSPORT_SPI, port->spi, timeout);
	if (err < 0) {
		return err;
	}

	err = spi_transceive(port->spi, &config, request->tx, request->rx);
	unlock_controller(SPAGHETTI_PORT_TRANSPORT_SPI, port->spi);
	return err;
#else
	ARG_UNUSED(port);
	ARG_UNUSED(request);
	ARG_UNUSED(timeout);
	return -ENOTSUP;
#endif
}

const struct device *spaghetti_port_uart_device(const struct spaghetti_port *port)
{
	if ((port == NULL) ||
	    !spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_UART) ||
	    (port->uart == NULL)) {
		return NULL;
	}

	return port->uart;
}

int spaghetti_port_uart_write(
	const struct spaghetti_port *port,
	const uint8_t *buf,
	size_t len,
	k_timeout_t timeout)
{
	const struct device *uart;
	k_timepoint_t deadline;
	size_t offset = 0U;

	if ((port == NULL) || ((len > 0U) && (buf == NULL))) {
		return -EINVAL;
	}
	if (timeout_is_forever(timeout)) {
		return -EINVAL;
	}

	uart = spaghetti_port_uart_device(port);
	if (uart == NULL) {
		return -ENOTSUP;
	}
	if (!device_is_ready(uart)) {
		return -ENODEV;
	}

	deadline = sys_timepoint_calc(timeout);
	while (offset < len) {
		uart_poll_out(uart, buf[offset]);
		offset += 1U;
		if ((offset < len) && sys_timepoint_expired(deadline)) {
			return -ETIMEDOUT;
		}
	}

	return 0;
}

int spaghetti_port_uart_read_until(
	const struct spaghetti_port *port,
	uint8_t *buf,
	size_t capacity,
	uint8_t stop_byte,
	size_t *out_len,
	k_timeout_t timeout)
{
	const struct device *uart;
	k_timepoint_t deadline;
	size_t offset = 0U;

	if ((port == NULL) || (buf == NULL) || (out_len == NULL) ||
	    (capacity == 0U)) {
		return -EINVAL;
	}
	if (timeout_is_forever(timeout)) {
		return -EINVAL;
	}

	uart = spaghetti_port_uart_device(port);
	if (uart == NULL) {
		return -ENOTSUP;
	}
	if (!device_is_ready(uart)) {
		return -ENODEV;
	}

	deadline = sys_timepoint_calc(timeout);
	while (offset < capacity) {
		unsigned char byte = 0U;
		int err = uart_poll_in(uart, &byte);

		if (err == 0) {
			buf[offset++] = (uint8_t)byte;
			if ((uint8_t)byte == stop_byte) {
				*out_len = offset;
				return 0;
			}
			continue;
		}
		if (err != -1) {
			return err;
		}
		if (sys_timepoint_expired(deadline)) {
			return -ETIMEDOUT;
		}
		k_sleep(K_MSEC(1));
	}

	return -EMSGSIZE;
}

int spaghetti_port_uart_read(
	const struct spaghetti_port *port,
	uint8_t *buf,
	size_t len,
	k_timeout_t timeout)
{
	const struct device *uart;
	k_timepoint_t deadline;
	size_t offset = 0U;

	if ((port == NULL) || (buf == NULL) || (len == 0U)) {
		return -EINVAL;
	}
	if (timeout_is_forever(timeout)) {
		return -EINVAL;
	}

	uart = spaghetti_port_uart_device(port);
	if (uart == NULL) {
		return -ENOTSUP;
	}
	if (!device_is_ready(uart)) {
		return -ENODEV;
	}

	deadline = sys_timepoint_calc(timeout);
	while (offset < len) {
		unsigned char byte = 0U;
		int err = uart_poll_in(uart, &byte);

		if (err == 0) {
			buf[offset++] = (uint8_t)byte;
			continue;
		}
		if (err != -1) {
			return err;
		}
		if (sys_timepoint_expired(deadline)) {
			return -ETIMEDOUT;
		}
		k_sleep(K_MSEC(1));
	}

	return 0;
}

int spaghetti_port_set_output(const struct spaghetti_port *port, bool high)
{
	if (port == NULL) {
		return -EINVAL;
	}
	if (!spaghetti_port_has_capability(
		    port, SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT) ||
	    (port->output == NULL)) {
		return -ENOTSUP;
	}
	if (!gpio_is_ready_dt(port->output)) {
		return -ENODEV;
	}

	return gpio_pin_set_raw(port->output->port, port->output->pin,
				high ? 1 : 0);
}

int spaghetti_port_get_input(const struct spaghetti_port *port, bool *out_high)
{
	int value;

	if ((port == NULL) || (out_high == NULL)) {
		return -EINVAL;
	}
	if (!spaghetti_port_has_capability(
		    port, SPAGHETTI_PORT_CAP_DIGITAL_INPUT) ||
	    (port->input == NULL)) {
		return -ENOTSUP;
	}
	if (!gpio_is_ready_dt(port->input)) {
		return -ENODEV;
	}

	value = gpio_pin_get_raw(port->input->port, port->input->pin);
	if (value < 0) {
		return value;
	}

	*out_high = value != 0;
	return 0;
}

int spaghetti_port_digital_output_set(
	const struct spaghetti_port *port,
	uint8_t channel,
	bool high)
{
	if (port == NULL) {
		return -EINVAL;
	}
	if ((port->digital_outputs == NULL) ||
	    (channel >= port->digital_output_count)) {
		return -ENOTSUP;
	}
	if (!gpio_is_ready_dt(&port->digital_outputs[channel])) {
		return -ENODEV;
	}

	return gpio_pin_set_raw(port->digital_outputs[channel].port,
				 port->digital_outputs[channel].pin,
				 high ? 1 : 0);
}

int spaghetti_port_digital_input_get(
	const struct spaghetti_port *port,
	uint8_t channel,
	bool *out_high)
{
	int value;

	if ((port == NULL) || (out_high == NULL)) {
		return -EINVAL;
	}
	if ((port->digital_inputs == NULL) ||
	    (channel >= port->digital_input_count)) {
		return -ENOTSUP;
	}
	if (!gpio_is_ready_dt(&port->digital_inputs[channel])) {
		return -ENODEV;
	}

	value = gpio_pin_get_raw(port->digital_inputs[channel].port,
				  port->digital_inputs[channel].pin);
	if (value < 0) {
		return value;
	}

	*out_high = value != 0;
	return 0;
}

int spaghetti_port_adc_read(
	const struct spaghetti_port *port,
	uint8_t channel,
	int32_t *out_raw,
	int32_t *out_microvolts,
	k_timeout_t timeout)
{
#if defined(CONFIG_ADC)
	int16_t sample = 0;
	struct adc_sequence sequence = {
		.buffer = &sample,
		.buffer_size = sizeof(sample),
	};
	int32_t microvolts;
	int err;

	if (port == NULL) {
		return -EINVAL;
	}
	if (channel > SPAGHETTI_PORT_SIGNAL_INDEX_MAX) {
		return -EINVAL;
	}
	if (!spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_ADC) ||
	    (port->adc_channels == NULL) ||
	    (channel >= port->adc_channel_count)) {
		return -ENOTSUP;
	}
	if (timeout_is_forever(timeout)) {
		return -EINVAL;
	}

	ARG_UNUSED(timeout);
	err = adc_channel_setup_dt(&port->adc_channels[channel]);
	if (err < 0) {
		return err;
	}
	err = adc_sequence_init_dt(&port->adc_channels[channel], &sequence);
	if (err < 0) {
		return err;
	}
	err = adc_read_dt(&port->adc_channels[channel], &sequence);
	if (err < 0) {
		return err;
	}

	microvolts = sample;
	err = adc_raw_to_millivolts_dt(&port->adc_channels[channel], &microvolts);
	if (err < 0) {
		return err;
	}
	microvolts *= 1000;

	if (out_raw != NULL) {
		*out_raw = sample;
	}
	if (out_microvolts != NULL) {
		*out_microvolts = microvolts;
	}
	return 0;
#else
	ARG_UNUSED(port);
	ARG_UNUSED(channel);
	ARG_UNUSED(out_raw);
	ARG_UNUSED(out_microvolts);
	ARG_UNUSED(timeout);
	return -ENOTSUP;
#endif
}

int spaghetti_port_w1_write_read(
	const struct spaghetti_port *port,
	const uint8_t rom[SPAGHETTI_ENDPOINT_VALUE_MAX],
	const uint8_t *write_data,
	size_t write_size,
	uint8_t *read_data,
	size_t read_size,
	k_timeout_t timeout)
{
#if defined(CONFIG_W1)
	int err;

	if ((port == NULL) || (rom == NULL) ||
	    ((write_size > 0U) && (write_data == NULL)) ||
	    ((read_size > 0U) && (read_data == NULL))) {
		return -EINVAL;
	}
	if (!spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_W1) ||
	    (port->w1 == NULL)) {
		return -ENOTSUP;
	}
	if (!device_is_ready(port->w1)) {
		return -ENODEV;
	}

	err = lock_controller(SPAGHETTI_PORT_TRANSPORT_W1, port->w1, timeout);
	if (err < 0) {
		return err;
	}

	err = w1_write_read(port->w1, rom, write_data, write_size, read_data,
			    read_size);
	unlock_controller(SPAGHETTI_PORT_TRANSPORT_W1, port->w1);
	return err;
#else
	ARG_UNUSED(port);
	ARG_UNUSED(rom);
	ARG_UNUSED(write_data);
	ARG_UNUSED(write_size);
	ARG_UNUSED(read_data);
	ARG_UNUSED(read_size);
	ARG_UNUSED(timeout);
	return -ENOTSUP;
#endif
}
