/**
 * @file
 * @brief Typed property, schema, record, and command vocabulary.
 * @ingroup spaghetti_schema
 */

#ifndef SPAGHETTI_SCHEMA_H
#define SPAGHETTI_SCHEMA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/util.h>

#include <spaghetti/module.h>

/** Maximum characters stored in one schema_id, including the terminating NUL. */
#define SPAGHETTI_SCHEMA_ID_SIZE 32U

/** Maximum characters stored in one field name, including the terminating NUL. */
#define SPAGHETTI_FIELD_NAME_SIZE 24U

/** Maximum characters stored in one unit string, including the terminating NUL. */
#define SPAGHETTI_UNIT_NAME_SIZE 16U

/** Maximum owned opaque bytes in one BYTES value. */
#define SPAGHETTI_VALUE_BYTES_MAX CONFIG_SPAGHETTI_VALUE_BYTES_MAX

/** Maximum UTF-8 payload bytes in one TEXT value, excluding the terminating NUL. */
#define SPAGHETTI_VALUE_TEXT_MAX CONFIG_SPAGHETTI_VALUE_TEXT_MAX

/** Maximum fields stored in one property set. */
#define SPAGHETTI_PROPERTY_MAX_FIELDS CONFIG_SPAGHETTI_MAX_PROPERTIES_PER_SET

/** Wire and storage type for one property value. */
enum spaghetti_value_type {
	SPAGHETTI_VALUE_BOOL, /**< Boolean true/false. */
	SPAGHETTI_VALUE_INT64, /**< Signed 64-bit integer or fixed-point. */
	SPAGHETTI_VALUE_UINT64, /**< Unsigned 64-bit integer or counter. */
	SPAGHETTI_VALUE_TEXT, /**< Owned UTF-8 text with terminating NUL. */
	SPAGHETTI_VALUE_BYTES, /**< Owned opaque byte blob. */
};

/** Descriptor hints that do not change the wire type. */
enum spaghetti_field_semantic {
	SPAGHETTI_FIELD_SEMANTIC_VALUE, /**< Generic typed value. */
	SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF, /**< UINT64 Module key. */
	SPAGHETTI_FIELD_SEMANTIC_RECORD_FIELD_REF, /**< UINT64 record field ID. */
	SPAGHETTI_FIELD_SEMANTIC_COMMAND_REF, /**< UINT64 command ID. */
	SPAGHETTI_FIELD_SEMANTIC_PORT_REF, /**< UINT64 Port ID. */
	SPAGHETTI_FIELD_SEMANTIC_FLOW_REF, /**< UINT64 Flow ID. */
	SPAGHETTI_FIELD_SEMANTIC_BAY_REF, /**< UINT64 Bay ID. */
	SPAGHETTI_FIELD_SEMANTIC_POWER_RAIL_REF, /**< UINT64 power rail ID. */
	SPAGHETTI_FIELD_SEMANTIC_DURATION_MS, /**< UINT64 duration in milliseconds. */
};

/** Bit flags describing one field in a schema. */
enum spaghetti_field_flags {
	SPAGHETTI_FIELD_REQUIRED = BIT(0), /**< Property set must include the field. */
	SPAGHETTI_FIELD_WRITABLE = BIT(1), /**< Hosts may write the field. */
	SPAGHETTI_FIELD_HAS_DEFAULT = BIT(2), /**< Descriptor publishes a default. */
	SPAGHETTI_FIELD_ENUM = BIT(3), /**< Value must match an enum option. */
};

/** Known descriptor flag bits; other bits are rejected during validation. */
#define SPAGHETTI_FIELD_FLAGS_KNOWN \
	(SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE | \
	 SPAGHETTI_FIELD_HAS_DEFAULT | SPAGHETTI_FIELD_ENUM)

/** Kind of one Module-produced record payload. */
enum spaghetti_record_kind {
	SPAGHETTI_RECORD_SAMPLE, /**< Periodic measurement-style payload. */
	SPAGHETTI_RECORD_EVENT, /**< Discrete event-style payload. */
};

/** Owned opaque bytes for one BYTES value. */
struct spaghetti_bytes_value {
	size_t size; /**< Valid byte count in @ref bytes. */
	uint8_t bytes[SPAGHETTI_VALUE_BYTES_MAX]; /**< Owned opaque payload. */
};

/** Owned UTF-8 text for one TEXT value. */
struct spaghetti_text_value {
	size_t size; /**< Payload bytes excluding the terminating NUL. */
	char text[SPAGHETTI_VALUE_TEXT_MAX + 1U]; /**< NUL-terminated UTF-8. */
};

/**
 * @brief One owned typed property value.
 *
 * @p type selects the active @p data member. Values never contain pointers.
 */
