#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/reboot.h>
#include <zephyr/ztest.h>

#include <zcbor_common.h>
#include <zcbor_encode.h>

#include <spaghetti/access_control.h>
#include <spaghetti/ble.h>
#include <spaghetti/capabilities.h>
#include <spaghetti/communication.h>
#include <spaghetti/config.h>
#include <spaghetti/config_codec.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/core.h>
#include <spaghetti/device_profile.h>
#include <spaghetti/discovery.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/factory_reset.h>
#include <spaghetti/feature_pack.h>
#include <spaghetti/health.h>
#include <spaghetti/identity.h>
#include <spaghetti/image_manifest.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/ota.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/protocol.h>
#include <spaghetti/remote_console.h>
#include <spaghetti/resources.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/block_registry.h>
#include <spaghetti/storage.h>
#include <spaghetti/topology.h>
#include <spaghetti/update.h>
#include <spaghetti/wifi_profiles.h>

#include "communication_internal.h"

static uint32_t apply_generation = 7U;
static int apply_error;
static int authorize_error;
static uint32_t last_authorized_permissions;
static bool resources_ready = true;

FUNC_NORETURN void sys_reboot(int type)
{
	ARG_UNUSED(type);
	for (;;) {
	}
}

int spaghetti_health_heartbeat(spaghetti_health_component_id_t id)
{
	ARG_UNUSED(id);
	return 0;
}

int spaghetti_health_get_status(struct spaghetti_health_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_health_status) {
		.state = SPAGHETTI_HEALTH_HEALTHY,
	};
	return 0;
}

int spaghetti_principal_authorize(
	spaghetti_principal_id_t id,
	uint32_t required_permissions)
{
	last_authorized_permissions = required_permissions;
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

int spaghetti_audit_get(uint32_t sequence, struct spaghetti_audit_entry *out)
{
	if ((out == NULL) || (sequence == 0U)) {
		return -EINVAL;
	}
	if (sequence > 2U) {
		return -ENOENT;
	}
	*out = (struct spaghetti_audit_entry) {
		.sequence = sequence,
		.principal_id = 1U,
		.operation_id = 3U,
		.internal_result = 0,
		.uptime_ms = 10,
	};
	return 0;
}

int spaghetti_core_get_info(struct spaghetti_core_info *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_core_info) {
		.state = SPAGHETTI_CORE_READY,
		.mode = SPAGHETTI_CORE_MODE_NORMAL,
		.image_state = SPAGHETTI_CORE_IMAGE_CONFIRMED,
		.version = "1.0.0",
	};
	return 0;
}

int spaghetti_identity_get(struct spaghetti_identity *out)
{
	static const uint8_t k_id[SPAGHETTI_DEVICE_ID_SIZE] = {
		0x90, 0x70, 0x69, 0xad, 0x75, 0x48,
	};

	if (out == NULL) {
		return -EINVAL;
	}
	memset(out, 0, sizeof(*out));
	memcpy(out->device_id, k_id, sizeof(k_id));
	(void)strncpy(out->device_name, "test-core",
		      sizeof(out->device_name) - 1U);
	return 0;
}

size_t spaghetti_port_count(void)
{
	return 1U;
}

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	ARG_UNUSED(id);
	return NULL;
}

uint32_t spaghetti_port_capabilities(const struct spaghetti_port *port)
{
	ARG_UNUSED(port);
	return 0U;
}

int spaghetti_module_manager_list_by_port(
	spaghetti_port_id_t port_id,
	struct spaghetti_module_snapshot *out,
	size_t capacity,
	size_t *out_count)
{
	ARG_UNUSED(port_id);
	ARG_UNUSED(out);
	ARG_UNUSED(capacity);
	if (out_count == NULL) {
		return -EINVAL;
	}
	*out_count = 0U;
	return 0;
}

int spaghetti_module_manager_get_by_key(
	spaghetti_module_key_t key,
	struct spaghetti_module_snapshot *out)
{
	if ((key == 0U) || (out == NULL)) {
		return -EINVAL;
	}
	*out = (struct spaghetti_module_snapshot) {
		.id = 1U,
		.key = key,
		.type_id = "relay",
		.state = SPAGHETTI_MODULE_READY,
	};
	return 0;
}

