#include <spaghetti/protocol.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_decode.h>
#include <zcbor_encode.h>

#define SPAGHETTI_PROTOCOL_CBOR_BACKUP 4U
#define SPAGHETTI_PROTOCOL_KEY_VERSION 0U
#define SPAGHETTI_PROTOCOL_KEY_CORRELATION 1U
#define SPAGHETTI_PROTOCOL_KEY_OPCODE 2U
#define SPAGHETTI_PROTOCOL_KEY_PAYLOAD 3U

static int encode_envelope(uint16_t version, uint32_t field1, uint32_t field2,
			   const struct spaghetti_protocol_payload *payload,
			   uint8_t *buffer, size_t capacity, size_t *written_size)
{
	ZCBOR_STATE_E(state, SPAGHETTI_PROTOCOL_CBOR_BACKUP, buffer, capacity,
		       1U);

	if ((payload == NULL) || (buffer == NULL) || (written_size == NULL)) {
		return -EINVAL;
	}
	if (payload->size > SPAGHETTI_PROTOCOL_PAYLOAD_MAX) {
		return -EMSGSIZE;
	}
	if (!zcbor_map_start_encode(state, 4U) ||
	    !zcbor_uint32_put(state, SPAGHETTI_PROTOCOL_KEY_VERSION) ||
	    !zcbor_uint32_put(state, version) ||
	    !zcbor_uint32_put(state, SPAGHETTI_PROTOCOL_KEY_CORRELATION) ||
	    !zcbor_uint32_put(state, field1) ||
	    !zcbor_uint32_put(state, SPAGHETTI_PROTOCOL_KEY_OPCODE) ||
	    !zcbor_uint32_put(state, field2) ||
	    !zcbor_uint32_put(state, SPAGHETTI_PROTOCOL_KEY_PAYLOAD) ||
	    !zcbor_bstr_encode_ptr(state, payload->bytes, payload->size) ||
	    !zcbor_map_end_encode(state, 4U)) {
		return -EMSGSIZE;
	}

	*written_size = (size_t)(state->payload - buffer);
	return 0;
}

static int decode_envelope(const uint8_t *bytes, size_t length,
			   uint16_t *version, uint32_t *field1, uint32_t *field2,
			   struct spaghetti_protocol_payload *payload)
{
	uint32_t decoded_version;
	uint32_t decoded_field1;
	uint32_t decoded_field2;
	struct zcbor_string payload_bstr = {0};
	bool seen[4] = {false, false, false, false};
	uint32_t key;
	size_t remaining;

	ZCBOR_STATE_D(state, SPAGHETTI_PROTOCOL_CBOR_BACKUP, bytes, length, 1U,
		       0U);

	if ((bytes == NULL) || (version == NULL) || (field1 == NULL) ||
	    (field2 == NULL) || (payload == NULL)) {
		return -EINVAL;
	}
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}

	while (!zcbor_array_at_end(state)) {
		if (!zcbor_uint32_decode(state, &key)) {
			return -EBADMSG;
		}
		if (key > 3U) {
			return -EBADMSG;
		}
		if (seen[key]) {
			return -EBADMSG;
		}
		seen[key] = true;

		switch (key) {
		case SPAGHETTI_PROTOCOL_KEY_VERSION:
			if (!zcbor_uint32_decode(state, &decoded_version)) {
				return -EBADMSG;
			}
			break;
		case SPAGHETTI_PROTOCOL_KEY_CORRELATION:
			if (!zcbor_uint32_decode(state, &decoded_field1)) {
				return -EBADMSG;
			}
			break;
		case SPAGHETTI_PROTOCOL_KEY_OPCODE:
			if (!zcbor_uint32_decode(state, &decoded_field2)) {
				return -EBADMSG;
			}
			break;
		case SPAGHETTI_PROTOCOL_KEY_PAYLOAD:
			if (!zcbor_bstr_decode(state, &payload_bstr)) {
				return -EBADMSG;
			}
			break;
		default:
			return -EBADMSG;
		}
	}

	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}
	remaining = (size_t)(state->payload_end - state->payload);
	if (remaining != 0U) {
		return -EBADMSG;
	}
	if (!seen[0] || !seen[1] || !seen[2] || !seen[3]) {
		return -EBADMSG;
	}
	if (decoded_version != SPAGHETTI_PROTOCOL_VERSION) {
		return -ENOTSUP;
	}
	if (decoded_field1 == 0U) {
		return -EINVAL;
	}
	if (payload_bstr.len > SPAGHETTI_PROTOCOL_PAYLOAD_MAX) {
		return -EMSGSIZE;
	}

	*version = (uint16_t)decoded_version;
	*field1 = decoded_field1;
	*field2 = decoded_field2;
	payload->size = payload_bstr.len;
	if (payload_bstr.len > 0U) {
		memcpy(payload->bytes, payload_bstr.value, payload_bstr.len);
	}
	return 0;
}

