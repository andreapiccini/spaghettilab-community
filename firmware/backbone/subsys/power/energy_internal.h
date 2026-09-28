#ifndef SPAGHETTI_ENERGY_INTERNAL_H
#define SPAGHETTI_ENERGY_INTERNAL_H

#include <stdint.h>

#include <spaghetti/energy.h>

/** Reason recorded in the internal metrics snapshot. */
enum spaghetti_energy_wake_reason {
	SPAGHETTI_ENERGY_WAKE_NONE, /**< No wake event recorded yet. */
	SPAGHETTI_ENERGY_WAKE_BOOT, /**< Recorded during initialization. */
	SPAGHETTI_ENERGY_WAKE_CONNECTIVITY, /**< Connectivity policy transition. */
	SPAGHETTI_ENERGY_WAKE_LOCAL_EVENT, /**< Local event opened a BLE window. */
	SPAGHETTI_ENERGY_WAKE_WINDOW, /**< Periodic window scheduler opened BLE. */
};

/** Caller-owned internal metrics copied for diagnostics and future Protocol V1. */
struct spaghetti_energy_snapshot {
	uint64_t active_uptime_ms; /**< Milliseconds counted while not force-sleeping. */
	uint64_t radio_active_ms; /**< Milliseconds the fake BLE radio stayed on. */
	uint32_t window_count; /**< Number of BLE windows opened. */
	enum spaghetti_energy_wake_reason wake_reason; /**< Last wake reason. */
	bool ble_radio_on; /**< Current fake BLE radio state. */
	bool window_active; /**< True while a windowed BLE window is open. */
};

struct spaghetti_energy_ble_backend {
	int (*set_radio)(bool on);
};

int spaghetti_energy_ble_backend_install(
	const struct spaghetti_energy_ble_backend *backend);

void spaghetti_energy_ble_backend_reset(void);

int spaghetti_energy_get_snapshot(struct spaghetti_energy_snapshot *out);

void spaghetti_energy_reset(void);

bool spaghetti_energy_test_port_controller_busy(void);

void spaghetti_energy_test_set_port_controller_busy(bool busy);

#endif /* SPAGHETTI_ENERGY_INTERNAL_H */
