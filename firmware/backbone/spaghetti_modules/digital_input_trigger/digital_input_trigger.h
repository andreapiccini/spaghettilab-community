/**
 * @file
 * @brief Public Digital Input Trigger Module driver configuration contract.
 * @ingroup spaghetti_digital_input_trigger
 */

#ifndef SPAGHETTI_DIGITAL_INPUT_TRIGGER_H
#define SPAGHETTI_DIGITAL_INPUT_TRIGGER_H

#include <stdbool.h>
#include <stdint.h>

struct spaghetti_module_driver;

/** Stable Digital Input Trigger config field identifiers. */
enum {
	SPAGHETTI_DIGITAL_INPUT_TRIGGER_CONFIG_CHANNEL = 1,
	SPAGHETTI_DIGITAL_INPUT_TRIGGER_CONFIG_TRIGGER_HIGH = 2,
};

/**
 * @brief Immutable Digital Input Trigger driver descriptor shared by all instances.
 */
extern const struct spaghetti_module_driver spaghetti_digital_input_trigger_driver;

#endif /* SPAGHETTI_DIGITAL_INPUT_TRIGGER_H */
