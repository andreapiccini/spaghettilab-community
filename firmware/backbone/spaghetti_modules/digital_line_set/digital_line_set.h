/**
 * @file
 * @brief Public Digital Line Set Module driver configuration contract.
 * @ingroup spaghetti_digital_line_set
 */

#ifndef SPAGHETTI_DIGITAL_LINE_SET_H
#define SPAGHETTI_DIGITAL_LINE_SET_H

#include <stdbool.h>
#include <stdint.h>

struct spaghetti_module_driver;

/** Stable Digital Line Set config, command, and argument field identifiers. */
enum {
	SPAGHETTI_DIGITAL_LINE_SET_CONFIG_CHANNEL = 1,
	SPAGHETTI_DIGITAL_LINE_SET_CONFIG_SAFE_HIGH = 2,
	SPAGHETTI_DIGITAL_LINE_SET_COMMAND_SET = 1,
	SPAGHETTI_DIGITAL_LINE_SET_COMMAND_FIELD_HIGH = 1,
};

/**
 * @brief Immutable Digital Line Set driver descriptor shared by all instances.
 */
extern const struct spaghetti_module_driver spaghetti_digital_line_set_driver;

#endif /* SPAGHETTI_DIGITAL_LINE_SET_H */
