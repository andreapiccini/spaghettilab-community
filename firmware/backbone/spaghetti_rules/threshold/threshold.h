/**
 * @file
 * @brief Public Threshold rule driver contract.
 * @ingroup spaghetti_threshold
 */

#ifndef SPAGHETTI_THRESHOLD_H
#define SPAGHETTI_THRESHOLD_H

#include <spaghetti/rule_driver.h>
#include <spaghetti/schema.h>

/** Stable Threshold rule config field identifiers. */
enum spaghetti_threshold_config_field {
	SPAGHETTI_THRESHOLD_SOURCE_KEY = 1,
	SPAGHETTI_THRESHOLD_SOURCE_FIELD_ID = 2,
	SPAGHETTI_THRESHOLD_LOWER = 3,
	SPAGHETTI_THRESHOLD_UPPER = 4,
	SPAGHETTI_THRESHOLD_TARGET_KEY = 5,
	SPAGHETTI_THRESHOLD_COMMAND_ID = 6,
	SPAGHETTI_THRESHOLD_COMMAND_FIELD_ID = 7,
	SPAGHETTI_THRESHOLD_ABOVE_VALUE = 8,
};

/** Immutable Threshold rule driver descriptor. */
extern const struct spaghetti_rule_driver spaghetti_threshold_rule_driver;

#endif /* SPAGHETTI_THRESHOLD_H */
