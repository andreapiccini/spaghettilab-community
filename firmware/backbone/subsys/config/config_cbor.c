#include <spaghetti/config_codec.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zcbor_common.h>
#include <zcbor_decode.h>
#include <zcbor_encode.h>

#include <spaghetti/schema.h>

#include "config_cbor_internal.h"

#define SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V0 1U
#define SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V1 2U
#define SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V2 3U
#define SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V3 4U
#define SPAGHETTI_CONFIG_CBOR_BACKUP_COUNT 8U
#define SPAGHETTI_CONFIG_CBOR_ROOT_KEY_VERSION 0U
#define SPAGHETTI_CONFIG_CBOR_ROOT_KEY_MODULES 1U
#define SPAGHETTI_CONFIG_CBOR_ROOT_KEY_SCHEDULES 2U
#define SPAGHETTI_CONFIG_CBOR_ROOT_KEY_RULES 3U
#define SPAGHETTI_CONFIG_CBOR_ROOT_KEY_MQTT 4U
#define SPAGHETTI_CONFIG_CBOR_ROOT_KEY_CONNECTIVITY 5U
#define SPAGHETTI_CONFIG_CBOR_ROOT_KEY_ENERGY 6U
#define SPAGHETTI_CONFIG_CBOR_ROOT_KEY_BLOCKS 7U
#define SPAGHETTI_CONFIG_CBOR_ROOT_KEY_EDGES 8U
#define SPAGHETTI_CONFIG_CBOR_MODULE_KEY_STABLE_KEY 0U
#define SPAGHETTI_CONFIG_CBOR_MODULE_KEY_PORT 1U
#define SPAGHETTI_CONFIG_CBOR_MODULE_KEY_TYPE 2U
#define SPAGHETTI_CONFIG_CBOR_MODULE_KEY_PROPERTIES 3U
#define SPAGHETTI_CONFIG_CBOR_MODULE_KEY_BAY 4U
#define SPAGHETTI_CONFIG_CBOR_MODULE_KEY_RAIL 5U
#define SPAGHETTI_CONFIG_CBOR_SCHEDULE_KEY_SOURCE 0U
#define SPAGHETTI_CONFIG_CBOR_SCHEDULE_KEY_PERIOD 1U
#define SPAGHETTI_CONFIG_CBOR_SCHEDULE_KEY_ENABLED 2U
#define SPAGHETTI_CONFIG_CBOR_RULE_KEY_STABLE_KEY 0U
#define SPAGHETTI_CONFIG_CBOR_RULE_KEY_TYPE 1U
#define SPAGHETTI_CONFIG_CBOR_RULE_KEY_PROPERTIES 2U
#define SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_STABLE_KEY 0U
#define SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_TYPE 1U
#define SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_MIN_VERSION 2U
#define SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_EXACT_VERSION 3U
#define SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_PROPERTIES 4U
#define SPAGHETTI_CONFIG_CBOR_EDGE_KEY_SOURCE_KEY 0U
#define SPAGHETTI_CONFIG_CBOR_EDGE_KEY_SOURCE_PORT 1U
#define SPAGHETTI_CONFIG_CBOR_EDGE_KEY_TARGET_KEY 2U
#define SPAGHETTI_CONFIG_CBOR_EDGE_KEY_TARGET_INPUT 3U
#define SPAGHETTI_CONFIG_CBOR_EDGE_KEY_SOURCE_KIND 4U
#define SPAGHETTI_CONFIG_CBOR_MQTT_KEY_ENABLED 0U
#define SPAGHETTI_CONFIG_CBOR_MQTT_KEY_HOST 1U
#define SPAGHETTI_CONFIG_CBOR_MQTT_KEY_PORT 2U
#define SPAGHETTI_CONFIG_CBOR_MQTT_KEY_BASE_TOPIC 3U
#define SPAGHETTI_CONFIG_CBOR_MQTT_KEY_SECURITY 4U
#define SPAGHETTI_CONFIG_CBOR_MQTT_KEY_CREDENTIAL_ID 5U
#define SPAGHETTI_CONFIG_CBOR_ENERGY_KEY_AVAILABILITY 0U
#define SPAGHETTI_CONFIG_CBOR_ENERGY_KEY_WINDOW 1U
#define SPAGHETTI_CONFIG_CBOR_ENERGY_KEY_PERIOD 2U
#define SPAGHETTI_CONFIG_CBOR_SCHEDULE_PERIOD_MAX_MS 86400000U

static int expect_key(zcbor_state_t *state, uint32_t expected)
{
	return zcbor_uint32_expect(state, expected) ? 0 : -EBADMSG;
}

static int put_key(zcbor_state_t *state, uint32_t key)
{
	return zcbor_uint32_put(state, key) ? 0 : -EMSGSIZE;
}

static int peek_wire_version(const uint8_t *bytes, size_t length,
			     uint32_t *out_version)
{
	uint32_t wire_version;
	int err;

	ZCBOR_STATE_D(state, SPAGHETTI_CONFIG_CBOR_BACKUP_COUNT, bytes, length,
		       1U, 0U);

	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_VERSION);
	if ((err < 0) || !zcbor_uint32_decode(state, &wire_version)) {
		return -EBADMSG;
	}

	*out_version = wire_version;
	return 0;
}

