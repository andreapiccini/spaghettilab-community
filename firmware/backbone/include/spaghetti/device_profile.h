/**
 * @file
 * @brief Declarative Device Profile catalog, validation, and execution.
 * @ingroup spaghetti_device_profile
 */

#ifndef SPAGHETTI_DEVICE_PROFILE_H
#define SPAGHETTI_DEVICE_PROFILE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/iterable_sections.h>

#include <spaghetti/module.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

/** Bytes reserved for one owned profile_id, including the terminating NUL. */
#define SPAGHETTI_DEVICE_PROFILE_ID_SIZE 32U

/** SHA-256 digest bytes stored with every committed profile image. */
#define SPAGHETTI_DEVICE_PROFILE_HASH_SIZE 32U

/** Temporary byte slots available to one acquisition-plan interpreter run. */
#define SPAGHETTI_DEVICE_PROFILE_TEMP_SLOTS 8U

/** Opcode vocabulary revision understood by this firmware image. */
#define SPAGHETTI_DEVICE_PROFILE_OPCODE_VERSION 2U

/** Compact CBOR map wire revision decoded by install. */
#define SPAGHETTI_DEVICE_PROFILE_WIRE_VERSION 1U

/** Maximum sample-record fields owned by one profile. */
#define SPAGHETTI_DEVICE_PROFILE_MAX_FIELDS SPAGHETTI_PROPERTY_MAX_FIELDS

/**
 * @brief Declare one immutable built-in Device Profile in the ROM section.
 *
 * Expand with `= { ... };` after the macro. Entries are linker-collected and
 * published by @ref spaghetti_device_profile_init.
 *
 * @param name C identifier for the profile object.
 */
#define SPAGHETTI_DEVICE_PROFILE_DEFINE(name) \
	const STRUCT_SECTION_ITERABLE(spaghetti_device_profile, name)

/**
 * @brief Bounded acquisition-plan opcodes.
 *
 * Unknown values are rejected during validation. New opcodes require a
 * firmware Capability Pack; install never extends this set.
 */
enum spaghetti_device_profile_opcode {
	SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE = 1U, /**< Write temp bytes on I2C. */
	SPAGHETTI_DEVICE_PROFILE_OP_I2C_READ = 2U, /**< Read imm0 bytes into temp. */
	SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ = 3U, /**< Write then read. */
	SPAGHETTI_DEVICE_PROFILE_OP_SPI_TRANSCEIVE = 4U, /**< Full-duplex SPI. */
	SPAGHETTI_DEVICE_PROFILE_OP_UART_WRITE = 5U, /**< Write temp bytes on UART. */
	SPAGHETTI_DEVICE_PROFILE_OP_UART_READ_UNTIL = 6U, /**< Read until stop byte. */
	SPAGHETTI_DEVICE_PROFILE_OP_GPIO_GET = 7U, /**< Sample digital input. */
	SPAGHETTI_DEVICE_PROFILE_OP_GPIO_SET = 8U, /**< Drive digital output. */
	SPAGHETTI_DEVICE_PROFILE_OP_ADC_READ = 9U, /**< Read one ADC channel. */
	SPAGHETTI_DEVICE_PROFILE_OP_DELAY_BOUNDED = 10U, /**< Sleep imm0 milliseconds. */
	SPAGHETTI_DEVICE_PROFILE_OP_WAIT_FIELD_MASK = 11U, /**< Bounded ready poll. */
	SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST = 12U, /**< Load imm2/imm3 bytes. */
	SPAGHETTI_DEVICE_PROFILE_OP_COPY_BYTES = 13U, /**< Copy temp to temp. */
	SPAGHETTI_DEVICE_PROFILE_OP_CONCAT = 14U, /**< Concatenate two temps. */
	SPAGHETTI_DEVICE_PROFILE_OP_BYTE_SWAP = 15U, /**< Swap 2 or 4 byte temp. */
	SPAGHETTI_DEVICE_PROFILE_OP_MASK = 16U, /**< AND first bytes with imm2. */
	SPAGHETTI_DEVICE_PROFILE_OP_SHIFT = 17U, /**< Shift integer temp. */
	SPAGHETTI_DEVICE_PROFILE_OP_SIGN_EXTEND = 18U, /**< Sign-extend imm0 bits. */
	SPAGHETTI_DEVICE_PROFILE_OP_CRC8 = 19U, /**< CRC-8 poly 0x07 over temp. */
	SPAGHETTI_DEVICE_PROFILE_OP_CRC16 = 20U, /**< CRC-16-CCITT over temp. */
	SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD = 21U, /**< Append one record field. */
	SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD = 22U, /**< Finalize sample record. */
	SPAGHETTI_DEVICE_PROFILE_OP_W1_WRITE_READ = 23U, /**< 1-Wire write then read. */
	SPAGHETTI_DEVICE_PROFILE_OP_UART_READ = 24U, /**< Read imm0 UART bytes. */
	SPAGHETTI_DEVICE_PROFILE_OP_WAIT_GPIO = 25U, /**< Bounded digital-input poll. */
};