int spaghetti_protocol_encode_request(
	const struct spaghetti_protocol_request *request,
	uint8_t *buffer,
	size_t capacity,
	size_t *written_size)
{
	if ((request == NULL) || (request->version != SPAGHETTI_PROTOCOL_VERSION) ||
	    (request->correlation_id == 0U)) {
		return -EINVAL;
	}

	return encode_envelope(request->version, request->correlation_id,
			       (uint32_t)request->operation, &request->payload,
			       buffer, capacity, written_size);
}

int spaghetti_protocol_decode_request(
	const uint8_t *bytes,
	size_t length,
	struct spaghetti_protocol_request *out)
{
	struct spaghetti_protocol_request decoded = {0};
	uint32_t operation;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = decode_envelope(bytes, length, &decoded.version,
			      &decoded.correlation_id, &operation,
			      &decoded.payload);
	if (err < 0) {
		return err;
	}
	if ((operation < (uint32_t)SPAGHETTI_PROTOCOL_GET_CATALOG) ||
	    (operation > (uint32_t)SPAGHETTI_PROTOCOL_GET_FEATURES)) {
		return -ENOTSUP;
	}

	decoded.operation = (enum spaghetti_protocol_operation)operation;
	*out = decoded;
	return 0;
}

int spaghetti_protocol_encode_response(
	const struct spaghetti_protocol_response *response,
	uint8_t *buffer,
	size_t capacity,
	size_t *written_size)
{
	if ((response == NULL) ||
	    (response->version != SPAGHETTI_PROTOCOL_VERSION) ||
	    (response->correlation_id == 0U) ||
	    (response->status > SPAGHETTI_PROTOCOL_STATUS_INTERNAL_ERROR)) {
		return -EINVAL;
	}

	return encode_envelope(response->version, response->correlation_id,
			       (uint32_t)response->status, &response->payload,
			       buffer, capacity, written_size);
}

int spaghetti_protocol_decode_response(
	const uint8_t *bytes,
	size_t length,
	struct spaghetti_protocol_response *out)
{
	struct spaghetti_protocol_response decoded = {0};
	uint32_t status;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = decode_envelope(bytes, length, &decoded.version,
			      &decoded.correlation_id, &status, &decoded.payload);
	if (err < 0) {
		return err;
	}
	if (status > (uint32_t)SPAGHETTI_PROTOCOL_STATUS_INTERNAL_ERROR) {
		return -EBADMSG;
	}

	decoded.status = (enum spaghetti_protocol_status)status;
	*out = decoded;
	return 0;
}

int spaghetti_protocol_encode_event(
	enum spaghetti_protocol_event_type type,
	uint32_t sequence,
	const struct spaghetti_protocol_payload *payload,
	uint8_t *buffer,
	size_t capacity,
	size_t *written_size)
{
	struct spaghetti_protocol_payload empty = {0};
	const struct spaghetti_protocol_payload *body =
		(payload != NULL) ? payload : &empty;

	if ((type < SPAGHETTI_PROTOCOL_EVENT_RECORD) ||
	    (type > SPAGHETTI_PROTOCOL_EVENT_CONNECTIVITY) ||
	    (sequence == 0U)) {
		return -EINVAL;
	}

	return encode_envelope(SPAGHETTI_PROTOCOL_VERSION, sequence,
			       (uint32_t)type, body, buffer, capacity,
			       written_size);
}

int spaghetti_protocol_encode_record_event_payload(
	uint32_t source_key,
	uint32_t sequence,
	const char *schema_id,
	uint16_t schema_version,
	struct spaghetti_protocol_payload *out)
{
	size_t schema_len;

