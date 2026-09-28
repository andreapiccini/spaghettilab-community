#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/zbus/zbus.h>
#include <zephyr/ztest.h>

#include <spaghetti/access_control.h>
#include <spaghetti/communication.h>
#include <spaghetti/core.h>
#include <spaghetti/data.h>
#include <spaghetti/identity.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/mqtt_credentials.h>
#include <spaghetti/protocol.h>
#include <spaghetti/record_delivery.h>
#include <spaghetti/schema.h>
#include <spaghetti/secure_workspace.h>

#include "mqtt_internal.h"

ZBUS_OBS_DECLARE(record_logger_subscriber);

static bool maintenance_active = true;
static bool principal_enabled = true;
static spaghetti_principal_id_t provisioned_principal = 2U;
static uint32_t principal_permissions =
	SPAGHETTI_PERMISSION_READ | SPAGHETTI_PERMISSION_CONFIGURE |
	SPAGHETTI_PERMISSION_COMMAND | SPAGHETTI_PERMISSION_DISCOVER;
static enum spaghetti_secure_workspace_owner workspace_owner =
	SPAGHETTI_SECURE_OWNER_NONE;
static uint32_t workspace_acquire_count;
static uint32_t workspace_release_count;
static int workspace_acquire_result;
static int stub_connect_result;
static uint32_t handle_request_calls;
static uint32_t last_correlation_id;
static uint32_t last_request_permissions;
static spaghetti_principal_id_t last_request_principal;
static struct spaghetti_protocol_response stub_response;
static bool replay_hit;
static uint32_t replay_correlation;
static spaghetti_principal_id_t replay_principal;
static struct spaghetti_protocol_response replay_response;
static const uint8_t test_device_id[SPAGHETTI_DEVICE_ID_SIZE] = {
	0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
	0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
	0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
	0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
};

enum spaghetti_maintenance_link_state
spaghetti_maintenance_link_get_state(void)
{
	return maintenance_active ? SPAGHETTI_MAINTENANCE_LINK_ACTIVE :
				    SPAGHETTI_MAINTENANCE_LINK_NORMAL;
}

int spaghetti_identity_get(struct spaghetti_identity *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	memset(out, 0, sizeof(*out));
	memcpy(out->device_id, test_device_id, sizeof(test_device_id));
	strcpy(out->device_name, "mqtt-test");
	return 0;
}

int spaghetti_principal_get(
	spaghetti_principal_id_t id,
	struct spaghetti_principal *out)
{
	if ((out == NULL) || (id == 0U)) {
		return -EINVAL;
	}
	if (id != provisioned_principal) {
		return -ENOENT;
	}
	*out = (struct spaghetti_principal) {
		.id = id,
		.role = SPAGHETTI_ROLE_ADMINISTRATOR,
		.permissions = principal_permissions,
		.enabled = principal_enabled,
	};
	strcpy(out->name, "mqtt-peer");
	return 0;
}

int spaghetti_core_get_info(struct spaghetti_core_info *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_core_info) {
		.mode = SPAGHETTI_CORE_MODE_NORMAL,
	};
	return 0;
}

int spaghetti_secure_workspace_acquire(
	enum spaghetti_secure_workspace_owner owner,
	k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	if (workspace_acquire_result < 0) {
		return workspace_acquire_result;
	}
	if (workspace_owner != SPAGHETTI_SECURE_OWNER_NONE) {
		return -EAGAIN;
	}
	workspace_owner = owner;
	++workspace_acquire_count;
	return 0;
}

int spaghetti_secure_workspace_release(
	enum spaghetti_secure_workspace_owner owner)
{
	if (workspace_owner != owner) {
		return -EPERM;
	}
	workspace_owner = SPAGHETTI_SECURE_OWNER_NONE;
	++workspace_release_count;
	return 0;
}

int spaghetti_communication_handle_request(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_request *request,
	struct spaghetti_protocol_response *response)
{
	if ((context == NULL) || (request == NULL) || (response == NULL)) {
		return -EINVAL;
	}

