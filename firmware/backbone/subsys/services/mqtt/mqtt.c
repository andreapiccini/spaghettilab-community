#include <spaghetti/mqtt.h>
#include <spaghetti/mqtt_credentials.h>

#include <errno.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/net/net_event.h>
#include <zephyr/net/net_if.h>
#include <zephyr/net/net_mgmt.h>
#include <zephyr/random/random.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/util.h>
#include <zephyr/zbus/zbus.h>

#if IS_ENABLED(CONFIG_MQTT_LIB)
#include <zephyr/net/mqtt.h>
#include <zephyr/net/socket.h>
#endif

#include <spaghetti/communication.h>
#include <spaghetti/core.h>
#include <spaghetti/data.h>
#include <spaghetti/identity.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/protocol.h>
#include <spaghetti/record_delivery.h>
#include <spaghetti/secure_workspace.h>

#include "mqtt_internal.h"
#include "../service_thread.h"

LOG_MODULE_REGISTER(spaghetti_mqtt, CONFIG_SPAGHETTI_MQTT_LOG_LEVEL);

SPAGHETTI_RECORD_CONSUMER_DEFINE(spaghetti_mqtt_record_consumer) = {
	.id = SPAGHETTI_RECORD_CONSUMER_ID_MQTT,
	.name = "mqtt",
};

#define SPAGHETTI_MQTT_COMMAND_QUEUE_DEPTH 2U
#define SPAGHETTI_MQTT_CLIENT_BUFFER_SIZE 1024U
#define SPAGHETTI_MQTT_FULL_TOPIC_SIZE \
	(SPAGHETTI_MQTT_BASE_TOPIC_SIZE + 1U + 9U + \
	 SPAGHETTI_MQTT_CORE_ID_HEX_SIZE + 1U + \
	 SPAGHETTI_MQTT_TOPIC_SUFFIX_SIZE)
#define SPAGHETTI_MQTT_POLL_MS 50
#define SPAGHETTI_MQTT_CONNACK_TIMEOUT_MS 1000
#define SPAGHETTI_MQTT_RECONNECT_MIN_MS 1000U
#define SPAGHETTI_MQTT_RECONNECT_MAX_MS 30000U
#define SPAGHETTI_MQTT_REQUEST_QUEUE_DEPTH 2U

enum spaghetti_mqtt_command {
	SPAGHETTI_MQTT_COMMAND_START,
	SPAGHETTI_MQTT_COMMAND_STOP,
};

struct spaghetti_mqtt_inbound_request {
	char client_id[SPAGHETTI_MQTT_CLIENT_ID_SIZE];
	size_t payload_size;
	uint8_t payload[SPAGHETTI_MQTT_PAYLOAD_SIZE];
};

struct spaghetti_mqtt_context {
	struct spaghetti_mqtt_config config;
	struct spaghetti_mqtt_status status;
	char core_id_hex[SPAGHETTI_MQTT_CORE_ID_HEX_SIZE + 1U];
	uint8_t device_id[SPAGHETTI_DEVICE_ID_SIZE];
	uint32_t reconnect_delay_ms;
	int64_t next_connect_ms;
	uint32_t event_sequence;
	uint32_t last_record_lost;
	bool initialized;
	bool started;
	bool client_active;
	bool network_callback_registered;
	bool workspace_acquired;
	bool network_ready_override;
	bool device_id_override;
#if IS_ENABLED(CONFIG_MQTT_LIB)
	struct mqtt_client client;
	struct sockaddr_storage broker;
	uint8_t rx_buffer[SPAGHETTI_MQTT_CLIENT_BUFFER_SIZE];
	uint8_t tx_buffer[SPAGHETTI_MQTT_CLIENT_BUFFER_SIZE];
#endif
};

static struct spaghetti_mqtt_context context;
static struct net_mgmt_event_callback network_callback;
static atomic_t network_is_ready;
static atomic_t client_is_connected;
static atomic_t connection_error;
static atomic_t stop_requested;
static atomic_t auth_failed;
static struct spaghetti_service_thread mqtt_worker_thread;
static struct spaghetti_service_thread mqtt_adapter_thread;

K_MUTEX_DEFINE(mqtt_lock);
K_SEM_DEFINE(network_event_sem, 0, 1);
K_MSGQ_DEFINE(command_queue, sizeof(enum spaghetti_mqtt_command),
	      SPAGHETTI_MQTT_COMMAND_QUEUE_DEPTH,
	      __alignof__(enum spaghetti_mqtt_command));
K_MSGQ_DEFINE(priority_queue, sizeof(struct spaghetti_mqtt_publication),
	      CONFIG_SPAGHETTI_MQTT_PRIORITY_QUEUE_DEPTH,
	      __alignof__(struct spaghetti_mqtt_publication));
K_MSGQ_DEFINE(publication_queue, sizeof(struct spaghetti_mqtt_publication),
	      CONFIG_SPAGHETTI_MQTT_QUEUE_DEPTH,
	      __alignof__(struct spaghetti_mqtt_publication));
K_MSGQ_DEFINE(request_queue, sizeof(struct spaghetti_mqtt_inbound_request),
	      SPAGHETTI_MQTT_REQUEST_QUEUE_DEPTH,
	      __alignof__(struct spaghetti_mqtt_inbound_request));

ZBUS_CHAN_DECLARE(spaghetti_record_chan);
ZBUS_OBS_DECLARE(record_mqtt_subscriber);

#if IS_ENABLED(CONFIG_SPAGHETTI_MQTT_TEST_HOOKS)
static struct spaghetti_mqtt_test_transport test_transport;
static bool test_transport_installed;
static char test_last_topic[SPAGHETTI_MQTT_FULL_TOPIC_SIZE];
static uint8_t test_last_payload[SPAGHETTI_MQTT_PAYLOAD_SIZE];
static size_t test_last_payload_size;
static uint8_t test_last_qos;
static bool test_last_retain;
K_MUTEX_DEFINE(test_publish_lock);
#endif

static bool bounded_string_is_valid(const char *value, size_t capacity,
				    bool may_be_empty)
{
	const char *terminator = memchr(value, '\0', capacity);

	if (terminator == NULL) {
		return false;
	}
	if (!may_be_empty && (terminator == value)) {
		return false;
	}

	return true;
}

static bool client_id_is_valid(const char *client_id)
{
	size_t length;

	if ((client_id == NULL) ||
	    !bounded_string_is_valid(client_id, SPAGHETTI_MQTT_CLIENT_ID_SIZE,
				     false)) {
		return false;
	}
	length = strlen(client_id);
	for (size_t idx = 0U; idx < length; ++idx) {
		const char ch = client_id[idx];

		if (!(((ch >= 'a') && (ch <= 'z')) ||
		      ((ch >= 'A') && (ch <= 'Z')) ||
		      ((ch >= '0') && (ch <= '9')) || (ch == '-') ||
		      (ch == '_') || (ch == '.'))) {
			return false;
		}
	}
	return true;
}

