#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/ble.h>
#include <spaghetti/capabilities.h>
#include <spaghetti/communication.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/core.h>
#include <spaghetti/health.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/ota.h>
#include <spaghetti/protocol.h>
#include <spaghetti/remote_console.h>
#include <spaghetti/update.h>
#include <spaghetti/wifi_profiles.h>

#include "communication_internal.h"
#include "connectivity_internal.h"

#define TEST_PRINCIPAL ((spaghetti_principal_id_t)9U)
#define TEST_LEASE_MS 200U

static enum spaghetti_wifi_profiles_state wifi_state =
	SPAGHETTI_WIFI_PROFILES_CONNECTED;
static int wifi_last_error;
static int wifi_request_connect_calls;
static int mqtt_stop_calls;
static int ota_arm_calls;
static int ota_cancel_calls;
static int update_begin_calls;
static int remote_console_start_calls;
static int next_ota_arm_error;
static int next_update_begin_error;
static enum spaghetti_resource_profile resource_profile =
	SPAGHETTI_RESOURCE_PROFILE_STANDARD;
static uint32_t build_capabilities =
	SPAGHETTI_BUILD_CAP_BLE |
	SPAGHETTI_BUILD_CAP_WIFI |
	SPAGHETTI_BUILD_CAP_MQTT |
	SPAGHETTI_BUILD_CAP_OTA_WIFI |
	SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE;
static spaghetti_principal_id_t ble_auth_principal;
static bool ble_auth_forced_absent;
static uint32_t physical_services;
static enum spaghetti_connectivity_service failed_start_service;
static int authorize_error;
static uint32_t last_required_permissions;

static int fake_start(enum spaghetti_connectivity_service service)
{
	if (service == failed_start_service) {
		return -EIO;
	}
	physical_services |= (uint32_t)service;
	if (service == SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE) {
		++remote_console_start_calls;
	}
	return 0;
}

static int fake_stop(enum spaghetti_connectivity_service service)
{
	physical_services &= ~(uint32_t)service;
	return 0;
}

static void reset_fakes(void)
{
	wifi_state = SPAGHETTI_WIFI_PROFILES_CONNECTED;
	wifi_last_error = 0;
	wifi_request_connect_calls = 0;
	mqtt_stop_calls = 0;
	ota_arm_calls = 0;
	ota_cancel_calls = 0;
	update_begin_calls = 0;
	remote_console_start_calls = 0;
	next_ota_arm_error = 0;
	next_update_begin_error = 0;
	resource_profile = SPAGHETTI_RESOURCE_PROFILE_STANDARD;
	build_capabilities = SPAGHETTI_BUILD_CAP_BLE |
		SPAGHETTI_BUILD_CAP_WIFI |
		SPAGHETTI_BUILD_CAP_MQTT |
		SPAGHETTI_BUILD_CAP_OTA_WIFI |
		SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE;
	ble_auth_principal = TEST_PRINCIPAL;
	ble_auth_forced_absent = false;
	physical_services = 0U;
	failed_start_service = 0;
	authorize_error = 0;
	last_required_permissions = 0U;
	spaghetti_ble_wifi_handover_set_test_authenticated(TEST_PRINCIPAL);
	(void)spaghetti_ble_wifi_handover_take_pending_disconnect(NULL);
	spaghetti_connectivity_handover_set_assoc_wait_ms(80U);
}

int spaghetti_communication_shell_init(void)
{
	return 0;
}

uint32_t spaghetti_communication_shell_permissions(
	enum spaghetti_core_mode mode)
{
	ARG_UNUSED(mode);
	return UINT32_MAX;
}

uint32_t spaghetti_communication_remote_console_permissions(void)
{
	return UINT32_MAX;
}

int spaghetti_health_heartbeat(spaghetti_health_component_id_t id)
{
	ARG_UNUSED(id);
	return 0;
}

int spaghetti_principal_authorize(
	spaghetti_principal_id_t id,
	uint32_t required_permissions)
{
	last_required_permissions = required_permissions;
	if (id == 0U) {
		return -EINVAL;
	}
	return authorize_error;
}

int spaghetti_audit_record(
	spaghetti_principal_id_t principal_id,
	uint16_t operation_id,
	int internal_result)
{
	ARG_UNUSED(principal_id);
	ARG_UNUSED(operation_id);
	ARG_UNUSED(internal_result);
	return 0;
}

int spaghetti_capabilities_get(struct spaghetti_capabilities *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_capabilities) {
		.resource_profile = resource_profile,
		.build_capabilities = build_capabilities,
		.max_protocol_payload = SPAGHETTI_PROTOCOL_PAYLOAD_MAX,
		.max_inflight_requests = 4U,
		.replay_window_ms = 1000U,
		.core_variant = "native-sim",
	};
	return 0;
}