	++handle_request_calls;
	last_request_permissions = context->permissions;
	last_request_principal = context->principal_id;
	last_correlation_id = request->correlation_id;

	if (replay_hit && (request->correlation_id == replay_correlation) &&
	    (context->principal_id == replay_principal)) {
		*response = replay_response;
		return 0;
	}

	*response = stub_response;
	response->correlation_id = request->correlation_id;
	response->version = SPAGHETTI_PROTOCOL_VERSION;
	replay_hit = true;
	replay_correlation = request->correlation_id;
	replay_principal = context->principal_id;
	replay_response = *response;
	return 0;
}

static int stub_connect(void *ctx)
{
	ARG_UNUSED(ctx);
	return stub_connect_result;
}

static void stub_disconnect(void *ctx)
{
	ARG_UNUSED(ctx);
}

static int stub_subscribe(void *ctx, const char *topic)
{
	ARG_UNUSED(ctx);
	ARG_UNUSED(topic);
	return 0;
}

static int stub_publish(void *ctx, const char *topic, const uint8_t *payload,
			size_t payload_size, uint8_t qos, bool retain)
{
	ARG_UNUSED(ctx);
	ARG_UNUSED(topic);
	ARG_UNUSED(payload);
	ARG_UNUSED(payload_size);
	ARG_UNUSED(qos);
	ARG_UNUSED(retain);
	return 0;
}

static int stub_process(void *ctx, int timeout_ms)
{
	ARG_UNUSED(ctx);
	k_sleep(K_MSEC(MIN(timeout_ms, 10)));
	return 0;
}

static void install_stub_transport(void)
{
	static const struct spaghetti_mqtt_test_transport transport = {
		.connect = stub_connect,
		.disconnect = stub_disconnect,
		.subscribe = stub_subscribe,
		.publish = stub_publish,
		.process = stub_process,
		.ctx = NULL,
	};

	stub_connect_result = 0;
	spaghetti_mqtt_test_set_transport(&transport);
}

static struct spaghetti_mqtt_config valid_config(void)
{
	const struct spaghetti_mqtt_config config = {
		.enabled = true,
		.host = "broker.invalid",
		.port = 1883U,
		.base_topic = "spaghetti/test",
		.security = SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT,
		.credential_id = 1U,
	};

	return config;
}

static struct spaghetti_record make_record(void)
{
	struct spaghetti_record record = {
		.source_id = 3U,
		.source_key = 10U,
		.boot_id = 7U,
		.timestamp_ms = 1000,
		.sequence = 4U,
		.payload = {
			.kind = SPAGHETTI_RECORD_SAMPLE,
			.schema_version = 1U,
		},
	};

	strncpy(record.payload.schema_id, "spaghetti.test.sample",
		sizeof(record.payload.schema_id) - 1U);
	return record;
}

static void reset_fakes(void)
{
	maintenance_active = true;
	principal_enabled = true;
	provisioned_principal = 2U;
	principal_permissions =
		SPAGHETTI_PERMISSION_READ | SPAGHETTI_PERMISSION_CONFIGURE |
		SPAGHETTI_PERMISSION_COMMAND | SPAGHETTI_PERMISSION_DISCOVER;
	workspace_owner = SPAGHETTI_SECURE_OWNER_NONE;
	workspace_acquire_count = 0U;
	workspace_release_count = 0U;
	workspace_acquire_result = 0;
	stub_connect_result = 0;
	handle_request_calls = 0U;
	last_correlation_id = 0U;
	last_request_permissions = 0U;
	last_request_principal = 0U;
	replay_hit = false;
	replay_correlation = 0U;
	replay_principal = 0U;
	memset(&stub_response, 0, sizeof(stub_response));
	stub_response.version = SPAGHETTI_PROTOCOL_VERSION;
	stub_response.status = SPAGHETTI_PROTOCOL_STATUS_OK;
	stub_response.payload.size = 1U;
	stub_response.payload.bytes[0] = 0xA0;
	spaghetti_mqtt_test_clear_transport();
	(void)spaghetti_mqtt_credentials_erase_all();
}