static bool security_is_allowed(enum spaghetti_mqtt_security security)
{
	switch (security) {
	case SPAGHETTI_MQTT_SECURITY_TLS_SERVER:
	case SPAGHETTI_MQTT_SECURITY_TLS_MUTUAL:
		return true;
	case SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT:
		return IS_ENABLED(
			CONFIG_SPAGHETTI_MQTT_ALLOW_PLAINTEXT_DEVELOPMENT);
	default:
		return false;
	}
}

static bool config_is_valid(const struct spaghetti_mqtt_config *config)
{
	if (config == NULL) {
		return false;
	}
	if (!config->enabled) {
		return (config->host[0] == '\0') && (config->port == 0U) &&
		       (config->base_topic[0] == '\0') &&
		       (config->security ==
			SPAGHETTI_MQTT_SECURITY_TLS_SERVER) &&
		       (config->credential_id == 0U);
	}
	if (!bounded_string_is_valid(config->host, sizeof(config->host),
				     false) ||
	    !bounded_string_is_valid(config->base_topic,
				     sizeof(config->base_topic), false) ||
	    (config->port == 0U) || !security_is_allowed(config->security)) {
		return false;
	}
	if ((config->security !=
	     SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT) &&
	    (config->credential_id == 0U)) {
		return false;
	}
	if ((config->security ==
	     SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT) &&
	    (config->credential_id == 0U)) {
		return false;
	}

	const size_t base_topic_len = strlen(config->base_topic);

	return (config->base_topic[0] != '/') &&
	       (config->base_topic[base_topic_len - 1U] != '/');
}

static bool publication_is_valid(
	const struct spaghetti_mqtt_publication *publication)
{
	if ((publication == NULL) ||
	    !bounded_string_is_valid(publication->topic_suffix,
				     sizeof(publication->topic_suffix),
				     false) ||
	    (publication->payload_size == 0U) ||
	    (publication->payload_size > sizeof(publication->payload)) ||
	    ((publication->qos != 0U) && (publication->qos != 1U)) ||
	    ((publication->publish_class != SPAGHETTI_MQTT_PUBLISH_PRIORITY) &&
	     (publication->publish_class != SPAGHETTI_MQTT_PUBLISH_RECORDS))) {
		return false;
	}

	const size_t suffix_len = strlen(publication->topic_suffix);

	return (publication->topic_suffix[0] != '/') &&
	       (publication->topic_suffix[suffix_len - 1U] != '/');
}

static void set_status(enum spaghetti_mqtt_state state, int error)
{
	(void)k_mutex_lock(&mqtt_lock, K_FOREVER);
	context.status.state = state;
	context.status.last_error = error;
	k_mutex_unlock(&mqtt_lock);
}

static int hex_encode_device_id(const uint8_t *device_id, char *out,
				size_t capacity)
{
	static const char hex[] = "0123456789abcdef";

	if ((device_id == NULL) || (out == NULL) ||
	    (capacity < (SPAGHETTI_MQTT_CORE_ID_HEX_SIZE + 1U))) {
		return -EINVAL;
	}
	for (size_t idx = 0U; idx < SPAGHETTI_DEVICE_ID_SIZE; ++idx) {
		out[(idx * 2U)] = hex[(device_id[idx] >> 4U) & 0x0FU];
		out[(idx * 2U) + 1U] = hex[device_id[idx] & 0x0FU];
	}
	out[SPAGHETTI_MQTT_CORE_ID_HEX_SIZE] = '\0';
	return 0;
}

static int refresh_core_id_locked(void)
{
	struct spaghetti_identity identity;
	int err;

	if (!context.device_id_override) {
		err = spaghetti_identity_get(&identity);
		if (err < 0) {
			return err;
		}
		memcpy(context.device_id, identity.device_id,
		       sizeof(context.device_id));
	}
	return hex_encode_device_id(context.device_id, context.core_id_hex,
				    sizeof(context.core_id_hex));
}

static int build_core_topic(const char *suffix, char *topic, size_t capacity)
{
	const int topic_size = snprintf(topic, capacity, "%s/v1/cores/%s/%s",
					context.config.base_topic,
					context.core_id_hex, suffix);

	if ((topic_size <= 0) || ((size_t)topic_size >= capacity)) {
		return -EMSGSIZE;
	}
	return topic_size;
}

uint32_t spaghetti_mqtt_adapter_permissions(void)
{
	return SPAGHETTI_PERMISSION_READ | SPAGHETTI_PERMISSION_CONFIGURE |
	       SPAGHETTI_PERMISSION_COMMAND | SPAGHETTI_PERMISSION_DISCOVER;
}

static int enqueue_request(const char *client_id, const uint8_t *payload,
			   size_t payload_size)
{
	struct spaghetti_mqtt_inbound_request request = {0};

	if (!client_id_is_valid(client_id) || (payload == NULL) ||
	    (payload_size == 0U) ||
	    (payload_size > sizeof(request.payload))) {
		return -EINVAL;
	}

	memcpy(request.client_id, client_id, strlen(client_id));
	memcpy(request.payload, payload, payload_size);
	request.payload_size = payload_size;
	return (k_msgq_put(&request_queue, &request, K_NO_WAIT) < 0) ?
		       -ENOMSG :
		       0;
}

static int publish_via_transport(const char *topic, const uint8_t *payload,
				 size_t payload_size, uint8_t qos, bool retain)
{
#if IS_ENABLED(CONFIG_SPAGHETTI_MQTT_TEST_HOOKS)
	if (test_transport_installed && (test_transport.publish != NULL)) {
		int err;

		(void)k_mutex_lock(&test_publish_lock, K_FOREVER);
		strncpy(test_last_topic, topic, sizeof(test_last_topic) - 1U);
		test_last_topic[sizeof(test_last_topic) - 1U] = '\0';
		test_last_payload_size = MIN(payload_size,
					     sizeof(test_last_payload));
		memcpy(test_last_payload, payload, test_last_payload_size);
		test_last_qos = qos;
		test_last_retain = retain;
		k_mutex_unlock(&test_publish_lock);
		err = test_transport.publish(test_transport.ctx, topic, payload,
					     payload_size, qos, retain);
		return err;
	}
#endif
#if IS_ENABLED(CONFIG_MQTT_LIB)
	{
		struct mqtt_publish_param parameters = {0};

		parameters.message.topic.topic.utf8 = (uint8_t *)topic;
		parameters.message.topic.topic.size = (uint32_t)strlen(topic);
		parameters.message.topic.qos =
			(qos == 0U) ? MQTT_QOS_0_AT_MOST_ONCE :
				      MQTT_QOS_1_AT_LEAST_ONCE;
		parameters.message.payload.data = (uint8_t *)payload;
		parameters.message.payload.len = payload_size;
		parameters.message_id = (qos == 0U) ? 0U : 1U;
		parameters.dup_flag = 0U;
		parameters.retain_flag = retain ? 1U : 0U;
		return mqtt_publish(&context.client, &parameters);
	}
#else
	ARG_UNUSED(topic);
	ARG_UNUSED(payload);
	ARG_UNUSED(payload_size);
	ARG_UNUSED(qos);
	ARG_UNUSED(retain);
	return -ENOTSUP;
#endif
}