static bool utf8_is_valid(const uint8_t *bytes, size_t size)
{
	size_t index = 0U;

	while (index < size) {
		const uint8_t lead = bytes[index];
		size_t remaining;

		if (lead <= 0x7FU) {
			remaining = 0U;
		} else if ((lead >= 0xC2U) && (lead <= 0xDFU)) {
			remaining = 1U;
		} else if ((lead >= 0xE0U) && (lead <= 0xEFU)) {
			remaining = 2U;
		} else if ((lead >= 0xF0U) && (lead <= 0xF4U)) {
			remaining = 3U;
		} else {
			return false;
		}

		if ((index + remaining) >= size) {
			return false;
		}

		for (size_t cont = 1U; cont <= remaining; ++cont) {
			if ((bytes[index + cont] & 0xC0U) != 0x80U) {
				return false;
			}
		}

		if ((lead == 0xE0U) && (bytes[index + 1U] < 0xA0U)) {
			return false;
		}
		if ((lead == 0xEDU) && (bytes[index + 1U] > 0x9FU)) {
			return false;
		}
		if ((lead == 0xF0U) && (bytes[index + 1U] < 0x90U)) {
			return false;
		}
		if ((lead == 0xF4U) && (bytes[index + 1U] > 0x8FU)) {
			return false;
		}

		index += remaining + 1U;
	}

	return true;
}

static int decode_property_value(zcbor_state_t *state,
				 struct spaghetti_value *value)
{
	struct zcbor_string text;
	struct zcbor_string bytes;
	bool boolean;
	int64_t signed_integer;
	uint64_t unsigned_integer;
	zcbor_major_type_t major;

	if ((state == NULL) || (state->payload == NULL) ||
	    (state->payload >= state->payload_end)) {
		return -EBADMSG;
	}

	major = ZCBOR_MAJOR_TYPE(*state->payload);
	switch (major) {
	case ZCBOR_MAJOR_TYPE_PINT:
		if (!zcbor_uint64_decode(state, &unsigned_integer)) {
			return -EBADMSG;
		}
		value->type = SPAGHETTI_VALUE_UINT64;
		value->data.unsigned_integer = unsigned_integer;
		return 0;
	case ZCBOR_MAJOR_TYPE_NINT:
		if (!zcbor_int64_decode(state, &signed_integer)) {
			return -EBADMSG;
		}
		value->type = SPAGHETTI_VALUE_INT64;
		value->data.signed_integer = signed_integer;
		return 0;
	case ZCBOR_MAJOR_TYPE_BSTR:
		if (!zcbor_bstr_decode(state, &bytes)) {
			return -EBADMSG;
		}
		if (bytes.len > SPAGHETTI_VALUE_BYTES_MAX) {
			return -EMSGSIZE;
		}
		value->type = SPAGHETTI_VALUE_BYTES;
		value->data.bytes.size = bytes.len;
		memcpy(value->data.bytes.bytes, bytes.value, bytes.len);
		return 0;
	case ZCBOR_MAJOR_TYPE_TSTR:
		if (!zcbor_tstr_decode(state, &text)) {
			return -EBADMSG;
		}
		if (text.len > SPAGHETTI_VALUE_TEXT_MAX) {
			return -EMSGSIZE;
		}
		if (!utf8_is_valid(text.value, text.len)) {
			return -EINVAL;
		}
		value->type = SPAGHETTI_VALUE_TEXT;
		value->data.text.size = text.len;
		memcpy(value->data.text.text, text.value, text.len);
		value->data.text.text[text.len] = '\0';
		return 0;
	case ZCBOR_MAJOR_TYPE_SIMPLE:
		if (zcbor_bool_decode(state, &boolean)) {
			value->type = SPAGHETTI_VALUE_BOOL;
			value->data.boolean = boolean;
			return 0;
		}
		return -EBADMSG;
	default:
		return -EBADMSG;
	}
}

static int decode_properties(zcbor_state_t *state,
			     struct spaghetti_property_set *properties)
{
	uint16_t seen_ids[SPAGHETTI_PROPERTY_MAX_FIELDS];

	memset(properties, 0, sizeof(*properties));
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}

	while (!zcbor_array_at_end(state)) {
		uint32_t field_id;
		struct spaghetti_value *value;
		int err;

		if (properties->field_count >= SPAGHETTI_PROPERTY_MAX_FIELDS) {
			return -EMSGSIZE;
		}
		if (!zcbor_uint32_decode(state, &field_id) ||
		    (field_id == 0U) || (field_id > UINT16_MAX)) {
			return -EBADMSG;
		}

		for (size_t idx = 0U; idx < properties->field_count; ++idx) {
			if (seen_ids[idx] == (uint16_t)field_id) {
				return -EEXIST;
			}
		}

		value = &properties->fields[properties->field_count];
		value->field_id = (uint16_t)field_id;
		err = decode_property_value(state, value);
		if (err < 0) {
			return err;
		}
		seen_ids[properties->field_count] = (uint16_t)field_id;
		++properties->field_count;
	}

	return zcbor_map_end_decode(state) ? 0 : -EBADMSG;
}

