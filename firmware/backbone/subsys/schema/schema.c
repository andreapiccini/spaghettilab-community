#include <spaghetti/schema.h>

#include <errno.h>
#include <string.h>

#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

LOG_MODULE_REGISTER(spaghetti_schema, CONFIG_SPAGHETTI_SCHEMA_LOG_LEVEL);

static size_t bounded_strlen(const char *text, size_t max_with_nul)
{
	size_t length = 0U;

	while ((length < max_with_nul) && (text[length] != '\0')) {
		length += 1U;
	}

	return length;
}

static bool string_fits(const char *text, size_t max_with_nul)
{
	size_t length;

	if (text == NULL) {
		return false;
	}

	length = bounded_strlen(text, max_with_nul);
	return (length > 0U) && (length < max_with_nul);
}

static bool unit_fits(const char *unit)
{
	if (unit == NULL) {
		return false;
	}

	return bounded_strlen(unit, SPAGHETTI_UNIT_NAME_SIZE) <
	       SPAGHETTI_UNIT_NAME_SIZE;
}

static bool utf8_is_valid(const uint8_t *bytes, size_t size)
{
	size_t idx = 0U;

	while (idx < size) {
		uint8_t lead = bytes[idx];
		size_t expected;
		uint32_t codepoint;

		if (lead <= 0x7FU) {
			idx += 1U;
			continue;
		}

		if ((lead >= 0xC2U) && (lead <= 0xDFU)) {
			expected = 2U;
			codepoint = (uint32_t)(lead & 0x1FU);
		} else if ((lead >= 0xE0U) && (lead <= 0xEFU)) {
			expected = 3U;
			codepoint = (uint32_t)(lead & 0x0FU);
		} else if ((lead >= 0xF0U) && (lead <= 0xF4U)) {
			expected = 4U;
			codepoint = (uint32_t)(lead & 0x07U);
		} else {
			return false;
		}

		if ((idx + expected) > size) {
			return false;
		}

		for (size_t cont = 1U; cont < expected; ++cont) {
			uint8_t byte = bytes[idx + cont];

			if ((byte < 0x80U) || (byte > 0xBFU)) {
				return false;
			}
			codepoint = (codepoint << 6) | (uint32_t)(byte & 0x3FU);
		}

		if ((expected == 2U) && (codepoint < 0x80U)) {
			return false;
		}
		if ((expected == 3U) && (codepoint < 0x800U)) {
			return false;
		}
		if ((expected == 3U) && (codepoint >= 0xD800U) &&
		    (codepoint <= 0xDFFFU)) {
			return false;
		}
		if ((expected == 4U) &&
		    ((codepoint < 0x10000U) || (codepoint > 0x10FFFFU))) {
			return false;
		}
		if ((lead == 0xE0U) && (bytes[idx + 1U] < 0xA0U)) {
			return false;
		}
		if ((lead == 0xEDU) && (bytes[idx + 1U] > 0x9FU)) {
			return false;
		}
		if ((lead == 0xF0U) && (bytes[idx + 1U] < 0x90U)) {
			return false;
		}
		if ((lead == 0xF4U) && (bytes[idx + 1U] > 0x8FU)) {
			return false;
		}

		idx += expected;
	}

	return true;
}

static bool semantic_matches_type(enum spaghetti_field_semantic semantic,
				  enum spaghetti_value_type type)
{
	switch (semantic) {
	case SPAGHETTI_FIELD_SEMANTIC_VALUE:
		return true;
	case SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF:
	case SPAGHETTI_FIELD_SEMANTIC_RECORD_FIELD_REF:
	case SPAGHETTI_FIELD_SEMANTIC_COMMAND_REF:
	case SPAGHETTI_FIELD_SEMANTIC_PORT_REF:
	case SPAGHETTI_FIELD_SEMANTIC_FLOW_REF:
	case SPAGHETTI_FIELD_SEMANTIC_BAY_REF:
	case SPAGHETTI_FIELD_SEMANTIC_POWER_RAIL_REF:
	case SPAGHETTI_FIELD_SEMANTIC_DURATION_MS:
		return type == SPAGHETTI_VALUE_UINT64;
	default:
		return false;
	}
}