static int publish_one(const struct spaghetti_mqtt_publication *publication)
{
	char topic[SPAGHETTI_MQTT_FULL_TOPIC_SIZE];
	int topic_size = build_core_topic(publication->topic_suffix, topic,
					  sizeof(topic));

	if (topic_size < 0) {
		return topic_size;
	}
	return publish_via_transport(topic, publication->payload,
				     publication->payload_size,
				     publication->qos, publication->retain);
}

static int publish_retained_snapshot(const char *suffix,
				     const uint8_t *payload,
				     size_t payload_size)
{
	struct spaghetti_mqtt_publication publication = {
		.payload_size = payload_size,
		.qos = 1U,
		.retain = true,
		.publish_class = SPAGHETTI_MQTT_PUBLISH_PRIORITY,
	};
	int err;

	if ((suffix == NULL) || (payload == NULL) || (payload_size == 0U) ||
	    (payload_size > sizeof(publication.payload))) {
		return -EINVAL;
	}
	err = snprintf(publication.topic_suffix,
		       sizeof(publication.topic_suffix), "%s", suffix);
	if ((err <= 0) ||
	    ((size_t)err >= sizeof(publication.topic_suffix))) {
		return -EMSGSIZE;
	}
	memcpy(publication.payload, payload, payload_size);
	return spaghetti_mqtt_publish(&publication);
}

static int encode_and_publish_state(void)
{
	struct spaghetti_protocol_payload body;
	struct spaghetti_record_consumer_status consumer_status;
	uint8_t envelope[SPAGHETTI_MQTT_PAYLOAD_SIZE];
	size_t written = 0U;
	uint32_t queue_depth = 0U;
	uint32_t drop_count = 0U;
	int err;

	err = spaghetti_record_delivery_get_consumer_status(
		SPAGHETTI_RECORD_CONSUMER_ID_MQTT, &consumer_status);
	if (err == 0) {
		queue_depth = (uint32_t)consumer_status.pending;
		drop_count = consumer_status.lost;
		context.last_record_lost = consumer_status.lost;
	}

	err = spaghetti_protocol_encode_status_event_payload(
		context.device_id, sizeof(context.device_id), 1U, queue_depth,
		drop_count, &body);
	if (err < 0) {
		return err;
	}
	if (context.event_sequence == 0U) {
		context.event_sequence = 1U;
	}
	err = spaghetti_protocol_encode_event(
		SPAGHETTI_PROTOCOL_EVENT_STATUS, context.event_sequence++,
		&body, envelope, sizeof(envelope), &written);
	if (err < 0) {
		return err;
	}
	return publish_retained_snapshot("state", envelope, written);
}

static int encode_and_publish_catalog(void)
{
	struct spaghetti_protocol_payload body = {0};
	uint8_t envelope[SPAGHETTI_MQTT_PAYLOAD_SIZE];
	size_t written = 0U;
	int err;

	/*
	 * Minimal retained catalog placeholder. Full GET_CATALOG pagination is
	 * available over requests; this retained topic signals reconnect
	 * readiness with a Protocol V1 event envelope.
	 */
	if (context.event_sequence == 0U) {
		context.event_sequence = 1U;
	}
	err = spaghetti_protocol_encode_event(
		SPAGHETTI_PROTOCOL_EVENT_STATUS, context.event_sequence++,
		&body, envelope, sizeof(envelope), &written);
	if (err < 0) {
		return err;
	}
	return publish_retained_snapshot("catalog", envelope, written);
}

static int handle_one_request(const struct spaghetti_mqtt_inbound_request *req)
{
	struct spaghetti_protocol_request request;
	struct spaghetti_protocol_response response;
	struct spaghetti_request_context request_context;
	struct spaghetti_principal principal;
	struct spaghetti_core_info info;
	spaghetti_principal_id_t principal_id;
	char response_suffix[SPAGHETTI_MQTT_TOPIC_SUFFIX_SIZE];
	struct spaghetti_mqtt_publication publication = {
		.qos = 1U,
		.retain = false,
		.publish_class = SPAGHETTI_MQTT_PUBLISH_PRIORITY,
	};
	uint8_t encoded[SPAGHETTI_MQTT_PAYLOAD_SIZE];
	size_t encoded_size = 0U;
	int err;

	err = spaghetti_protocol_decode_request(req->payload, req->payload_size,
						&request);
	if (err < 0) {
		return err;
	}

	err = spaghetti_mqtt_credentials_resolve_principal(
		context.config.credential_id, &principal_id);
	if (err < 0) {
		return err;
	}
	err = spaghetti_principal_get(principal_id, &principal);
	if ((err < 0) || !principal.enabled) {
		return (err < 0) ? err : -ENOENT;
	}
	err = spaghetti_core_get_info(&info);
	if (err < 0) {
		info.mode = SPAGHETTI_CORE_MODE_NORMAL;
	}

	request_context = (struct spaghetti_request_context) {
		.principal_id = principal_id,
		.permissions = principal.permissions &
			       spaghetti_mqtt_adapter_permissions(),
		.local = false,
		.core_mode = info.mode,
	};

	err = spaghetti_communication_handle_request(
		&request_context, &request, &response);
	if (err < 0) {
		return err;
	}

	err = spaghetti_protocol_encode_response(
		&response, encoded, sizeof(encoded), &encoded_size);
	if (err < 0) {
		return err;
	}

	err = snprintf(response_suffix, sizeof(response_suffix),
		       "responses/%s", req->client_id);
	if ((err <= 0) || ((size_t)err >= sizeof(response_suffix))) {
		return -EMSGSIZE;
	}
	memcpy(publication.topic_suffix, response_suffix,
	       strlen(response_suffix) + 1U);
	memcpy(publication.payload, encoded, encoded_size);
	publication.payload_size = encoded_size;
	return spaghetti_mqtt_publish(&publication);
}

static void drain_requests(void)
{
	struct spaghetti_mqtt_inbound_request request;

	while (k_msgq_get(&request_queue, &request, K_NO_WAIT) == 0) {
		const int err = handle_one_request(&request);

		if (err < 0) {
			LOG_WRN("request failed: err=%d", err);
		}
	}
}

