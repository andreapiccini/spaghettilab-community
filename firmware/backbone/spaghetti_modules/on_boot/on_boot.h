/**
 * @file
 * @brief Public On Boot Module driver configuration contract.
 * @ingroup spaghetti_on_boot
 */

#ifndef SPAGHETTI_ON_BOOT_H
#define SPAGHETTI_ON_BOOT_H

struct spaghetti_module_driver;

/**
 * @brief Immutable On Boot driver descriptor shared by all instances.
 */
extern const struct spaghetti_module_driver spaghetti_on_boot_driver;

#endif /* SPAGHETTI_ON_BOOT_H */
