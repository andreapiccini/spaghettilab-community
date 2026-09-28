#include <spaghetti/protocol.h>

#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

#include <spaghetti/access_control.h>
#include <spaghetti/ble.h>
#include <spaghetti/capabilities.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/ota.h>
#include <spaghetti/remote_console.h>
#include <spaghetti/update.h>
#include <spaghetti/wifi_profiles.h>

#include "../communication_internal.h"

#ifndef CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS
#define CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS 5000
#endif

#ifndef CONFIG_SPAGHETTI_BLE_WIFI_HANDOVER_ASSOC_WAIT_MS
#define CONFIG_SPAGHETTI_BLE_WIFI_HANDOVER_ASSOC_WAIT_MS 5000
#endif

#ifndef CONFIG_SPAGHETTI_OTA_PORT
#define CONFIG_SPAGHETTI_OTA_PORT 1337
#endif

#ifndef CONFIG_SPAGHETTI_REMOTE_CONSOLE_PORT
#define CONFIG_SPAGHETTI_REMOTE_CONSOLE_PORT 1338
#endif

#define SPAGHETTI_HANDOVER_ADDR_SIZE 16U

static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.protocol.connectivity",
	.version = 1U,
	.fields = NULL,
	.field_count = 0U,
};

static uint32_t handover_assoc_wait_ms =
	CONFIG_SPAGHETTI_BLE_WIFI_HANDOVER_ASSOC_WAIT_MS;

void spaghetti_connectivity_handover_set_assoc_wait_ms(uint32_t ms)
{
	handover_assoc_wait_ms = (ms == 0U) ? 1U : ms;
}

enum spaghetti_handover_kind {
	SPAGHETTI_HANDOVER_LEASE = 0,
	SPAGHETTI_HANDOVER_NETWORK_MAINTENANCE,
	SPAGHETTI_HANDOVER_WIFI_UPDATE,
};

static int require_ble_handover_session(
	const struct spaghetti_request_context *context)
{
	int err;

	if (context == NULL) {
		return -EINVAL;
	}
	/*
	 * Intended for the BLE adapter. Local Shell may still invoke these ops
	 * for debug when policy already authorized the principal. Unit tests
	 * install the BLE auth hook instead of a live peer.
	 */
	if (context->local) {
		return 0;
	}
	err = spaghetti_ble_principal_is_authenticated(context->principal_id);
	if (err == 0) {
		return 0;
	}
	return err;
}

static int encode_handover_ack(
	struct spaghetti_protocol_payload *response,
	const char *address,
	uint16_t port,
	int64_t deadline_ms,
	uint32_t reached_state)
{
	ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
		       sizeof(response->bytes), 1U);
	const char *addr = (address != NULL) ? address : "0.0.0.0";

	if (!zcbor_map_start_encode(state, 4U) ||
	    !zcbor_uint32_put(state, 0U) ||
	    !zcbor_tstr_put_term(state, addr, SPAGHETTI_HANDOVER_ADDR_SIZE) ||
	    !zcbor_uint32_put(state, 1U) ||
	    !zcbor_uint32_put(state, (uint32_t)port) ||
	    !zcbor_uint32_put(state, 2U) ||
	    !zcbor_int64_put(state, deadline_ms) ||
	    !zcbor_uint32_put(state, 3U) ||
	    !zcbor_uint32_put(state, reached_state) ||
	    !zcbor_map_end_encode(state, 4U)) {
		return -EMSGSIZE;
	}
	response->size = (size_t)(state->payload - response->bytes);
	return 0;
}

static int copy_sta_ipv4(char *out, size_t capacity)
{
	if ((out == NULL) || (capacity == 0U)) {
		return -EINVAL;
	}
	/*
	 * Bound placeholder used when the station address is not yet published
	 * through a dedicated Connectivity helper. Callers still receive port,
	 * deadline, and reached state for the opened service.
	 */
	strncpy(out, "0.0.0.0", capacity - 1U);
	out[capacity - 1U] = '\0';
	return 0;
}

