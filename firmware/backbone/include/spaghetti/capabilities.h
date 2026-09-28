/**
 * @file
 * @brief Immutable build capability and resource-profile API.
 * @ingroup spaghetti_core
 */

#ifndef SPAGHETTI_CAPABILITIES_H
#define SPAGHETTI_CAPABILITIES_H

#include <stdbool.h>
#include <stdint.h>

#include <zephyr/sys/util.h>

/** Maximum bytes in the NUL-terminated Core variant identifier. */
#define SPAGHETTI_CORE_VARIANT_SIZE 32U

/** Build-time resource budget selected by the Core board. */
enum spaghetti_resource_profile {
	SPAGHETTI_RESOURCE_PROFILE_MINIMAL, /**< Small deterministic budget. */
	SPAGHETTI_RESOURCE_PROFILE_STANDARD, /**< Mid-range deterministic budget. */
	SPAGHETTI_RESOURCE_PROFILE_EXTENDED, /**< Verified additional-RAM budget. */
};

/** Features that are both compiled and backed by the selected Core. */
enum spaghetti_build_capability {
	SPAGHETTI_BUILD_CAP_BLE = BIT(0), /**< Bluetooth LE is compiled. */
	SPAGHETTI_BUILD_CAP_WIFI = BIT(1), /**< Wi-Fi is compiled. */
	SPAGHETTI_BUILD_CAP_MQTT = BIT(2), /**< MQTT is compiled. */
	SPAGHETTI_BUILD_CAP_OTA_BLE = BIT(3), /**< BLE OTA is compiled. */
	SPAGHETTI_BUILD_CAP_OTA_WIFI = BIT(4), /**< Wi-Fi OTA is compiled. */
	SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE = BIT(5), /**< TLS console is compiled. */
	SPAGHETTI_BUILD_CAP_EXTERNAL_RAM = BIT(6), /**< External RAM is verified. */
	SPAGHETTI_BUILD_CAP_HARDWARE_WATCHDOG = BIT(7), /**< Watchdog exists. */
	SPAGHETTI_BUILD_CAP_RUNTIME_PORT_MUX = BIT(8), /**< Port mux exists. */
	SPAGHETTI_BUILD_CAP_POWER_SWITCHING = BIT(9), /**< Power switch exists. */
	SPAGHETTI_BUILD_CAP_POWER_MEASUREMENT = BIT(10), /**< Power ADC exists. */
	SPAGHETTI_BUILD_CAP_OTA_CAN = BIT(11), /**< CAN field-update adapter is compiled. */
	SPAGHETTI_BUILD_CAP_OTA_ESPNOW = BIT(12), /**< ESP-NOW field-update adapter is compiled. */
};

/** Caller-owned immutable snapshot of the compiled firmware contract. */
struct spaghetti_capabilities {
	enum spaghetti_resource_profile resource_profile; /**< Selected budget. */
	uint32_t build_capabilities; /**< Available feature bits. */
	uint16_t max_modules; /**< Simultaneous live Modules. */
	uint16_t max_schedules; /**< Runtime schedules. */
	uint16_t max_rules; /**< Runtime rules. */
	uint16_t max_device_profiles; /**< Persisted Device Profiles. */
	uint16_t max_profile_operations; /**< Operations in one profile catalog. */
	uint16_t max_processing_blocks; /**< Processing graph Blocks. */
	uint16_t max_processing_edges; /**< Processing graph edges. */
	uint16_t max_properties_per_set; /**< Values in one property set. */
	uint16_t max_protocol_payload; /**< Machine payload bytes. */
	uint16_t max_record_queue; /**< Record Delivery slots. */
	uint8_t max_record_consumers; /**< Independent record cursors. */
	uint8_t max_ble_peers; /**< Simultaneous BLE peers. */
	uint8_t max_principals; /**< Persisted security principals. */
	uint8_t max_audit_entries; /**< Bounded access-control audit ring slots. */
	uint8_t max_inflight_requests; /**< Replay/request entries. */
	uint8_t max_secure_sessions; /**< Heavy secure sessions. */
	uint8_t max_flows; /**< Physical Core Flows. */
	uint8_t max_function_bays_per_flow; /**< Bays along one Flow. */
	uint8_t max_power_rails; /**< Board-declared power rails. */
	uint32_t replay_window_ms; /**< Request replay lifetime in milliseconds. */
	char core_variant[SPAGHETTI_CORE_VARIANT_SIZE]; /**< Stable variant ID. */
};

/**
 * @brief Copy the immutable capability snapshot.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains the complete build contract.
 * @retval -EINVAL @p out is NULL.
 *
 * @note The function reads no runtime free-memory or mutable hardware state.
 */
int spaghetti_capabilities_get(struct spaghetti_capabilities *out);

/**
 * @brief Test whether every requested build capability is present.
 *
 * @param[in] required Capability bitmask copied by value. Zero is supported.
 *
 * @return true when every bit in @p required is compiled and board-backed.
 * @return false when at least one requested bit is unavailable or unknown.
 */
bool spaghetti_capabilities_support(uint32_t required);

#endif /* SPAGHETTI_CAPABILITIES_H */