static void *mqtt_setup(void)
{
	reset_fakes();
	return NULL;
}

static void mqtt_before(void *f)
{
	ARG_UNUSED(f);
	reset_fakes();
	(void)spaghetti_mqtt_stop(K_SECONDS(1));
}

static void mqtt_after(void *f)
{
	ARG_UNUSED(f);
	(void)spaghetti_mqtt_stop(K_SECONDS(1));
	spaghetti_mqtt_test_clear_transport();
	(void)spaghetti_mqtt_credentials_erase_all();
}

ZTEST(mqtt, test_config_validation_and_plaintext_gate)
{
	struct spaghetti_mqtt_config config = valid_config();

	zassert_equal(spaghetti_mqtt_init(NULL), -EINVAL);
	zassert_ok(spaghetti_mqtt_init(&(struct spaghetti_mqtt_config){0}));

	config = valid_config();
	config.security = SPAGHETTI_MQTT_SECURITY_TLS_SERVER;
	config.credential_id = 0U;
	zassert_equal(spaghetti_mqtt_init(&config), -EINVAL);

	config = valid_config();
	config.credential_id = 0U;
	zassert_equal(spaghetti_mqtt_init(&config), -EINVAL);

	config = valid_config();
	memcpy(config.base_topic, "trailing/", sizeof("trailing/"));
	zassert_equal(spaghetti_mqtt_init(&config), -EINVAL);

	config = valid_config();
	zassert_ok(spaghetti_mqtt_init(&config));
}

ZTEST(mqtt, test_credential_principal_binding)
{
	const uint8_t ca[8] = {1, 2, 3, 4, 5, 6, 7, 8};
	bool exists = true;
	spaghetti_principal_id_t principal_id = 0U;

	maintenance_active = false;
	zassert_equal(spaghetti_mqtt_credentials_set(
			      1U, provisioned_principal, ca, sizeof(ca), NULL,
			      0U, NULL, 0U),
		      -EACCES);

	maintenance_active = true;
	principal_enabled = false;
	zassert_equal(spaghetti_mqtt_credentials_set(
			      1U, provisioned_principal, ca, sizeof(ca), NULL,
			      0U, NULL, 0U),
		      -ENOENT);

	principal_enabled = true;
	zassert_equal(spaghetti_mqtt_credentials_set(
			      1U, 99U, ca, sizeof(ca), NULL, 0U, NULL, 0U),
		      -ENOENT);

	zassert_ok(spaghetti_mqtt_credentials_set(
		1U, provisioned_principal, ca, sizeof(ca), NULL, 0U, NULL,
		0U));
	zassert_ok(spaghetti_mqtt_credentials_exists(1U, &exists));
	zassert_true(exists);
	zassert_ok(spaghetti_mqtt_credentials_resolve_principal(1U,
								&principal_id));
	zassert_equal(principal_id, provisioned_principal);

	principal_enabled = false;
	zassert_equal(spaghetti_mqtt_credentials_resolve_principal(
			      1U, &principal_id),
		      -ENOENT);

	principal_enabled = true;
	zassert_ok(spaghetti_mqtt_credentials_clear(1U));
	zassert_ok(spaghetti_mqtt_credentials_exists(1U, &exists));
	zassert_false(exists);
}