static int session_still_valid(
	const struct spaghetti_request_context *context)
{
	if (context->local) {
		return 0;
	}
	return spaghetti_ble_principal_is_authenticated(context->principal_id);
}

static int wait_wifi_associated(
	const struct spaghetti_request_context *context,
	uint32_t timeout_ms)
{
	const int64_t deadline_ms = k_uptime_get() + timeout_ms;
	struct spaghetti_wifi_profiles_status status;
	int err;

	(void)spaghetti_wifi_profiles_request_connect();

	while (k_uptime_get() <= deadline_ms) {
		err = session_still_valid(context);
		if (err < 0) {
			return -ECONNABORTED;
		}
		err = spaghetti_wifi_profiles_get_status(&status);
		if (err < 0) {
			return err;
		}
		if (status.state == SPAGHETTI_WIFI_PROFILES_CONNECTED) {
			return 0;
		}
		if (status.state == SPAGHETTI_WIFI_PROFILES_ERROR) {
			return (status.last_error < 0) ? status.last_error :
							 -ECONNREFUSED;
		}
		if (status.state == SPAGHETTI_WIFI_PROFILES_IDLE) {
			return -ENETUNREACH;
		}
		k_sleep(K_MSEC(20));
	}
	return -ETIMEDOUT;
}

static void rollback_handover(bool lease_held, bool ota_opened,
			      bool console_opened_extra)
{
	if (ota_opened) {
		(void)spaghetti_ota_cancel();
	}
	if (console_opened_extra) {
		(void)spaghetti_remote_console_stop(
			K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
	}
	if (lease_held) {
		(void)spaghetti_connectivity_release_lease();
	}
}

static void maybe_request_minimal_disconnect(
	const struct spaghetti_request_context *context)
{
	struct spaghetti_capabilities caps;

	if (spaghetti_capabilities_get(&caps) < 0) {
		return;
	}
	if (caps.resource_profile != SPAGHETTI_RESOURCE_PROFILE_MINIMAL) {
		return;
	}
	if (context->local) {
		return;
	}
	spaghetti_ble_wifi_handover_request_disconnect(context->principal_id);
}

static int stop_mqtt_for_workspace(void)
{
	const int err = spaghetti_mqtt_stop(
		K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));

	return ((err == 0) || (err == -EALREADY) || (err == -ENOTSUP) ||
		(err == -EACCES)) ? 0 : err;
}

static int run_wifi_handover(
	const struct spaghetti_request_context *context,
	uint32_t services,
	uint32_t duration_ms,
	enum spaghetti_handover_kind kind,
	struct spaghetti_protocol_payload *response)
{
	struct spaghetti_connectivity_lease_request lease = {
		.services = services,
		.duration_ms = duration_ms,
	};
	struct spaghetti_connectivity_snapshot snap;
	char address[SPAGHETTI_HANDOVER_ADDR_SIZE];
	uint16_t port = 0U;
	uint32_t reached = 0U;
	uint32_t assoc_wait_ms;
	bool lease_held = false;
	bool ota_opened = false;
	int err;

	err = require_ble_handover_session(context);
	if (err < 0) {
		return err;
	}

	if ((services & SPAGHETTI_CONNECTIVITY_SERVICE_WIFI) != 0U) {
		if (!spaghetti_capabilities_support(SPAGHETTI_BUILD_CAP_WIFI)) {
			return -ENOTSUP;
		}
	}
	if (kind == SPAGHETTI_HANDOVER_NETWORK_MAINTENANCE) {
		if (!spaghetti_capabilities_support(
			    SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE)) {
			return -ENOTSUP;
		}
	}
	if (kind == SPAGHETTI_HANDOVER_WIFI_UPDATE) {
		if (!spaghetti_capabilities_support(
			    SPAGHETTI_BUILD_CAP_OTA_WIFI)) {
			return -ENOTSUP;
		}
	}

