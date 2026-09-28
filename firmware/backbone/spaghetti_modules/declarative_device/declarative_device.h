/**
 * @file
 * @brief Generic Module driver that executes declarative Device Profiles.
 */

#ifndef SPAGHETTI_DECLARATIVE_DEVICE_H
#define SPAGHETTI_DECLARATIVE_DEVICE_H

#include <stdint.h>

/** Config field: owned profile_id TEXT. */
#define SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_ID 1U
/** Config field: profile version UINT64. */
#define SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_VERSION 2U
/** Config field: optional profile hash BYTES. */
#define SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_HASH 3U
/** Config field: optional I2C address UINT64. */
#define SPAGHETTI_DECLARATIVE_CONFIG_I2C_ADDRESS 4U
/** Config field: optional SPI chip-select UINT64. */
#define SPAGHETTI_DECLARATIVE_CONFIG_SPI_CS 5U
/** Config field: optional ADC channel UINT64. */
#define SPAGHETTI_DECLARATIVE_CONFIG_ADC_CHANNEL 6U
/** Config field: optional SPI frequency Hz UINT64. */
#define SPAGHETTI_DECLARATIVE_CONFIG_SPI_FREQUENCY_HZ 7U
/** Config field: optional 1-Wire ROM BYTES, exactly 8. */
#define SPAGHETTI_DECLARATIVE_CONFIG_W1_ROM 8U

#endif /* SPAGHETTI_DECLARATIVE_DEVICE_H */