int spaghetti_module_manager_command(
	spaghetti_module_id_t id,
	const struct spaghetti_module_command *command)
{
	ARG_UNUSED(id);
	return (command != NULL) ? 0 : -EINVAL;
}

int spaghetti_config_get_snapshot(
	struct spaghetti_config *out,
	struct spaghetti_config_revision *out_revision)
{
	if ((out == NULL) || (out_revision == NULL)) {
		return -EINVAL;
	}
	*out = (struct spaghetti_config) {
		.version = SPAGHETTI_CONFIG_VERSION,
	};
	out_revision->generation = apply_generation;
	memset(out_revision->sha256, 0x11, sizeof(out_revision->sha256));
	return 0;
}

int spaghetti_config_get_revision(struct spaghetti_config_revision *out_revision)
{
	if (out_revision == NULL) {
		return -EINVAL;
	}
	out_revision->generation = apply_generation;
	memset(out_revision->sha256, 0x11, sizeof(out_revision->sha256));
	return 0;
}

static struct spaghetti_config test_workspace;

struct spaghetti_config *spaghetti_config_acquire_workspace(void)
{
	return &test_workspace;
}

void spaghetti_config_release_workspace(struct spaghetti_config *config)
{
	ARG_UNUSED(config);
}

int spaghetti_config_apply(
	const struct spaghetti_config *candidate,
	uint32_t expected_generation,
	struct spaghetti_config_commit_result *out_result)
{
	if (candidate == NULL) {
		return -EINVAL;
	}
	if (expected_generation != apply_generation) {
		return -ESTALE;
	}
	if (apply_error < 0) {
		return apply_error;
	}
	if (out_result != NULL) {
		*out_result = (struct spaghetti_config_commit_result) {
			.revision = {
				.generation = apply_generation + 1U,
			},
			.changed = true,
		};
		memset(out_result->revision.sha256, 0x22,
		       sizeof(out_result->revision.sha256));
	}
	++apply_generation;
	return 0;
}

int spaghetti_config_validate(
	const struct spaghetti_config *candidate,
	struct spaghetti_config_failure *failure)
{
	ARG_UNUSED(failure);
	return (candidate != NULL) ? 0 : -EINVAL;
}

int spaghetti_config_decode_cbor(const uint8_t *bytes, size_t length,
				 struct spaghetti_config *out)
{
	if ((bytes == NULL) || (length == 0U) || (out == NULL)) {
		return -EINVAL;
	}
	*out = (struct spaghetti_config) {
		.version = SPAGHETTI_CONFIG_VERSION,
	};
	return 0;
}

int spaghetti_config_encode_cbor(
	const struct spaghetti_config *config,
	uint8_t *buffer,
	size_t buffer_capacity,
	size_t *written_size)
{
	if ((config == NULL) || (buffer == NULL) || (written_size == NULL) ||
	    (buffer_capacity == 0U)) {
		return -EINVAL;
	}
	buffer[0] = 0xA1U;
	*written_size = 1U;
	return 0;
}

int spaghetti_capabilities_get(struct spaghetti_capabilities *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_capabilities) {
		.max_protocol_payload = SPAGHETTI_PROTOCOL_PAYLOAD_MAX,
		.max_inflight_requests = CONFIG_SPAGHETTI_MAX_INFLIGHT_REQUESTS,
		.replay_window_ms = CONFIG_SPAGHETTI_PROTOCOL_REPLAY_WINDOW_MS,
		.core_variant = "native-sim",
	};
	return 0;
}

bool spaghetti_capabilities_support(uint32_t required)
{
	ARG_UNUSED(required);
	return true;
}

int spaghetti_connectivity_get_snapshot(
	struct spaghetti_connectivity_snapshot *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_connectivity_snapshot) {
		.policy = SPAGHETTI_CONNECTIVITY_LOW_ENERGY,
		.active_services = SPAGHETTI_CONNECTIVITY_SERVICE_BLE |
				   SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
		.leased_services = SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
		.lease_expires_at_ms = k_uptime_get() + 60000,
	};
	return 0;
}

