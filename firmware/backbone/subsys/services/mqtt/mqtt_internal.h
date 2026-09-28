#ifndef SPAGHETTI_MQTT_INTERNAL_H
#define SPAGHETTI_MQTT_INTERNAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

#include <spaghetti/data.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/schema.h>

/** Encode one record as a Protocol V1 MQTT publication (records class). */
int spaghetti_mqtt_format_record(
	const struct spaghetti_record *record,
	struct spaghetti_mqtt_publication *out);

#if IS_ENABLED(CONFIG_SPAGHETTI_MQTT_TEST_HOOKS)

/** Stub transport operations used by native_sim tests. */
struct spaghetti_mqtt_test_transport {
	int (*connect)(void *ctx);
	void (*disconnect)(void *ctx);
	int (*subscribe)(void *ctx, const char *topic);
	int (*publish)(void *ctx, const char *topic, const uint8_t *payload,
			size_t payload_size, uint8_t qos, bool retain);
	/** Return 0, or negative errno; may call inject helpers. */
	int (*process)(void *ctx, int timeout_ms);
	void *ctx;
};

void spaghetti_mqtt_test_set_transport(
	const struct spaghetti_mqtt_test_transport *transport);
void spaghetti_mqtt_test_clear_transport(void);

/**
 * @brief Deliver one request payload as if published on requests/<client_id>.
 *
 * Must be called from the MQTT worker context via the stub process hook, or
 * from a test thread while the worker is connected (queued for the worker).
 */
int spaghetti_mqtt_test_inject_request(
	const char *client_id,
	const uint8_t *payload,
	size_t payload_size);

/** Copy the latest retained/priority publish matching a topic suffix. */
int spaghetti_mqtt_test_last_publish(
	char *topic,
	size_t topic_capacity,
	uint8_t *payload,
	size_t payload_capacity,
	size_t *payload_size,
	uint8_t *qos,
	bool *retain);

bool spaghetti_mqtt_test_wait_state(
	enum spaghetti_mqtt_state state,
	k_timeout_t timeout);

/** Force network-ready without IPv4 callbacks. */
void spaghetti_mqtt_test_set_network_ready(bool ready);

/** Override identity device_id used for core_id hex (32 bytes). */
void spaghetti_mqtt_test_set_device_id(const uint8_t device_id[32]);

#endif /* CONFIG_SPAGHETTI_MQTT_TEST_HOOKS */

#endif /* SPAGHETTI_MQTT_INTERNAL_H */
