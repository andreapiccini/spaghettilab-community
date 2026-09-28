/**
 * @file
 * @brief Public INA219 Module Driver contract for the Spaghetti firmware.
 * @ingroup spaghetti_ina219
 */

#ifndef SPAGHETTI_INA219_H
#define SPAGHETTI_INA219_H

#include <stdint.h>

#include <spaghetti/schema.h>

struct spaghetti_module_driver;

/** Stable INA219 config and record field identifiers. */
enum {
	SPAGHETTI_INA219_CONFIG_ADDRESS = 1,
	SPAGHETTI_INA219_CONFIG_SHUNT_MILLIOHM = 2,
	SPAGHETTI_INA219_CONFIG_CURRENT_LSB_MICROAMP = 3,
	SPAGHETTI_INA219_FIELD_BUS_VOLTAGE_MICROVOLTS = 1,
	SPAGHETTI_INA219_FIELD_CURRENT_MICROAMPS = 2,
	SPAGHETTI_INA219_FIELD_POWER_MICROWATTS = 3,
};

/**
 * @brief Runtime configuration copied by one INA219 Module instance.
 *
 * Retained for Storage/CBOR byte compatibility until phase 330 migrates the
 * wire format to property sets.
 */
struct spaghetti_ina219_config {
	uint8_t i2c_address; /**< INA219 7-bit address in the inclusive range 0x40-0x4F. */
	uint16_t shunt_milliohm; /**< Positive physical shunt resistance in milliohms. */
	uint16_t current_lsb_microamp; /**< Positive current-register weight in microamps. */
};

/**
 * @brief Copy a legacy INA219 config struct into a typed property set.
 *
 * @param[in] in Borrowed legacy config.
 * @param[out] out Caller-owned property set written only on success.
 *
 * @retval 0 Conversion completed.
 * @retval -EINVAL A pointer is NULL.
 */
int spaghetti_ina219_config_to_properties(
	const struct spaghetti_ina219_config *in,
	struct spaghetti_property_set *out);

/**
 * @brief Copy a typed property set into a legacy INA219 config struct.
 *
 * @param[in] in Borrowed property set.
 * @param[out] out Caller-owned legacy config written only on success.
 *
 * @retval 0 Conversion completed.
 * @retval -EINVAL A pointer is NULL or a required field is missing/wrong type.
 * @retval -ERANGE A numeric field cannot be represented in the legacy struct.
 */
int spaghetti_ina219_config_from_properties(
	const struct spaghetti_property_set *in,
	struct spaghetti_ina219_config *out);

/**
 * @brief Immutable INA219 driver descriptor.
 *
 * The Registry owns no instance state. This descriptor has firmware lifetime
 * and is shared by every configured INA219 Module.
 */
extern const struct spaghetti_module_driver spaghetti_ina219_driver;

#endif /* SPAGHETTI_INA219_H */