static int encode_property_value(zcbor_state_t *state,
				 const struct spaghetti_value *value)
{
	switch (value->type) {
	case SPAGHETTI_VALUE_BOOL:
		return zcbor_bool_put(state, value->data.boolean) ? 0 : -EMSGSIZE;
	case SPAGHETTI_VALUE_INT64:
		return zcbor_int64_put(state, value->data.signed_integer) ?
			       0 :
			       -EMSGSIZE;
	case SPAGHETTI_VALUE_UINT64:
		return zcbor_uint64_put(state, value->data.unsigned_integer) ?
			       0 :
			       -EMSGSIZE;
	case SPAGHETTI_VALUE_TEXT:
		return zcbor_tstr_encode_ptr(
			       state, value->data.text.text,
			       value->data.text.size) ?
			       0 :
			       -EMSGSIZE;
	case SPAGHETTI_VALUE_BYTES:
		return zcbor_bstr_encode_ptr(
			       state, (const char *)value->data.bytes.bytes,
			       value->data.bytes.size) ?
			       0 :
			       -EMSGSIZE;
	default:
		return -EINVAL;
	}
}

static int encode_properties(zcbor_state_t *state,
			     const struct spaghetti_property_set *properties)
{
	uint16_t ordered_ids[SPAGHETTI_PROPERTY_MAX_FIELDS];
	size_t count = properties->field_count;

	if (count > SPAGHETTI_PROPERTY_MAX_FIELDS) {
		return -EINVAL;
	}
	if (!zcbor_map_start_encode(state, count)) {
		return -EMSGSIZE;
	}

	for (size_t idx = 0U; idx < count; ++idx) {
		ordered_ids[idx] = properties->fields[idx].field_id;
	}

	for (size_t idx = 1U; idx < count; ++idx) {
		const uint16_t current = ordered_ids[idx];
		size_t insert = idx;

		while ((insert > 0U) &&
		       (ordered_ids[insert - 1U] > current)) {
			ordered_ids[insert] = ordered_ids[insert - 1U];
			--insert;
		}
		ordered_ids[insert] = current;
	}

	for (size_t order_idx = 0U; order_idx < count; ++order_idx) {
		const uint16_t field_id = ordered_ids[order_idx];
		const struct spaghetti_value *value = NULL;
		int err;

		for (size_t idx = 0U; idx < properties->field_count; ++idx) {
			if (properties->fields[idx].field_id == field_id) {
				value = &properties->fields[idx];
				break;
			}
		}
		if (value == NULL) {
			return -EINVAL;
		}

		err = put_key(state, field_id);
		if (err < 0) {
			return err;
		}
		err = encode_property_value(state, value);
		if (err < 0) {
			return err;
		}
	}

	return zcbor_map_end_encode(state, count) ? 0 : -EMSGSIZE;
}

static int copy_text(const struct zcbor_string *text, char *destination,
		     size_t capacity)
{
	if (text->len >= capacity) {
		return -EMSGSIZE;
	}
	if (!utf8_is_valid(text->value, text->len)) {
		return -EINVAL;
	}

	memcpy(destination, text->value, text->len);
	destination[text->len] = '\0';
	return 0;
}

static int decode_optional_u8(zcbor_state_t *state, uint8_t *out,
			      uint8_t unspecified)
{
	uint32_t value;

	if (zcbor_nil_expect(state, NULL)) {
		*out = unspecified;
		return 0;
	}
	if (!zcbor_uint32_decode(state, &value) || (value > UINT8_MAX)) {
		return -EBADMSG;
	}

	*out = (uint8_t)value;
	return 0;
}

static int encode_optional_u8(zcbor_state_t *state, uint8_t value,
			      uint8_t unspecified)
{
	if (value == unspecified) {
		return zcbor_nil_put(state, NULL) ? 0 : -EMSGSIZE;
	}

	return zcbor_uint32_put(state, value) ? 0 : -EMSGSIZE;
}

static int decode_module(zcbor_state_t *state,
			 struct spaghetti_module_config *module)
{
	struct zcbor_string type_id;
	uint32_t key;
	uint32_t port_id;
	int err;

	memset(module, 0, sizeof(*module));
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_STABLE_KEY);
	if ((err < 0) || !zcbor_uint32_decode(state, &key)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_PORT);
	if ((err < 0) || !zcbor_uint32_decode(state, &port_id)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_TYPE);
	if ((err < 0) || !zcbor_tstr_decode(state, &type_id)) {
		return -EBADMSG;
	}
	if ((key == 0U) || (port_id > UINT8_MAX)) {
		return -EINVAL;
	}
	if (type_id.len >= sizeof(module->type_id)) {
		return -EMSGSIZE;
	}

	module->key = key;
	module->port_id = (spaghetti_port_id_t)port_id;
	memcpy(module->type_id, type_id.value, type_id.len);
	module->type_id[type_id.len] = '\0';

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_PROPERTIES);
	if (err < 0) {
		return err;
	}
	err = decode_properties(state, &module->properties);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_BAY);
	if (err < 0) {
		return err;
	}
	err = decode_optional_u8(state, &module->bay_id,
				 SPAGHETTI_BAY_ID_UNSPECIFIED);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_RAIL);
	if (err < 0) {
		return err;
	}
	err = decode_optional_u8(state, &module->power_rail_id,
				 SPAGHETTI_POWER_RAIL_UNSPECIFIED);
	if (err < 0) {
		return err;
	}
	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}

	return 0;
}

