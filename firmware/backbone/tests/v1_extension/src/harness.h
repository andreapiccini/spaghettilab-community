/**
 * @file
 * @brief Board/service stubs for V1 extension proof (not central subsystems).
 */

#ifndef V1_EXTENSION_HARNESS_H
#define V1_EXTENSION_HARNESS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/config.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>
#include <spaghetti/service.h>

struct v1_harness {
	uint32_t storage_writes;
	struct spaghetti_config stored;
	int storage_error;
	size_t runtime_schedule_count;
	size_t runtime_rule_count;
	bool runtime_running;
	struct spaghetti_mqtt_config mqtt;
	enum spaghetti_connectivity_policy connectivity;
	enum spaghetti_service_state service_state;
	bool eeprom_enabled;
	bool analog_enabled;
	uint8_t eeprom_identity[8];
	size_t eeprom_identity_size;
	uint8_t analog_identity[4];
	size_t analog_identity_size;
};

void v1_harness_reset(void);
struct v1_harness *v1_harness_get(void);

void v1_port_reset(void);

#endif /* V1_EXTENSION_HARNESS_H */