/**
 * @brief Compact acquisition-plan operation without pointers.
 *
 * Operand meaning depends on @ref opcode. Immediate fields carry lengths,
 * timeouts, masks, and small constants. Wire and storage copy this layout.
 */
struct spaghetti_device_profile_op {
	uint8_t opcode; /**< Value from @ref spaghetti_device_profile_opcode. */
	uint8_t dst; /**< Destination temp slot or emitted field id. */
	uint8_t src_a; /**< First source temp slot. */
	uint8_t src_b; /**< Second source temp slot when required. */
	uint16_t imm0; /**< Length, timeout_ms, attempts, or shift count. */
	uint16_t imm1; /**< Secondary length, interval_ms, or endian flag. */
	uint32_t imm2; /**< Mask, constant low bytes, or frequency. */
	uint32_t imm3; /**< Expected mask value or constant high bytes. */
};

/**
 * @brief Owned sample-record field published by one profile.
 *
 * MVP supports INT64 and UINT64 only. Names and units are owned NUL-terminated
 * strings copied from CBOR or built-in initializers.
 */
struct spaghetti_device_profile_field {
	uint16_t field_id; /**< Stable nonzero schema field identifier. */
	enum spaghetti_value_type type; /**< INT64 or UINT64 for MVP. */
	char name[SPAGHETTI_FIELD_NAME_SIZE]; /**< Owned machine field name. */
	char unit[SPAGHETTI_UNIT_NAME_SIZE]; /**< Owned unit string, may be empty. */
};

/**
 * @brief Decoded Device Profile owned by firmware after install or link-in.
 *
 * Built-ins live in ROM. Installed profiles are copied into RAM slots and are
 * never published until validation and hashing succeed. Instance Port, Bay,
 * label, and bus address are not part of this object.
 */
struct spaghetti_device_profile {
	char profile_id[SPAGHETTI_DEVICE_PROFILE_ID_SIZE]; /**< Owned stable model ID. */
	uint16_t version; /**< Incompatible profile revision. */
	uint8_t hash[SPAGHETTI_DEVICE_PROFILE_HASH_SIZE]; /**< SHA-256 of installed bytes. */
	enum spaghetti_port_transport transport; /**< Required Port electrical family. */
	uint32_t required_capabilities; /**< Port capability bits the profile needs. */
	uint32_t max_total_time_ms; /**< Worst-case plan time accepted by validate. */
	uint16_t max_transactions; /**< Worst-case bus transactions accepted. */
	uint16_t max_bytes; /**< Worst-case transferred bytes accepted. */
	struct spaghetti_device_profile_op
		init_ops[CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS]; /**< Init plan. */
	size_t init_count; /**< Valid entries in @ref init_ops. */
	struct spaghetti_device_profile_op
		sample_ops[CONFIG_SPAGHETTI_MAX_ACQUISITION_OPERATIONS]; /**< Sample plan. */
	size_t sample_count; /**< Valid entries in @ref sample_ops. */
	struct spaghetti_device_profile_op
		safe_stop_ops[CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS]; /**< Safe-stop plan. */
	size_t safe_stop_count; /**< Valid entries in @ref safe_stop_ops. */
	char sample_schema_id[SPAGHETTI_SCHEMA_ID_SIZE]; /**< Owned sample schema_id. */
	uint16_t sample_schema_version; /**< Sample schema version. */
	struct spaghetti_device_profile_field
		sample_fields[SPAGHETTI_DEVICE_PROFILE_MAX_FIELDS]; /**< Owned fields. */
	size_t sample_field_count; /**< Valid entries in @ref sample_fields. */
};