static int publish_queued(struct k_msgq *queue)
{
	struct spaghetti_mqtt_publication publication;
	int err = k_msgq_get(queue, &publication, K_NO_WAIT);

	if (err == -ENOMSG) {
		return 0;
	}
	if (err < 0) {
		return err;
	}

	err = publish_one(&publication);
	(void)k_mutex_lock(&mqtt_lock, K_FOREVER);
	if (err == 0) {
		++context.status.published;
	} else {
		++context.status.dropped;
		context.status.last_error = err;
	}
	k_mutex_unlock(&mqtt_lock);
	return err;
}

#if IS_ENABLED(CONFIG_MQTT_LIB)
static void mqtt_event_handler(struct mqtt_client *client,
			       const struct mqtt_evt *event)
{
	ARG_UNUSED(client);

	switch (event->type) {
	case MQTT_EVT_CONNACK:
		if ((event->result == 0) &&
		    (event->param.connack.return_code ==
		     MQTT_CONNECTION_ACCEPTED)) {
			atomic_set(&client_is_connected, 1);
			atomic_set(&connection_error, 0);
			atomic_set(&auth_failed, 0);
		} else {
			atomic_set(&connection_error,
				   (event->result < 0) ? event->result :
							 -ECONNREFUSED);
			if (event->param.connack.return_code !=
			    MQTT_CONNECTION_ACCEPTED) {
				atomic_set(&auth_failed, 1);
			}
		}
		break;
	case MQTT_EVT_DISCONNECT:
		atomic_set(&client_is_connected, 0);
		atomic_set(&connection_error,
			   (event->result < 0) ? event->result : -ENOTCONN);
		break;
	case MQTT_EVT_PUBLISH: {
		const struct mqtt_publish_param *pub = &event->param.publish;
		char topic[SPAGHETTI_MQTT_FULL_TOPIC_SIZE];
		char expected_prefix[SPAGHETTI_MQTT_FULL_TOPIC_SIZE];
		uint8_t payload[SPAGHETTI_MQTT_PAYLOAD_SIZE];
		const char *client_id;
		size_t topic_len;
		size_t prefix_len;
		ssize_t got;

		topic_len = MIN(pub->message.topic.topic.size,
				sizeof(topic) - 1U);
		memcpy(topic, pub->message.topic.topic.utf8, topic_len);
		topic[topic_len] = '\0';
		if (build_core_topic("requests/", expected_prefix,
				     sizeof(expected_prefix)) < 0) {
			break;
		}
		prefix_len = strlen(expected_prefix);
		if ((topic_len <= prefix_len) ||
		    (strncmp(topic, expected_prefix, prefix_len) != 0)) {
			break;
		}
		client_id = &topic[prefix_len];
		if (pub->message.payload.len > sizeof(payload)) {
			break;
		}
		got = mqtt_read_publish_payload(
			&context.client, payload, pub->message.payload.len);
		if ((got < 0) || ((size_t)got != pub->message.payload.len)) {
			break;
		}
		(void)enqueue_request(client_id, payload, (size_t)got);
		if (pub->message.topic.qos == MQTT_QOS_1_AT_LEAST_ONCE) {
			struct mqtt_puback_param ack = {
				.message_id = pub->message_id,
			};

			(void)mqtt_publish_qos1_ack(&context.client, &ack);
		}
		break;
	}
	default:
		break;
	}
}
#endif

static void network_event_handler(struct net_mgmt_event_callback *callback,
				  uint64_t event, struct net_if *iface)
{
	ARG_UNUSED(callback);
	ARG_UNUSED(iface);

	if (event == NET_EVENT_IPV4_ADDR_ADD) {
		atomic_set(&network_is_ready, 1);
		k_sem_give(&network_event_sem);
	} else if (event == NET_EVENT_IPV4_ADDR_DEL) {
		atomic_set(&network_is_ready, 0);
		k_sem_give(&network_event_sem);
	}
}

static bool network_ready(void)
{
	if (context.network_ready_override) {
		return true;
	}
	return atomic_get(&network_is_ready) != 0;
}

static int acquire_workspace_if_needed(void)
{
	int err;

	if (context.config.security ==
	    SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT) {
		return 0;
	}
	if (context.workspace_acquired) {
		return 0;
	}
	err = spaghetti_secure_workspace_acquire(SPAGHETTI_SECURE_OWNER_MQTT,
						 K_NO_WAIT);
	if (err < 0) {
		return err;
	}
	context.workspace_acquired = true;
	return 0;
}

static void release_workspace_if_needed(void)
{
	if (!context.workspace_acquired) {
		return;
	}
	(void)spaghetti_secure_workspace_release(SPAGHETTI_SECURE_OWNER_MQTT);
	context.workspace_acquired = false;
}

static void disconnect_client(void)
{
#if IS_ENABLED(CONFIG_SPAGHETTI_MQTT_TEST_HOOKS)
	if (test_transport_installed && (test_transport.disconnect != NULL)) {
		test_transport.disconnect(test_transport.ctx);
	}
#endif
#if IS_ENABLED(CONFIG_MQTT_LIB)
	if (context.client_active) {
		if (atomic_get(&client_is_connected) != 0) {
			(void)mqtt_disconnect(&context.client, NULL);
		} else {
			(void)mqtt_abort(&context.client);
		}
		context.client_active = false;
	}
#endif
	atomic_set(&client_is_connected, 0);
	release_workspace_if_needed();
}

static uint32_t reconnect_delay_with_jitter(uint32_t base_ms)
{
	uint32_t jitter = sys_rand32_get() % (base_ms / 4U + 1U);

	return base_ms + jitter;
}

#if IS_ENABLED(CONFIG_MQTT_LIB)
static int resolve_broker(void)
{
	struct zsock_addrinfo hints = {
		.ai_family = AF_INET,
		.ai_socktype = SOCK_STREAM,
		.ai_protocol = IPPROTO_TCP,
	};
	struct zsock_addrinfo *result;
	char port_text[6];
	int text_size = snprintf(port_text, sizeof(port_text), "%u",
				 (uint32_t)context.config.port);
	int err;

	if ((text_size <= 0) || ((size_t)text_size >= sizeof(port_text))) {
		return -EINVAL;
	}
	err = zsock_getaddrinfo(context.config.host, port_text, &hints,
				&result);
	if (err != 0) {
		return -EHOSTUNREACH;
	}
	if ((result == NULL) || (result->ai_addr == NULL) ||
	    (result->ai_addrlen > sizeof(context.broker))) {
		zsock_freeaddrinfo(result);
		return -EADDRNOTAVAIL;
	}
	memset(&context.broker, 0, sizeof(context.broker));
	memcpy(&context.broker, result->ai_addr, result->ai_addrlen);
	zsock_freeaddrinfo(result);
	return 0;
}

