/**
 * @file
 * @brief Public bounded MQTT Protocol V1 adapter contract.
 * @ingroup spaghetti_mqtt
 *
 * Topic layout under `<base>/v1/cores/<core_id>/` (QoS in parentheses):
 *
 * | Relative topic | Direction | Notes |
 * |---|---|---|
 * | `state` | publish | retained QoS 1 |
 * | `catalog` | publish | retained QoS 1, paginated |
 * | `modules/<key>/records` | publish | QoS 0, not retained |
 * | `discovery` | publish | QoS 1, not retained |
 * | `requests/<client_id>` | subscribe | QoS 1; `client_id` max 32 |
 * | `responses/<client_id>` | publish | QoS 1 |
 *
 * `core_id` is the canonical lowercase hex of the immutable identity
 * `device_id` (64 hex characters). It is not a Config field. Payloads are
 * Protocol V1 CBOR envelopes/events; Node-RED translates CBOR to JS objects.
 */

#ifndef SPAGHETTI_MQTT_H
#define SPAGHETTI_MQTT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

#include <spaghetti/access_control.h>

/** Maximum MQTT broker host bytes, including the terminating NUL. */
#define SPAGHETTI_MQTT_HOST_SIZE 64U

/** Maximum MQTT base-topic bytes, including the terminating NUL. */
#define SPAGHETTI_MQTT_BASE_TOPIC_SIZE 96U

/** Compatibility alias for @ref SPAGHETTI_MQTT_BASE_TOPIC_SIZE. */
#define SPAGHETTI_MQTT_TOPIC_SIZE SPAGHETTI_MQTT_BASE_TOPIC_SIZE

/**
 * Maximum relative topic-suffix bytes under the core prefix, including NUL.
 * Sized for `modules/<uint32>/records` and similar short suffixes.
 */
#define SPAGHETTI_MQTT_TOPIC_SUFFIX_SIZE 48U

/** Maximum MQTT client_id bytes in request/response topics, including NUL. */
#define SPAGHETTI_MQTT_CLIENT_ID_SIZE 32U

/** Canonical hex length of `device_id` used as `core_id` (no NUL). */
#define SPAGHETTI_MQTT_CORE_ID_HEX_SIZE (SPAGHETTI_DEVICE_ID_SIZE * 2U)

/**
 * Maximum MQTT application payload bytes (Protocol V1 envelope including
 * profile payload ceiling overhead).
 */
#define SPAGHETTI_MQTT_PAYLOAD_SIZE \
	(CONFIG_SPAGHETTI_MAX_PROTOCOL_PAYLOAD + 64U)

/** @deprecated Fixed MQTT PSK size retained for the phase-355 stub API. */
#define SPAGHETTI_MQTT_PSK_SIZE 32U

/** @deprecated Maximum MQTT credential identity bytes including NUL. */
#define SPAGHETTI_MQTT_CREDENTIAL_IDENTITY_SIZE 32U

/** Broker authentication / transport security mode. */
enum spaghetti_mqtt_security {
	SPAGHETTI_MQTT_SECURITY_TLS_SERVER = 0, /**< TLS server auth + hostname check. */
	SPAGHETTI_MQTT_SECURITY_TLS_MUTUAL = 1, /**< Mutual TLS with client certificate. */
	SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT = 2, /**< Cleartext; gated by Kconfig. */
};

/** MQTT service lifecycle visible to diagnostics. */
enum spaghetti_mqtt_state {
	SPAGHETTI_MQTT_STOPPED, /**< No connection or reconnect is active. */
	SPAGHETTI_MQTT_WAIT_NETWORK, /**< Started and waiting for an IPv4 address. */
	SPAGHETTI_MQTT_CONNECTED, /**< Connected to the configured broker. */
	SPAGHETTI_MQTT_ERROR, /**< A transient error is waiting for bounded retry. */
	SPAGHETTI_MQTT_DEGRADED, /**< Bad TLS/creds; Runtime continues without MQTT. */
};

/** @brief Complete copied MQTT endpoint configuration. */
struct spaghetti_mqtt_config {
	bool enabled; /**< True when the service may start and publish. */
	char host[SPAGHETTI_MQTT_HOST_SIZE]; /**< Owned DNS name or IPv4 text. */
	uint16_t port; /**< TCP broker port in host byte order. */
	char base_topic[SPAGHETTI_MQTT_BASE_TOPIC_SIZE]; /**< Owned prefix, no trailing slash. */
	enum spaghetti_mqtt_security security; /**< Transport security mode. */
	uint16_t credential_id; /**< Secure-storage slot; zero only when disabled. */
};