/**
 * @brief Worst-case budget computed by @ref spaghetti_device_profile_validate.
 */
struct spaghetti_device_profile_budget {
	uint32_t total_time_ms; /**< Sum of delays, waits, and transfer timeouts. */
	uint32_t transactions; /**< Count of Port bus operations including wait polls. */
	uint32_t bytes; /**< Sum of transferred bytes across all plans. */
	uint32_t operations; /**< Total opcode executions across all plans. */
};

/** Device Profile section associated with one validation failure. */
enum spaghetti_device_profile_failure_field {
	SPAGHETTI_DEVICE_PROFILE_FAILURE_WIRE = 0, /**< CBOR decode or wire version. */
	SPAGHETTI_DEVICE_PROFILE_FAILURE_IDENTITY = 1, /**< id, version, transport, caps. */
	SPAGHETTI_DEVICE_PROFILE_FAILURE_PLAN = 2, /**< Acquisition opcodes or operands. */
	SPAGHETTI_DEVICE_PROFILE_FAILURE_SCHEMA = 3, /**< Sample schema vs EMIT ops. */
	SPAGHETTI_DEVICE_PROFILE_FAILURE_BUDGET = 4, /**< Time, transactions, or bytes. */
};

/** Stable reason associated with one Device Profile validation failure. */
enum spaghetti_device_profile_failure_reason {
	SPAGHETTI_DEVICE_PROFILE_FAILURE_MALFORMED = 0, /**< CBOR shape is invalid. */
	SPAGHETTI_DEVICE_PROFILE_FAILURE_UNSUPPORTED = 1, /**< Wire version or opcode. */
	SPAGHETTI_DEVICE_PROFILE_FAILURE_RANGE = 2, /**< Bound exceeded. */
	SPAGHETTI_DEVICE_PROFILE_FAILURE_INCONSISTENT = 3, /**< Schema vs plan disagree. */
	SPAGHETTI_DEVICE_PROFILE_FAILURE_REQUIRED = 4, /**< Mandatory value absent. */
};

/** Optional caller-owned Device Profile validation diagnostic. */
struct spaghetti_device_profile_failure {
	enum spaghetti_device_profile_failure_field field; /**< Section with the error. */
	size_t index; /**< Opcode/field index, or zero when not applicable. */
	enum spaghetti_device_profile_failure_reason reason; /**< Transport-independent. */
};

/**
 * @brief Instance binding supplied by the declarative Module driver.
 *
 * Values come from Module config property fields, not from the shared profile.
 */
struct spaghetti_device_profile_binding {
	uint16_t i2c_address; /**< 7-bit I2C address when transport is I2C. */
	uint8_t spi_cs; /**< Logical SPI chip-select index. */
	uint8_t adc_channel; /**< Logical ADC channel index 0..4. */
	uint32_t spi_frequency_hz; /**< SPI clock used by SPI_TRANSCEIVE. */
	uint32_t default_timeout_ms; /**< Fallback Port lock timeout. */
	uint8_t w1_rom[SPAGHETTI_ENDPOINT_VALUE_MAX]; /**< 1-Wire ROM when transport is W1. */
};

/**
 * @brief Callback that reports whether Config still references a profile.
 *
 * @param[in] profile_id Borrowed NUL-terminated profile ID.
 * @param[in] version Profile version under consideration.
 * @param[in,out] user_data Caller context registered with the checker.
 *
 * @retval true At least one active or persisted Config references the profile.
 * @retval false The profile is unreferenced and may be removed.
 */
typedef bool (*spaghetti_device_profile_reference_checker_t)(
	const char *profile_id,
	uint16_t version,
	void *user_data);

/**
 * @brief Initialize the catalog from built-ins and persisted CBOR slots.
 *
 * Call once from thread context during Core bring-up. Re-entry after
 * @ref spaghetti_device_profile_reset_for_test rebuilds the same view.
 *
 * @retval 0 Catalog is ready.
 * @retval -ENOMEM Persisted profile exceeds slot capacity.
 * @retval -EBADMSG A persisted CBOR image is corrupt.
 * @retval -EINVAL A built-in or persisted profile fails validation.
 */