int spaghetti_connectivity_acquire_lease(
	const struct spaghetti_connectivity_lease_request *request)
{
	return (request != NULL) ? 0 : -EINVAL;
}

int spaghetti_connectivity_release_lease(void)
{
	return 0;
}

int spaghetti_storage_request_maintenance_once(void)
{
	return 0;
}

void spaghetti_factory_reset_set_acting_principal(spaghetti_principal_id_t id)
{
	ARG_UNUSED(id);
}

int spaghetti_factory_reset(uint32_t scope)
{
	return (scope != 0U) ? 0 : -EINVAL;
}

int spaghetti_update_get_status(struct spaghetti_update_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_update_status) {
		.state = SPAGHETTI_UPDATE_IDLE,
	};
	return 0;
}

int spaghetti_update_arm(uint32_t timeout_ms)
{
	return (timeout_ms != 0U) ? 0 : -EINVAL;
}

int spaghetti_update_begin(enum spaghetti_update_transport transport)
{
	ARG_UNUSED(transport);
	return 0;
}

int spaghetti_update_cancel(void)
{
	return 0;
}

int spaghetti_ota_ble_open(
	const struct spaghetti_ble_update_begin *request,
	uint32_t *session_id)
{
	if ((request == NULL) || (session_id == NULL)) {
		return -EINVAL;
	}
	*session_id = 1U;
	return 0;
}

int spaghetti_ota_ble_write(uint32_t session_id, uint32_t offset,
			    const uint8_t *bytes, size_t size)
{
	ARG_UNUSED(session_id);
	ARG_UNUSED(offset);
	ARG_UNUSED(bytes);
	ARG_UNUSED(size);
	return 0;
}

int spaghetti_ota_ble_finish(uint32_t session_id)
{
	ARG_UNUSED(session_id);
	return 0;
}

int spaghetti_ota_ble_cancel(uint32_t session_id)
{
	ARG_UNUSED(session_id);
	return 0;
}

void spaghetti_ota_ble_set_acting_principal(spaghetti_principal_id_t id)
{
	ARG_UNUSED(id);
}

int spaghetti_discovery_list(
	struct spaghetti_discovery_candidate *out,
	size_t capacity,
	size_t *out_count)
{
	ARG_UNUSED(out);
	ARG_UNUSED(capacity);
	if (out_count == NULL) {
		return -EINVAL;
	}
	*out_count = 0U;
	return 0;
}

int spaghetti_discovery_scan_port(
	spaghetti_port_id_t port_id,
	const struct spaghetti_discovery_scan_policy *policy)
{
	ARG_UNUSED(port_id);
	return (policy != NULL) ? 0 : -EINVAL;
}

int spaghetti_discovery_accept(
	spaghetti_discovery_candidate_id_t candidate_id,
	spaghetti_module_key_t key,
	uint32_t expected_generation,
	struct spaghetti_module_config *out_module)
{
	ARG_UNUSED(candidate_id);
	ARG_UNUSED(expected_generation);
	if ((key == 0U) || (out_module == NULL)) {
		return -EINVAL;
	}
	*out_module = (struct spaghetti_module_config) {
		.key = key,
		.type_id = "relay",
	};
	return 0;
}

size_t spaghetti_topology_flow_count(void)
{
	return 0U;
}

const struct spaghetti_flow_descriptor *spaghetti_topology_flow_get(
	spaghetti_flow_id_t id)
{
	ARG_UNUSED(id);
	return NULL;
}

int spaghetti_topology_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_descriptor *out)
{
	ARG_UNUSED(flow_id);
	ARG_UNUSED(bay_id);
	ARG_UNUSED(out);
	return -ENOENT;
}

int spaghetti_power_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_power_descriptor *out)
{
	ARG_UNUSED(flow_id);
	ARG_UNUSED(bay_id);
	ARG_UNUSED(out);
	return -ENOENT;
}

size_t spaghetti_power_rail_count(void)
{
	return 0U;
}

const struct spaghetti_power_rail_descriptor *spaghetti_power_rail_get(
	spaghetti_power_rail_id_t id)
{
	ARG_UNUSED(id);
	return NULL;
}