static void initialize_client(void)
{
	static uint8_t client_id[SPAGHETTI_MQTT_CORE_ID_HEX_SIZE + 1U];

	memcpy(client_id, context.core_id_hex, sizeof(client_id));
	mqtt_client_init(&context.client);
	context.client.broker = &context.broker;
	context.client.evt_cb = mqtt_event_handler;
	context.client.client_id.utf8 = client_id;
	context.client.client_id.size = SPAGHETTI_MQTT_CORE_ID_HEX_SIZE;
	context.client.protocol_version = MQTT_VERSION_3_1_1;
	context.client.rx_buf = context.rx_buffer;
	context.client.rx_buf_size = sizeof(context.rx_buffer);
	context.client.tx_buf = context.tx_buffer;
	context.client.tx_buf_size = sizeof(context.tx_buffer);
	context.client.transport.type = MQTT_TRANSPORT_NON_SECURE;
#if defined(CONFIG_MQTT_LIB_TLS)
	if (context.config.security !=
	    SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT) {
		context.client.transport.type = MQTT_TRANSPORT_SECURE;
	}
#endif
}
#endif

static int connect_client(void)
{
	char request_topic[SPAGHETTI_MQTT_FULL_TOPIC_SIZE];
	int err;

	err = refresh_core_id_locked();
	if (err < 0) {
		return err;
	}
	err = acquire_workspace_if_needed();
	if (err < 0) {
		return err;
	}

#if IS_ENABLED(CONFIG_SPAGHETTI_MQTT_TEST_HOOKS)
	if (test_transport_installed) {
		if (test_transport.connect != NULL) {
			err = test_transport.connect(test_transport.ctx);
			if (err < 0) {
				if ((err == -EACCES) || (err == -ECONNREFUSED) ||
				    (err == -EPERM)) {
					atomic_set(&auth_failed, 1);
				}
				release_workspace_if_needed();
				return err;
			}
		}
		atomic_set(&client_is_connected, 1);
		atomic_set(&connection_error, 0);
		atomic_set(&auth_failed, 0);
		if (build_core_topic("requests/+", request_topic,
				     sizeof(request_topic)) < 0) {
			disconnect_client();
			return -EMSGSIZE;
		}
		if (test_transport.subscribe != NULL) {
			err = test_transport.subscribe(test_transport.ctx,
						       request_topic);
			if (err < 0) {
				disconnect_client();
				return err;
			}
		}
		(void)encode_and_publish_state();
		(void)encode_and_publish_catalog();
		return 0;
	}
#endif

#if IS_ENABLED(CONFIG_MQTT_LIB)
	{
		struct zsock_pollfd socket_poll = {
			.events = ZSOCK_POLLIN,
		};
		const int64_t deadline_ms =
			k_uptime_get() + SPAGHETTI_MQTT_CONNACK_TIMEOUT_MS;

		err = resolve_broker();
		if (err < 0) {
			release_workspace_if_needed();
			return err;
		}
		initialize_client();
		atomic_set(&client_is_connected, 0);
		atomic_set(&connection_error, 0);
		err = mqtt_connect(&context.client);
		if (err < 0) {
			release_workspace_if_needed();
			return err;
		}
		context.client_active = true;
		socket_poll.fd = context.client.transport.tcp.sock;
		while ((atomic_get(&client_is_connected) == 0) &&
		       (k_uptime_get() < deadline_ms)) {
			err = zsock_poll(&socket_poll, 1, SPAGHETTI_MQTT_POLL_MS);
			if (err < 0) {
				err = -errno;
				goto abort;
			}
			if ((err > 0) &&
			    ((socket_poll.revents & ZSOCK_POLLIN) != 0)) {
				err = mqtt_input(&context.client);
				if (err < 0) {
					goto abort;
				}
			}
			if (atomic_get(&connection_error) < 0) {
				err = (int)atomic_get(&connection_error);
				goto abort;
			}
		}
		if (atomic_get(&client_is_connected) == 0) {
			err = -ETIMEDOUT;
			goto abort;
		}
		if (build_core_topic("requests/+", request_topic,
				     sizeof(request_topic)) < 0) {
			err = -EMSGSIZE;
			goto abort;
		}
		{
			struct mqtt_topic topic_list = {
				.topic = {
					.utf8 = (uint8_t *)request_topic,
					.size = (uint32_t)strlen(request_topic),
				},
				.qos = MQTT_QOS_1_AT_LEAST_ONCE,
			};
			struct mqtt_subscription_list subscriptions = {
				.list = &topic_list,
				.list_count = 1U,
				.message_id = 1U,
			};

			err = mqtt_subscribe(&context.client, &subscriptions);
			if (err < 0) {
				goto abort;
			}
		}
		(void)encode_and_publish_state();
		(void)encode_and_publish_catalog();
		return 0;
abort:
		disconnect_client();
		return err;
	}
#else
	ARG_UNUSED(request_topic);
	release_workspace_if_needed();
	return -ENOTSUP;
#endif
}

static int service_connected_client(void)
{
	int err;

#if IS_ENABLED(CONFIG_SPAGHETTI_MQTT_TEST_HOOKS)
	if (test_transport_installed) {
		if (test_transport.process != NULL) {
			err = test_transport.process(test_transport.ctx,
						     SPAGHETTI_MQTT_POLL_MS);
			if (err < 0) {
				return err;
			}
		} else {
			k_sleep(K_MSEC(SPAGHETTI_MQTT_POLL_MS));
		}
		drain_requests();
		err = publish_queued(&priority_queue);
		if (err < 0) {
			return err;
		}
		return publish_queued(&publication_queue);
	}
#endif

#if IS_ENABLED(CONFIG_MQTT_LIB)
	{
		struct zsock_pollfd socket_poll = {
			.fd = context.client.transport.tcp.sock,
			.events = ZSOCK_POLLIN,
		};

		err = zsock_poll(&socket_poll, 1, SPAGHETTI_MQTT_POLL_MS);
		if (err < 0) {
			return -errno;
		}
		if ((err > 0) && ((socket_poll.revents & ZSOCK_POLLIN) != 0)) {
			err = mqtt_input(&context.client);
			if (err < 0) {
				return err;
			}
		}
		err = mqtt_live(&context.client);
		if ((err < 0) && (err != -EAGAIN)) {
			return err;
		}
		drain_requests();
		err = publish_queued(&priority_queue);
		if (err < 0) {
			return err;
		}
		return publish_queued(&publication_queue);
	}
#else
	drain_requests();
	return 0;
#endif
}