/** Publication priority class for separate QoS1 pools. */
enum spaghetti_mqtt_publish_class {
	SPAGHETTI_MQTT_PUBLISH_PRIORITY = 0, /**< State/response QoS1 pool. */
	SPAGHETTI_MQTT_PUBLISH_RECORDS = 1, /**< Best-effort records/discovery pool. */
};

/** @brief Complete caller-owned publication copied into an outbound queue. */
struct spaghetti_mqtt_publication {
	/** Relative topic under the core prefix without leading/trailing slash. */
	char topic_suffix[SPAGHETTI_MQTT_TOPIC_SUFFIX_SIZE];
	size_t payload_size; /**< Valid leading bytes in @ref payload. */
	uint8_t payload[SPAGHETTI_MQTT_PAYLOAD_SIZE]; /**< Owned payload bytes. */
	uint8_t qos; /**< MQTT QoS 0 or 1. */
	bool retain; /**< Retain flag. */
	enum spaghetti_mqtt_publish_class publish_class; /**< Queue selection. */
};

/** @brief Caller-owned snapshot of bounded MQTT diagnostics. */
struct spaghetti_mqtt_status {
	enum spaghetti_mqtt_state state; /**< Current lifecycle state. */
	uint32_t queued; /**< Publications accepted since the last configuration. */
	uint32_t published; /**< Publications successfully passed to MQTT. */
	uint32_t dropped; /**< Publications rejected or lost after acceptance. */
	int last_error; /**< Latest negative errno, or zero when none is recorded. */
};

/** Non-sensitive metadata for the legacy MQTT credential stub. */
struct spaghetti_mqtt_credential_metadata {
	bool present; /**< True when a credential record exists. */
	spaghetti_principal_id_t principal_id; /**< Bound principal, or zero. */
	char identity[SPAGHETTI_MQTT_CREDENTIAL_IDENTITY_SIZE]; /**< Public label. */
};

/**
 * @brief Initialize or replace the stopped MQTT service configuration.
 *
 * The first successful call prepares stopped state without allocating workers.
 * A later call replaces the copied configuration only while the service is
 * stopped and clears queued publications and diagnostics.
 *
 * @param[in] config Caller-owned configuration borrowed only for this call
 *                   and copied on success. Disabled configuration must use
 *                   empty host/topic strings, port zero, security
 *                   @ref SPAGHETTI_MQTT_SECURITY_TLS_SERVER, and credential_id
 *                   zero. Plaintext requires the development Kconfig gate.
 *
 * @retval 0 The copied configuration is ready in the stopped state.
 * @retval -EINVAL A pointer, string, port, security, or enabled-field combination is invalid.
 * @retval -EBUSY The service must be stopped before reconfiguration.
 * @retval -EIO The Data observer could not be enabled or disabled.
 *
 * @note Call from thread context. The call performs no socket or DNS work.
 */
int spaghetti_mqtt_init(const struct spaghetti_mqtt_config *config);

/**
 * @brief Request connection when IPv4 networking becomes ready.
 *
 * Started only through Connectivity / Service Manager in production. Before
 * opening TLS the worker acquires @ref SPAGHETTI_SECURE_OWNER_MQTT.
 *
 * @retval 0 The bounded start command was accepted.
 * @retval -EACCES MQTT is uninitialized or disabled by Config.
 * @retval -EALREADY MQTT is already started.
 * @retval -ENOMSG The bounded command queue is full.
 *
 * @note Call from thread context. Socket work occurs only in the MQTT worker.
 */
int spaghetti_mqtt_start(void);

/**
 * @brief Stop reconnect and wait for the worker to release its connection.
 *
 * Closes the socket, releases the secure workspace, and deactivates the
 * Record Delivery MQTT consumer.
 *
 * @param[in] timeout Finite maximum wait for worker exit and stack release.
 *
 * @retval 0 MQTT reached the stopped state.
 * @retval -EACCES MQTT is uninitialized.
 * @retval -EALREADY MQTT is already stopped.
 * @retval -ENOMSG The bounded command queue is full.
 * @retval -EAGAIN @p timeout expired before acknowledgement.
 * @retval -EINVAL @p timeout is K_FOREVER or exceeds the service limit.
 *
 * @note Call from thread context. Do not call from ISR context.
 */
