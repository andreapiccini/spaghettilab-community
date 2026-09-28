/**
 * @file
 * @brief Multi-provider Module discovery contract for Spaghetti firmware.
 * @ingroup spaghetti_discovery
 *
 * Providers propose ephemeral candidates. Accept copies a
 * @ref spaghetti_module_config ready for Config; Discovery never applies
 * Config or creates Manager instances. Manual Modules enter Config directly
 * and do not require a candidate.
 */

#ifndef SPAGHETTI_DISCOVERY_H
#define SPAGHETTI_DISCOVERY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/iterable_sections.h>
#include <zephyr/sys/util.h>

#include <spaghetti/config.h>
#include <spaghetti/module.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/schema.h>
#include <spaghetti/topology.h>

/** Maximum bytes in a NUL-terminated provider ID, including the terminator. */
#define SPAGHETTI_DISCOVERY_PROVIDER_ID_SIZE 24U

/** Maximum stable hardware identity bytes retained per candidate. */
#define SPAGHETTI_DISCOVERY_IDENTITY_MAX 16U

/** ABI version carried by every linked discovery provider descriptor. */
#define SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION 1U

/** Ephemeral candidate identifier valid only until the next table mutation. */
typedef uint32_t spaghetti_discovery_candidate_id_t;

/** Hardware or software method that produced one candidate. */
enum spaghetti_discovery_method {
	SPAGHETTI_DISCOVERY_METHOD_EEPROM, /**< Removable identity EEPROM/record. */
	SPAGHETTI_DISCOVERY_METHOD_I2C_REGISTER, /**< Known I2C register fingerprint. */
	SPAGHETTI_DISCOVERY_METHOD_ANALOG, /**< ADC window / resistor ID heuristic. */
	SPAGHETTI_DISCOVERY_METHOD_W1_ROM, /**< 1-Wire ROM search. */
	SPAGHETTI_DISCOVERY_METHOD_CUSTOM, /**< Board-specific proprietary probe. */
};

/** How confidently the provider identified type and configuration. */
enum spaghetti_discovery_confidence {
	SPAGHETTI_DISCOVERY_HEURISTIC, /**< User must explicitly accept. */
	SPAGHETTI_DISCOVERY_AUTHORITATIVE, /**< Complete identity when type/config known. */
};

/** Probe invasiveness bits declared by a provider and copied onto candidates. */
enum spaghetti_discovery_probe_flags {
	SPAGHETTI_DISCOVERY_PROBE_READ_ONLY = BIT(0), /**< Observes without changing state. */
	SPAGHETTI_DISCOVERY_PROBE_MAY_CHANGE_STATE = BIT(1), /**< May alter device or bus state. */
};

/**
 * @brief One owned Discovery candidate retained in the bounded table.
 *
 * Candidate @ref id values are ephemeral. @ref identity holds stable hardware
 * bytes when available. Suggested fields may be empty for an unidentified device.
 * Bay and rail are @c UNSPECIFIED when the method cannot observe them.
 */
struct spaghetti_discovery_candidate {
	spaghetti_discovery_candidate_id_t id; /**< Ephemeral table identity. */
	spaghetti_port_id_t port_id; /**< Port that was scanned. */
	spaghetti_flow_id_t flow_id; /**< Flow derived from @ref port_id. */
	spaghetti_bay_id_t bay_id; /**< Observed Bay, or UNSPECIFIED. */
	spaghetti_power_rail_id_t power_rail_id; /**< Observed rail, or UNSPECIFIED. */
	char provider_id[SPAGHETTI_DISCOVERY_PROVIDER_ID_SIZE]; /**< Owning provider. */
	enum spaghetti_discovery_method method; /**< Identification method. */
	enum spaghetti_discovery_confidence confidence; /**< Heuristic vs authoritative. */
	uint32_t probe_flags; /**< @ref spaghetti_discovery_probe_flags bits. */
	uint8_t identity_size; /**< Valid leading bytes in @ref identity. */
	uint8_t identity[SPAGHETTI_DISCOVERY_IDENTITY_MAX]; /**< Stable hardware identity. */
	char suggested_type_id[SPAGHETTI_TYPE_ID_MAX]; /**< Optional suggested driver type. */
	struct spaghetti_property_set suggested_properties; /**< Optional suggested config. */
	uint32_t generation; /**< Nonzero CAS generation for this table slot. */
};