static bool values_equal(const struct spaghetti_value *left,
			 const struct spaghetti_value *right)
{
	if ((left == NULL) || (right == NULL) || (left->type != right->type) ||
	    (left->field_id != right->field_id)) {
		return false;
	}

	switch (left->type) {
	case SPAGHETTI_VALUE_BOOL:
		return left->data.boolean == right->data.boolean;
	case SPAGHETTI_VALUE_INT64:
		return left->data.signed_integer == right->data.signed_integer;
	case SPAGHETTI_VALUE_UINT64:
		return left->data.unsigned_integer ==
		       right->data.unsigned_integer;
	case SPAGHETTI_VALUE_TEXT:
		return (left->data.text.size == right->data.text.size) &&
		       (memcmp(left->data.text.text, right->data.text.text,
			       left->data.text.size) == 0);
	case SPAGHETTI_VALUE_BYTES:
		return (left->data.bytes.size == right->data.bytes.size) &&
		       (memcmp(left->data.bytes.bytes, right->data.bytes.bytes,
			       left->data.bytes.size) == 0);
	default:
		return false;
	}
}

static const struct spaghetti_field_descriptor *schema_find_field(
	const struct spaghetti_schema_descriptor *schema,
	uint16_t field_id)
{
	for (size_t idx = 0U; idx < schema->field_count; ++idx) {
		if (schema->fields[idx].field_id == field_id) {
			return &schema->fields[idx];
		}
	}

	return NULL;
}

static int validate_schema_descriptor(
	const struct spaghetti_schema_descriptor *schema)
{
	if ((schema == NULL) || (schema->fields == NULL) ||
	    !string_fits(schema->schema_id, SPAGHETTI_SCHEMA_ID_SIZE)) {
		return -EINVAL;
	}

	if (schema->field_count > SPAGHETTI_PROPERTY_MAX_FIELDS) {
		return -EMSGSIZE;
	}

	for (size_t idx = 0U; idx < schema->field_count; ++idx) {
		const struct spaghetti_field_descriptor *field =
			&schema->fields[idx];

		if (field->field_id == 0U) {
			return -EINVAL;
		}
		if (!string_fits(field->name, SPAGHETTI_FIELD_NAME_SIZE) ||
		    (field->description == NULL) || !unit_fits(field->unit)) {
			return -EINVAL;
		}
		if ((field->flags & ~SPAGHETTI_FIELD_FLAGS_KNOWN) != 0U) {
			return -EINVAL;
		}
		if (!semantic_matches_type(field->semantic, field->type)) {
			return -EPROTONOSUPPORT;
		}
		if ((field->semantic == SPAGHETTI_FIELD_SEMANTIC_VALUE) &&
		    (field->reference_group != 0U)) {
			return -EPROTONOSUPPORT;
		}
		if ((field->semantic != SPAGHETTI_FIELD_SEMANTIC_VALUE) &&
		    (field->reference_group == 0U) &&
		    ((field->semantic ==
		      SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF) ||
		     (field->semantic ==
		      SPAGHETTI_FIELD_SEMANTIC_RECORD_FIELD_REF))) {
			/*
			 * Compound source/target refs require a nonzero group so
			 * editors can pair them. Lone refs may use group zero.
			 */
		}

		for (size_t prior = 0U; prior < idx; ++prior) {
			if (schema->fields[prior].field_id == field->field_id) {
				return -EEXIST;
			}
		}

		if ((field->flags & SPAGHETTI_FIELD_HAS_DEFAULT) != 0U) {
			if ((field->default_value == NULL) ||
			    (field->default_value->field_id != field->field_id) ||
			    (field->default_value->type != field->type)) {
				return -EPROTONOSUPPORT;
			}
		} else if (field->default_value != NULL) {
			return -EPROTONOSUPPORT;
		}

		if ((field->flags & SPAGHETTI_FIELD_ENUM) != 0U) {
			if ((field->type != SPAGHETTI_VALUE_INT64) &&
			    (field->type != SPAGHETTI_VALUE_UINT64)) {
				return -EPROTONOSUPPORT;
			}
			if ((field->enum_options == NULL) ||
			    (field->enum_option_count == 0U)) {
				return -EPROTONOSUPPORT;
			}
			for (size_t opt = 0U; opt < field->enum_option_count;
			     ++opt) {
				const struct spaghetti_enum_option *option =
					&field->enum_options[opt];

				if ((option->name == NULL) ||
				    (option->description == NULL) ||
				    (option->value.field_id != field->field_id) ||
				    (option->value.type != field->type)) {
					return -EPROTONOSUPPORT;
				}
				for (size_t earlier = 0U; earlier < opt;
				     ++earlier) {
					if (values_equal(
						    &field->enum_options[earlier]
							     .value,
						    &option->value)) {
						return -EEXIST;
					}
				}
			}
		} else if ((field->enum_options != NULL) ||
			   (field->enum_option_count != 0U)) {
			return -EPROTONOSUPPORT;
		}

		if (field->type == SPAGHETTI_VALUE_BYTES) {
			if (field->bytes_max_size > SPAGHETTI_VALUE_BYTES_MAX) {
				return -EMSGSIZE;
			}
			if (field->bytes_min_size > field->bytes_max_size) {
				return -EINVAL;
			}
		}
	}

	return 0;
}