ZTEST(mqtt, test_request_response_correlation_and_replay)
{
	struct spaghetti_mqtt_config config = valid_config();
	struct spaghetti_protocol_request request = {
		.version = SPAGHETTI_PROTOCOL_VERSION,
		.correlation_id = 42U,
		.operation = SPAGHETTI_PROTOCOL_GET_STATUS,
	};
	uint8_t encoded[SPAGHETTI_MQTT_PAYLOAD_SIZE];
	size_t encoded_size = 0U;
	char topic[256];
	uint8_t payload[SPAGHETTI_MQTT_PAYLOAD_SIZE];
	size_t payload_size = 0U;
	uint8_t qos = 0U;
	bool retain = true;
	const uint8_t ca[4] = {9, 9, 9, 9};

	install_stub_transport();
	spaghetti_mqtt_test_set_device_id(test_device_id);
	zassert_ok(spaghetti_mqtt_credentials_set(
		1U, provisioned_principal, ca, sizeof(ca), NULL, 0U, NULL,
		0U));
	zassert_ok(spaghetti_protocol_encode_request(
		&request, encoded, sizeof(encoded), &encoded_size));

	zassert_ok(spaghetti_mqtt_init(&config));
	spaghetti_mqtt_test_set_network_ready(true);
	zassert_ok(spaghetti_mqtt_start());
	zassert_true(spaghetti_mqtt_test_wait_state(SPAGHETTI_MQTT_CONNECTED,
						    K_SECONDS(2)));

	zassert_ok(spaghetti_mqtt_test_inject_request("client-a", encoded,
						      encoded_size));
	for (size_t attempt = 0U; attempt < 50U; ++attempt) {
		if (handle_request_calls >= 1U) {
			break;
		}
		k_sleep(K_MSEC(20));
	}
	zassert_equal(handle_request_calls, 1U);
	zassert_equal(last_correlation_id, 42U);
	zassert_equal(last_request_principal, provisioned_principal);
	zassert_equal(last_request_permissions,
		      spaghetti_mqtt_adapter_permissions() &
			      principal_permissions);

	for (size_t attempt = 0U; attempt < 50U; ++attempt) {
		if (spaghetti_mqtt_test_last_publish(
			    topic, sizeof(topic), payload, sizeof(payload),
			    &payload_size, &qos, &retain) == 0) {
			if (strstr(topic, "/responses/client-a") != NULL) {
				break;
			}
		}
		k_sleep(K_MSEC(20));
	}
	zassert_not_null(strstr(topic, "/responses/client-a"));
	zassert_equal(qos, 1U);

	/* Duplicate request hits Communication replay cache stub. */
	zassert_ok(spaghetti_mqtt_test_inject_request("client-a", encoded,
						      encoded_size));
	for (size_t attempt = 0U; attempt < 50U; ++attempt) {
		if (handle_request_calls >= 2U) {
			break;
		}
		k_sleep(K_MSEC(20));
	}
	zassert_equal(handle_request_calls, 2U);
	zassert_ok(spaghetti_mqtt_stop(K_SECONDS(1)));
}

ZTEST(mqtt, test_record_consumer_independent_and_workspace)
{
	struct spaghetti_mqtt_config config = valid_config();
	struct spaghetti_record record = make_record();
	struct spaghetti_record_consumer_status mqtt_status;
	struct spaghetti_record_consumer_status ble_status;
	struct spaghetti_mqtt_publication publication;
	const uint8_t ca[4] = {1, 2, 3, 4};

	install_stub_transport();
	/* TLS path acquires workspace. */
	config.security = SPAGHETTI_MQTT_SECURITY_TLS_SERVER;
	config.port = 8883U;
	spaghetti_mqtt_test_set_device_id(test_device_id);
	zassert_ok(spaghetti_mqtt_credentials_set(
		1U, provisioned_principal, ca, sizeof(ca), NULL, 0U, NULL,
		0U));

	zassert_ok(spaghetti_data_init());
	zassert_ok(zbus_obs_set_enable(&record_logger_subscriber, false));
	zassert_ok(spaghetti_mqtt_format_record(&record, &publication));
	zassert_equal(strcmp(publication.topic_suffix, "modules/10/records"),
		      0);
	zassert_equal(publication.publish_class, SPAGHETTI_MQTT_PUBLISH_RECORDS);

	zassert_ok(spaghetti_mqtt_init(&config));
	spaghetti_mqtt_test_set_network_ready(true);
	zassert_ok(spaghetti_mqtt_start());
	zassert_true(spaghetti_mqtt_test_wait_state(SPAGHETTI_MQTT_CONNECTED,
						    K_SECONDS(2)));
	zassert_equal(workspace_acquire_count, 1U);
	zassert_equal(workspace_owner, SPAGHETTI_SECURE_OWNER_MQTT);

	zassert_ok(spaghetti_record_delivery_set_consumer_active(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, true));
	zassert_ok(spaghetti_data_publish(&record, K_NO_WAIT));

	for (size_t attempt = 0U; attempt < 50U; ++attempt) {
		zassert_ok(spaghetti_record_delivery_get_consumer_status(
			SPAGHETTI_RECORD_CONSUMER_ID_MQTT, &mqtt_status));
		if (mqtt_status.delivered >= 1U) {
			break;
		}
		k_sleep(K_MSEC(20));
	}
	zassert_true(mqtt_status.delivered >= 1U);

	zassert_ok(spaghetti_record_delivery_get_consumer_status(
		SPAGHETTI_RECORD_CONSUMER_ID_BLE, &ble_status));
	zassert_equal(ble_status.delivered, 0U);
	zassert_true(ble_status.pending >= 1U);

	zassert_ok(spaghetti_mqtt_stop(K_SECONDS(1)));
	zassert_equal(workspace_release_count, 1U);
	zassert_equal(workspace_owner, SPAGHETTI_SECURE_OWNER_NONE);
}