int spaghetti_resources_get_snapshot(struct spaghetti_resources_snapshot *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	if (!resources_ready) {
		return -EACCES;
	}
	memset(out, 0, sizeof(*out));
	out->modules.capacity = 8U;
	return 0;
}

size_t spaghetti_feature_pack_count(void)
{
	return 0U;
}

int spaghetti_feature_pack_catalog(
	struct spaghetti_feature_pack_catalog_entry *out,
	size_t capacity,
	size_t *out_count)
{
	ARG_UNUSED(out);
	ARG_UNUSED(capacity);
	if (out_count == NULL) {
		return -EINVAL;
	}
	*out_count = 0U;
	return 0;
}

const struct spaghetti_image_manifest *spaghetti_image_manifest_get(void)
{
	return NULL;
}

size_t spaghetti_device_profile_count(void)
{
	return 0U;
}

const struct spaghetti_device_profile *spaghetti_device_profile_get(size_t idx)
{
	ARG_UNUSED(idx);
	return NULL;
}

int spaghetti_device_profile_install(const uint8_t *cbor, size_t size)
{
	return ((cbor != NULL) && (size > 0U)) ? 0 : -EINVAL;
}

int spaghetti_device_profile_remove(const char *id, uint16_t version)
{
	ARG_UNUSED(version);
	return (id != NULL) ? 0 : -EINVAL;
}

size_t spaghetti_driver_registry_count(void)
{
	return 0U;
}

const struct spaghetti_module_driver *spaghetti_driver_registry_get(size_t index)
{
	ARG_UNUSED(index);
	return NULL;
}

size_t spaghetti_rule_registry_count(void)
{
	return 0U;
}

size_t spaghetti_block_registry_count(void)
{
	return 0U;
}

enum spaghetti_maintenance_link_state spaghetti_maintenance_link_get_state(void)
{
	return SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
}

int spaghetti_storage_read_config(struct spaghetti_config *out)
{
	ARG_UNUSED(out);
	return -ENOENT;
}

int spaghetti_storage_write_config(const struct spaghetti_config *config)
{
	return (config != NULL) ? 0 : -EINVAL;
}

int spaghetti_remote_console_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size,
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(psk);
	ARG_UNUSED(psk_size);
	ARG_UNUSED(identity);
	ARG_UNUSED(identity_size);
	ARG_UNUSED(principal_id);
	return 0;
}

int spaghetti_remote_console_clear_credentials(void)
{
	return 0;
}

int spaghetti_remote_console_get_status(
	struct spaghetti_remote_console_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_remote_console_status) {0};
	return 0;
}

void spaghetti_ble_close_peers_for_principal(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
}

int spaghetti_wifi_profiles_set(
	const struct spaghetti_wifi_profile_config *config)
{
	return (config != NULL) ? 0 : -EINVAL;
}

int spaghetti_wifi_profiles_remove(const char *ssid)
{
	return (ssid != NULL) ? 0 : -EINVAL;
}

int spaghetti_wifi_profiles_set_preferred(const char *ssid)
{
	return (ssid != NULL) ? 0 : -EINVAL;
}

int spaghetti_wifi_profiles_clear_preferred(void)
{
	return 0;
}

int spaghetti_wifi_profiles_list(
	struct spaghetti_wifi_profile_summary *out,
	size_t capacity,
	size_t *out_count)
{
	ARG_UNUSED(out);
	ARG_UNUSED(capacity);
	if (out_count == NULL) {
		return -EINVAL;
	}
	*out_count = 0U;
	return 0;
}

int spaghetti_wifi_profiles_scan(
	struct spaghetti_wifi_scan_result *out,
	size_t capacity,
	size_t *out_count)
{
	ARG_UNUSED(out);
	ARG_UNUSED(capacity);
	if (out_count == NULL) {
		return -EINVAL;
	}
	*out_count = 0U;
	return 0;
}

int spaghetti_wifi_profiles_request_connect(void)
{
	return 0;
}

int spaghetti_wifi_profiles_get_status(
	struct spaghetti_wifi_profiles_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_wifi_profiles_status) {
		.state = SPAGHETTI_WIFI_PROFILES_CONNECTED,
	};
	return 0;
}

