/**
 * @file
 * @brief Public Port API for the Spaghetti firmware.
 * @ingroup spaghetti_port
 */

#ifndef SPAGHETTI_PORT_H
#define SPAGHETTI_PORT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/drivers/i2c.h>
#include <zephyr/drivers/spi.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

#include <spaghetti/module.h>

/**
 * @brief Port identifier type.
 *
 * A Port ID is a small numeric identifier used by the firmware to refer to
 * a physical Spaghetti Port without exposing board-specific GPIO or MCU details.
 */
typedef uint8_t spaghetti_port_id_t;

/**
 * @brief Nonzero Module key that currently owns a Port transport reference.
 */
typedef uint32_t spaghetti_port_owner_t;

/**
 * @brief Capabilities exposed by a Spaghetti Port.
 *
 * Capabilities are represented as individual bits so that a Port can expose
 * multiple possible functions. Only one electrical family is active at runtime.
 */
enum spaghetti_port_capability {
	SPAGHETTI_PORT_CAP_I2C = BIT(0), /**< Shared I2C controller. */
	SPAGHETTI_PORT_CAP_SPI = BIT(1), /**< Shared SPI controller. */
	SPAGHETTI_PORT_CAP_UART = BIT(2), /**< Exclusive UART controller. */
	SPAGHETTI_PORT_CAP_DIGITAL_INPUT = BIT(3), /**< Digital input line. */
	SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT = BIT(4), /**< Digital output line. */
	SPAGHETTI_PORT_CAP_ADC = BIT(5), /**< ADC channel on the connector. */
	SPAGHETTI_PORT_CAP_W1 = BIT(6), /**< 1-Wire controller. */
	SPAGHETTI_PORT_CAP_PWM = BIT(7), /**< PWM output on the connector. */
	SPAGHETTI_PORT_CAP_DAC = BIT(8), /**< DAC output on the connector. */
	SPAGHETTI_PORT_CAP_CAN = BIT(9), /**< CAN controller on the connector. */
};

/**
 * @brief Active electrical transport selected for one Port.
 */
enum spaghetti_port_transport {
	SPAGHETTI_PORT_TRANSPORT_I2C, /**< Shared I2C bus. */
	SPAGHETTI_PORT_TRANSPORT_SPI, /**< Shared SPI bus. */
	SPAGHETTI_PORT_TRANSPORT_UART, /**< Exclusive UART. */
	SPAGHETTI_PORT_TRANSPORT_GPIO, /**< Digital GPIO family. */
	SPAGHETTI_PORT_TRANSPORT_ADC, /**< ADC family. */
	SPAGHETTI_PORT_TRANSPORT_W1, /**< Shared 1-Wire bus. */
};

/**
 * @brief Borrowed I2C transfer request valid only for one Port call.
 */
struct spaghetti_port_i2c_request {
	uint16_t address; /**< 7-bit I2C address. */
	struct i2c_msg *messages; /**< Borrowed Zephyr message array. */
	uint8_t message_count; /**< Number of messages. */
};

/**
 * @brief Borrowed SPI transfer request valid only for one Port call.
 */
struct spaghetti_port_spi_request {
	uint8_t chip_select; /**< Logical chip-select index on the Port. */
	uint32_t frequency_hz; /**< Requested SPI clock. */
	spi_operation_t operation; /**< Zephyr SPI operation flags. */
	const struct spi_buf_set *tx; /**< Optional borrowed TX buffers. */
	const struct spi_buf_set *rx; /**< Optional borrowed RX buffers. */
};

struct spaghetti_port;

/**
 * @brief Initialize all Spaghetti Ports and shared controller locks.
 *
 * @retval 0 Initialization completed successfully.
 * @retval -ENODEV A required hardware device is unavailable or not ready.
 */
int spaghetti_port_init_all(void);

/**
 * @brief Return the number of available Spaghetti Ports.
 *
 * @return Number of Ports exposed by the current Core.
 */
size_t spaghetti_port_count(void);