static int validate_value_against_field(
	const struct spaghetti_value *value,
	const struct spaghetti_field_descriptor *field)
{
	if (value->type != field->type) {
		return -EINVAL;
	}

	switch (value->type) {
	case SPAGHETTI_VALUE_BOOL:
		break;
	case SPAGHETTI_VALUE_INT64:
		if ((value->data.signed_integer < field->signed_minimum) ||
		    (value->data.signed_integer > field->signed_maximum)) {
			return -ERANGE;
		}
		break;
	case SPAGHETTI_VALUE_UINT64:
		if ((value->data.unsigned_integer < field->unsigned_minimum) ||
		    (value->data.unsigned_integer > field->unsigned_maximum)) {
			return -ERANGE;
		}
		break;
	case SPAGHETTI_VALUE_TEXT:
		if (value->data.text.size > SPAGHETTI_VALUE_TEXT_MAX) {
			return -EMSGSIZE;
		}
		if (value->data.text.text[value->data.text.size] != '\0') {
			return -EINVAL;
		}
		if (bounded_strlen(value->data.text.text,
				   SPAGHETTI_VALUE_TEXT_MAX + 1U) !=
		    value->data.text.size) {
			return -EINVAL;
		}
		if (!utf8_is_valid((const uint8_t *)value->data.text.text,
				   value->data.text.size)) {
			return -EINVAL;
		}
		break;
	case SPAGHETTI_VALUE_BYTES:
		if (value->data.bytes.size > SPAGHETTI_VALUE_BYTES_MAX) {
			return -EMSGSIZE;
		}
		if ((value->data.bytes.size < field->bytes_min_size) ||
		    (value->data.bytes.size > field->bytes_max_size)) {
			return -EMSGSIZE;
		}
		break;
	default:
		return -EINVAL;
	}

	if ((field->flags & SPAGHETTI_FIELD_ENUM) != 0U) {
		bool matched = false;

		for (size_t opt = 0U; opt < field->enum_option_count; ++opt) {
			if (values_equal(value, &field->enum_options[opt].value)) {
				matched = true;
				break;
			}
		}
		if (!matched) {
			return -EINVAL;
		}
	}

	return 0;
}

static int validate_reference_groups(
	const struct spaghetti_property_set *properties,
	const struct spaghetti_schema_descriptor *schema)
{
	for (size_t idx = 0U; idx < schema->field_count; ++idx) {
		const struct spaghetti_field_descriptor *field =
			&schema->fields[idx];
		bool has_key;
		bool has_peer;

		if ((field->reference_group == 0U) ||
		    (field->semantic !=
		     SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF)) {
			continue;
		}
		if (spaghetti_property_find(properties, field->field_id) ==
		    NULL) {
			continue;
		}

		has_key = true;
		has_peer = false;
		for (size_t peer_idx = 0U; peer_idx < schema->field_count;
		     ++peer_idx) {
			const struct spaghetti_field_descriptor *peer =
				&schema->fields[peer_idx];

			if (peer->reference_group != field->reference_group) {
				continue;
			}
			if ((peer->semantic !=
			     SPAGHETTI_FIELD_SEMANTIC_RECORD_FIELD_REF) &&
			    (peer->semantic !=
			     SPAGHETTI_FIELD_SEMANTIC_COMMAND_REF)) {
				if ((peer != field) &&
				    (spaghetti_property_find(
					     properties, peer->field_id) !=
				     NULL)) {
					return -EPROTONOSUPPORT;
				}
				continue;
			}
			if (spaghetti_property_find(properties, peer->field_id) !=
			    NULL) {
				has_peer = true;
			}
		}

		if (has_key && !has_peer) {
			return -EPROTONOSUPPORT;
		}
	}

	return 0;
}

