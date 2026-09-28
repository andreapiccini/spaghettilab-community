#ifndef DISCOVERY_TEST_FAKE_PROVIDERS_H
#define DISCOVERY_TEST_FAKE_PROVIDERS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/discovery.h>

/** Controllable harness shared by linked fake providers. */
struct discovery_test_harness {
	bool eeprom_enabled;
	uint8_t eeprom_bytes[128];
	size_t eeprom_size;

	bool analog_enabled;
	char analog_type_id[SPAGHETTI_TYPE_ID_MAX];
	uint8_t analog_identity[SPAGHETTI_DISCOVERY_IDENTITY_MAX];
	uint8_t analog_identity_size;

	bool i2c_register_enabled;
	uint8_t i2c_identity[SPAGHETTI_DISCOVERY_IDENTITY_MAX];
	uint8_t i2c_identity_size;
	char i2c_type_id[SPAGHETTI_TYPE_ID_MAX];

	bool w1_enabled;
	uint8_t w1_roms[2][8];
	size_t w1_rom_count;

	bool timeout_enabled;
	bool invasive_enabled;
	bool invasive_ran;

	bool flood_enabled;
	size_t flood_count;

	bool duplicate_emit_enabled;
};

void discovery_test_harness_reset(void);
struct discovery_test_harness *discovery_test_harness_get(void);

#endif /* DISCOVERY_TEST_FAKE_PROVIDERS_H */
