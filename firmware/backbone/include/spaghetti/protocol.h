/**
 * @file
 * @brief Transport-independent Communication Protocol V1 envelope and handlers.
 * @ingroup spaghetti_communication
 */

#ifndef SPAGHETTI_PROTOCOL_H
#define SPAGHETTI_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/iterable_sections.h>
#include <zephyr/sys/util.h>

#include <spaghetti/access_control.h>
#include <spaghetti/core.h>
#include <spaghetti/schema.h>

/** Machine protocol revision carried by every V1 envelope. */
#define SPAGHETTI_PROTOCOL_VERSION 1U

/** Absolute maximum payload bytes accepted by any Protocol V1 profile. */
#define SPAGHETTI_PROTOCOL_PAYLOAD_ABSOLUTE_MAX 2048U

/**
 * Profile payload ceiling. Prefer the historical Kconfig name so capabilities
 * and existing boards keep working; Protocol V1 documents the same limit.
 */
#define SPAGHETTI_PROTOCOL_PAYLOAD_MAX CONFIG_SPAGHETTI_MAX_PROTOCOL_PAYLOAD

/** Stable Protocol V1 operation identifiers. */
enum spaghetti_protocol_operation {
	SPAGHETTI_PROTOCOL_GET_CATALOG = 1, /**< Page catalog fingerprint and drivers. */
	SPAGHETTI_PROTOCOL_GET_STATUS = 2, /**< Bounded Core and Module status. */
	SPAGHETTI_PROTOCOL_APPLY_CONFIG = 3, /**< Compare-and-swap Config apply. */
	SPAGHETTI_PROTOCOL_LIST_DISCOVERY = 4, /**< Page Discovery candidates. */
	SPAGHETTI_PROTOCOL_SCAN_DISCOVERY = 5, /**< Scan one Port for candidates. */
	SPAGHETTI_PROTOCOL_ACCEPT_DISCOVERY = 6, /**< Accept candidate into Config. */
	SPAGHETTI_PROTOCOL_MODULE_COMMAND = 7, /**< Command a Module by stable key. */
	SPAGHETTI_PROTOCOL_GET_UPDATE_STATUS = 8, /**< Read-only Update snapshot. */
	SPAGHETTI_PROTOCOL_GET_CAPABILITIES = 9, /**< Immutable build capabilities. */
	SPAGHETTI_PROTOCOL_GET_CONNECTIVITY_STATUS = 10, /**< Connectivity policy snapshot. */
	SPAGHETTI_PROTOCOL_ACQUIRE_CONNECTIVITY_LEASE = 11, /**< Acquire temporary lease. */
	SPAGHETTI_PROTOCOL_RELEASE_CONNECTIVITY_LEASE = 12, /**< Release temporary lease. */
	SPAGHETTI_PROTOCOL_OPEN_NETWORK_MAINTENANCE = 13, /**< Open network Maintenance job. */
	SPAGHETTI_PROTOCOL_OPEN_WIFI_UPDATE = 14, /**< Open Wi-Fi Update job. */
	SPAGHETTI_PROTOCOL_FACTORY_RESET = 15, /**< Scoped factory reset. */
	SPAGHETTI_PROTOCOL_GET_CONFIG = 16, /**< Read Config CBOR and revision. */
	SPAGHETTI_PROTOCOL_VALIDATE_CONFIG = 17, /**< Validate Config without apply. */
	SPAGHETTI_PROTOCOL_GET_AUDIT_LOG = 18, /**< Page audit metadata. */
	SPAGHETTI_PROTOCOL_GET_JOB_STATUS = 19, /**< Poll an async job. */
	SPAGHETTI_PROTOCOL_GET_TOPOLOGY = 20, /**< Page Flow/Port/Bay topology. */
	SPAGHETTI_PROTOCOL_GET_RESOURCES = 21, /**< Resource capacity, high-water, flash/RAM. */
	/**
	 * GET_RESOURCES response keys (append-only V1):
	 * 0 feature_set_hash, 1-6 pools, 7 allocation_failures,
	 * 8 flash_slot_bytes, 9 flash_image_budget_bytes,
	 * 10 flash_headroom_bytes, 11 static_ram_budget_bytes.
	 */
	SPAGHETTI_PROTOCOL_LIST_DEVICE_PROFILES = 22, /**< Page Device Profiles. */
	SPAGHETTI_PROTOCOL_GET_DEVICE_PROFILE = 23, /**< Read one Device Profile. */
	SPAGHETTI_PROTOCOL_VALIDATE_DEVICE_PROFILE = 24, /**< Validate profile CBOR. */
	SPAGHETTI_PROTOCOL_INSTALL_DEVICE_PROFILE = 25, /**< Install profile CBOR. */
	SPAGHETTI_PROTOCOL_REMOVE_DEVICE_PROFILE = 26, /**< Remove an installed profile. */
	SPAGHETTI_PROTOCOL_GET_FEATURES = 27, /**< Feature packs and set hash. */
	SPAGHETTI_PROTOCOL_OPEN_BLE_UPDATE = 28, /**< Open BLE Update session. */
	SPAGHETTI_PROTOCOL_WRITE_BLE_UPDATE = 29, /**< Write one BLE Update chunk. */
	SPAGHETTI_PROTOCOL_FINISH_BLE_UPDATE = 30, /**< Finish BLE Update session. */
	SPAGHETTI_PROTOCOL_CANCEL_BLE_UPDATE = 31, /**< Cancel BLE Update session. */
};