int spaghetti_ble_principal_is_authenticated(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
	return 0;
}

void spaghetti_ble_wifi_handover_request_disconnect(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
}

int spaghetti_mqtt_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return -EALREADY;
}

int spaghetti_ota_arm(uint32_t timeout_ms)
{
	return (timeout_ms != 0U) ? 0 : -EINVAL;
}

int spaghetti_ota_cancel(void)
{
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
	};
	return 0;
}

int spaghetti_remote_console_start(void)
{
	return 0;
}

int spaghetti_remote_console_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return 0;
}

static struct spaghetti_request_context make_context(uint32_t permissions)
{
	return (struct spaghetti_request_context) {
		.principal_id = SPAGHETTI_PRINCIPAL_MAINTENANCE_ID,
		.permissions = permissions,
		.local = true,
		.core_mode = SPAGHETTI_CORE_MODE_NORMAL,
	};
}

static const uint32_t all_permissions =
	SPAGHETTI_PERMISSION_READ | SPAGHETTI_PERMISSION_CONFIGURE |
	SPAGHETTI_PERMISSION_COMMAND | SPAGHETTI_PERMISSION_DISCOVER |
	SPAGHETTI_PERMISSION_UPDATE | SPAGHETTI_PERMISSION_PROVISION;

ZTEST(protocol, test_status_from_errno_mapping)
{
	zassert_equal(spaghetti_protocol_status_from_errno(0),
		      SPAGHETTI_PROTOCOL_STATUS_OK);
	zassert_equal(spaghetti_protocol_status_from_errno(-EINVAL),
		      SPAGHETTI_PROTOCOL_STATUS_INVALID_ARGUMENT);
	zassert_equal(spaghetti_protocol_status_from_errno(-ENOTSUP),
		      SPAGHETTI_PROTOCOL_STATUS_UNSUPPORTED);
	zassert_equal(spaghetti_protocol_status_from_errno(-EACCES),
		      SPAGHETTI_PROTOCOL_STATUS_UNAUTHORIZED);
	zassert_equal(spaghetti_protocol_status_from_errno(-ESTALE),
		      SPAGHETTI_PROTOCOL_STATUS_CONFLICT);
	zassert_equal(spaghetti_protocol_status_from_errno(-EBUSY),
		      SPAGHETTI_PROTOCOL_STATUS_BUSY);
	zassert_equal(spaghetti_protocol_status_from_errno(-ENODEV),
		      SPAGHETTI_PROTOCOL_STATUS_UNAVAILABLE);
	zassert_equal(spaghetti_protocol_status_from_errno(-ETIMEDOUT),
		      SPAGHETTI_PROTOCOL_STATUS_TIMEOUT);
	zassert_equal(spaghetti_protocol_status_from_errno(-ENOMEM),
		      SPAGHETTI_PROTOCOL_STATUS_RESOURCE_EXHAUSTED);
	zassert_equal(spaghetti_protocol_status_from_errno(-EBADMSG),
		      SPAGHETTI_PROTOCOL_STATUS_MALFORMED_REQUEST);
	zassert_equal(spaghetti_protocol_status_from_errno(-EIO),
		      SPAGHETTI_PROTOCOL_STATUS_INTERNAL_ERROR);
}

ZTEST(protocol, test_envelope_roundtrip_and_rejects)
{
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 42U,
		.operation = SPAGHETTI_PROTOCOL_GET_STATUS,
	};
	struct spaghetti_protocol_request decoded;
	struct spaghetti_protocol_response response = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 42U,
		.status = SPAGHETTI_PROTOCOL_STATUS_OK,
	};
	struct spaghetti_protocol_response decoded_response;
	uint8_t buffer[128];
	size_t written = 0U;
	uint8_t malformed[] = {0xA1, 0x00, 0x01};

	zassert_ok(spaghetti_protocol_encode_request(
		&request, buffer, sizeof(buffer), &written));
	zassert_ok(spaghetti_protocol_decode_request(buffer, written, &decoded));
	zassert_equal(decoded.correlation_id, 42U);
	zassert_equal(decoded.operation, SPAGHETTI_PROTOCOL_GET_STATUS);

	response.payload.size = 1U;
	response.payload.bytes[0] = 0xA0U;
	zassert_ok(spaghetti_protocol_encode_response(
		&response, buffer, sizeof(buffer), &written));
	zassert_ok(spaghetti_protocol_decode_response(
		buffer, written, &decoded_response));
	zassert_equal(decoded_response.correlation_id, 42U);

	request.correlation_id = 0U;
	zassert_equal(spaghetti_protocol_encode_request(
		&request, buffer, sizeof(buffer), &written), -EINVAL);
	zassert_equal(spaghetti_protocol_decode_request(
		malformed, sizeof(malformed), &decoded), -EBADMSG);
}

