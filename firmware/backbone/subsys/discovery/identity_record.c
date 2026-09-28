#include <spaghetti/discovery.h>

#include <errno.h>
#include <string.h>

#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/crc.h>

/* Little-endian magic "SPID" for Spaghetti identity records. */
#define SPAGHETTI_IDENTITY_RECORD_MAGIC 0x53495044U

/* Currently supported identity-record format version. */
#define SPAGHETTI_IDENTITY_RECORD_VERSION 1U

/* Fixed header size before the variable body and trailing CRC. */
#define SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE 8U

/* Trailing CRC-32 size. */
#define SPAGHETTI_IDENTITY_RECORD_CRC_SIZE 4U

/* Fixed body type-id width matches SPAGHETTI_TYPE_ID_MAX. */
#define SPAGHETTI_IDENTITY_RECORD_TYPE_ID_SIZE SPAGHETTI_TYPE_ID_MAX

static int decode_property_value(const uint8_t *bytes, size_t bytes_size,
				 size_t *offset, struct spaghetti_value *value)
{
	uint8_t value_type;
	size_t pos = *offset;

	if ((pos + 1U) > bytes_size) {
		return -EBADMSG;
	}

	value_type = bytes[pos];
	++pos;

	switch (value_type) {
	case SPAGHETTI_VALUE_BOOL:
		if ((pos + 1U) > bytes_size) {
			return -EBADMSG;
		}
		value->type = SPAGHETTI_VALUE_BOOL;
		value->data.boolean = (bytes[pos] != 0U);
		++pos;
		break;
	case SPAGHETTI_VALUE_INT64:
		if ((pos + sizeof(int64_t)) > bytes_size) {
			return -EBADMSG;
		}
		value->type = SPAGHETTI_VALUE_INT64;
		value->data.signed_integer =
			(int64_t)sys_get_le64(&bytes[pos]);
		pos += sizeof(int64_t);
		break;
	case SPAGHETTI_VALUE_UINT64:
		if ((pos + sizeof(uint64_t)) > bytes_size) {
			return -EBADMSG;
		}
		value->type = SPAGHETTI_VALUE_UINT64;
		value->data.unsigned_integer = sys_get_le64(&bytes[pos]);
		pos += sizeof(uint64_t);
		break;
	case SPAGHETTI_VALUE_TEXT: {
		uint8_t text_size;

		if ((pos + 1U) > bytes_size) {
			return -EBADMSG;
		}
		text_size = bytes[pos];
		++pos;
		if (text_size > SPAGHETTI_VALUE_TEXT_MAX) {
			return -ERANGE;
		}
		if ((pos + text_size) > bytes_size) {
			return -EBADMSG;
		}
		value->type = SPAGHETTI_VALUE_TEXT;
		value->data.text.size = text_size;
		memcpy(value->data.text.text, &bytes[pos], text_size);
		value->data.text.text[text_size] = '\0';
		pos += text_size;
		break;
	}
	case SPAGHETTI_VALUE_BYTES: {
		uint8_t blob_size;

		if ((pos + 1U) > bytes_size) {
			return -EBADMSG;
		}
		blob_size = bytes[pos];
		++pos;
		if (blob_size > SPAGHETTI_VALUE_BYTES_MAX) {
			return -ERANGE;
		}
		if ((pos + blob_size) > bytes_size) {
			return -EBADMSG;
		}
		value->type = SPAGHETTI_VALUE_BYTES;
		value->data.bytes.size = blob_size;
		memcpy(value->data.bytes.bytes, &bytes[pos], blob_size);
		pos += blob_size;
		break;
	}
	default:
		return -EBADMSG;
	}

	*offset = pos;
	return 0;
}

int spaghetti_identity_record_decode(
	const uint8_t *bytes,
	size_t bytes_size,
	struct spaghetti_discovery_candidate *out)
{
	uint32_t magic;
	uint8_t version;
	uint8_t identity_size;
	uint16_t body_len;
	uint32_t expected_crc;
	uint32_t actual_crc;
	size_t total_size;
	size_t offset;
	uint8_t property_count;
	const char *terminator;
	struct spaghetti_discovery_candidate decoded;