bool spaghetti_capabilities_support(uint32_t required)
{
	return (build_capabilities & required) == required;
}

int spaghetti_ble_principal_is_authenticated(
	spaghetti_principal_id_t principal_id)
{
	if (principal_id == 0U) {
		return -EINVAL;
	}
	if (ble_auth_forced_absent) {
		return -ENOENT;
	}
	if (ble_auth_principal == principal_id) {
		return 0;
	}
	return -ENOENT;
}

void spaghetti_ble_wifi_handover_set_test_authenticated(
	spaghetti_principal_id_t principal_id)
{
	ble_auth_principal = principal_id;
}

static spaghetti_principal_id_t pending_disconnect_principal;
static bool pending_disconnect;

void spaghetti_ble_wifi_handover_request_disconnect(
	spaghetti_principal_id_t principal_id)
{
	pending_disconnect_principal = principal_id;
	pending_disconnect = (principal_id != 0U);
}

bool spaghetti_ble_wifi_handover_take_pending_disconnect(
	spaghetti_principal_id_t *out_principal)
{
	const bool pending = pending_disconnect;

	if (pending) {
		if (out_principal != NULL) {
			*out_principal = pending_disconnect_principal;
		}
		pending_disconnect = false;
		pending_disconnect_principal = 0U;
	}
	return pending;
}

int spaghetti_wifi_profiles_request_connect(void)
{
	++wifi_request_connect_calls;
	return 0;
}

int spaghetti_wifi_profiles_get_status(
	struct spaghetti_wifi_profiles_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_wifi_profiles_status) {
		.state = wifi_state,
		.last_error = wifi_last_error,
	};
	return 0;
}

int spaghetti_mqtt_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	++mqtt_stop_calls;
	return 0;
}

int spaghetti_ota_arm(uint32_t timeout_ms)
{
	ARG_UNUSED(timeout_ms);
	++ota_arm_calls;
	return next_ota_arm_error;
}

int spaghetti_ota_cancel(void)
{
	++ota_cancel_calls;
	return 0;
}

int spaghetti_ota_get_status(struct spaghetti_ota_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_ota_status) {
		.state = SPAGHETTI_OTA_ARMED,
		.port = 1337U,
		.credentials_present = true,
	};
	return 0;
}

int spaghetti_update_begin(enum spaghetti_update_transport transport)
{
	zassert_equal(transport, SPAGHETTI_UPDATE_TRANSPORT_UDP);
	++update_begin_calls;
	return next_update_begin_error;
}

int spaghetti_update_cancel(void)
{
	return 0;
}

int spaghetti_remote_console_get_status(
	struct spaghetti_remote_console_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_remote_console_status) {
		.state = SPAGHETTI_REMOTE_CONSOLE_LISTENING,
		.port = 1338U,
		.credentials_present = true,
	};
	return 0;
}

int spaghetti_remote_console_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return 0;
}

static struct spaghetti_request_context make_ble_context(uint32_t permissions)
{
	return (struct spaghetti_request_context) {
		.principal_id = TEST_PRINCIPAL,
		.permissions = permissions,
		.local = false,
		.core_mode = SPAGHETTI_CORE_MODE_NORMAL,
	};
}

static int encode_u32_pair(struct spaghetti_protocol_payload *out,
			   uint32_t a, uint32_t b)
{
	ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, out->bytes,
		       sizeof(out->bytes), 1U);

	if (!zcbor_map_start_encode(state, 2U) ||
	    !zcbor_uint32_put(state, 0U) ||
	    !zcbor_uint32_put(state, a) ||
	    !zcbor_uint32_put(state, 1U) ||
	    !zcbor_uint32_put(state, b) ||
	    !zcbor_map_end_encode(state, 2U)) {
		return -EMSGSIZE;
	}
	out->size = (size_t)(state->payload - out->bytes);
	return 0;
}

static int encode_duration(struct spaghetti_protocol_payload *out,
			   uint32_t duration_ms)
{
	ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, out->bytes,
		       sizeof(out->bytes), 1U);

	if (!zcbor_map_start_encode(state, 1U) ||
	    !zcbor_uint32_put(state, 0U) ||
	    !zcbor_uint32_put(state, duration_ms) ||
	    !zcbor_map_end_encode(state, 1U)) {
		return -EMSGSIZE;
	}
	out->size = (size_t)(state->payload - out->bytes);
	return 0;
}

static void ensure_communication(void)
{
	const int err = spaghetti_communication_init();

	zassert_true((err == 0) || (err == -EALREADY));
}