static void process_command(enum spaghetti_mqtt_command command)
{
	if (command == SPAGHETTI_MQTT_COMMAND_START) {
		context.reconnect_delay_ms = SPAGHETTI_MQTT_RECONNECT_MIN_MS;
		context.next_connect_ms = 0;
		return;
	}

	disconnect_client();
	k_msgq_purge(&publication_queue);
	k_msgq_purge(&priority_queue);
	k_msgq_purge(&request_queue);
	(void)k_mutex_lock(&mqtt_lock, K_FOREVER);
	context.started = false;
	context.status.state = SPAGHETTI_MQTT_STOPPED;
	k_mutex_unlock(&mqtt_lock);
}

static void mqtt_worker_thread_entry(void *first, void *second, void *third)
{
	ARG_UNUSED(first);
	ARG_UNUSED(second);
	ARG_UNUSED(third);

	while (atomic_get(&stop_requested) == 0) {
		enum spaghetti_mqtt_command command;

		if (k_msgq_get(&command_queue, &command,
			       K_MSEC(SPAGHETTI_MQTT_POLL_MS)) == 0) {
			process_command(command);
			if (command == SPAGHETTI_MQTT_COMMAND_STOP) {
				break;
			}
		}

		(void)k_mutex_lock(&mqtt_lock, K_FOREVER);
		const bool should_run = context.started;
		k_mutex_unlock(&mqtt_lock);
		if (!should_run) {
			continue;
		}

		if (!network_ready()) {
			disconnect_client();
			set_status(SPAGHETTI_MQTT_WAIT_NETWORK, 0);
			(void)k_sem_take(&network_event_sem, K_NO_WAIT);
			continue;
		}

		if (atomic_get(&client_is_connected) == 0) {
			const int64_t now_ms = k_uptime_get();

			if (now_ms < context.next_connect_ms) {
				continue;
			}

			const int err = connect_client();

			if (err < 0) {
				if (atomic_get(&auth_failed) != 0) {
					set_status(SPAGHETTI_MQTT_DEGRADED, err);
					context.next_connect_ms =
						k_uptime_get() +
						reconnect_delay_with_jitter(
							context.reconnect_delay_ms);
				} else {
					set_status(SPAGHETTI_MQTT_ERROR, err);
					context.next_connect_ms =
						k_uptime_get() +
						reconnect_delay_with_jitter(
							context.reconnect_delay_ms);
				}
				context.reconnect_delay_ms = MIN(
					context.reconnect_delay_ms * 2U,
					SPAGHETTI_MQTT_RECONNECT_MAX_MS);
				continue;
			}

			context.reconnect_delay_ms =
				SPAGHETTI_MQTT_RECONNECT_MIN_MS;
			set_status(SPAGHETTI_MQTT_CONNECTED, 0);
			LOG_INF("connected");
		}

		const int err = service_connected_client();

		if (err < 0) {
			disconnect_client();
			set_status(SPAGHETTI_MQTT_ERROR, err);
			context.next_connect_ms =
				k_uptime_get() +
				reconnect_delay_with_jitter(
					context.reconnect_delay_ms);
			context.reconnect_delay_ms = MIN(
				context.reconnect_delay_ms * 2U,
				SPAGHETTI_MQTT_RECONNECT_MAX_MS);
		}
	}
	disconnect_client();
	k_msgq_purge(&publication_queue);
	k_msgq_purge(&priority_queue);
	k_msgq_purge(&request_queue);
	(void)k_mutex_lock(&mqtt_lock, K_FOREVER);
	context.started = false;
	context.status.state = SPAGHETTI_MQTT_STOPPED;
	k_mutex_unlock(&mqtt_lock);
}

int spaghetti_mqtt_format_record(
	const struct spaghetti_record *record,
	struct spaghetti_mqtt_publication *out)
{
	struct spaghetti_protocol_payload body;
	struct spaghetti_mqtt_publication publication = {
		.qos = 0U,
		.retain = false,
		.publish_class = SPAGHETTI_MQTT_PUBLISH_RECORDS,
	};
	size_t written = 0U;
	int text_size;
	int err;

	if ((record == NULL) || (out == NULL)) {
		return -EINVAL;
	}

	text_size = snprintf(publication.topic_suffix,
			     sizeof(publication.topic_suffix),
			     "modules/%" PRIu32 "/records",
			     (uint32_t)record->source_key);
	if ((text_size <= 0) ||
	    ((size_t)text_size >= sizeof(publication.topic_suffix))) {
		return -EMSGSIZE;
	}

	err = spaghetti_protocol_encode_record_event_payload(
		record->source_key, record->sequence,
		record->payload.schema_id, record->payload.schema_version,
		&body);
	if (err < 0) {
		return err;
	}
	err = spaghetti_protocol_encode_event(
		SPAGHETTI_PROTOCOL_EVENT_RECORD,
		record->sequence == 0U ? 1U : record->sequence, &body,
		publication.payload, sizeof(publication.payload), &written);
	if (err < 0) {
		return err;
	}
	publication.payload_size = written;
	*out = publication;
	return 0;
}

static void mqtt_adapter_thread_entry(void *first, void *second, void *third)
{
	ARG_UNUSED(first);
	ARG_UNUSED(second);
	ARG_UNUSED(third);

	while (atomic_get(&stop_requested) == 0) {
		struct spaghetti_record record;
		struct spaghetti_record_cursor cursor;
		struct spaghetti_mqtt_publication publication;
		struct spaghetti_mqtt_status status;
		int err;

		err = spaghetti_mqtt_get_status(&status);
		if ((err < 0) || (status.state != SPAGHETTI_MQTT_CONNECTED)) {
			k_sleep(K_MSEC(SPAGHETTI_MQTT_POLL_MS));
			continue;
		}

		err = spaghetti_record_delivery_peek(
			SPAGHETTI_RECORD_CONSUMER_ID_MQTT, &record, &cursor);
		if (err == -ENOENT) {
			k_sleep(K_MSEC(SPAGHETTI_MQTT_POLL_MS));
			continue;
		}
		if (err < 0) {
			k_sleep(K_MSEC(SPAGHETTI_MQTT_POLL_MS));
			continue;
		}

		err = spaghetti_mqtt_format_record(&record, &publication);
		if (err == 0) {
			err = spaghetti_mqtt_publish(&publication);
		}
		if (err == 0) {
			/*
			 * ACK only after the broker accepted the publish. With
			 * the stub transport, publish success means acceptance.
			 */
			(void)spaghetti_record_delivery_ack(
				SPAGHETTI_RECORD_CONSUMER_ID_MQTT, &cursor);
		} else if ((err != -ENOMSG) && (err != -EACCES)) {
			LOG_WRN("record rejected: key=%u err=%d",
				record.source_key, err);
			k_sleep(K_MSEC(SPAGHETTI_MQTT_POLL_MS));
		}
	}
}

