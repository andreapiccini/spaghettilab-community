/**
 * @file
 * @brief Public Relay Module Driver configuration contract.
 * @ingroup spaghetti_relay
 */

#ifndef SPAGHETTI_RELAY_H
#define SPAGHETTI_RELAY_H

#include <stdbool.h>

#include <spaghetti/schema.h>

struct spaghetti_module_driver;

/** Stable Relay config and command field identifiers. */
enum {
	SPAGHETTI_RELAY_CONFIG_ACTIVE_HIGH = 1,
	SPAGHETTI_RELAY_CONFIG_SAFE_ON = 2,
	SPAGHETTI_RELAY_COMMAND_SET = 1,
	SPAGHETTI_RELAY_COMMAND_FIELD_ON = 1,
};

/**
 * @brief Runtime configuration copied by one Relay Module instance.
 *
 * Retained for Storage/CBOR byte compatibility until phase 330 migrates the
 * wire format to property sets.
 */
struct spaghetti_relay_config {
	bool active_high; /**< True when electrical high means logical ON. */
	bool safe_on; /**< Logical state imposed during init and deinit. */
};

/**
 * @brief Copy a legacy Relay config struct into a typed property set.
 *
 * @param[in] in Borrowed legacy config.
 * @param[out] out Caller-owned property set written only on success.
 *
 * @retval 0 Conversion completed.
 * @retval -EINVAL A pointer is NULL.
 */
int spaghetti_relay_config_to_properties(
	const struct spaghetti_relay_config *in,
	struct spaghetti_property_set *out);

/**
 * @brief Copy a typed property set into a legacy Relay config struct.
 *
 * @param[in] in Borrowed property set.
 * @param[out] out Caller-owned legacy config written only on success.
 *
 * @retval 0 Conversion completed.
 * @retval -EINVAL A pointer is NULL or a required field is missing/wrong type.
 */
int spaghetti_relay_config_from_properties(
	const struct spaghetti_property_set *in,
	struct spaghetti_relay_config *out);

/**
 * @brief Immutable Relay driver descriptor shared by all instances.
 */
extern const struct spaghetti_module_driver spaghetti_relay_driver;

#endif /* SPAGHETTI_RELAY_H */