/**
 * @brief Get a Spaghetti Port by identifier.
 *
 * @param[in] id Port identifier.
 *
 * @return Pointer to the requested Port.
 * @return NULL if the identifier is invalid or the Port is unavailable.
 *
 * The returned object is owned by the Port subsystem and must not be modified
 * or freed by the caller.
 */
const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id);

/**
 * @brief Check whether a Port exposes a capability.
 *
 * @param[in] port Port to inspect.
 * @param[in] capabilities Nonzero capability bitmask that must be fully present.
 *
 * @return true if the Port exposes the requested capability.
 * @return false if it does not, or if @p port is NULL.
 */
bool spaghetti_port_has_capability(
	const struct spaghetti_port *port,
	uint32_t capabilities);

/**
 * @brief Return the capability bitmask advertised by a Port.
 *
 * The mask is the DTS-derived pin mux for that connector. Hosts read it from
 * GET_TOPOLOGY flow key 5 and must not invent peripherals the Port lacks.
 *
 * @return Capability bits, or 0 if @p port is NULL.
 */
uint32_t spaghetti_port_capabilities(const struct spaghetti_port *port);

/**
 * @brief Acquire a Port transport for one Module owner.
 *
 * Call from thread context. The first owner selects the board backend. Later
 * owners must request the same shareable transport.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] owner Nonzero Module key copied by value.
 * @param[in] transport Requested electrical family.
 *
 * @retval 0 Ownership recorded.
 * @retval -EINVAL @p port is NULL or @p owner is zero.
 * @retval -ENOTSUP Capability or backend is unavailable.
 * @retval -EBUSY A different transport is already active.
 * @retval -EALREADY @p owner already holds this Port.
 * @retval -ENOMEM Owner table is full.
 */
int spaghetti_port_acquire(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner,
	enum spaghetti_port_transport transport);

/**
 * @brief Release one Module owner from a Port.
 *
 * The last release returns the Port to the board safe/sleep state.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] owner Nonzero Module key previously acquired.
 *
 * @retval 0 Ownership released.
 * @retval -EINVAL @p port is NULL or @p owner is zero.
 * @retval -ENOENT @p owner does not hold this Port.
 */
int spaghetti_port_release(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner);

/**
 * @brief Copy the active transport and owner count.
 *
 * Outputs change only on success.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[out] out_transport Optional active transport.
 * @param[out] out_owner_count Optional owner count.
 *
 * @retval 0 Snapshot written.
 * @retval -EINVAL @p port is NULL.
 * @retval -ENOENT No transport is currently active.
 */
int spaghetti_port_get_active_transport(
	const struct spaghetti_port *port,
	enum spaghetti_port_transport *out_transport,
	size_t *out_owner_count);

/**
 * @brief Return the Zephyr I2C device associated with a Port.
 *
 * @param[in] port Port to inspect.
 *
 * @return Borrowed Zephyr I2C device, or NULL when unavailable.
 */
const struct device *spaghetti_port_i2c_device(const struct spaghetti_port *port);

/**
 * @brief Serialize an I2C transfer on the Port controller lock.
 *
 * Call from thread context. @p timeout bounds only the shared-controller lock
 * wait; @c K_FOREVER is rejected. Zephyr keeps its own hardware timeouts.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] request Borrowed transfer descriptor valid for this call.
 * @param[in] timeout Bounded lock wait; must not be @c K_FOREVER.
 *
 * @retval 0 Transfer completed.
 * @retval -EINVAL Invalid argument or forever timeout.
 * @retval -ENOTSUP Port has no I2C capability.
 * @retval -ENODEV Controller is not ready.
 * @retval -EBUSY Lock wait timed out.
 * @retval -EIO Or other original Zephyr I2C errno.
 */
int spaghetti_port_i2c_transfer(
	const struct spaghetti_port *port,
	const struct spaghetti_port_i2c_request *request,
	k_timeout_t timeout);

/**
 * @brief Serialize an SPI transfer on the Port controller lock.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] request Borrowed transfer descriptor valid for this call.
 * @param[in] timeout Bounded lock wait; must not be @c K_FOREVER.
 *
 * @retval 0 Transfer completed.
 * @retval -EINVAL Invalid argument or forever timeout.
 * @retval -ENOTSUP Port has no SPI capability.
 * @retval -ENODEV Controller is not ready.
 * @retval -EBUSY Lock wait timed out.
 * @retval -EIO Or other original Zephyr SPI errno.
 */