static void handover_before(void *fixture)
{
	static const struct spaghetti_connectivity_backend backend = {
		.start = fake_start,
		.stop = fake_stop,
	};

	ARG_UNUSED(fixture);
	reset_fakes();
	spaghetti_connectivity_backend_reset();
	zassert_ok(spaghetti_connectivity_backend_install(&backend));
	zassert_ok(spaghetti_connectivity_init(
		SPAGHETTI_CONNECTIVITY_LOW_ENERGY));
	ensure_communication();
}

static void handover_after(void *fixture)
{
	ARG_UNUSED(fixture);
	(void)spaghetti_connectivity_release_lease();
	spaghetti_connectivity_backend_reset();
	(void)spaghetti_ble_wifi_handover_take_pending_disconnect(NULL);
}

ZTEST(ble_wifi_handover, test_generic_wifi_lease_does_not_open_ota_or_console)
{
	struct spaghetti_request_context context =
		make_ble_context(SPAGHETTI_PERMISSION_DISCOVER);
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 1U,
		.operation = SPAGHETTI_PROTOCOL_ACQUIRE_CONNECTIVITY_LEASE,
	};
	struct spaghetti_protocol_response response;

	zassert_ok(encode_u32_pair(&request.payload,
				   SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
				   TEST_LEASE_MS));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
	zassert_equal(last_required_permissions, SPAGHETTI_PERMISSION_DISCOVER);
	zassert_equal(ota_arm_calls, 0);
	zassert_equal(remote_console_start_calls, 0);
	zassert_equal(mqtt_stop_calls, 0);
	zassert_true((physical_services &
		      SPAGHETTI_CONNECTIVITY_SERVICE_WIFI) != 0U);
	zassert_true((physical_services &
		      SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE) == 0U);
}

ZTEST(ble_wifi_handover, test_open_wifi_update_stops_mqtt_and_returns_port)
{
	struct spaghetti_request_context context =
		make_ble_context(SPAGHETTI_PERMISSION_UPDATE);
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 2U,
		.operation = SPAGHETTI_PROTOCOL_OPEN_WIFI_UPDATE,
	};
	struct spaghetti_protocol_response response;

	zassert_ok(encode_duration(&request.payload, TEST_LEASE_MS));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
	zassert_equal(last_required_permissions, SPAGHETTI_PERMISSION_UPDATE);
	zassert_equal(mqtt_stop_calls, 1);
	zassert_equal(ota_arm_calls, 1);
	zassert_equal(update_begin_calls, 1);
	zassert_true(response.payload.size > 0U);
}

ZTEST(ble_wifi_handover, test_network_absent_and_bad_credential)
{
	struct spaghetti_request_context context =
		make_ble_context(SPAGHETTI_PERMISSION_DISCOVER);
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 3U,
		.operation = SPAGHETTI_PROTOCOL_ACQUIRE_CONNECTIVITY_LEASE,
	};
	struct spaghetti_protocol_response response;

	wifi_state = SPAGHETTI_WIFI_PROFILES_IDLE;
	zassert_ok(encode_u32_pair(&request.payload,
				   SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
				   TEST_LEASE_MS));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_not_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
	zassert_true((physical_services &
		      SPAGHETTI_CONNECTIVITY_SERVICE_WIFI) == 0U);

	wifi_state = SPAGHETTI_WIFI_PROFILES_ERROR;
	wifi_last_error = -EACCES;
	request.correlation_id = 4U;
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_not_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
}

ZTEST(ble_wifi_handover, test_association_timeout_restores_low_energy)
{
	struct spaghetti_request_context context =
		make_ble_context(SPAGHETTI_PERMISSION_DISCOVER);
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 5U,
		.operation = SPAGHETTI_PROTOCOL_ACQUIRE_CONNECTIVITY_LEASE,
	};
	struct spaghetti_protocol_response response;
	struct spaghetti_connectivity_snapshot snap;

	wifi_state = SPAGHETTI_WIFI_PROFILES_CONNECTING;
	spaghetti_connectivity_handover_set_assoc_wait_ms(40U);
	zassert_ok(encode_u32_pair(&request.payload,
				   SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
				   TEST_LEASE_MS));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_not_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
	zassert_ok(spaghetti_connectivity_get_snapshot(&snap));
	zassert_equal(snap.policy, SPAGHETTI_CONNECTIVITY_LOW_ENERGY);
	zassert_equal(snap.leased_services, 0U);
	zassert_equal(snap.active_services, SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
}