struct spaghetti_value {
	uint16_t field_id; /**< Stable nonzero schema field identifier. */
	enum spaghetti_value_type type; /**< Active union member. */
	union {
		bool boolean; /**< Active when type is BOOL. */
		int64_t signed_integer; /**< Active when type is INT64. */
		uint64_t unsigned_integer; /**< Active when type is UINT64. */
		struct spaghetti_text_value text; /**< Active when type is TEXT. */
		struct spaghetti_bytes_value bytes; /**< Active when type is BYTES. */
	} data;
};

/** Bounded owned collection of property values. */
struct spaghetti_property_set {
	size_t field_count; /**< Number of valid entries in @ref fields. */
	struct spaghetti_value fields[SPAGHETTI_PROPERTY_MAX_FIELDS]; /**< Owned values. */
};

/** Firmware-lifetime enum option belonging to one field descriptor. */
struct spaghetti_enum_option {
	struct spaghetti_value value; /**< Option payload matching the field type. */
	const char *name; /**< Stable machine name borrowed for firmware life. */
	const char *description; /**< Short human text borrowed for firmware life. */
};

/** Firmware-lifetime description of one schema field. */
struct spaghetti_field_descriptor {
	uint16_t field_id; /**< Stable nonzero identifier encoded on the wire. */
	enum spaghetti_value_type type; /**< Required value type. */
	enum spaghetti_field_semantic semantic; /**< Host/validator meaning. */
	uint8_t reference_group; /**< Nonzero group for compound references. */
	uint32_t flags; /**< Combination of @ref spaghetti_field_flags. */
	int64_t signed_minimum; /**< INT64 inclusive minimum; unused otherwise. */
	int64_t signed_maximum; /**< INT64 inclusive maximum; unused otherwise. */
	uint64_t unsigned_minimum; /**< UINT64 inclusive minimum; unused otherwise. */
	uint64_t unsigned_maximum; /**< UINT64 inclusive maximum; unused otherwise. */
	uint8_t bytes_min_size; /**< BYTES inclusive minimum length. */
	uint8_t bytes_max_size; /**< BYTES inclusive maximum length. */
	const char *name; /**< Stable machine name for JSON and Node-RED. */
	const char *description; /**< Brief human description. */
	const char *unit; /**< Unit string, or empty when not applicable. */
	const struct spaghetti_value *default_value; /**< NULL when no default. */
	const struct spaghetti_enum_option *enum_options; /**< NULL when not an enum. */
	size_t enum_option_count; /**< Number of @ref enum_options entries. */
};

/** Firmware-lifetime schema catalog entry. */
struct spaghetti_schema_descriptor {
	const char *schema_id; /**< Stable identifier such as spaghetti.ina219.sample. */
	uint16_t version; /**< Incompatible field changes bump this value. */
	const struct spaghetti_field_descriptor *fields; /**< Ordered field table. */
	size_t field_count; /**< Number of @ref fields entries. */
};

/** Firmware-lifetime command description for one Module driver. */
struct spaghetti_command_descriptor {
	uint16_t command_id; /**< Stable command identifier within the driver. */
	const char *name; /**< Stable machine name. */
	const struct spaghetti_schema_descriptor *argument_schema; /**< Argument fields. */
};

/** Owned Module-produced payload before Runtime stamps identity metadata. */
struct spaghetti_record_payload {
	enum spaghetti_record_kind kind; /**< Sample or event classification. */
	char schema_id[SPAGHETTI_SCHEMA_ID_SIZE]; /**< Owned matching schema_id. */
	uint16_t schema_version; /**< Matching schema version. */
	struct spaghetti_property_set values; /**< Owned typed fields. */
};

/**
 * @brief Copiable zbus record assembled by Manager or Runtime.
 *
 * @p timestamp_ms is monotonic uptime from @c k_uptime_get(), not Unix time.
 * @p sequence is per source, starts at one, and may roll over at UINT32_MAX.
 */
struct spaghetti_record {
	spaghetti_module_id_t source_id; /**< Ephemeral live Module handle. */
	spaghetti_module_key_t source_key; /**< Stable nonzero Config identity. */
	uint64_t boot_id; /**< Value that changes across reboot. */
	int64_t timestamp_ms; /**< Monotonic uptime milliseconds. */
	uint32_t sequence; /**< Per-source sequence starting at one. */
	struct spaghetti_record_payload payload; /**< Owned typed payload. */
};

/** Synchronous Module command carrying owned argument values. */
struct spaghetti_module_command {
	uint16_t command_id; /**< Stable command identifier. */
	struct spaghetti_property_set arguments; /**< Owned argument values. */
};