int spaghetti_device_profile_init(void);

/**
 * @brief Return the number of profiles visible in the catalog.
 *
 * @return Count of built-in plus installed profiles.
 */
size_t spaghetti_device_profile_count(void);

/**
 * @brief Borrow one catalog profile by index.
 *
 * @param[in] idx Zero-based index below @ref spaghetti_device_profile_count.
 *
 * @return Firmware-lifetime pointer, or NULL when @p idx is out of range.
 */
const struct spaghetti_device_profile *spaghetti_device_profile_get(size_t idx);

/**
 * @brief Find one catalog profile by identity and optional hash.
 *
 * @param[in] id Borrowed NUL-terminated profile_id.
 * @param[in] version Exact profile version.
 * @param[in] hash_or_null Optional SHA-256; NULL skips the digest check.
 *
 * @return Firmware-lifetime pointer, or NULL when no entry matches.
 */
const struct spaghetti_device_profile *spaghetti_device_profile_find(
	const char *id,
	uint16_t version,
	const uint8_t *hash_or_null);

/**
 * @brief Validate one decoded profile and compute its worst-case budget.
 *
 * Rejects unknown opcodes, unbounded WAIT attempts, schema incoherence, and
 * budgets that exceed the profile limits or Kconfig caps. Performs no I/O.
 *
 * @param[in] profile Borrowed decoded profile.
 * @param[out] out_budget Optional budget written only on success.
 *
 * @retval 0 Profile is executable within declared limits.
 * @retval -EINVAL Null pointer, empty id, bad field, or zero WAIT attempts.
 * @retval -ENOTSUP Opcode is outside the firmware vocabulary.
 * @retval -E2BIG Operation or field counts exceed Kconfig limits.
 * @retval -EFBIG Computed time, transactions, or bytes exceed profile maxima.
 * @retval -EPROTONOSUPPORT Sample schema fields are incoherent with EMIT ops.
 */
int spaghetti_device_profile_validate(
	const struct spaghetti_device_profile *profile,
	struct spaghetti_device_profile_budget *out_budget);

/**
 * @brief Decode CBOR and validate without installing.
 *
 * Does not mutate the catalog or persist bytes. @p failure is written only when
 * non-NULL and the profile is rejected.
 *
 * @param[in] cbor Borrowed complete CBOR image.
 * @param[in] size Exact byte count of @p cbor.
 * @param[out] failure Optional diagnostic; unchanged on success.
 *
 * @retval 0 Profile would be accepted by @ref spaghetti_device_profile_install
 *           aside from slot/hash uniqueness checks that require commit.
 * @retval -EINVAL Null pointer or zero size.
 * @retval -EMSGSIZE Image exceeds the configured byte budget.
 * @retval -EBADMSG CBOR shape is invalid or contains floats.
 * @retval -ENOTSUP Unsupported wire version or opcode.
 * @retval -E2BIG Decoded plan exceeds operation limits.
 * @retval -EFBIG Budget validation failed.
 * @retval -EPROTONOSUPPORT Sample schema fields are incoherent with EMIT ops.
 */
int spaghetti_device_profile_validate_cbor(
	const uint8_t *cbor,
	size_t size,
	struct spaghetti_device_profile_failure *failure);

/**
 * @brief Decode, validate, hash, and atomically publish one CBOR profile.
 *
 * Staging never becomes visible on truncated input, float values, unknown
 * opcodes, hash conflicts, or validation failure.
 *
 * @param[in] cbor Borrowed complete CBOR image.
 * @param[in] size Exact byte count of @p cbor; must be <= MAX_DEVICE_PROFILE_BYTES.
 *
 * @retval 0 Profile committed to a RAM slot and persisted store.
 * @retval -EINVAL Null pointer or zero size.
 * @retval -EMSGSIZE Image exceeds the configured byte budget.
 * @retval -EBADMSG CBOR shape is invalid or contains floats.
 * @retval -ENOTSUP Unsupported wire version or opcode.
 * @retval -EEXIST Same id/version exists with a different hash.
 * @retval -ENOSPC No free profile slot remains.
 * @retval -E2BIG Decoded plan exceeds operation limits.
 * @retval -EFBIG Budget validation failed.
 */