	if ((schema_id == NULL) || (out == NULL) || (source_key == 0U) ||
	    (sequence == 0U)) {
		return -EINVAL;
	}

	schema_len = strlen(schema_id);
	{
	ZCBOR_STATE_E(state, SPAGHETTI_PROTOCOL_CBOR_BACKUP, out->bytes,
		       sizeof(out->bytes), 1U);

	if (!zcbor_map_start_encode(state, 4U) ||
	    !zcbor_uint32_put(state, 0U) ||
	    !zcbor_uint32_put(state, source_key) ||
	    !zcbor_uint32_put(state, 1U) ||
	    !zcbor_uint32_put(state, sequence) ||
	    !zcbor_uint32_put(state, 2U) ||
	    !zcbor_tstr_encode_ptr(state, schema_id, schema_len) ||
	    !zcbor_uint32_put(state, 3U) ||
	    !zcbor_uint32_put(state, schema_version) ||
	    !zcbor_map_end_encode(state, 4U)) {
		return -EMSGSIZE;
	}

	out->size = (size_t)(state->payload - out->bytes);
	}
	return 0;
}

int spaghetti_protocol_encode_status_event_payload(
	const uint8_t *device_id,
	size_t device_id_size,
	uint64_t boot_id,
	uint32_t queue_depth,
	uint32_t drop_count,
	struct spaghetti_protocol_payload *out)
{
	if ((device_id == NULL) || (out == NULL) || (device_id_size == 0U)) {
		return -EINVAL;
	}

	{
	ZCBOR_STATE_E(state, SPAGHETTI_PROTOCOL_CBOR_BACKUP, out->bytes,
		       sizeof(out->bytes), 1U);

	if (!zcbor_map_start_encode(state, 4U) ||
	    !zcbor_uint32_put(state, 0U) ||
	    !zcbor_bstr_encode_ptr(state, device_id, device_id_size) ||
	    !zcbor_uint32_put(state, 1U) ||
	    !zcbor_uint64_put(state, boot_id) ||
	    !zcbor_uint32_put(state, 2U) ||
	    !zcbor_uint32_put(state, queue_depth) ||
	    !zcbor_uint32_put(state, 3U) ||
	    !zcbor_uint32_put(state, drop_count) ||
	    !zcbor_map_end_encode(state, 4U)) {
		return -EMSGSIZE;
	}

	out->size = (size_t)(state->payload - out->bytes);
	}
	return 0;
}

int spaghetti_protocol_encode_discovery_event_payload(
	uint32_t candidate_id,
	uint8_t port_id,
	uint32_t generation,
	struct spaghetti_protocol_payload *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	{
	ZCBOR_STATE_E(state, SPAGHETTI_PROTOCOL_CBOR_BACKUP, out->bytes,
		       sizeof(out->bytes), 1U);

	if (!zcbor_map_start_encode(state, 3U) ||
	    !zcbor_uint32_put(state, 0U) ||
	    !zcbor_uint32_put(state, candidate_id) ||
	    !zcbor_uint32_put(state, 1U) ||
	    !zcbor_uint32_put(state, port_id) ||
	    !zcbor_uint32_put(state, 2U) ||
	    !zcbor_uint32_put(state, generation) ||
	    !zcbor_map_end_encode(state, 3U)) {
		return -EMSGSIZE;
	}

	out->size = (size_t)(state->payload - out->bytes);
	}
	return 0;
}

int spaghetti_protocol_encode_connectivity_event_payload(
	uint32_t policy,
	uint32_t active_services,
	int32_t last_error,
	struct spaghetti_protocol_payload *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	{
	ZCBOR_STATE_E(state, SPAGHETTI_PROTOCOL_CBOR_BACKUP, out->bytes,
		       sizeof(out->bytes), 1U);

	if (!zcbor_map_start_encode(state, 3U) ||
	    !zcbor_uint32_put(state, 0U) ||
	    !zcbor_uint32_put(state, policy) ||
	    !zcbor_uint32_put(state, 1U) ||
	    !zcbor_uint32_put(state, active_services) ||
	    !zcbor_uint32_put(state, 2U) ||
	    !zcbor_int32_put(state, last_error) ||
	    !zcbor_map_end_encode(state, 3U)) {
		return -EMSGSIZE;
	}

	out->size = (size_t)(state->payload - out->bytes);
	}
	return 0;
}