ZTEST(mqtt, test_degraded_on_bad_credentials)
{
	struct spaghetti_mqtt_config config = valid_config();
	const uint8_t ca[4] = {1, 2, 3, 4};

	install_stub_transport();
	stub_connect_result = -EACCES;
	config.security = SPAGHETTI_MQTT_SECURITY_TLS_MUTUAL;
	config.port = 8883U;
	spaghetti_mqtt_test_set_device_id(test_device_id);
	zassert_ok(spaghetti_mqtt_credentials_set(
		1U, provisioned_principal, ca, sizeof(ca), ca, sizeof(ca), ca,
		sizeof(ca)));
	zassert_ok(spaghetti_mqtt_init(&config));
	spaghetti_mqtt_test_set_network_ready(true);
	zassert_ok(spaghetti_mqtt_start());
	zassert_true(spaghetti_mqtt_test_wait_state(SPAGHETTI_MQTT_DEGRADED,
						    K_SECONDS(2)));
	zassert_ok(spaghetti_mqtt_stop(K_SECONDS(1)));
}

ZTEST(mqtt, test_priority_queue_and_lifecycle)
{
	struct spaghetti_mqtt_config config = valid_config();
	struct spaghetti_mqtt_publication publication = {
		.topic_suffix = "state",
		.payload_size = 1U,
		.payload = {0x01},
		.qos = 1U,
		.retain = true,
		.publish_class = SPAGHETTI_MQTT_PUBLISH_PRIORITY,
	};
	struct spaghetti_mqtt_status status;

	zassert_ok(spaghetti_mqtt_init(&config));
	for (size_t idx = 0U;
	     idx < CONFIG_SPAGHETTI_MQTT_PRIORITY_QUEUE_DEPTH; ++idx) {
		zassert_ok(spaghetti_mqtt_publish(&publication));
	}
	zassert_equal(spaghetti_mqtt_publish(&publication), -ENOMSG);
	zassert_ok(spaghetti_mqtt_get_status(&status));
	zassert_equal(status.queued,
		      CONFIG_SPAGHETTI_MQTT_PRIORITY_QUEUE_DEPTH);
	zassert_equal(status.dropped, 1U);

	publication.publish_class = SPAGHETTI_MQTT_PUBLISH_RECORDS;
	publication.topic_suffix[0] = 'r';
	publication.qos = 0U;
	publication.retain = false;
	for (size_t idx = 0U; idx < CONFIG_SPAGHETTI_MQTT_QUEUE_DEPTH; ++idx) {
		zassert_ok(spaghetti_mqtt_publish(&publication));
	}
	zassert_equal(spaghetti_mqtt_publish(&publication), -ENOMSG);
}

ZTEST_SUITE(mqtt, NULL, mqtt_setup, mqtt_before, mqtt_after, NULL);