/**
 * Fixed reference byte vectors for the envelope wire format, published so any
 * out-of-tree codec (e.g. the TypeScript Protocol SDK, see
 * software/roadmap/react-flow-v1/tasks/S021-codec-protocol-types.md) can
 * verify its encoding against a byte sequence this test suite pins down,
 * instead of only checking internal round-trip/determinism as the rest of
 * this file does. Any change to these bytes is a wire-format break.
 *
 * Collections here are indefinite-length (0xBF/0x9F ... 0xFF) — this zcbor
 * build does not use canonical/definite-length encoding for maps or lists,
 * confirmed by running this exact test in native_sim before pinning the
 * vectors below.
 */
ZTEST(protocol, test_envelope_golden_vectors)
{
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 1U,
		.operation = SPAGHETTI_PROTOCOL_GET_STATUS,
	};
	struct spaghetti_protocol_response response = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 1U,
		.status = SPAGHETTI_PROTOCOL_STATUS_OK,
	};
	/* {0:1, 1:1, 2:2, 3:h''} — version=1, correlation_id=1, operation=GET_STATUS(2), empty payload. */
	uint8_t expected_request[] = {0xBF, 0x00, 0x01, 0x01, 0x01, 0x02, 0x02, 0x03, 0x40, 0xFF};
	/* {0:1, 1:1, 2:0, 3:h'A0'} — version=1, correlation_id=1, status=OK(0), payload={0xA0} (one CBOR empty map byte). */
	uint8_t expected_response[] = {0xBF, 0x00, 0x01, 0x01, 0x01, 0x02, 0x00, 0x03, 0x41, 0xA0, 0xFF};
	uint8_t buffer[128];
	size_t written = 0U;

	zassert_ok(spaghetti_protocol_encode_request(
		&request, buffer, sizeof(buffer), &written));
	zassert_equal(written, sizeof(expected_request));
	zassert_mem_equal(buffer, expected_request, written);

	response.payload.size = 1U;
	response.payload.bytes[0] = 0xA0U;
	zassert_ok(spaghetti_protocol_encode_response(
		&response, buffer, sizeof(buffer), &written));
	zassert_equal(written, sizeof(expected_response));
	zassert_mem_equal(buffer, expected_response, written);
}

ZTEST(protocol, test_permission_denied_unknown_op_replay)
{
	struct spaghetti_request_context context = make_context(all_permissions);
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 11U,
		.operation = SPAGHETTI_PROTOCOL_GET_STATUS,
	};
	struct spaghetti_protocol_response response;
	struct spaghetti_protocol_response first;
	uint8_t encoded_req[128];
	uint8_t encoded_a[256];
	uint8_t encoded_b[256];
	uint8_t encoded_c[256];
	size_t written_a = 0U;
	size_t written_b = 0U;
	size_t written_c = 0U;

	{
		const int init_err = spaghetti_communication_init();
		zassert_true((init_err == 0) || (init_err == -EALREADY));
	}

	context.permissions = SPAGHETTI_PERMISSION_READ;
	authorize_error = -EACCES;
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_UNAUTHORIZED);
	zassert_equal(response.correlation_id, 11U);
	authorize_error = 0;

	request.operation = (enum spaghetti_protocol_operation)99;
	zassert_equal(spaghetti_communication_handle_request(
		&context, &request, &response), -ENOTSUP);

	context = make_context(all_permissions);
	request.operation = SPAGHETTI_PROTOCOL_GET_CAPABILITIES;
	request.correlation_id = 12U;
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &first));
	zassert_equal(first.status, SPAGHETTI_PROTOCOL_STATUS_OK);
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(response.status, first.status);
	zassert_equal(response.payload.size, first.payload.size);
	zassert_mem_equal(response.payload.bytes, first.payload.bytes,
			  first.payload.size);

	request.payload.size = 1U;
	request.payload.bytes[0] = 0xA0U;
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_CONFLICT);

	/* Three fake transports produce identical response bytes. */
	request.payload.size = 0U;
	request.correlation_id = 13U;
	zassert_ok(spaghetti_protocol_encode_request(
		&request, encoded_req, sizeof(encoded_req), &written_a));
	ARG_UNUSED(encoded_req);
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_ok(spaghetti_protocol_encode_response(
		&response, encoded_a, sizeof(encoded_a), &written_a));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_ok(spaghetti_protocol_encode_response(
		&response, encoded_b, sizeof(encoded_b), &written_b));
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_ok(spaghetti_protocol_encode_response(
		&response, encoded_c, sizeof(encoded_c), &written_c));
	zassert_equal(written_a, written_b);
	zassert_equal(written_b, written_c);
	zassert_mem_equal(encoded_a, encoded_b, written_a);
	zassert_mem_equal(encoded_b, encoded_c, written_b);
}