	err = spaghetti_connectivity_acquire_lease(&lease);
	if (err < 0) {
		return err;
	}
	lease_held = true;

	assoc_wait_ms = handover_assoc_wait_ms;
	if (assoc_wait_ms > duration_ms) {
		assoc_wait_ms = duration_ms;
	}

	if ((services & SPAGHETTI_CONNECTIVITY_SERVICE_WIFI) != 0U) {
		err = wait_wifi_associated(context, assoc_wait_ms);
		if (err < 0) {
			rollback_handover(lease_held, false, false);
			return err;
		}
	}

	if ((kind == SPAGHETTI_HANDOVER_NETWORK_MAINTENANCE) ||
	    (kind == SPAGHETTI_HANDOVER_WIFI_UPDATE)) {
		err = stop_mqtt_for_workspace();
		if (err < 0) {
			rollback_handover(lease_held, false, false);
			return err;
		}
	}

	if (kind == SPAGHETTI_HANDOVER_WIFI_UPDATE) {
		err = spaghetti_ota_arm(duration_ms);
		if (err < 0) {
			rollback_handover(lease_held, false, false);
			return err;
		}
		ota_opened = true;
		err = spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UDP);
		if (err < 0) {
			rollback_handover(lease_held, ota_opened, false);
			return err;
		}
	}

	err = spaghetti_connectivity_get_snapshot(&snap);
	if (err < 0) {
		rollback_handover(lease_held, ota_opened, false);
		return err;
	}
	if ((snap.leased_services == 0U) ||
	    (snap.lease_expires_at_ms <= k_uptime_get())) {
		rollback_handover(lease_held, ota_opened, false);
		return -ETIMEDOUT;
	}

	(void)copy_sta_ipv4(address, sizeof(address));
	reached = snap.active_services;

	if (kind == SPAGHETTI_HANDOVER_WIFI_UPDATE) {
		struct spaghetti_ota_status ota_status;

		err = spaghetti_ota_get_status(&ota_status);
		if (err < 0) {
			rollback_handover(lease_held, ota_opened, false);
			return err;
		}
		port = ota_status.port;
		if (port == 0U) {
			port = (uint16_t)CONFIG_SPAGHETTI_OTA_PORT;
		}
		reached = (uint32_t)ota_status.state;
	} else if (kind == SPAGHETTI_HANDOVER_NETWORK_MAINTENANCE) {
		struct spaghetti_remote_console_status console_status;

		err = spaghetti_remote_console_get_status(&console_status);
		if (err < 0) {
			rollback_handover(lease_held, false, false);
			return err;
		}
		port = console_status.port;
		if (port == 0U) {
			port = (uint16_t)CONFIG_SPAGHETTI_REMOTE_CONSOLE_PORT;
		}
		reached = (uint32_t)console_status.state;
	}

	err = encode_handover_ack(response, address, port,
				  snap.lease_expires_at_ms, reached);
	if (err < 0) {
		rollback_handover(lease_held, ota_opened, false);
		return err;
	}

	maybe_request_minimal_disconnect(context);
	return 0;
}

static int execute_get_connectivity_status(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	struct spaghetti_connectivity_snapshot snap;
	int err;

	ARG_UNUSED(context);
	ARG_UNUSED(request);
	err = spaghetti_connectivity_get_snapshot(&snap);
	if (err < 0) {
		return err;
	}
	{
		ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
			       sizeof(response->bytes), 1U);

		if (!zcbor_map_start_encode(state, 5U) ||
		    !zcbor_uint32_put(state, 0U) ||
		    !zcbor_uint32_put(state, (uint32_t)snap.policy) ||
		    !zcbor_uint32_put(state, 1U) ||
		    !zcbor_uint32_put(state, snap.active_services) ||
		    !zcbor_uint32_put(state, 2U) ||
		    !zcbor_uint32_put(state, snap.leased_services) ||
		    !zcbor_uint32_put(state, 3U) ||
		    !zcbor_int64_put(state, snap.lease_expires_at_ms) ||
		    !zcbor_uint32_put(state, 4U) ||
		    !zcbor_int32_put(state, snap.last_error) ||
		    !zcbor_map_end_encode(state, 5U)) {
			return -EMSGSIZE;
		}
		response->size = (size_t)(state->payload - response->bytes);
	}
	return 0;
}