int spaghetti_mqtt_stop(k_timeout_t timeout);

/**
 * @brief Queue one copied publication without network I/O.
 *
 * Priority publications use a dedicated QoS1 pool and are never silently
 * dropped for capacity; records use a separate best-effort pool.
 *
 * @param[in] publication Caller-owned bounded publication borrowed only for
 *                        this call and copied on success.
 *
 * @retval 0 The publication was copied into the outbound queue.
 * @retval -EINVAL A pointer, suffix, or payload size is invalid.
 * @retval -EACCES MQTT is uninitialized or disabled by Config.
 * @retval -ENOMSG The selected outbound queue is full.
 *
 * @note Thread-safe and non-blocking. The call is not ISR-safe because it
 *       updates coherent diagnostics under a mutex.
 */
int spaghetti_mqtt_publish(
	const struct spaghetti_mqtt_publication *publication);

/**
 * @brief Copy the current coherent MQTT status.
 *
 * @param[out] out Caller-owned destination written only on success and never retained.
 *
 * @retval 0 A coherent status snapshot was copied.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES MQTT is uninitialized.
 *
 * @note Thread-safe and callable from thread context without network I/O.
 */
int spaghetti_mqtt_get_status(struct spaghetti_mqtt_status *out);

/**
 * @brief Maximum adapter permissions for MQTT (no provision).
 *
 * Intersected with the credential-bound principal before Communication.
 *
 * @return Permission bitmask of read|configure|command|discover.
 */
uint32_t spaghetti_mqtt_adapter_permissions(void);

/**
 * @brief Store one MQTT credential bound to a principal (phase-355 stub).
 *
 * Prefer @ref spaghetti_mqtt_credentials_set. This entry point remains for
 * legacy Maintenance paths and maps onto credential slot 1 with empty TLS
 * material when sizes match the historical PSK contract.
 *
 * @param[in] psk Caller-owned secret borrowed only for this call.
 * @param[in] psk_size Must equal @ref SPAGHETTI_MQTT_PSK_SIZE.
 * @param[in] identity Caller-owned public NUL-terminated label (unused).
 * @param[in] principal_id Principal bound to this credential.
 *
 * @retval 0 The credential metadata and secret were stored.
 * @retval -EINVAL A pointer or size is invalid.
 * @retval -EACCES Local maintenance is not active.
 * @retval -ENOENT The principal is missing or revoked.
 */
int spaghetti_mqtt_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const char *identity,
	spaghetti_principal_id_t principal_id);

/**
 * @brief Replace the MQTT secret while preserving principal binding.
 *
 * @param[in] psk Caller-owned secret borrowed only for this call.
 * @param[in] psk_size Must equal @ref SPAGHETTI_MQTT_PSK_SIZE.
 * @param[in] identity Caller-owned public NUL-terminated label (unused).
 *
 * @retval 0 The credential was rotated.
 * @retval -EINVAL A pointer or size is invalid.
 * @retval -EACCES Local maintenance is not active.
 * @retval -ENOENT No credential was stored.
 */
int spaghetti_mqtt_rotate_credentials(
	const uint8_t *psk, size_t psk_size,
	const char *identity);

/**
 * @brief Delete every MQTT credential vault entry.
 *
 * Used by factory reset. Equivalent to clearing all credential slots.
 *
 * @retval 0 At least one credential was deleted, or the vault was empty after wipe.
 * @retval -ENOENT No credential was stored.
 */
int spaghetti_mqtt_clear_credentials(void);

/**
 * @brief Delete MQTT credentials bound to @p principal_id.
 *
 * @param[in] principal_id Principal whose credential should be removed.
 *
 * @retval 0 The credential was deleted.
 * @retval -EINVAL @p principal_id is zero.
 * @retval -ENOENT No credential is bound to that principal.
 */
int spaghetti_mqtt_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id);

/**
 * @brief Copy non-sensitive MQTT credential metadata for slot 1.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains metadata without secrets.
 * @retval -EINVAL @p out is NULL.
 */
int spaghetti_mqtt_get_credential_metadata(
	struct spaghetti_mqtt_credential_metadata *out);

#endif /* SPAGHETTI_MQTT_H */