int spaghetti_mqtt_init(const struct spaghetti_mqtt_config *config)
{
	int err;

	if (!config_is_valid(config)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&mqtt_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (context.initialized &&
	    ((context.status.state != SPAGHETTI_MQTT_STOPPED) ||
	     (mqtt_worker_thread.stack != NULL) ||
	     (mqtt_adapter_thread.stack != NULL))) {
		k_mutex_unlock(&mqtt_lock);
		return -EBUSY;
	}

	err = zbus_obs_set_enable(&record_mqtt_subscriber, false);
	if (err < 0) {
		k_mutex_unlock(&mqtt_lock);
		return -EIO;
	}

	k_msgq_purge(&publication_queue);
	k_msgq_purge(&priority_queue);
	k_msgq_purge(&command_queue);
	k_msgq_purge(&request_queue);
	context.config = *config;
	context.status = (struct spaghetti_mqtt_status) {
		.state = SPAGHETTI_MQTT_STOPPED,
	};
	context.started = false;
	context.reconnect_delay_ms = SPAGHETTI_MQTT_RECONNECT_MIN_MS;
	context.next_connect_ms = 0;
	context.event_sequence = 1U;
	context.initialized = true;
	k_mutex_unlock(&mqtt_lock);

	LOG_INF("ready: enabled=%u security=%u", config->enabled ? 1U : 0U,
		(unsigned int)config->security);
	return 0;
}

int spaghetti_mqtt_start(void)
{
	const enum spaghetti_mqtt_command command =
		SPAGHETTI_MQTT_COMMAND_START;
	int err = k_mutex_lock(&mqtt_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized || !context.config.enabled) {
		k_mutex_unlock(&mqtt_lock);
		return -EACCES;
	}
	if (context.started) {
		k_mutex_unlock(&mqtt_lock);
		return -EALREADY;
	}

	(void)refresh_core_id_locked();
	err = zbus_obs_set_enable(&record_mqtt_subscriber, true);
	if (err < 0) {
		k_mutex_unlock(&mqtt_lock);
		return -EIO;
	}
	(void)spaghetti_record_delivery_set_consumer_active(
		SPAGHETTI_RECORD_CONSUMER_ID_MQTT, true);
	if (!context.network_callback_registered) {
		net_mgmt_init_event_callback(
			&network_callback, network_event_handler,
			NET_EVENT_IPV4_ADDR_ADD | NET_EVENT_IPV4_ADDR_DEL);
		net_mgmt_add_event_callback(&network_callback);
		context.network_callback_registered = true;
	}
	atomic_set(&stop_requested, 0);
	atomic_set(&auth_failed, 0);
	err = k_msgq_put(&command_queue, &command, K_NO_WAIT);
	if (err < 0) {
		k_mutex_unlock(&mqtt_lock);
		return -ENOMSG;
	}
	context.started = true;
	context.status.state = SPAGHETTI_MQTT_WAIT_NETWORK;
	context.status.last_error = 0;
	k_mutex_unlock(&mqtt_lock);

	err = spaghetti_service_thread_start(
		&mqtt_worker_thread, CONFIG_SPAGHETTI_MQTT_WORKER_STACK_SIZE,
		mqtt_worker_thread_entry, NULL, NULL, NULL,
		CONFIG_SPAGHETTI_MQTT_PRIORITY, "spaghetti_mqtt");
	if (err == 0) {
		err = spaghetti_service_thread_start(
			&mqtt_adapter_thread,
			CONFIG_SPAGHETTI_MQTT_ADAPTER_STACK_SIZE,
			mqtt_adapter_thread_entry, NULL, NULL, NULL,
			CONFIG_SPAGHETTI_MQTT_PRIORITY, "mqtt_adapter");
	}
	if (err < 0) {
		atomic_set(&stop_requested, 1);
		k_sem_give(&network_event_sem);
		if (mqtt_worker_thread.stack != NULL) {
			(void)spaghetti_service_thread_join_and_release(
				&mqtt_worker_thread, K_SECONDS(1));
		}
		k_msgq_purge(&command_queue);
		(void)zbus_obs_set_enable(&record_mqtt_subscriber, false);
		(void)spaghetti_record_delivery_set_consumer_active(
			SPAGHETTI_RECORD_CONSUMER_ID_MQTT, false);
		(void)k_mutex_lock(&mqtt_lock, K_FOREVER);
		context.started = false;
		context.status.state = SPAGHETTI_MQTT_STOPPED;
		context.status.last_error = err;
		if (context.network_callback_registered) {
			net_mgmt_del_event_callback(&network_callback);
			context.network_callback_registered = false;
		}
		k_mutex_unlock(&mqtt_lock);
	}
	return err;
}

int spaghetti_mqtt_stop(k_timeout_t timeout)
{
	const enum spaghetti_mqtt_command command =
		SPAGHETTI_MQTT_COMMAND_STOP;
	int64_t timeout_ms;
	int err;

	if (K_TIMEOUT_EQ(timeout, K_FOREVER)) {
		return -EINVAL;
	}
	timeout_ms = k_ticks_to_ms_floor64(timeout.ticks);
	if ((timeout_ms < 0) ||
	    (timeout_ms > CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS)) {
		return -EINVAL;
	}
	err = k_mutex_lock(&mqtt_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&mqtt_lock);
		return -EACCES;
	}
	if (!context.started && (mqtt_worker_thread.stack == NULL) &&
	    (mqtt_adapter_thread.stack == NULL)) {
		k_mutex_unlock(&mqtt_lock);
		return -EALREADY;
	}

	atomic_set(&stop_requested, 1);
	err = context.started ?
		k_msgq_put(&command_queue, &command, K_NO_WAIT) : 0;
	k_sem_give(&network_event_sem);
	k_mutex_unlock(&mqtt_lock);
	if (err < 0) {
		return -ENOMSG;
	}

	const k_timepoint_t deadline = sys_timepoint_calc(timeout);

	if (mqtt_worker_thread.stack != NULL) {
		err = spaghetti_service_thread_join_and_release(
			&mqtt_worker_thread, sys_timepoint_timeout(deadline));
		if (err < 0) {
			return err;
		}
	}
	if (mqtt_adapter_thread.stack != NULL) {
		err = spaghetti_service_thread_join_and_release(
			&mqtt_adapter_thread, sys_timepoint_timeout(deadline));
		if (err < 0) {
			return err;
		}
	}
	(void)zbus_obs_set_enable(&record_mqtt_subscriber, false);
	(void)spaghetti_record_delivery_set_consumer_active(
		SPAGHETTI_RECORD_CONSUMER_ID_MQTT, false);
	(void)k_mutex_lock(&mqtt_lock, K_FOREVER);
	if (context.network_callback_registered) {
		net_mgmt_del_event_callback(&network_callback);
		context.network_callback_registered = false;
	}
	context.started = false;
	context.status.state = SPAGHETTI_MQTT_STOPPED;
	k_mutex_unlock(&mqtt_lock);
	return 0;
}