int spaghetti_device_profile_install(const uint8_t *cbor, size_t size);

/**
 * @brief Publish one already-decoded profile into a RAM catalog slot.
 *
 * Intended for tests and tooling. Does not persist CBOR bytes. Hash may be
 * supplied by the caller; an all-zero hash is accepted for fixtures.
 *
 * @param[in] profile Borrowed complete decoded profile.
 *
 * @retval 0 Profile committed to a RAM slot.
 * @retval -EINVAL Null pointer or validation failure.
 * @retval -EEXIST Same id/version exists with a different hash.
 * @retval -ENOSPC No free profile slot remains.
 */
int spaghetti_device_profile_install_decoded(
	const struct spaghetti_device_profile *profile);

/**
 * @brief Remove one installed profile when it is unreferenced.
 *
 * Built-in ROM profiles cannot be removed. Removal fails when the registered
 * reference checker reports an active or persisted Config reference.
 *
 * @param[in] id Borrowed NUL-terminated profile_id.
 * @param[in] version Exact profile version.
 *
 * @retval 0 Profile removed from catalog and persisted store.
 * @retval -EINVAL Null or empty @p id.
 * @retval -ENOENT No installed profile matches.
 * @retval -EPERM Profile is built-in.
 * @retval -EBUSY Profile is still referenced.
 */
int spaghetti_device_profile_remove(const char *id, uint16_t version);

/**
 * @brief Register the Config reference checker used by remove.
 *
 * @param[in] checker Optional callback; NULL treats every profile as free.
 * @param[in,out] user_data Passed to @p checker on each remove attempt.
 */
void spaghetti_device_profile_set_reference_checker(
	spaghetti_device_profile_reference_checker_t checker,
	void *user_data);

/**
 * @brief Execute one plan from a validated profile through Port APIs only.
 *
 * @param[in] profile Borrowed catalog or staging profile.
 * @param[in] ops Borrowed operation array.
 * @param[in] op_count Number of valid operations in @p ops.
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] binding Borrowed instance addressing and timeouts.
 * @param[in,out] out_record Optional record filled by EMIT opcodes.
 *
 * @retval 0 Plan completed.
 * @retval -EINVAL Null pointer or invalid temp/field operand.
 * @retval -ENOTSUP Opcode or transport is unavailable.
 * @retval -ETIMEDOUT WAIT_FIELD_MASK exhausted its attempts.
 * @retval -EIO Or other original Port errno.
 */
int spaghetti_device_profile_exec(
	const struct spaghetti_device_profile *profile,
	const struct spaghetti_device_profile_op *ops,
	size_t op_count,
	const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
	struct spaghetti_record_payload *out_record);

/**
 * @brief Build a temporary schema descriptor view over owned profile fields.
 *
 * @param[in] profile Borrowed profile with owned sample field strings.
 * @param[out] fields Caller-owned field table with at least sample_field_count.
 * @param[out] out_schema Caller-owned descriptor referencing @p fields.
 *
 * @retval 0 Descriptor view is ready for schema helpers.
 * @retval -EINVAL Null pointer or unsupported field type.
 * @retval -E2BIG Field count exceeds the caller table contract.
 */
int spaghetti_device_profile_make_schema(
	const struct spaghetti_device_profile *profile,
	struct spaghetti_field_descriptor *fields,
	struct spaghetti_schema_descriptor *out_schema);

#if defined(CONFIG_ZTEST) || defined(ZTEST_UNITTEST)
/**
 * @brief Test-only catalog reset that keeps the persisted CBOR store.
 *
 * Clears runtime catalog pointers and RAM decoded slots, then leaves persisted
 * CBOR images intact so a following @ref spaghetti_device_profile_init reloads
 * them as after reboot.
 */
void spaghetti_device_profile_reset_for_test(void);

/**
 * @brief Test-only wipe of persisted CBOR images.
 */
void spaghetti_device_profile_clear_persisted_for_test(void);
#endif

#endif /* SPAGHETTI_DEVICE_PROFILE_H */