/**
 * @brief Callback used by a provider to emit one candidate during a scan.
 *
 * @param[in] candidate Provider-owned candidate borrowed only during this call.
 * @param[in,out] user_data Scan-lifetime context supplied by Discovery.
 *
 * @retval 0 Discovery accepted and copied the candidate.
 * @retval -errno Validation or capacity failure; the provider should stop.
 */
typedef int (*spaghetti_discovery_emit_candidate_cb_t)(
	const struct spaghetti_discovery_candidate *candidate,
	void *user_data);

/**
 * @brief Callback that scans one Port and emits zero or more candidates.
 *
 * @param[in] port Borrowed firmware-lifetime Port.
 * @param[in] emit Callback borrowed for the duration of this call.
 * @param[in,out] emit_user_data Opaque scan context passed back to @p emit.
 * @param[in] timeout Maximum time available for this provider scan.
 *
 * @retval 0 The scan completed, including when it found nothing.
 * @retval -errno Provider or emit failure.
 */
typedef int (*spaghetti_discovery_provider_scan_cb_t)(
	const struct spaghetti_port *port,
	spaghetti_discovery_emit_candidate_cb_t emit,
	void *emit_user_data,
	k_timeout_t timeout);

/** Operations implemented by one auto-registered Discovery provider. */
struct spaghetti_discovery_provider_ops {
	spaghetti_discovery_provider_scan_cb_t scan; /**< Bounded synchronous provider scan. */
};

/**
 * @brief Immutable provider descriptor collected into a linker section.
 *
 * String literals and @ref ops have firmware lifetime.
 */
struct spaghetti_discovery_provider {
	const char *provider_id; /**< Stable unique provider ID. */
	uint16_t api_version; /**< Must equal SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION. */
	enum spaghetti_discovery_method method; /**< Declared method. */
	enum spaghetti_discovery_confidence confidence; /**< Declared confidence. */
	uint32_t probe_flags; /**< Declared probe invasiveness. */
	uint32_t required_capabilities; /**< Port capability bits that must all be present. */
	const struct spaghetti_discovery_provider_ops *ops; /**< Non-NULL scan ops. */
};

/** Iterable-section helper used by @ref SPAGHETTI_DISCOVERY_PROVIDER_DEFINE. */
#define SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(name) \
	const STRUCT_SECTION_ITERABLE(spaghetti_discovery_provider, name)

/**
 * @brief Caller-owned scan policy borrowed only for one @ref spaghetti_discovery_scan_port.
 */
struct spaghetti_discovery_scan_policy {
	bool allow_read_only; /**< Run providers with only READ_ONLY set. */
	bool allow_state_changing; /**< Run providers that may change state. */
	k_timeout_t timeout_per_provider; /**< Bound passed by value to each provider. */
};

/**
 * @brief Initialize empty bounded Discovery candidate state.
 *
 * @retval 0 Discovery was initialized with an empty candidate table.
 * @retval -EALREADY Discovery was initialized previously.
 *
 * @note Call once from boot thread context before other Discovery functions.
 *       Manual Modules do not use Discovery; they enter Config directly.
 */
int spaghetti_discovery_init(void);

/**
 * @brief Scan one Port with every capability- and policy-matching provider.
 *
 * Existing candidates for @p port_id are cleared first. Matching providers run
 * synchronously. Emitted candidates are validated and copied into the bounded
 * table. Duplicate keys are Port + provider ID + identity. With zero matching
 * providers the call succeeds and leaves an empty candidate set for that Port.
 *
 * @param[in] port_id Physical Port selected for discovery.
 * @param[in] policy Caller-owned policy borrowed only for this call.
 *
 * @retval 0 The scan completed (possibly with zero candidates).
 * @retval -EINVAL @p policy is NULL or inconsistent.
 * @retval -EACCES Discovery has not been initialized.
 * @retval -ENOENT The selected Port does not exist.
 * @retval -ENOSPC The candidate table cannot accept another unique identity.
 * @retval -ETIMEDOUT A provider exceeded its timeout.
 * @retval -errno A provider or emit validation failure.
 *
 * @note Call from thread context. Providers may sleep within the timeout.
 *
 * Communication does not yet publish a scan-complete event. Hosts should call
 * @ref spaghetti_discovery_list after a successful scan. A future Communication
 * hook may notify listeners when scan finishes.
 */
