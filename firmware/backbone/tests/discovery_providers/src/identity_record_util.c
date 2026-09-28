#include "identity_record_util.h"

#include <errno.h>
#include <string.h>

#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/crc.h>

#define SPAGHETTI_IDENTITY_RECORD_MAGIC 0x53495044U
#define SPAGHETTI_IDENTITY_RECORD_VERSION 1U
#define SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE 8U
#define SPAGHETTI_IDENTITY_RECORD_CRC_SIZE 4U

static int encode_property_value(uint8_t *out, size_t capacity, size_t *offset,
				 const struct spaghetti_value *value)
{
	size_t pos = *offset;

	if ((pos + 1U) > capacity) {
		return -EMSGSIZE;
	}
	out[pos++] = (uint8_t)value->type;

	switch (value->type) {
	case SPAGHETTI_VALUE_BOOL:
		if ((pos + 1U) > capacity) {
			return -EMSGSIZE;
		}
		out[pos++] = value->data.boolean ? 1U : 0U;
		break;
	case SPAGHETTI_VALUE_INT64:
		if ((pos + sizeof(int64_t)) > capacity) {
			return -EMSGSIZE;
		}
		sys_put_le64((uint64_t)value->data.signed_integer, &out[pos]);
		pos += sizeof(int64_t);
		break;
	case SPAGHETTI_VALUE_UINT64:
		if ((pos + sizeof(uint64_t)) > capacity) {
			return -EMSGSIZE;
		}
		sys_put_le64(value->data.unsigned_integer, &out[pos]);
		pos += sizeof(uint64_t);
		break;
	case SPAGHETTI_VALUE_TEXT:
		if (value->data.text.size > SPAGHETTI_VALUE_TEXT_MAX) {
			return -ERANGE;
		}
		if ((pos + 1U + value->data.text.size) > capacity) {
			return -EMSGSIZE;
		}
		out[pos++] = (uint8_t)value->data.text.size;
		memcpy(&out[pos], value->data.text.text, value->data.text.size);
		pos += value->data.text.size;
		break;
	case SPAGHETTI_VALUE_BYTES:
		if (value->data.bytes.size > SPAGHETTI_VALUE_BYTES_MAX) {
			return -ERANGE;
		}
		if ((pos + 1U + value->data.bytes.size) > capacity) {
			return -EMSGSIZE;
		}
		out[pos++] = (uint8_t)value->data.bytes.size;
		memcpy(&out[pos], value->data.bytes.bytes,
		       value->data.bytes.size);
		pos += value->data.bytes.size;
		break;
	default:
		return -EINVAL;
	}

	*offset = pos;
	return 0;
}

int discovery_test_identity_record_encode(
	const uint8_t *identity,
	uint8_t identity_size,
	const char *type_id,
	spaghetti_bay_id_t bay_id,
	spaghetti_power_rail_id_t power_rail_id,
	const struct spaghetti_property_set *properties,
	uint8_t *out,
	size_t capacity,
	size_t *out_size)
{
	size_t offset;
	size_t type_len;
	uint16_t body_len;
	uint32_t crc;
	size_t property_count;

	if ((identity == NULL) || (type_id == NULL) || (properties == NULL) ||
	    (out == NULL) || (out_size == NULL) || (identity_size == 0U) ||
	    (identity_size > SPAGHETTI_DISCOVERY_IDENTITY_MAX)) {
		return -EINVAL;
	}
	if (properties->field_count > SPAGHETTI_PROPERTY_MAX_FIELDS) {
		return -ERANGE;
	}
	if (capacity < (SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE +
			SPAGHETTI_IDENTITY_RECORD_CRC_SIZE)) {
		return -EMSGSIZE;
	}

	memset(out, 0, capacity);
	sys_put_le32(SPAGHETTI_IDENTITY_RECORD_MAGIC, &out[0]);
	out[4] = SPAGHETTI_IDENTITY_RECORD_VERSION;
	out[5] = identity_size;
	/* body_len filled after body is encoded */
	offset = SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE;

	if ((offset + identity_size) > capacity) {
		return -EMSGSIZE;
	}
	memcpy(&out[offset], identity, identity_size);
	offset += identity_size;

	if ((offset + SPAGHETTI_TYPE_ID_MAX) > capacity) {
		return -EMSGSIZE;
	}
	type_len = 0U;
	while ((type_len < SPAGHETTI_TYPE_ID_MAX) && (type_id[type_len] != '\0')) {
		++type_len;
	}
	if (type_len >= SPAGHETTI_TYPE_ID_MAX) {
		return -EINVAL;
	}
	memcpy(&out[offset], type_id, type_len);
	offset += SPAGHETTI_TYPE_ID_MAX;

	if ((offset + 3U) > capacity) {
		return -EMSGSIZE;
	}
	out[offset++] = bay_id;
	out[offset++] = power_rail_id;
	property_count = properties->field_count;
	out[offset++] = (uint8_t)property_count;

	for (size_t idx = 0U; idx < property_count; ++idx) {
		int err;

		if ((offset + sizeof(uint16_t)) > capacity) {
			return -EMSGSIZE;
		}
		sys_put_le16(properties->fields[idx].field_id, &out[offset]);
		offset += sizeof(uint16_t);
		err = encode_property_value(out, capacity, &offset,
					    &properties->fields[idx]);
		if (err < 0) {
			return err;
		}
	}

	body_len = (uint16_t)(offset - SPAGHETTI_IDENTITY_RECORD_HEADER_SIZE);
	sys_put_le16(body_len, &out[6]);

	if ((offset + SPAGHETTI_IDENTITY_RECORD_CRC_SIZE) > capacity) {
		return -EMSGSIZE;
	}
	crc = crc32_ieee(out, offset);
	sys_put_le32(crc, &out[offset]);
	offset += SPAGHETTI_IDENTITY_RECORD_CRC_SIZE;

	*out_size = offset;
	return 0;
}