/** Public status codes exposed to hosts; never raw Zephyr errno. */
enum spaghetti_protocol_status {
	SPAGHETTI_PROTOCOL_STATUS_OK = 0, /**< Operation succeeded. */
	SPAGHETTI_PROTOCOL_STATUS_INVALID_ARGUMENT = 1, /**< Request arguments are invalid. */
	SPAGHETTI_PROTOCOL_STATUS_UNSUPPORTED = 2, /**< Operation or feature unsupported. */
	SPAGHETTI_PROTOCOL_STATUS_UNAUTHORIZED = 3, /**< Principal lacks permission. */
	SPAGHETTI_PROTOCOL_STATUS_CONFLICT = 4, /**< CAS, replay, or identity conflict. */
	SPAGHETTI_PROTOCOL_STATUS_BUSY = 5, /**< Resource temporarily busy. */
	SPAGHETTI_PROTOCOL_STATUS_UNAVAILABLE = 6, /**< Dependency unavailable. */
	SPAGHETTI_PROTOCOL_STATUS_TIMEOUT = 7, /**< Bounded wait expired. */
	SPAGHETTI_PROTOCOL_STATUS_RESOURCE_EXHAUSTED = 8, /**< Queue, pool, or payload full. */
	SPAGHETTI_PROTOCOL_STATUS_MALFORMED_REQUEST = 9, /**< CBOR or framing is malformed. */
	SPAGHETTI_PROTOCOL_STATUS_INTERNAL_ERROR = 10, /**< Unexpected internal failure. */
};

/** Machine event types published on the event stream. */
enum spaghetti_protocol_event_type {
	SPAGHETTI_PROTOCOL_EVENT_RECORD = 1, /**< Module record event. */
	SPAGHETTI_PROTOCOL_EVENT_STATUS = 2, /**< Device status event. */
	SPAGHETTI_PROTOCOL_EVENT_DISCOVERY = 3, /**< Discovery candidate event. */
	SPAGHETTI_PROTOCOL_EVENT_CONNECTIVITY = 4, /**< Connectivity change event. */
};

/** How Communication schedules one operation. */
enum spaghetti_operation_execution {
	SPAGHETTI_OPERATION_IMMEDIATE_READ, /**< Snapshot read; may run inline. */
	SPAGHETTI_OPERATION_SERIALIZED_MUTATION, /**< Bounded mutation worker. */
	SPAGHETTI_OPERATION_ASYNC_JOB, /**< Long job; returns job_id. */
};

/** Caller-owned bounded payload buffer. */
struct spaghetti_protocol_payload {
	size_t size; /**< Valid leading bytes in @ref bytes. */
	uint8_t bytes[SPAGHETTI_PROTOCOL_PAYLOAD_MAX]; /**< Owned payload. */
};

/** Caller-owned Protocol V1 request envelope. */
struct spaghetti_protocol_request {
	uint16_t version; /**< Must equal @ref SPAGHETTI_PROTOCOL_VERSION. */
	uint32_t correlation_id; /**< Nonzero ID copied into the response. */
	enum spaghetti_protocol_operation operation; /**< Selected operation. */
	struct spaghetti_protocol_payload payload; /**< Operation request body. */
};