int spaghetti_mqtt_publish(
	const struct spaghetti_mqtt_publication *publication)
{
	struct k_msgq *queue;
	int err;

	if (!publication_is_valid(publication)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&mqtt_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized || !context.config.enabled) {
		k_mutex_unlock(&mqtt_lock);
		return -EACCES;
	}

	queue = (publication->publish_class ==
		 SPAGHETTI_MQTT_PUBLISH_PRIORITY) ?
			&priority_queue :
			&publication_queue;
	err = k_msgq_put(queue, publication, K_NO_WAIT);
	if (err < 0) {
		++context.status.dropped;
		context.status.last_error = -ENOMSG;
		k_mutex_unlock(&mqtt_lock);
		return -ENOMSG;
	}
	++context.status.queued;
	k_mutex_unlock(&mqtt_lock);
	return 0;
}

int spaghetti_mqtt_get_status(struct spaghetti_mqtt_status *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&mqtt_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&mqtt_lock);
		return -EACCES;
	}

	*out = context.status;
	k_mutex_unlock(&mqtt_lock);
	return 0;
}

int spaghetti_mqtt_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const char *identity,
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(identity);

	if ((psk == NULL) || (psk_size != SPAGHETTI_MQTT_PSK_SIZE)) {
		return -EINVAL;
	}
	return spaghetti_mqtt_credentials_set(1U, principal_id, psk, psk_size,
					      NULL, 0U, NULL, 0U);
}

int spaghetti_mqtt_rotate_credentials(
	const uint8_t *psk, size_t psk_size,
	const char *identity)
{
	spaghetti_principal_id_t principal_id;
	int err;

	ARG_UNUSED(identity);
	if ((psk == NULL) || (psk_size != SPAGHETTI_MQTT_PSK_SIZE)) {
		return -EINVAL;
	}
	err = spaghetti_mqtt_credentials_resolve_principal(1U, &principal_id);
	if (err < 0) {
		return err;
	}
	return spaghetti_mqtt_credentials_set(1U, principal_id, psk, psk_size,
					      NULL, 0U, NULL, 0U);
}

int spaghetti_mqtt_clear_credentials(void)
{
	bool any = false;
	int err;

	for (uint16_t credential_id = 1U;
	     credential_id <= CONFIG_SPAGHETTI_MQTT_CREDENTIAL_SLOTS;
	     ++credential_id) {
		bool exists = false;

		if ((spaghetti_mqtt_credentials_exists(credential_id,
						       &exists) == 0) &&
		    exists) {
			any = true;
			break;
		}
	}
	err = spaghetti_mqtt_credentials_erase_all();
	if (err < 0) {
		return err;
	}
	return any ? 0 : -ENOENT;
}

int spaghetti_mqtt_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	return spaghetti_mqtt_credentials_delete_for_principal(principal_id);
}

int spaghetti_mqtt_get_credential_metadata(
	struct spaghetti_mqtt_credential_metadata *out)
{
	spaghetti_principal_id_t principal_id;
	bool exists = false;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}
	err = spaghetti_mqtt_credentials_exists(1U, &exists);
	if (err < 0) {
		return err;
	}
	*out = (struct spaghetti_mqtt_credential_metadata) {
		.present = exists,
	};
	if (!exists) {
		return 0;
	}
	err = spaghetti_mqtt_credentials_resolve_principal(1U, &principal_id);
	if (err < 0) {
		out->present = true;
		out->principal_id = 0U;
		return 0;
	}
	out->principal_id = principal_id;
	return 0;
}

#if IS_ENABLED(CONFIG_SPAGHETTI_MQTT_TEST_HOOKS)
void spaghetti_mqtt_test_set_transport(
	const struct spaghetti_mqtt_test_transport *transport)
{
	if (transport == NULL) {
		test_transport_installed = false;
		memset(&test_transport, 0, sizeof(test_transport));
		return;
	}
	test_transport = *transport;
	test_transport_installed = true;
}

void spaghetti_mqtt_test_clear_transport(void)
{
	spaghetti_mqtt_test_set_transport(NULL);
}

int spaghetti_mqtt_test_inject_request(
	const char *client_id,
	const uint8_t *payload,
	size_t payload_size)
{
	return enqueue_request(client_id, payload, payload_size);
}

int spaghetti_mqtt_test_last_publish(
	char *topic,
	size_t topic_capacity,
	uint8_t *payload,
	size_t payload_capacity,
	size_t *payload_size,
	uint8_t *qos,
	bool *retain)
{
	if ((topic == NULL) || (payload == NULL) || (payload_size == NULL) ||
	    (qos == NULL) || (retain == NULL) || (topic_capacity == 0U)) {
		return -EINVAL;
	}
	(void)k_mutex_lock(&test_publish_lock, K_FOREVER);
	if (test_last_payload_size == 0U) {
		k_mutex_unlock(&test_publish_lock);
		return -ENOENT;
	}
	if ((strlen(test_last_topic) >= topic_capacity) ||
	    (test_last_payload_size > payload_capacity)) {
		k_mutex_unlock(&test_publish_lock);
		return -EMSGSIZE;
	}
	(void)strncpy(topic, test_last_topic, topic_capacity);
	topic[topic_capacity - 1U] = '\0';
	memcpy(payload, test_last_payload, test_last_payload_size);
	*payload_size = test_last_payload_size;
	*qos = test_last_qos;
	*retain = test_last_retain;
	k_mutex_unlock(&test_publish_lock);
	return 0;
}

bool spaghetti_mqtt_test_wait_state(
	enum spaghetti_mqtt_state state,
	k_timeout_t timeout)
{
	const int64_t deadline = k_uptime_get() +
		k_ticks_to_ms_floor64(timeout.ticks);

	while (k_uptime_get() <= deadline) {
		struct spaghetti_mqtt_status status;

		if ((spaghetti_mqtt_get_status(&status) == 0) &&
		    (status.state == state)) {
			return true;
		}
		k_sleep(K_MSEC(10));
	}
	return false;
}

void spaghetti_mqtt_test_set_network_ready(bool ready)
{
	context.network_ready_override = ready;
	if (ready) {
		atomic_set(&network_is_ready, 1);
		k_sem_give(&network_event_sem);
	} else {
		atomic_set(&network_is_ready, 0);
	}
}

void spaghetti_mqtt_test_set_device_id(const uint8_t device_id[32])
{
	if (device_id == NULL) {
		return;
	}
	(void)k_mutex_lock(&mqtt_lock, K_FOREVER);
	memcpy(context.device_id, device_id, sizeof(context.device_id));
	context.device_id_override = true;
	(void)hex_encode_device_id(context.device_id, context.core_id_hex,
				   sizeof(context.core_id_hex));
	k_mutex_unlock(&mqtt_lock);
}
#endif /* CONFIG_SPAGHETTI_MQTT_TEST_HOOKS */