int spaghetti_port_spi_transceive(
	const struct spaghetti_port *port,
	const struct spaghetti_port_spi_request *request,
	k_timeout_t timeout);

/**
 * @brief Return the borrowed UART device for an exclusive Port endpoint.
 *
 * Framing and callbacks remain the Module driver's responsibility.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 *
 * @return Borrowed UART device, or NULL when unavailable.
 */
const struct device *spaghetti_port_uart_device(const struct spaghetti_port *port);

/**
 * @brief Write bytes on the Port UART with a bounded wall-clock timeout.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] buf Borrowed TX bytes valid for this call.
 * @param[in] len Number of bytes in @p buf.
 * @param[in] timeout Bounded wait; must not be @c K_FOREVER.
 *
 * @retval 0 Every byte was accepted by the controller.
 * @retval -EINVAL Invalid argument or forever timeout.
 * @retval -ENOTSUP Port has no UART capability.
 * @retval -ENODEV Controller is not ready.
 * @retval -ETIMEDOUT The timeout expired before the write finished.
 * @retval -EIO Or other original Zephyr UART errno.
 */
int spaghetti_port_uart_write(
	const struct spaghetti_port *port,
	const uint8_t *buf,
	size_t len,
	k_timeout_t timeout);

/**
 * @brief Read UART bytes until @p stop_byte or capacity/timeout.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[out] buf Caller-owned RX buffer written only on success.
 * @param[in] capacity Maximum bytes that may be stored in @p buf.
 * @param[in] stop_byte Terminating byte included in the returned length.
 * @param[out] out_len Written byte count on success.
 * @param[in] timeout Bounded wait; must not be @c K_FOREVER.
 *
 * @retval 0 Stop byte observed or buffer filled without overrun.
 * @retval -EINVAL Invalid argument or forever timeout.
 * @retval -ENOTSUP Port has no UART capability.
 * @retval -ENODEV Controller is not ready.
 * @retval -ETIMEDOUT The timeout expired before @p stop_byte.
 * @retval -EMSGSIZE @p capacity was exhausted before @p stop_byte.
 */
int spaghetti_port_uart_read_until(
	const struct spaghetti_port *port,
	uint8_t *buf,
	size_t capacity,
	uint8_t stop_byte,
	size_t *out_len,
	k_timeout_t timeout);

/**
 * @brief Read exactly @p len UART bytes with a bounded timeout.
 *
 * Does not return a silent partial frame: timeout or a short read fails
 * without reporting a successful length.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[out] buf Caller-owned RX buffer written only on success.
 * @param[in] len Exact byte count that must arrive.
 * @param[in] timeout Bounded wait; must not be @c K_FOREVER.
 *
 * @retval 0 Exactly @p len bytes were stored in @p buf.
 * @retval -EINVAL Invalid argument, zero @p len, or forever timeout.
 * @retval -ENOTSUP Port has no UART capability.
 * @retval -ENODEV Controller is not ready.
 * @retval -ETIMEDOUT The timeout expired before @p len bytes arrived.
 * @retval -EIO Or other original Zephyr UART errno.
 */
int spaghetti_port_uart_read(
	const struct spaghetti_port *port,
	uint8_t *buf,
	size_t len,
	k_timeout_t timeout);

/**
 * @brief Drive the raw electrical level of a Port digital output.
 *
 * @param[in] port Port borrowed for this call and never retained.
 * @param[in] high True requests a high electrical level; false requests low.
 *
 * @retval 0 The output reached the requested level.
 * @retval -EINVAL @p port is NULL.
 * @retval -ENOTSUP The Port has no digital-output capability or GPIO resource.
 * @retval -ENODEV The GPIO controller is unavailable.
 * @retval -EIO The GPIO driver rejected the write.
 *
 * @note Call from thread context. Logical actuator polarity belongs to its
 *       Module driver, not to this raw Port operation.
 */