static int encode_module(zcbor_state_t *state,
			 const struct spaghetti_module_config *module)
{
	int err;

	if (!zcbor_map_start_encode(state, 6U)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_STABLE_KEY);
	if ((err < 0) || !zcbor_uint32_put(state, module->key)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_PORT);
	if ((err < 0) || !zcbor_uint32_put(state, module->port_id)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_TYPE);
	if ((err < 0) ||
	    !zcbor_tstr_put_term(state, module->type_id,
				 sizeof(module->type_id))) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_PROPERTIES);
	if (err < 0) {
		return err;
	}
	err = encode_properties(state, &module->properties);
	if (err < 0) {
		return err;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_BAY);
	if (err < 0) {
		return err;
	}
	err = encode_optional_u8(state, module->bay_id,
				 SPAGHETTI_BAY_ID_UNSPECIFIED);
	if (err < 0) {
		return err;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MODULE_KEY_RAIL);
	if (err < 0) {
		return err;
	}
	err = encode_optional_u8(state, module->power_rail_id,
				 SPAGHETTI_POWER_RAIL_UNSPECIFIED);
	if (err < 0) {
		return err;
	}

	return zcbor_map_end_encode(state, 6U) ? 0 : -EMSGSIZE;
}

static int decode_schedule(zcbor_state_t *state,
			   struct spaghetti_runtime_schedule_config *schedule)
{
	uint32_t source_key;
	uint32_t period_ms;
	bool enabled;
	int err;

	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_SCHEDULE_KEY_SOURCE);
	if ((err < 0) || !zcbor_uint32_decode(state, &source_key)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_SCHEDULE_KEY_PERIOD);
	if ((err < 0) || !zcbor_uint32_decode(state, &period_ms)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_SCHEDULE_KEY_ENABLED);
	if ((err < 0) || !zcbor_bool_decode(state, &enabled)) {
		return -EBADMSG;
	}
	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}
	if ((source_key == 0U) || (period_ms == 0U) ||
	    (period_ms > SPAGHETTI_CONFIG_CBOR_SCHEDULE_PERIOD_MAX_MS)) {
		return -EINVAL;
	}

	schedule->source_key = source_key;
	schedule->period_ms = period_ms;
	schedule->enabled = enabled;
	return 0;
}

static int encode_schedule(
	zcbor_state_t *state,
	const struct spaghetti_runtime_schedule_config *schedule)
{
	int err;

	if (!zcbor_map_start_encode(state, 3U)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_SCHEDULE_KEY_SOURCE);
	if ((err < 0) || !zcbor_uint32_put(state, schedule->source_key)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_SCHEDULE_KEY_PERIOD);
	if ((err < 0) || !zcbor_uint32_put(state, schedule->period_ms)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_SCHEDULE_KEY_ENABLED);
	if ((err < 0) || !zcbor_bool_put(state, schedule->enabled)) {
		return -EMSGSIZE;
	}

	return zcbor_map_end_encode(state, 3U) ? 0 : -EMSGSIZE;
}

static int decode_rule(zcbor_state_t *state, struct spaghetti_rule_config *rule)
{
	struct zcbor_string type_id;
	uint32_t key;
	int err;

	memset(rule, 0, sizeof(*rule));
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_RULE_KEY_STABLE_KEY);
	if ((err < 0) || !zcbor_uint32_decode(state, &key)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_RULE_KEY_TYPE);
	if ((err < 0) || !zcbor_tstr_decode(state, &type_id)) {
		return -EBADMSG;
	}
	if (key == 0U) {
		return -EINVAL;
	}
	if (type_id.len >= sizeof(rule->type_id)) {
		return -EMSGSIZE;
	}

	rule->key = key;
	memcpy(rule->type_id, type_id.value, type_id.len);
	rule->type_id[type_id.len] = '\0';

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_RULE_KEY_PROPERTIES);
	if (err < 0) {
		return err;
	}
	err = decode_properties(state, &rule->properties);
	if (err < 0) {
		return err;
	}
	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}

	return 0;
}

static int encode_rule(zcbor_state_t *state,
		       const struct spaghetti_rule_config *rule)
{
	int err;

	if (!zcbor_map_start_encode(state, 3U)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_RULE_KEY_STABLE_KEY);
	if ((err < 0) || !zcbor_uint32_put(state, rule->key)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_RULE_KEY_TYPE);
	if ((err < 0) ||
	    !zcbor_tstr_put_term(state, rule->type_id, sizeof(rule->type_id))) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_RULE_KEY_PROPERTIES);
	if (err < 0) {
		return err;
	}
	err = encode_properties(state, &rule->properties);
	if (err < 0) {
		return err;
	}

	return zcbor_map_end_encode(state, 3U) ? 0 : -EMSGSIZE;
}