/** Caller-owned Protocol V1 response envelope. */
struct spaghetti_protocol_response {
	uint16_t version; /**< Always @ref SPAGHETTI_PROTOCOL_VERSION on success. */
	uint32_t correlation_id; /**< Exact ID from the accepted request. */
	enum spaghetti_protocol_status status; /**< Public V1 status. */
	struct spaghetti_protocol_payload payload; /**< Operation response body. */
};

/**
 * @brief Authenticated adapter context for one request.
 *
 * @p permissions is the adapter maximum already intersected with the peer;
 * Communication still authorizes @p principal_id for the handler requirements.
 */
struct spaghetti_request_context {
	spaghetti_principal_id_t principal_id; /**< Authenticated peer identity. */
	uint32_t permissions; /**< Adapter-capped permission bits. */
	bool local; /**< True for local USB/UART adapters. */
	enum spaghetti_core_mode core_mode; /**< Mode observed by the adapter. */
};

/**
 * @brief Execute one authorized operation.
 *
 * @param[in] context Borrowed authenticated adapter context.
 * @param[in] request Borrowed operation request payload.
 * @param[out] response Caller-owned response payload written only on success.
 *
 * @retval 0 Response payload was written.
 * @retval -errno Domain failure mapped by Communication into public status.
 */
typedef int (*spaghetti_operation_execute_fn)(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response);

/**
 * @brief Firmware-lifetime operation handler registered via iterable section.
 */
struct spaghetti_operation_handler {
	enum spaghetti_protocol_operation operation; /**< Unique operation ID. */
	uint32_t required_permissions; /**< Bits the principal must hold. */
	enum spaghetti_operation_execution execution; /**< Scheduling class. */
	const struct spaghetti_schema_descriptor *request_schema; /**< Request schema. */
	const struct spaghetti_schema_descriptor *response_schema; /**< Response schema. */
	spaghetti_operation_execute_fn execute; /**< Handler body. */
};

/**
 * @brief Map an internal errno into the frozen Protocol V1 status domain.
 *
 * @param[in] error Zero or negative errno copied by value.
 *
 * @return Matching @ref spaghetti_protocol_status value.
 */
enum spaghetti_protocol_status spaghetti_protocol_status_from_errno(int error);

/**
 * @brief Encode one Protocol V1 request envelope as canonical CBOR.
 *
 * @param[in] request Borrowed request copied into CBOR.
 * @param[out] buffer Caller-owned destination.
 * @param[in] capacity Capacity of @p buffer.
 * @param[out] written_size Encoded size written only on success.
 *
 * @retval 0 Canonical CBOR was written.
 * @retval -EINVAL A pointer is NULL or the request is invalid.
 * @retval -EMSGSIZE The encoded envelope exceeds @p capacity.
 */
int spaghetti_protocol_encode_request(
	const struct spaghetti_protocol_request *request,
	uint8_t *buffer,
	size_t capacity,
	size_t *written_size);

/**
 * @brief Decode one Protocol V1 request envelope from canonical CBOR.
 *
 * @param[in] bytes Borrowed complete CBOR input.
 * @param[in] length Exact byte count of @p bytes.
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains a validated request.
 * @retval -EINVAL A pointer is NULL.
 * @retval -EBADMSG The CBOR shape is invalid.
 * @retval -ENOTSUP The envelope version is unsupported.
 * @retval -EMSGSIZE The payload exceeds the profile ceiling.
 */
int spaghetti_protocol_decode_request(
	const uint8_t *bytes,
	size_t length,
	struct spaghetti_protocol_request *out);

/**
 * @brief Encode one Protocol V1 response envelope as canonical CBOR.
 *
 * @param[in] response Borrowed response copied into CBOR.
 * @param[out] buffer Caller-owned destination.
 * @param[in] capacity Capacity of @p buffer.
 * @param[out] written_size Encoded size written only on success.
 *
 * @retval 0 Canonical CBOR was written.
 * @retval -EINVAL A pointer is NULL or the response is invalid.
 * @retval -EMSGSIZE The encoded envelope exceeds @p capacity.
 */
int spaghetti_protocol_encode_response(
	const struct spaghetti_protocol_response *response,
	uint8_t *buffer,
	size_t capacity,
	size_t *written_size);

/**
 * @brief Decode one Protocol V1 response envelope from canonical CBOR.
 *
 * @param[in] bytes Borrowed complete CBOR input.
 * @param[in] length Exact byte count of @p bytes.
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains a validated response.
 * @retval -EINVAL A pointer is NULL.
 * @retval -EBADMSG The CBOR shape is invalid.
 * @retval -ENOTSUP The envelope version is unsupported.
 * @retval -EMSGSIZE The payload exceeds the profile ceiling.
 */