const struct spaghetti_value *spaghetti_property_find(
	const struct spaghetti_property_set *properties,
	uint16_t field_id)
{
	if ((properties == NULL) || (field_id == 0U)) {
		return NULL;
	}

	for (size_t idx = 0U; idx < properties->field_count; ++idx) {
		if (properties->fields[idx].field_id == field_id) {
			return &properties->fields[idx];
		}
	}

	return NULL;
}

int spaghetti_property_validate(
	const struct spaghetti_property_set *properties,
	const struct spaghetti_schema_descriptor *schema)
{
	return spaghetti_property_validate_with_resolver(properties, schema,
							 NULL, NULL);
}

int spaghetti_property_validate_with_resolver(
	const struct spaghetti_property_set *properties,
	const struct spaghetti_schema_descriptor *schema,
	spaghetti_schema_reference_resolve_fn resolve,
	void *user_data)
{
	int err;

	err = validate_schema_descriptor(schema);
	if (err != 0) {
		return err;
	}
	if (properties == NULL) {
		return -EINVAL;
	}
	if (properties->field_count > SPAGHETTI_PROPERTY_MAX_FIELDS) {
		return -EMSGSIZE;
	}

	for (size_t idx = 0U; idx < properties->field_count; ++idx) {
		const struct spaghetti_value *value = &properties->fields[idx];
		const struct spaghetti_field_descriptor *field;

		if (value->field_id == 0U) {
			return -EINVAL;
		}
		for (size_t prior = 0U; prior < idx; ++prior) {
			if (properties->fields[prior].field_id ==
			    value->field_id) {
				return -EEXIST;
			}
		}

		field = schema_find_field(schema, value->field_id);
		if (field == NULL) {
			return -ENOENT;
		}

		err = validate_value_against_field(value, field);
		if (err != 0) {
			return err;
		}

		if ((resolve != NULL) &&
		    (field->semantic != SPAGHETTI_FIELD_SEMANTIC_VALUE) &&
		    (field->semantic != SPAGHETTI_FIELD_SEMANTIC_DURATION_MS)) {
			err = resolve(field->semantic, field->reference_group,
				      value, user_data);
			if (err != 0) {
				return err;
			}
		}
	}

	for (size_t idx = 0U; idx < schema->field_count; ++idx) {
		const struct spaghetti_field_descriptor *field =
			&schema->fields[idx];

		if (((field->flags & SPAGHETTI_FIELD_REQUIRED) != 0U) &&
		    (spaghetti_property_find(properties, field->field_id) ==
		     NULL)) {
			return -ENOENT;
		}
	}

	return validate_reference_groups(properties, schema);
}

int spaghetti_record_payload_validate(
	const struct spaghetti_record_payload *payload,
	const struct spaghetti_schema_descriptor *schema)
{
	size_t schema_id_length;

	if ((payload == NULL) || (schema == NULL) ||
	    (schema->schema_id == NULL)) {
		return -EINVAL;
	}
	if ((payload->kind != SPAGHETTI_RECORD_SAMPLE) &&
	    (payload->kind != SPAGHETTI_RECORD_EVENT)) {
		return -EINVAL;
	}

	schema_id_length =
		bounded_strlen(schema->schema_id, SPAGHETTI_SCHEMA_ID_SIZE);
	if ((schema_id_length == 0U) ||
	    (schema_id_length >= SPAGHETTI_SCHEMA_ID_SIZE) ||
	    (strncmp(payload->schema_id, schema->schema_id,
		     SPAGHETTI_SCHEMA_ID_SIZE) != 0) ||
	    (payload->schema_version != schema->version)) {
		return -EPROTONOSUPPORT;
	}

	return spaghetti_property_validate(&payload->values, schema);
}

int spaghetti_record_validate(
	const struct spaghetti_record *record,
	const struct spaghetti_schema_descriptor *schema)
{
	if (record == NULL) {
		return -EINVAL;
	}
	if (record->source_key == 0U) {
		return -EINVAL;
	}
	if (record->sequence == 0U) {
		return -EINVAL;
	}
	if (record->timestamp_ms < 0) {
		return -EINVAL;
	}

	return spaghetti_record_payload_validate(&record->payload, schema);
}