static int decode_block(zcbor_state_t *state, struct spaghetti_block_config *block)
{
	struct zcbor_string type_id;
	uint32_t key;
	uint32_t min_version;
	uint32_t exact_version;
	int err;

	memset(block, 0, sizeof(*block));
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_STABLE_KEY);
	if ((err < 0) || !zcbor_uint32_decode(state, &key)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_TYPE);
	if ((err < 0) || !zcbor_tstr_decode(state, &type_id)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_MIN_VERSION);
	if ((err < 0) || !zcbor_uint32_decode(state, &min_version)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_EXACT_VERSION);
	if ((err < 0) || !zcbor_uint32_decode(state, &exact_version)) {
		return -EBADMSG;
	}
	if (key == 0U) {
		return -EINVAL;
	}
	if ((min_version > UINT16_MAX) || (exact_version > UINT16_MAX)) {
		return -EINVAL;
	}
	if (type_id.len >= sizeof(block->type_id)) {
		return -EMSGSIZE;
	}

	block->key = key;
	memcpy(block->type_id, type_id.value, type_id.len);
	block->type_id[type_id.len] = '\0';
	block->min_version = (uint16_t)min_version;
	block->exact_version = (uint16_t)exact_version;

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_PROPERTIES);
	if (err < 0) {
		return err;
	}
	err = decode_properties(state, &block->properties);
	if (err < 0) {
		return err;
	}
	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}

	return 0;
}

static int encode_block(zcbor_state_t *state,
			const struct spaghetti_block_config *block)
{
	int err;

	if (!zcbor_map_start_encode(state, 5U)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_STABLE_KEY);
	if ((err < 0) || !zcbor_uint32_put(state, block->key)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_TYPE);
	if ((err < 0) ||
	    !zcbor_tstr_put_term(state, block->type_id, sizeof(block->type_id))) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_MIN_VERSION);
	if ((err < 0) || !zcbor_uint32_put(state, block->min_version)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_EXACT_VERSION);
	if ((err < 0) || !zcbor_uint32_put(state, block->exact_version)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_BLOCK_KEY_PROPERTIES);
	if (err < 0) {
		return err;
	}
	err = encode_properties(state, &block->properties);
	if (err < 0) {
		return err;
	}

	return zcbor_map_end_encode(state, 5U) ? 0 : -EMSGSIZE;
}

static int decode_edge(zcbor_state_t *state, struct spaghetti_edge_config *edge)
{
	uint32_t source_key;
	uint32_t source_port;
	uint32_t target_key;
	uint32_t target_input;
	uint32_t source_kind;
	int err;

	memset(edge, 0, sizeof(*edge));
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_SOURCE_KEY);
	if ((err < 0) || !zcbor_uint32_decode(state, &source_key)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_SOURCE_PORT);
	if ((err < 0) || !zcbor_uint32_decode(state, &source_port)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_TARGET_KEY);
	if ((err < 0) || !zcbor_uint32_decode(state, &target_key)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_TARGET_INPUT);
	if ((err < 0) || !zcbor_uint32_decode(state, &target_input)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_SOURCE_KIND);
	if ((err < 0) || !zcbor_uint32_decode(state, &source_kind)) {
		return -EBADMSG;
	}
	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}
	if ((source_port > UINT16_MAX) || (target_input > UINT16_MAX) ||
	    (source_kind > UINT8_MAX)) {
		return -EINVAL;
	}

	edge->source_key = source_key;
	edge->source_port_or_field = (uint16_t)source_port;
	edge->target_key = target_key;
	edge->target_input = (uint16_t)target_input;
	edge->source_kind = (uint8_t)source_kind;
	return 0;
}

static int encode_edge(zcbor_state_t *state,
		       const struct spaghetti_edge_config *edge)
{
	int err;

	if (!zcbor_map_start_encode(state, 5U)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_SOURCE_KEY);
	if ((err < 0) || !zcbor_uint32_put(state, edge->source_key)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_SOURCE_PORT);
	if ((err < 0) ||
	    !zcbor_uint32_put(state, edge->source_port_or_field)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_TARGET_KEY);
	if ((err < 0) || !zcbor_uint32_put(state, edge->target_key)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_TARGET_INPUT);
	if ((err < 0) || !zcbor_uint32_put(state, edge->target_input)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_EDGE_KEY_SOURCE_KIND);
	if ((err < 0) || !zcbor_uint32_put(state, edge->source_kind)) {
		return -EMSGSIZE;
	}

	return zcbor_map_end_encode(state, 5U) ? 0 : -EMSGSIZE;
}