ZTEST(ble_wifi_handover, test_lease_expiry_restores_low_energy)
{
	struct spaghetti_request_context context =
		make_ble_context(SPAGHETTI_PERMISSION_DISCOVER);
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 6U,
		.operation = SPAGHETTI_PROTOCOL_ACQUIRE_CONNECTIVITY_LEASE,
	};
	struct spaghetti_protocol_response response;
	struct spaghetti_connectivity_snapshot snap;

	zassert_ok(encode_u32_pair(&request.payload,
				   SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
				   30U));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
	k_sleep(K_MSEC(60));
	zassert_ok(spaghetti_connectivity_get_snapshot(&snap));
	zassert_equal(snap.leased_services, 0U);
	zassert_equal(snap.active_services, SPAGHETTI_CONNECTIVITY_SERVICE_BLE);
	zassert_equal(snap.policy, SPAGHETTI_CONNECTIVITY_LOW_ENERGY);
}

ZTEST(ble_wifi_handover, test_ble_lost_before_ack_and_after_ack)
{
	struct spaghetti_request_context context =
		make_ble_context(SPAGHETTI_PERMISSION_UPDATE);
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 7U,
		.operation = SPAGHETTI_PROTOCOL_OPEN_WIFI_UPDATE,
	};
	struct spaghetti_protocol_response response;
	spaghetti_principal_id_t disconnect_principal = 0U;

	wifi_state = SPAGHETTI_WIFI_PROFILES_CONNECTING;
	ble_auth_forced_absent = true;
	spaghetti_connectivity_handover_set_assoc_wait_ms(60U);
	zassert_ok(encode_duration(&request.payload, TEST_LEASE_MS));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_not_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
	zassert_equal(ota_arm_calls, 0);

	ble_auth_forced_absent = false;
	wifi_state = SPAGHETTI_WIFI_PROFILES_CONNECTED;
	resource_profile = SPAGHETTI_RESOURCE_PROFILE_MINIMAL;
	request.correlation_id = 8U;
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
	zassert_true(spaghetti_ble_wifi_handover_take_pending_disconnect(
		&disconnect_principal));
	zassert_equal(disconnect_principal, TEST_PRINCIPAL);
}

ZTEST(ble_wifi_handover, test_ota_owned_by_other_transport_is_busy)
{
	struct spaghetti_request_context context =
		make_ble_context(SPAGHETTI_PERMISSION_UPDATE);
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 9U,
		.operation = SPAGHETTI_PROTOCOL_OPEN_WIFI_UPDATE,
	};
	struct spaghetti_protocol_response response;
	struct spaghetti_connectivity_snapshot snap;

	next_ota_arm_error = -EBUSY;
	zassert_ok(encode_duration(&request.payload, TEST_LEASE_MS));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_not_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
	zassert_equal(ota_cancel_calls, 0);
	zassert_ok(spaghetti_connectivity_get_snapshot(&snap));
	zassert_equal(snap.leased_services, 0U);
}

ZTEST(ble_wifi_handover, test_permissions_are_distinct)
{
	struct spaghetti_request_context context =
		make_ble_context(UINT32_MAX);
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 10U,
	};
	struct spaghetti_protocol_response response;

	request.operation = SPAGHETTI_PROTOCOL_ACQUIRE_CONNECTIVITY_LEASE;
	zassert_ok(encode_u32_pair(&request.payload,
				   SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
				   TEST_LEASE_MS));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(last_required_permissions, SPAGHETTI_PERMISSION_DISCOVER);

	(void)spaghetti_connectivity_release_lease();
	request.operation = SPAGHETTI_PROTOCOL_RELEASE_CONNECTIVITY_LEASE;
	request.correlation_id = 11U;
	request.payload.size = 0U;
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(last_required_permissions, SPAGHETTI_PERMISSION_COMMAND);

	request.operation = SPAGHETTI_PROTOCOL_OPEN_NETWORK_MAINTENANCE;
	request.correlation_id = 12U;
	zassert_ok(encode_duration(&request.payload, TEST_LEASE_MS));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(last_required_permissions, SPAGHETTI_PERMISSION_CONFIGURE);
	zassert_equal(mqtt_stop_calls, 1);
	zassert_true(remote_console_start_calls > 0);

	(void)spaghetti_connectivity_release_lease();
	request.operation = SPAGHETTI_PROTOCOL_OPEN_WIFI_UPDATE;
	request.correlation_id = 13U;
	zassert_ok(encode_duration(&request.payload, TEST_LEASE_MS));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(last_required_permissions, SPAGHETTI_PERMISSION_UPDATE);
}

ZTEST_SUITE(ble_wifi_handover, NULL, NULL, handover_before, handover_after,
	    NULL);