ZTEST(protocol, test_config_stale_and_apply)
{
	struct spaghetti_request_context context = make_context(all_permissions);
	{
		const int init_err = spaghetti_communication_init();
		zassert_true((init_err == 0) || (init_err == -EALREADY));
	}
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 21U,
		.operation = SPAGHETTI_PROTOCOL_APPLY_CONFIG,
	};
	struct spaghetti_protocol_response response;
	const uint8_t config_bytes[] = {0xA0};
	ZCBOR_STATE_E(state, 4U, request.payload.bytes,
		       sizeof(request.payload.bytes), 1U);

	zassert_true(zcbor_map_start_encode(state, 2U));
	zassert_true(zcbor_uint32_put(state, 0U));
	zassert_true(zcbor_uint32_put(state, 1U)); /* stale generation */
	zassert_true(zcbor_uint32_put(state, 1U));
	zassert_true(zcbor_bstr_encode_ptr(state, config_bytes, sizeof(config_bytes)));
	zassert_true(zcbor_map_end_encode(state, 2U));
	request.payload.size = (size_t)(state->payload - request.payload.bytes);

	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_CONFLICT);
	zassert_equal(response.correlation_id, 21U);

	{
		ZCBOR_STATE_E(state2, 4U, request.payload.bytes,
			       sizeof(request.payload.bytes), 1U);

		request.correlation_id = 22U;
		zassert_true(zcbor_map_start_encode(state2, 2U));
		zassert_true(zcbor_uint32_put(state2, 0U));
		zassert_true(zcbor_uint32_put(state2, apply_generation));
		zassert_true(zcbor_uint32_put(state2, 1U));
		zassert_true(zcbor_bstr_encode_ptr(state2, config_bytes,
						   sizeof(config_bytes)));
		zassert_true(zcbor_map_end_encode(state2, 2U));
		request.payload.size =
			(size_t)(state2->payload - request.payload.bytes);
	}
	zassert_ok(spaghetti_communication_handle_request(
		&context, &request, &response));
	zassert_equal(response.status, SPAGHETTI_PROTOCOL_STATUS_OK);
}

ZTEST(protocol, test_events_and_max_payload_helper)
{
	struct spaghetti_protocol_payload payload = {0};
	uint8_t buffer[128];
	size_t written = 0U;
	const uint8_t device_id[4] = {1, 2, 3, 4};

	zassert_ok(spaghetti_protocol_encode_status_event_payload(
		device_id, sizeof(device_id), 9U, 1U, 0U, &payload));
	zassert_ok(spaghetti_protocol_encode_event(
		SPAGHETTI_PROTOCOL_EVENT_STATUS, 1U, &payload, buffer,
		sizeof(buffer), &written));
	zassert_true(written > 0U);
	zassert_ok(spaghetti_ops_encode_empty_map(&payload));
}

ZTEST_SUITE(protocol, NULL, NULL, NULL, NULL, NULL);
