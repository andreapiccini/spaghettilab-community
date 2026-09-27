#include <errno.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/capabilities.h>

static enum spaghetti_resource_profile expected_profile(void)
{
#if defined(CONFIG_SPAGHETTI_RESOURCE_PROFILE_MINIMAL)
	return SPAGHETTI_RESOURCE_PROFILE_MINIMAL;
#elif defined(CONFIG_SPAGHETTI_RESOURCE_PROFILE_STANDARD)
	return SPAGHETTI_RESOURCE_PROFILE_STANDARD;
#else
	return SPAGHETTI_RESOURCE_PROFILE_EXTENDED;
#endif
}

static uint32_t expected_capabilities(void)
{
	uint32_t expected = 0U;

	if (IS_ENABLED(CONFIG_BT)) {
		expected |= SPAGHETTI_BUILD_CAP_BLE;
	}
	if (IS_ENABLED(CONFIG_WIFI)) {
		expected |= SPAGHETTI_BUILD_CAP_WIFI;
	}
	if (IS_ENABLED(CONFIG_MQTT_LIB)) {
		expected |= SPAGHETTI_BUILD_CAP_MQTT;
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_OTA_BLE)) {
		expected |= SPAGHETTI_BUILD_CAP_OTA_BLE;
	}
	if (IS_ENABLED(CONFIG_WIFI) &&
	    IS_ENABLED(CONFIG_NET_SOCKETS_ENABLE_DTLS)) {
		expected |= SPAGHETTI_BUILD_CAP_OTA_WIFI;
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_REMOTE_CONSOLE)) {
		expected |= SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE;
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_HAS_EXTERNAL_RAM)) {
		expected |= SPAGHETTI_BUILD_CAP_EXTERNAL_RAM;
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_RUNTIME_PORT_MUX)) {
		expected |= SPAGHETTI_BUILD_CAP_RUNTIME_PORT_MUX;
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_POWER)) {
		expected |= SPAGHETTI_BUILD_CAP_POWER_SWITCHING;
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_POWER_MEASUREMENT)) {
		expected |= SPAGHETTI_BUILD_CAP_POWER_MEASUREMENT;
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN)) {
		expected |= SPAGHETTI_BUILD_CAP_OTA_CAN;
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_FIELD_UPDATE_ESPNOW)) {
		expected |= SPAGHETTI_BUILD_CAP_OTA_ESPNOW;
	}
	return expected;
}

ZTEST(capabilities, test_snapshot_matches_build_contract)
{
	struct spaghetti_capabilities snapshot;
	struct spaghetti_capabilities untouched = {
		.max_modules = UINT16_MAX,
	};
	const uint32_t expected = expected_capabilities();

	zassert_equal(spaghetti_capabilities_get(NULL), -EINVAL);
	zassert_equal(untouched.max_modules, UINT16_MAX);
	zassert_ok(spaghetti_capabilities_get(&snapshot));
	zassert_equal(snapshot.resource_profile, expected_profile());
	zassert_equal(snapshot.build_capabilities, expected);
	zassert_equal(snapshot.max_modules, CONFIG_SPAGHETTI_MAX_MODULES);
	zassert_equal(snapshot.max_schedules, CONFIG_SPAGHETTI_MAX_SCHEDULES);
	zassert_equal(snapshot.max_rules, CONFIG_SPAGHETTI_MAX_RULES);
	zassert_equal(snapshot.max_device_profiles,
		      CONFIG_SPAGHETTI_MAX_DEVICE_PROFILES);
	zassert_equal(snapshot.max_profile_operations,
		      CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS);
	zassert_equal(snapshot.max_processing_blocks,
		      CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS);
	zassert_equal(snapshot.max_processing_edges,
		      CONFIG_SPAGHETTI_MAX_PROCESSING_EDGES);
	zassert_equal(snapshot.max_properties_per_set,
		      CONFIG_SPAGHETTI_MAX_PROPERTIES_PER_SET);
	zassert_equal(snapshot.max_protocol_payload,
		      CONFIG_SPAGHETTI_MAX_PROTOCOL_PAYLOAD);
	zassert_equal(snapshot.max_record_queue,
		      CONFIG_SPAGHETTI_MAX_RECORD_QUEUE);
	zassert_equal(snapshot.max_record_consumers,
		      CONFIG_SPAGHETTI_MAX_RECORD_CONSUMERS);
	zassert_equal(snapshot.max_ble_peers,
		      CONFIG_SPAGHETTI_MAX_BLE_PEERS);
	zassert_equal(snapshot.max_principals,
		      CONFIG_SPAGHETTI_MAX_PRINCIPALS);
	zassert_equal(snapshot.max_audit_entries,
		      CONFIG_SPAGHETTI_MAX_AUDIT_ENTRIES);
	zassert_equal(snapshot.max_inflight_requests,
		      CONFIG_SPAGHETTI_MAX_INFLIGHT_REQUESTS);
	zassert_equal(snapshot.max_secure_sessions,
		      CONFIG_SPAGHETTI_MAX_SECURE_SESSIONS);
	zassert_equal(snapshot.max_flows, CONFIG_SPAGHETTI_MAX_FLOWS);
	zassert_equal(snapshot.max_function_bays_per_flow,
		      CONFIG_SPAGHETTI_MAX_FUNCTION_BAYS_PER_FLOW);
	zassert_equal(snapshot.max_power_rails,
		      CONFIG_SPAGHETTI_MAX_POWER_RAILS);
	zassert_equal(snapshot.replay_window_ms,
		      CONFIG_SPAGHETTI_PROTOCOL_REPLAY_WINDOW_MS);
	zassert_equal(strcmp(snapshot.core_variant,
			     CONFIG_SPAGHETTI_CORE_VARIANT), 0);
	zassert_true(spaghetti_capabilities_support(0U));
	zassert_true(spaghetti_capabilities_support(expected));
	zassert_false(spaghetti_capabilities_support(BIT(31)));
}

ZTEST(capabilities, test_profiles_have_distinct_bounded_limits)
{
	struct spaghetti_capabilities snapshot;

	zassert_ok(spaghetti_capabilities_get(&snapshot));
	if (snapshot.resource_profile == SPAGHETTI_RESOURCE_PROFILE_MINIMAL) {
		zassert_equal(snapshot.max_modules, 8U);
		zassert_equal(snapshot.max_secure_sessions, 1U);
		zassert_false(spaghetti_capabilities_support(
			SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE));
	} else if (snapshot.resource_profile ==
		   SPAGHETTI_RESOURCE_PROFILE_STANDARD) {
		zassert_equal(snapshot.max_modules, 16U);
		zassert_equal(snapshot.max_secure_sessions, 1U);
		zassert_true(spaghetti_capabilities_support(
			SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE));
	} else {
		zassert_equal(snapshot.max_modules, 32U);
		zassert_equal(snapshot.max_secure_sessions, 1U);
		zassert_true(spaghetti_capabilities_support(
			SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE));
	}
}

ZTEST_SUITE(capabilities, NULL, NULL, NULL, NULL, NULL);