int spaghetti_protocol_decode_response(
	const uint8_t *bytes,
	size_t length,
	struct spaghetti_protocol_response *out);

/**
 * @brief Encode one Protocol V1 event envelope as canonical CBOR.
 *
 * @param[in] type Event type copied by value.
 * @param[in] sequence Monotonic event sequence.
 * @param[in] payload Borrowed event body; may be empty.
 * @param[out] buffer Caller-owned destination.
 * @param[in] capacity Capacity of @p buffer.
 * @param[out] written_size Encoded size written only on success.
 *
 * @retval 0 Canonical CBOR was written.
 * @retval -EINVAL A pointer is NULL or @p type is unknown.
 * @retval -EMSGSIZE The encoded envelope exceeds @p capacity.
 */
int spaghetti_protocol_encode_event(
	enum spaghetti_protocol_event_type type,
	uint32_t sequence,
	const struct spaghetti_protocol_payload *payload,
	uint8_t *buffer,
	size_t capacity,
	size_t *written_size);

/**
 * @brief Encode a bounded record event payload.
 *
 * @param[in] source_key Stable Module key.
 * @param[in] sequence Per-source sequence.
 * @param[in] schema_id Borrowed schema identifier.
 * @param[in] schema_version Schema version.
 * @param[out] out Caller-owned payload written only on success.
 *
 * @retval 0 Payload encoded.
 * @retval -EINVAL A pointer is NULL.
 * @retval -EMSGSIZE Encoded payload exceeds the profile ceiling.
 */
int spaghetti_protocol_encode_record_event_payload(
	uint32_t source_key,
	uint32_t sequence,
	const char *schema_id,
	uint16_t schema_version,
	struct spaghetti_protocol_payload *out);

/**
 * @brief Encode a bounded status event payload.
 *
 * @param[in] device_id Borrowed public device identity bytes.
 * @param[in] device_id_size Byte count of @p device_id.
 * @param[in] boot_id Boot epoch.
 * @param[in] queue_depth Record queue depth.
 * @param[in] drop_count Dropped record count.
 * @param[out] out Caller-owned payload written only on success.
 *
 * @retval 0 Payload encoded.
 * @retval -EINVAL A pointer is NULL.
 * @retval -EMSGSIZE Encoded payload exceeds the profile ceiling.
 */
int spaghetti_protocol_encode_status_event_payload(
	const uint8_t *device_id,
	size_t device_id_size,
	uint64_t boot_id,
	uint32_t queue_depth,
	uint32_t drop_count,
	struct spaghetti_protocol_payload *out);

/**
 * @brief Encode a bounded discovery event payload.
 *
 * @param[in] candidate_id Ephemeral candidate identity.
 * @param[in] port_id Port that owns the candidate.
 * @param[in] generation Candidate generation.
 * @param[out] out Caller-owned payload written only on success.
 *
 * @retval 0 Payload encoded.
 * @retval -EINVAL @p out is NULL.
 * @retval -EMSGSIZE Encoded payload exceeds the profile ceiling.
 */
int spaghetti_protocol_encode_discovery_event_payload(
	uint32_t candidate_id,
	uint8_t port_id,
	uint32_t generation,
	struct spaghetti_protocol_payload *out);

/**
 * @brief Encode a bounded connectivity event payload.
 *
 * @param[in] policy Connectivity policy numeric value.
 * @param[in] active_services Active service bitmask.
 * @param[in] last_error Last transition errno.
 * @param[out] out Caller-owned payload written only on success.
 *
 * @retval 0 Payload encoded.
 * @retval -EINVAL @p out is NULL.
 * @retval -EMSGSIZE Encoded payload exceeds the profile ceiling.
 */
int spaghetti_protocol_encode_connectivity_event_payload(
	uint32_t policy,
	uint32_t active_services,
	int32_t last_error,
	struct spaghetti_protocol_payload *out);

/** Iterable-section helper used by @ref SPAGHETTI_OPERATION_HANDLER_DEFINE. */
#define SPAGHETTI_OPERATION_HANDLER_DEFINE(name) \
	const STRUCT_SECTION_ITERABLE(spaghetti_operation_handler, name)

#endif /* SPAGHETTI_PROTOCOL_H */