int spaghetti_discovery_scan_port(
	spaghetti_port_id_t port_id,
	const struct spaghetti_discovery_scan_policy *policy);

/**
 * @brief Copy or count retained Discovery candidates.
 *
 * @param[out] out Optional caller-owned array written only on success.
 * @param[in] capacity Maximum entries @p out can hold; ignored when @p out is NULL.
 * @param[out] out_count Required or written candidate count.
 *
 * @retval 0 Candidates were copied, or a count-only query succeeded.
 * @retval -EINVAL @p out_count is NULL, or @p out is NULL with nonzero capacity.
 * @retval -EACCES Discovery has not been initialized.
 * @retval -ENOSPC @p capacity is too small; @p out_count holds the requirement.
 *
 * @note @c list(NULL, 0, &count) performs a count-only query.
 */
int spaghetti_discovery_list(
	struct spaghetti_discovery_candidate *out,
	size_t capacity,
	size_t *out_count);

/**
 * @brief Build a Config Module description from one accepted candidate.
 *
 * Requires an AUTHORITATIVE candidate with a complete suggested type and
 * properties, or any HEURISTIC candidate explicitly chosen by the caller.
 * Copies a module config ready to insert into a new Config snapshot, including
 * Bay/rail only when known. Does not apply Config or create a live Module.
 * On success the candidate is removed from the table.
 *
 * @param[in] candidate_id Ephemeral candidate identity from a prior list/scan.
 * @param[in] key Nonzero Module key to assign in the produced config.
 * @param[in] expected_generation Generation that must match the candidate.
 * @param[out] out_module Caller-owned Module config written only on success.
 *
 * @retval 0 @p out_module was filled and the candidate was removed.
 * @retval -EINVAL A pointer, key, or incomplete authoritative candidate is invalid.
 * @retval -EACCES Discovery has not been initialized.
 * @retval -ENOENT No candidate has @p candidate_id.
 * @retval -ESTALE @p expected_generation does not match.
 *
 * @note Call from thread context. No hardware I/O is performed.
 */
int spaghetti_discovery_accept(
	spaghetti_discovery_candidate_id_t candidate_id,
	spaghetti_module_key_t key,
	uint32_t expected_generation,
	struct spaghetti_module_config *out_module);

/**
 * @brief Remove one candidate without producing a Module config.
 *
 * @param[in] candidate_id Ephemeral candidate identity from a prior list/scan.
 * @param[in] expected_generation Generation that must match the candidate.
 *
 * @retval 0 The candidate was removed.
 * @retval -EINVAL @p expected_generation is zero.
 * @retval -EACCES Discovery has not been initialized.
 * @retval -ENOENT No candidate has @p candidate_id.
 * @retval -ESTALE @p expected_generation does not match.
 *
 * @note Call from thread context.
 */
int spaghetti_discovery_reject(
	spaghetti_discovery_candidate_id_t candidate_id,
	uint32_t expected_generation);

/**
 * @brief Decode a Spaghetti identity record into candidate suggested fields.
 *
 * Input bytes are borrowed. @p out is modified only after magic, version,
 * length, CRC, and property-set validation succeed. Fills identity,
 * suggested_type_id, suggested_properties, and bay/rail when present. Does not
 * assign ephemeral id, provider metadata, port, flow, or generation.
 *
 * @param[in] bytes Borrowed identity-record bytes.
 * @param[in] bytes_size Exact length of @p bytes.
 * @param[out] out Caller-owned candidate fields written only on success.
 *
 * @retval 0 Suggested fields were filled.
 * @retval -EINVAL A pointer is NULL.
 * @retval -EMSGSIZE @p bytes_size is too small for the declared record.
 * @retval -EBADMSG Magic, length, CRC, or body shape is corrupt.
 * @retval -ENOTSUP The format version is unsupported.
 * @retval -ERANGE A property value cannot be represented in the property set.
 *
 * @see subsys/discovery/providers/README.md for the on-wire layout.
 */
int spaghetti_identity_record_decode(
	const uint8_t *bytes,
	size_t bytes_size,
	struct spaghetti_discovery_candidate *out);

#endif /* SPAGHETTI_DISCOVERY_H */