static int decode_mqtt(zcbor_state_t *state, struct spaghetti_mqtt_config *mqtt)
{
	struct zcbor_string host;
	struct zcbor_string base_topic;
	uint32_t port;
	uint32_t security = (uint32_t)SPAGHETTI_MQTT_SECURITY_TLS_SERVER;
	uint32_t credential_id = 0U;
	bool enabled;
	int err;

	memset(mqtt, 0, sizeof(*mqtt));
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_ENABLED);
	if ((err < 0) || !zcbor_bool_decode(state, &enabled)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_HOST);
	if ((err < 0) || !zcbor_tstr_decode(state, &host)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_PORT);
	if ((err < 0) || !zcbor_uint32_decode(state, &port)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_BASE_TOPIC);
	if ((err < 0) || !zcbor_tstr_decode(state, &base_topic)) {
		return -EBADMSG;
	}
	if (!zcbor_map_end_decode(state)) {
		err = expect_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_SECURITY);
		if ((err < 0) || !zcbor_uint32_decode(state, &security)) {
			return -EBADMSG;
		}
		err = expect_key(state,
				 SPAGHETTI_CONFIG_CBOR_MQTT_KEY_CREDENTIAL_ID);
		if ((err < 0) ||
		    !zcbor_uint32_decode(state, &credential_id)) {
			return -EBADMSG;
		}
		if (!zcbor_map_end_decode(state)) {
			return -EBADMSG;
		}
	}
	if ((port > UINT16_MAX) || (credential_id > UINT16_MAX) ||
	    (security > (uint32_t)SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT)) {
		return -EINVAL;
	}

	err = copy_text(&host, mqtt->host, sizeof(mqtt->host));
	if (err < 0) {
		return err;
	}
	err = copy_text(&base_topic, mqtt->base_topic, sizeof(mqtt->base_topic));
	if (err < 0) {
		return err;
	}

	mqtt->enabled = enabled;
	mqtt->port = (uint16_t)port;
	mqtt->security = (enum spaghetti_mqtt_security)security;
	mqtt->credential_id = (uint16_t)credential_id;
	return 0;
}

static int encode_mqtt(zcbor_state_t *state,
		       const struct spaghetti_mqtt_config *mqtt)
{
	int err;

	if (!zcbor_map_start_encode(state, 6U)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_ENABLED);
	if ((err < 0) || !zcbor_bool_put(state, mqtt->enabled)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_HOST);
	if ((err < 0) ||
	    !zcbor_tstr_put_term(state, mqtt->host, sizeof(mqtt->host))) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_PORT);
	if ((err < 0) || !zcbor_uint32_put(state, mqtt->port)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_BASE_TOPIC);
	if ((err < 0) ||
	    !zcbor_tstr_put_term(state, mqtt->base_topic,
				 sizeof(mqtt->base_topic))) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_SECURITY);
	if ((err < 0) ||
	    !zcbor_uint32_put(state, (uint32_t)mqtt->security)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_MQTT_KEY_CREDENTIAL_ID);
	if ((err < 0) ||
	    !zcbor_uint32_put(state, mqtt->credential_id)) {
		return -EMSGSIZE;
	}

	return zcbor_map_end_encode(state, 6U) ? 0 : -EMSGSIZE;
}

static int decode_energy(zcbor_state_t *state,
			 struct spaghetti_energy_policy *energy)
{
	uint32_t availability;
	uint32_t window_ms;
	uint32_t period_ms;
	int err;

	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ENERGY_KEY_AVAILABILITY);
	if ((err < 0) || !zcbor_uint32_decode(state, &availability)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ENERGY_KEY_WINDOW);
	if ((err < 0) || !zcbor_uint32_decode(state, &window_ms)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ENERGY_KEY_PERIOD);
	if ((err < 0) || !zcbor_uint32_decode(state, &period_ms)) {
		return -EBADMSG;
	}
	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}

	energy->ble_availability =
		(enum spaghetti_ble_availability)availability;
	energy->advertising_window_ms = window_ms;
	energy->advertising_period_ms = period_ms;
	return 0;
}

static int encode_energy(zcbor_state_t *state,
			 const struct spaghetti_energy_policy *energy)
{
	int err;

	if (!zcbor_map_start_encode(state, 3U)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ENERGY_KEY_AVAILABILITY);
	if ((err < 0) ||
	    !zcbor_uint32_put(state, (uint32_t)energy->ble_availability)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ENERGY_KEY_WINDOW);
	if ((err < 0) ||
	    !zcbor_uint32_put(state, energy->advertising_window_ms)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ENERGY_KEY_PERIOD);
	if ((err < 0) ||
	    !zcbor_uint32_put(state, energy->advertising_period_ms)) {
		return -EMSGSIZE;
	}

	return zcbor_map_end_encode(state, 3U) ? 0 : -EMSGSIZE;
}

static int decode_array_modules(zcbor_state_t *state,
				struct spaghetti_config *config)
{
	if (!zcbor_list_start_decode(state)) {
		return -EBADMSG;
	}
	while (!zcbor_array_at_end(state)) {
		int err;

		if (config->module_count >= SPAGHETTI_CONFIG_MAX_MODULES) {
			return -EMSGSIZE;
		}
		err = decode_module(state, &config->modules[config->module_count]);
		if (err < 0) {
			return err;
		}
		++config->module_count;
	}
	return zcbor_list_end_decode(state) ? 0 : -EBADMSG;
}

static int decode_array_schedules(zcbor_state_t *state,
				  struct spaghetti_config *config)
{
	if (!zcbor_list_start_decode(state)) {
		return -EBADMSG;
	}
	while (!zcbor_array_at_end(state)) {
		int err;

		if (config->schedule_count >= SPAGHETTI_CONFIG_MAX_SCHEDULES) {
			return -EMSGSIZE;
		}
		err = decode_schedule(
			state, &config->schedules[config->schedule_count]);
		if (err < 0) {
			return err;
		}
		++config->schedule_count;
	}
	return zcbor_list_end_decode(state) ? 0 : -EBADMSG;
}