	if ((bytes == NULL) || (out == NULL)) {
		return -EINVAL;
	}
	if (bytes_size < (SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE +
			  SPAGHETTI_IDENTITY_RECORD_CRC_SIZE)) {
		return -EMSGSIZE;
	}

	magic = sys_get_le32(&bytes[0]);
	if (magic != SPAGHETTI_IDENTITY_RECORD_MAGIC) {
		return -EBADMSG;
	}

	version = bytes[4];
	if (version != SPAGHETTI_IDENTITY_RECORD_VERSION) {
		return -ENOTSUP;
	}

	identity_size = bytes[5];
	if ((identity_size == 0U) ||
	    (identity_size > SPAGHETTI_DISCOVERY_IDENTITY_MAX)) {
		return -EBADMSG;
	}

	body_len = sys_get_le16(&bytes[6]);
	total_size = SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE + (size_t)body_len +
		     SPAGHETTI_IDENTITY_RECORD_CRC_SIZE;
	if (total_size > bytes_size) {
		return -EMSGSIZE;
	}
	if (total_size < bytes_size) {
		/* Trailing garbage is rejected so hosts cannot hide bytes. */
		return -EBADMSG;
	}

	expected_crc = sys_get_le32(
		&bytes[SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE + body_len]);
	actual_crc = crc32_ieee(bytes,
				SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE +
					(size_t)body_len);
	if (actual_crc != expected_crc) {
		return -EBADMSG;
	}

	/*
	 * Body layout (version 1):
	 *   identity[identity_size]
	 *   type_id[24] NUL-padded
	 *   bay_id
	 *   power_rail_id
	 *   property_count
	 *   properties[] as field_id LE16 + typed value
	 */
	if ((size_t)body_len < ((size_t)identity_size +
				SPAGHETTI_IDENTITY_RECORD_TYPE_ID_SIZE + 3U)) {
		return -EBADMSG;
	}

	memset(&decoded, 0, sizeof(decoded));
	decoded.identity_size = identity_size;
	memcpy(decoded.identity, &bytes[SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE],
	       identity_size);

	offset = SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE + identity_size;
	memcpy(decoded.suggested_type_id, &bytes[offset],
	       SPAGHETTI_IDENTITY_RECORD_TYPE_ID_SIZE);
	terminator = memchr(decoded.suggested_type_id, '\0',
			    sizeof(decoded.suggested_type_id));
	if (terminator == NULL) {
		return -EBADMSG;
	}
	offset += SPAGHETTI_IDENTITY_RECORD_TYPE_ID_SIZE;

	decoded.bay_id = bytes[offset];
	++offset;
	decoded.power_rail_id = bytes[offset];
	++offset;
	property_count = bytes[offset];
	++offset;

	if (property_count > SPAGHETTI_PROPERTY_MAX_FIELDS) {
		return -ERANGE;
	}

	for (uint8_t prop_idx = 0U; prop_idx < property_count; ++prop_idx) {
		struct spaghetti_value *value;
		uint16_t field_id;
		int err;

		if ((offset + sizeof(uint16_t)) >
		    (SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE + (size_t)body_len)) {
			return -EBADMSG;
		}
		field_id = sys_get_le16(&bytes[offset]);
		offset += sizeof(uint16_t);
		if (field_id == 0U) {
			return -EBADMSG;
		}

		for (size_t seen = 0U; seen < decoded.suggested_properties.field_count;
		     ++seen) {
			if (decoded.suggested_properties.fields[seen].field_id ==
			    field_id) {
				return -EBADMSG;
			}
		}

		value = &decoded.suggested_properties
				 .fields[decoded.suggested_properties.field_count];
		value->field_id = field_id;
		err = decode_property_value(
			bytes,
			SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE + (size_t)body_len,
			&offset, value);
		if (err < 0) {
			return err;
		}
		++decoded.suggested_properties.field_count;
	}

	if (offset != (SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE + (size_t)body_len)) {
		return -EBADMSG;
	}

	*out = decoded;
	return 0;
}