int spaghetti_port_set_output(const struct spaghetti_port *port, bool high);

/**
 * @brief Read the raw electrical level of a Port digital input.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[out] out_high Written only on success.
 *
 * @retval 0 Level copied.
 * @retval -EINVAL @p port or @p out_high is NULL.
 * @retval -ENOTSUP Input capability or GPIO resource is absent.
 * @retval -ENODEV GPIO controller is unavailable.
 */
int spaghetti_port_get_input(const struct spaghetti_port *port, bool *out_high);

/**
 * @brief Read one logical ADC channel through the shared controller lock.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] channel Logical connector index in 0..4.
 * @param[out] out_raw Optional raw sample written only on success.
 * @param[out] out_microvolts Optional converted value written only on success.
 * @param[in] timeout Bounded lock wait; must not be @c K_FOREVER.
 *
 * @retval 0 Sample acquired.
 * @retval -EINVAL Invalid argument, channel, or forever timeout.
 * @retval -ENOTSUP ADC capability is absent.
 * @retval -ENODEV Controller is not ready.
 * @retval -EBUSY Lock wait timed out.
 */
int spaghetti_port_adc_read(
	const struct spaghetti_port *port,
	uint8_t channel,
	int32_t *out_raw,
	int32_t *out_microvolts,
	k_timeout_t timeout);

/**
 * @brief Drive one indexed digital output line on the connector.
 *
 * `spaghetti_port_set_output()` above drives a Port's single primary digital
 * line (Relay's model: one Port, one purpose). A Flow's five raw signals can
 * carry more than one independently-driveable digital line on the same
 * connector — this is the indexed counterpart, mirroring
 * @ref spaghetti_port_adc_read's channel model exactly, for drivers that
 * pick which signal index (0..4) they own via their own Module config.
 *
 * @param[in] port Port borrowed for this call and never retained.
 * @param[in] channel Logical connector signal index in 0..4.
 * @param[in] high True requests a high electrical level; false requests low.
 *
 * @retval 0 The output reached the requested level.
 * @retval -EINVAL @p port is NULL.
 * @retval -ENOTSUP No digital-output line is wired at @p channel.
 * @retval -ENODEV The GPIO controller is unavailable.
 * @retval -EIO The GPIO driver rejected the write.
 */
int spaghetti_port_digital_output_set(
	const struct spaghetti_port *port,
	uint8_t channel,
	bool high);

/**
 * @brief Read one indexed digital input line on the connector.
 *
 * Indexed counterpart of @ref spaghetti_port_get_input, same reasoning as
 * @ref spaghetti_port_digital_output_set above.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] channel Logical connector signal index in 0..4.
 * @param[out] out_high Written only on success.
 *
 * @retval 0 Level copied.
 * @retval -EINVAL @p port or @p out_high is NULL.
 * @retval -ENOTSUP No digital-input line is wired at @p channel.
 * @retval -ENODEV GPIO controller is unavailable.
 */
int spaghetti_port_digital_input_get(
	const struct spaghetti_port *port,
	uint8_t channel,
	bool *out_high);

/**
 * @brief Perform a bounded 1-Wire write/read against one ROM identity.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] rom Eight-byte ROM identity.
 * @param[in] write_data Optional borrowed TX bytes.
 * @param[in] write_size TX byte count.
 * @param[out] read_data Optional RX buffer written only on success.
 * @param[in] read_size RX byte count.
 * @param[in] timeout Bounded lock wait; must not be @c K_FOREVER.
 *
 * @retval 0 Transaction completed.
 * @retval -EINVAL Invalid argument or forever timeout.
 * @retval -ENOTSUP 1-Wire capability is absent.
 * @retval -ENODEV Controller is not ready.
 * @retval -EBUSY Lock wait timed out.
 */
int spaghetti_port_w1_write_read(
	const struct spaghetti_port *port,
	const uint8_t rom[SPAGHETTI_ENDPOINT_VALUE_MAX],
	const uint8_t *write_data,
	size_t write_size,
	uint8_t *read_data,
	size_t read_size,
	k_timeout_t timeout);

#endif /* SPAGHETTI_PORT_H */