static int execute_acquire_lease(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t services = 0U;
	uint32_t duration_ms = 0U;
	int err;

	err = spaghetti_ops_decode_u32(request, 0U, &services);
	if (err < 0) {
		return err;
	}
	err = spaghetti_ops_decode_u32(request, 1U, &duration_ms);
	if (err < 0) {
		return err;
	}
	/*
	 * Generic lease enables only the requested connectivity services and
	 * never arms Update or implies a remote console session unless the
	 * REMOTE_CONSOLE bit is explicitly requested by the peer.
	 */
	return run_wifi_handover(context, services, duration_ms,
				 SPAGHETTI_HANDOVER_LEASE, response);
}

static int execute_release_lease(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	int err;

	ARG_UNUSED(request);
	err = require_ble_handover_session(context);
	if (err < 0) {
		return err;
	}
	err = spaghetti_connectivity_release_lease();
	if (err < 0) {
		return err;
	}
	return spaghetti_ops_encode_empty_map(response);
}

static int execute_open_network_maintenance(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t duration_ms = 0U;
	int err;

	err = spaghetti_ops_decode_u32(request, 0U, &duration_ms);
	if (err < 0) {
		return err;
	}
	return run_wifi_handover(
		context,
		SPAGHETTI_CONNECTIVITY_SERVICE_WIFI |
			SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE,
		duration_ms,
		SPAGHETTI_HANDOVER_NETWORK_MAINTENANCE,
		response);
}

static int execute_open_wifi_update(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	uint32_t duration_ms = 0U;
	int err;

	err = spaghetti_ops_decode_u32(request, 0U, &duration_ms);
	if (err < 0) {
		err = spaghetti_ops_decode_optional_u32(request, 0U, 60000U,
							&duration_ms);
		if (err < 0) {
			return err;
		}
	}
	return run_wifi_handover(context,
				 SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
				 duration_ms,
				 SPAGHETTI_HANDOVER_WIFI_UPDATE,
				 response);
}

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_get_connectivity_status) = {
	.operation = SPAGHETTI_PROTOCOL_GET_CONNECTIVITY_STATUS,
	.required_permissions = SPAGHETTI_PERMISSION_READ,
	.execution = SPAGHETTI_OPERATION_IMMEDIATE_READ,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_get_connectivity_status,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_acquire_connectivity_lease) = {
	.operation = SPAGHETTI_PROTOCOL_ACQUIRE_CONNECTIVITY_LEASE,
	.required_permissions = SPAGHETTI_PERMISSION_DISCOVER,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_acquire_lease,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_release_connectivity_lease) = {
	.operation = SPAGHETTI_PROTOCOL_RELEASE_CONNECTIVITY_LEASE,
	.required_permissions = SPAGHETTI_PERMISSION_COMMAND,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_release_lease,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_open_network_maintenance) = {
	.operation = SPAGHETTI_PROTOCOL_OPEN_NETWORK_MAINTENANCE,
	.required_permissions = SPAGHETTI_PERMISSION_CONFIGURE,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_open_network_maintenance,
};

SPAGHETTI_OPERATION_HANDLER_DEFINE(op_open_wifi_update) = {
	.operation = SPAGHETTI_PROTOCOL_OPEN_WIFI_UPDATE,
	.required_permissions = SPAGHETTI_PERMISSION_UPDATE,
	.execution = SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	.request_schema = &empty_schema,
	.response_schema = &empty_schema,
	.execute = execute_open_wifi_update,
};
