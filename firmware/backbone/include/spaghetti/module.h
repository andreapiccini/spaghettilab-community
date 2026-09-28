/**
 * @file
 * @brief Public Module types for the Spaghetti firmware.
 * @ingroup spaghetti_module
 */

#ifndef SPAGHETTI_MODULE_H
#define SPAGHETTI_MODULE_H

#include <stdint.h>

struct spaghetti_module_driver;
struct spaghetti_port;

/** Maximum bytes in a Module type ID, including the terminating NUL. */
#define SPAGHETTI_TYPE_ID_MAX 24U

/** Maximum bytes stored in one Module endpoint value. */
#define SPAGHETTI_ENDPOINT_VALUE_MAX 8U

/**
 * @brief Runtime identifier for a live Module.
 *
 * The Module Manager assigns this ephemeral handle. It is valid only while the
 * corresponding Module remains configured and must not be persisted.
 */
typedef uint8_t spaghetti_module_id_t;

/**
 * @brief Stable identity of one desired Module configuration.
 *
 * Config owns this nonzero value. It remains stable across Manager slot reuse
 * and reboot when the same configuration is restored.
 */
typedef uint32_t spaghetti_module_key_t;

/**
 * @brief Lifecycle state of a Module instance.
 */
enum spaghetti_module_state {
	SPAGHETTI_MODULE_UNINITIALIZED, /**< Driver initialization has not completed. */
	SPAGHETTI_MODULE_READY, /**< The Module accepts supported operations. */
	SPAGHETTI_MODULE_ERROR, /**< The Module encountered an unrecoverable error. */
};

/**
 * @brief Hardware endpoint namespace used for collision detection.
 */
enum spaghetti_module_endpoint_kind {
	SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE, /**< The Module requires the whole Port. */
	SPAGHETTI_ENDPOINT_I2C_ADDRESS, /**< One-byte 7-bit I2C address. */
	SPAGHETTI_ENDPOINT_SPI_CHIP_SELECT, /**< One-byte SPI chip-select index. */
	SPAGHETTI_ENDPOINT_UART_EXCLUSIVE, /**< Exclusive UART termination. */
	SPAGHETTI_ENDPOINT_GPIO_LINE, /**< Logical connector signal index 0..4. */
	SPAGHETTI_ENDPOINT_ADC_CHANNEL, /**< Logical connector signal index 0..4. */
	SPAGHETTI_ENDPOINT_W1_ROM, /**< Full eight-byte 1-Wire ROM identity. */
};

/**
 * @brief Normalized hardware endpoint of one Module.
 *
 * @p kind selects the namespace. @p value_size bounds the owned @p value bytes.
 */
struct spaghetti_module_endpoint {
	enum spaghetti_module_endpoint_kind kind; /**< Namespace for @ref value. */
	uint8_t value_size; /**< Valid byte count in @ref value. */
	uint8_t value[SPAGHETTI_ENDPOINT_VALUE_MAX]; /**< Owned endpoint payload. */
};

/**
 * @brief Manager-owned live Module instance passed to its concrete driver.
 */
struct spaghetti_module {
	spaghetti_module_id_t id; /**< Ephemeral Manager handle for this live instance. */
	spaghetti_module_key_t key; /**< Stable nonzero Config identity. */
	enum spaghetti_module_state state; /**< Current public lifecycle state. */
	const struct spaghetti_port *port; /**< Borrowed firmware-lifetime shared Port. */
	const struct spaghetti_module_driver *driver; /**< Borrowed immutable descriptor. */
	struct spaghetti_module_endpoint endpoint; /**< Validated physical endpoint. */
	void *context; /**< Opaque context owned by the concrete driver's static pool. */
};

/**
 * @brief Legacy electrical measurement returned by V0 Module drivers.
 *
 * Prefer schema-backed @c spaghetti_record_payload for new drivers. Runtime and
 * Data still consume this type until phase 340 migrates the electrical path.
 */
struct spaghetti_sample {
	int32_t bus_voltage_microvolts; /**< Bus voltage in microvolts. */
	int32_t current_microamps; /**< Signed current in microamps. */
	uint32_t power_microwatts; /**< Non-negative power in microwatts. */
};

#endif /* SPAGHETTI_MODULE_H */