static int decode_array_rules(zcbor_state_t *state,
			      struct spaghetti_config *config)
{
	if (!zcbor_list_start_decode(state)) {
		return -EBADMSG;
	}
	while (!zcbor_array_at_end(state)) {
		int err;

		if (config->rule_count >= SPAGHETTI_CONFIG_MAX_RULES) {
			return -EMSGSIZE;
		}
		err = decode_rule(state, &config->rules[config->rule_count]);
		if (err < 0) {
			return err;
		}
		++config->rule_count;
	}
	return zcbor_list_end_decode(state) ? 0 : -EBADMSG;
}

static int decode_array_blocks(zcbor_state_t *state,
			       struct spaghetti_config *config)
{
	if (!zcbor_list_start_decode(state)) {
		return -EBADMSG;
	}
	while (!zcbor_array_at_end(state)) {
		int err;

		if (config->block_count >= SPAGHETTI_CONFIG_MAX_BLOCKS) {
			return -EMSGSIZE;
		}
		err = decode_block(state, &config->blocks[config->block_count]);
		if (err < 0) {
			return err;
		}
		++config->block_count;
	}
	return zcbor_list_end_decode(state) ? 0 : -EBADMSG;
}

static int decode_array_edges(zcbor_state_t *state,
			      struct spaghetti_config *config)
{
	if (!zcbor_list_start_decode(state)) {
		return -EBADMSG;
	}
	while (!zcbor_array_at_end(state)) {
		int err;

		if (config->edge_count >= SPAGHETTI_CONFIG_MAX_EDGES) {
			return -EMSGSIZE;
		}
		err = decode_edge(state, &config->edges[config->edge_count]);
		if (err < 0) {
			return err;
		}
		++config->edge_count;
	}
	return zcbor_list_end_decode(state) ? 0 : -EBADMSG;
}

static int decode_wire_v2(const uint8_t *bytes, size_t length,
			  struct spaghetti_config *out)
{
	uint32_t wire_version;
	uint32_t connectivity;
	int err;

	memset(out, 0, sizeof(*out));
	out->version = SPAGHETTI_CONFIG_VERSION;

	ZCBOR_STATE_D(state, SPAGHETTI_CONFIG_CBOR_BACKUP_COUNT, bytes, length,
		       1U, 0U);

	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_VERSION);
	if ((err < 0) || !zcbor_uint32_decode(state, &wire_version) ||
	    (wire_version != SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V2)) {
		return -EBADMSG;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_MODULES);
	if (err < 0) {
		return err;
	}
	err = decode_array_modules(state, out);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_SCHEDULES);
	if (err < 0) {
		return err;
	}
	err = decode_array_schedules(state, out);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_RULES);
	if (err < 0) {
		return err;
	}
	err = decode_array_rules(state, out);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_MQTT);
	if (err < 0) {
		return err;
	}
	err = decode_mqtt(state, &out->mqtt);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_CONNECTIVITY);
	if ((err < 0) || !zcbor_uint32_decode(state, &connectivity)) {
		return -EBADMSG;
	}
	out->connectivity_policy =
		(enum spaghetti_connectivity_policy)connectivity;

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_ENERGY);
	if (err < 0) {
		return err;
	}
	err = decode_energy(state, &out->energy_policy);
	if (err < 0) {
		return err;
	}

	/* Wire V2 has no processing graph; migrate to empty blocks/edges. */
	out->block_count = 0U;
	out->edge_count = 0U;

	if (!zcbor_map_end_decode(state) ||
	    (state->payload != state->payload_end)) {
		return -EBADMSG;
	}

	return spaghetti_config_validate(out, NULL);
}

static int decode_wire_v3(const uint8_t *bytes, size_t length,
			  struct spaghetti_config *out)
{
	uint32_t wire_version;
	uint32_t connectivity;
	int err;

	memset(out, 0, sizeof(*out));
	out->version = SPAGHETTI_CONFIG_VERSION;

	ZCBOR_STATE_D(state, SPAGHETTI_CONFIG_CBOR_BACKUP_COUNT, bytes, length,
		       1U, 0U);

	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_VERSION);
	if ((err < 0) || !zcbor_uint32_decode(state, &wire_version) ||
	    (wire_version != SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V3)) {
		return -EBADMSG;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_MODULES);
	if (err < 0) {
		return err;
	}
	err = decode_array_modules(state, out);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_SCHEDULES);
	if (err < 0) {
		return err;
	}
	err = decode_array_schedules(state, out);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_RULES);
	if (err < 0) {
		return err;
	}
	err = decode_array_rules(state, out);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_MQTT);
	if (err < 0) {
		return err;
	}
	err = decode_mqtt(state, &out->mqtt);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_CONNECTIVITY);
	if ((err < 0) || !zcbor_uint32_decode(state, &connectivity)) {
		return -EBADMSG;
	}
	out->connectivity_policy =
		(enum spaghetti_connectivity_policy)connectivity;

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_ENERGY);
	if (err < 0) {
		return err;
	}
	err = decode_energy(state, &out->energy_policy);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_BLOCKS);
	if (err < 0) {
		return err;
	}
	err = decode_array_blocks(state, out);
	if (err < 0) {
		return err;
	}

	err = expect_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_EDGES);
	if (err < 0) {
		return err;
	}
	err = decode_array_edges(state, out);
	if (err < 0) {
		return err;
	}

	if (!zcbor_map_end_decode(state) ||
	    (state->payload != state->payload_end)) {
		return -EBADMSG;
	}

	return spaghetti_config_validate(out, NULL);
}