/**
 * @brief Resolve one typed reference during property validation.
 *
 * @param[in] semantic Reference semantic being resolved.
 * @param[in] reference_group Compound group from the field descriptor.
 * @param[in] value Borrowed property value for the reference.
 * @param[in,out] user_data Caller context for the resolver.
 *
 * @retval 0 Reference target exists.
 * @retval -ENOENT Reference target is missing.
 * @retval -EINVAL Reference value is malformed for the semantic.
 */
typedef int (*spaghetti_schema_reference_resolve_fn)(
	enum spaghetti_field_semantic semantic,
	uint8_t reference_group,
	const struct spaghetti_value *value,
	void *user_data);

/**
 * @brief Borrow one property by stable field ID.
 *
 * @param[in] properties Borrowed property set.
 * @param[in] field_id Stable nonzero field identifier.
 *
 * @return Immutable pointer with the property-set lifetime, or NULL.
 */
const struct spaghetti_value *spaghetti_property_find(
	const struct spaghetti_property_set *properties,
	uint16_t field_id);

/**
 * @brief Validate a property set against a schema without resolving references.
 *
 * @param[in] properties Borrowed property set; never modified.
 * @param[in] schema Borrowed firmware-lifetime schema descriptor.
 *
 * @retval 0 Property set matches the schema.
 * @retval -EINVAL Null pointer, bad count, type mismatch, UTF-8, or flags.
 * @retval -ENOENT Required field is missing or field ID is unknown.
 * @retval -EEXIST Duplicate field ID.
 * @retval -EMSGSIZE TEXT or BYTES exceed bounds.
 * @retval -ERANGE Numeric value is outside declared limits.
 * @retval -EPROTONOSUPPORT Semantic, enum, or default contract is unsupported.
 */
int spaghetti_property_validate(
	const struct spaghetti_property_set *properties,
	const struct spaghetti_schema_descriptor *schema);

/**
 * @brief Validate a property set and resolve typed references.
 *
 * @param[in] properties Borrowed property set; never modified.
 * @param[in] schema Borrowed firmware-lifetime schema descriptor.
 * @param[in] resolve Optional reference resolver; NULL skips external lookup.
 * @param[in,out] user_data Passed to @p resolve when non-NULL.
 *
 * @retval 0 Property set matches the schema and references resolve.
 * @retval -EINVAL Null pointer, bad count, type mismatch, UTF-8, or flags.
 * @retval -ENOENT Required field, unknown field ID, or missing reference.
 * @retval -EEXIST Duplicate field ID.
 * @retval -EMSGSIZE TEXT or BYTES exceed bounds.
 * @retval -ERANGE Numeric value is outside declared limits.
 * @retval -EPROTONOSUPPORT Semantic, enum, or default contract is unsupported.
 */
int spaghetti_property_validate_with_resolver(
	const struct spaghetti_property_set *properties,
	const struct spaghetti_schema_descriptor *schema,
	spaghetti_schema_reference_resolve_fn resolve,
	void *user_data);

/**
 * @brief Validate one Module-produced record payload against its schema.
 *
 * @param[in] payload Borrowed payload; never modified.
 * @param[in] schema Borrowed firmware-lifetime schema descriptor.
 *
 * @retval 0 Payload matches the schema.
 * @retval -EINVAL Null pointer or unsupported kind.
 * @retval -ENOENT Required field is missing or field ID is unknown.
 * @retval -EEXIST Duplicate field ID.
 * @retval -EMSGSIZE TEXT or BYTES exceed bounds.
 * @retval -ERANGE Numeric value is outside declared limits.
 * @retval -EPROTONOSUPPORT Schema ID/version or semantic contract mismatch.
 */
int spaghetti_record_payload_validate(
	const struct spaghetti_record_payload *payload,
	const struct spaghetti_schema_descriptor *schema);

/**
 * @brief Validate a stamped record against its schema.
 *
 * @param[in] record Borrowed record; never modified.
 * @param[in] schema Borrowed firmware-lifetime schema descriptor.
 *
 * @retval 0 Record metadata and payload are acceptable.
 * @retval -EINVAL Null pointer, zero sequence, or invalid source key.
 * @retval -ENOENT Required field is missing or field ID is unknown.
 * @retval -EEXIST Duplicate field ID.
 * @retval -EMSGSIZE TEXT or BYTES exceed bounds.
 * @retval -ERANGE Numeric value is outside declared limits.
 * @retval -EPROTONOSUPPORT Schema ID/version or semantic contract mismatch.
 */
int spaghetti_record_validate(
	const struct spaghetti_record *record,
	const struct spaghetti_schema_descriptor *schema);

#endif /* SPAGHETTI_SCHEMA_H */