int spaghetti_config_decode_cbor(const uint8_t *bytes, size_t length,
				 struct spaghetti_config *out)
{
	uint32_t wire_version;
	int err;

	if ((bytes == NULL) || (out == NULL) || (length == 0U)) {
		return -EINVAL;
	}
	if (length > SPAGHETTI_CONFIG_CBOR_MAX_SIZE) {
		return -EMSGSIZE;
	}

	err = peek_wire_version(bytes, length, &wire_version);
	if (err < 0) {
		return err;
	}
	if ((wire_version == SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V0) ||
	    (wire_version == SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V1)) {
		return spaghetti_config_decode_cbor_legacy(bytes, length,
							   wire_version, out);
	}
	if (wire_version == SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V2) {
		return decode_wire_v2(bytes, length, out);
	}
	if (wire_version != SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V3) {
		return -ENOTSUP;
	}

	return decode_wire_v3(bytes, length, out);
}

int spaghetti_config_encode_cbor(
	const struct spaghetti_config *config,
	uint8_t *buffer,
	size_t buffer_capacity,
	size_t *written_size)
{
	int err;

	if ((config == NULL) || (buffer == NULL) || (written_size == NULL)) {
		return -EINVAL;
	}
	if (buffer_capacity == 0U) {
		return -EMSGSIZE;
	}

	err = spaghetti_config_validate(config, NULL);
	if (err < 0) {
		return err;
	}

	ZCBOR_STATE_E(state, SPAGHETTI_CONFIG_CBOR_BACKUP_COUNT, buffer,
		       buffer_capacity, 1U);

	if (!zcbor_map_start_encode(state, 9U)) {
		return -EMSGSIZE;
	}
	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_VERSION);
	if ((err < 0) ||
	    !zcbor_uint32_put(state, SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V3)) {
		return -EMSGSIZE;
	}

	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_MODULES);
	if ((err < 0) ||
	    !zcbor_list_start_encode(state, config->module_count)) {
		return -EMSGSIZE;
	}
	for (size_t idx = 0U; idx < config->module_count; ++idx) {
		err = encode_module(state, &config->modules[idx]);
		if (err < 0) {
			return err;
		}
	}
	if (!zcbor_list_end_encode(state, config->module_count)) {
		return -EMSGSIZE;
	}

	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_SCHEDULES);
	if ((err < 0) ||
	    !zcbor_list_start_encode(state, config->schedule_count)) {
		return -EMSGSIZE;
	}
	for (size_t idx = 0U; idx < config->schedule_count; ++idx) {
		err = encode_schedule(state, &config->schedules[idx]);
		if (err < 0) {
			return err;
		}
	}
	if (!zcbor_list_end_encode(state, config->schedule_count)) {
		return -EMSGSIZE;
	}

	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_RULES);
	if ((err < 0) || !zcbor_list_start_encode(state, config->rule_count)) {
		return -EMSGSIZE;
	}
	for (size_t idx = 0U; idx < config->rule_count; ++idx) {
		err = encode_rule(state, &config->rules[idx]);
		if (err < 0) {
			return err;
		}
	}
	if (!zcbor_list_end_encode(state, config->rule_count)) {
		return -EMSGSIZE;
	}

	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_MQTT);
	if (err < 0) {
		return err;
	}
	err = encode_mqtt(state, &config->mqtt);
	if (err < 0) {
		return err;
	}

	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_CONNECTIVITY);
	if ((err < 0) ||
	    !zcbor_uint32_put(state, (uint32_t)config->connectivity_policy)) {
		return -EMSGSIZE;
	}

	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_ENERGY);
	if (err < 0) {
		return err;
	}
	err = encode_energy(state, &config->energy_policy);
	if (err < 0) {
		return err;
	}

	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_BLOCKS);
	if ((err < 0) ||
	    !zcbor_list_start_encode(state, config->block_count)) {
		return -EMSGSIZE;
	}
	for (size_t idx = 0U; idx < config->block_count; ++idx) {
		err = encode_block(state, &config->blocks[idx]);
		if (err < 0) {
			return err;
		}
	}
	if (!zcbor_list_end_encode(state, config->block_count)) {
		return -EMSGSIZE;
	}

	err = put_key(state, SPAGHETTI_CONFIG_CBOR_ROOT_KEY_EDGES);
	if ((err < 0) || !zcbor_list_start_encode(state, config->edge_count)) {
		return -EMSGSIZE;
	}
	for (size_t idx = 0U; idx < config->edge_count; ++idx) {
		err = encode_edge(state, &config->edges[idx]);
		if (err < 0) {
			return err;
		}
	}
	if (!zcbor_list_end_encode(state, config->edge_count)) {
		return -EMSGSIZE;
	}

	if (!zcbor_map_end_encode(state, 9U)) {
		return -EMSGSIZE;
	}

	*written_size = (size_t)(state->payload - buffer);
	if (*written_size > SPAGHETTI_CONFIG_CBOR_MAX_SIZE) {
		return -EMSGSIZE;
	}

	return 0;
}
