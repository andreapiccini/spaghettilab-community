/**
 * @file
 * @brief Shared power-resource ownership and rail admission contract.
 * @ingroup spaghetti_power
 */

#ifndef SPAGHETTI_POWER_H
#define SPAGHETTI_POWER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/topology.h>

/** Identifier of one board-declared shared power resource. */
typedef uint8_t spaghetti_power_resource_id_t;

/** Identifier of one live owner, normally derived from a Module runtime ID. */
typedef uint8_t spaghetti_power_owner_id_t;

/** Identifier of one board-declared power rail. */
typedef uint8_t spaghetti_power_rail_id_t;

/** Owner value that can never identify a configured Module. */
#define SPAGHETTI_POWER_OWNER_INVALID UINT8_MAX

/** Rail sentinel when Config cannot name a physical selection. */
#define SPAGHETTI_POWER_RAIL_UNSPECIFIED UINT8_MAX

/** Observable lifecycle of one shared power resource. */
enum spaghetti_power_state {
	SPAGHETTI_POWER_OFF, /**< No owners exist and the resource is disabled. */
	SPAGHETTI_POWER_STARTING, /**< The first owner is enabling the resource. */
	SPAGHETTI_POWER_ON, /**< One or more distinct owners hold the resource. */
	SPAGHETTI_POWER_STOPPING, /**< The final owner is disabling the resource. */
	SPAGHETTI_POWER_ERROR, /**< A hardware transition failed. */
};

/** How firmly firmware can select and verify one rail. */
enum spaghetti_power_assurance {
	SPAGHETTI_POWER_UNMANAGED, /**< Passive/jumper selection; firmware cannot verify. */
	SPAGHETTI_POWER_SWITCHED, /**< Firmware can enable/disable the rail. */
	SPAGHETTI_POWER_SWITCHED_AND_MEASURED, /**< Switched rail with measurement. */
};

/** Admission outcome for one Module power binding. */
enum spaghetti_power_admission_state {
	SPAGHETTI_POWER_ADMISSION_NOT_REQUIRED, /**< No power binding was needed. */
	SPAGHETTI_POWER_ADMISSION_UNVERIFIED, /**< Accepted without firmware proof. */
	SPAGHETTI_POWER_ADMISSION_ENFORCED, /**< Limits were checked before enable. */
};

/** Caller-owned coherent snapshot of one power resource. */
struct spaghetti_power_status {
	enum spaghetti_power_state state; /**< State observed while holding the lock. */
	uint16_t reference_count; /**< Number of distinct successful owners. */
	int last_error; /**< Last transition error, or zero after success. */
};

/** Immutable rail descriptor owned by the Power subsystem. */
struct spaghetti_power_rail_descriptor {
	spaghetti_power_rail_id_t id; /**< Board-stable rail identifier. */
	enum spaghetti_power_assurance assurance; /**< Selection/verify strength. */
	uint32_t min_microvolts; /**< Minimum voltage; zero means unknown. */
	uint32_t max_microvolts; /**< Maximum voltage; zero means unknown. */
	uint32_t max_total_microamps; /**< Aggregate current limit; zero unknown. */
};

/** Borrowed Module driver power needs for one attach/validate call. */
struct spaghetti_module_power_requirement {
	bool declared; /**< False yields UNVERIFIED instead of an error. */
	uint32_t min_microvolts; /**< Module minimum voltage. */
	uint32_t max_microvolts; /**< Module maximum voltage. */
	uint32_t max_microamps; /**< Module maximum current draw. */
};

/** Config-selected physical power placement for one Module. */
struct spaghetti_power_binding {
	spaghetti_flow_id_t flow_id; /**< Flow that owns the Bay. */
	spaghetti_bay_id_t bay_id; /**< Bay ordinal from the field. */
	spaghetti_power_rail_id_t rail_id; /**< Selected rail at that Bay. */
};

/** Caller-owned Bay reachability snapshot. */
struct spaghetti_bay_power_descriptor {
	spaghetti_flow_id_t flow_id; /**< Owning Flow identifier. */
	spaghetti_bay_id_t bay_id; /**< Bay ordinal from the field. */
	uint32_t available_rail_mask; /**< Bits for rail_id values below 32. */
};

/**
 * @brief Initialize every compiled shared power resource in its safe OFF state.
 *
 * @retval 0 Every resource reached its safe initial state.
 * @retval -EALREADY Power was initialized previously.
 * @retval Negative errno from the selected backend.
 */
int spaghetti_power_init(void);

/**
 * @brief Add one distinct owner and enable on the first acquisition.
 *
 * @param[in] id Board-declared shared power resource.
 * @param[in] owner Distinct live owner; must not be INVALID.
 *
 * @retval 0 Owner recorded; enable ran on the first acquisition.
 * @retval -EINVAL Invalid @p id or @p owner.
 * @retval -ENOENT Resource is not declared.
 * @retval -EALREADY @p owner already holds the resource.
 * @retval -ENOMEM Owner table is full.
 * @retval -EALREADY Power was not initialized.
 * @retval Negative errno from the selected backend.
 */
int spaghetti_power_acquire(spaghetti_power_resource_id_t id,
			    spaghetti_power_owner_id_t owner);

/**
 * @brief Remove one owner and disable only after the final release.
 *
 * @param[in] id Board-declared shared power resource.
 * @param[in] owner Distinct live owner previously acquired.
 *
 * @retval 0 Owner removed; disable ran after the final release.
 * @retval -EINVAL Invalid @p id or @p owner.
 * @retval -ENOENT Resource is not declared or @p owner is absent.
 * @retval -EALREADY Power was not initialized.
 * @retval Negative errno from the selected backend.
 */
int spaghetti_power_release(spaghetti_power_resource_id_t id,
			    spaghetti_power_owner_id_t owner);

/**
 * @brief Copy the state of one shared resource.
 *
 * @param[in] id Board-declared shared power resource.
 * @param[out] out Caller-owned snapshot written only on success.
 *
 * @retval 0 Status copied.
 * @retval -EINVAL @p out is NULL or @p id is invalid.
 * @retval -ENOENT Resource is not declared.
 * @retval -EALREADY Power was not initialized.
 */
int spaghetti_power_get_status(spaghetti_power_resource_id_t id,
			       struct spaghetti_power_status *out);

/**
 * @brief Return the number of board-declared power rails.
 *
 * @return Rail count from the compiled catalog; zero when none.
 */
size_t spaghetti_power_rail_count(void);

/**
 * @brief Borrow one immutable rail descriptor.
 *
 * @param[in] id Board-stable rail identifier.
 *
 * @return Firmware-lifetime descriptor, or NULL when unknown.
 */
const struct spaghetti_power_rail_descriptor *spaghetti_power_rail_get(
	spaghetti_power_rail_id_t id);

/**
 * @brief Copy Bay power reachability for one Flow position.
 *
 * @param[in] flow_id Owning Flow identifier.
 * @param[in] bay_id Bay identifier within that Flow.
 * @param[out] out Caller-owned storage written only on success.
 *
 * @retval 0 Descriptor copied.
 * @retval -EINVAL @p out is NULL or @p bay_id is unspecified.
 * @retval -ENOENT Board does not declare that Bay power link.
 */
int spaghetti_power_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_power_descriptor *out);

/**
 * @brief Validate a Module power binding without enabling hardware.
 *
 * @param[in] binding Selected Flow/Bay/rail placement.
 * @param[in] requirement Borrowed Module needs; may be NULL when undeclared.
 * @param[out] out_state Caller-owned admission outcome written only on success.
 *
 * @retval 0 Binding is acceptable for the current assurance level.
 * @retval -EINVAL Invalid pointer or unspecified rail/bay.
 * @retval -ENOENT Flow, Bay, rail, or mask bit is absent.
 * @retval -ERANGE Declared voltage is incompatible with known rail limits.
 * @retval -ENOSPC Declared current would exceed the known rail budget.
 */
int spaghetti_power_validate_binding(
	const struct spaghetti_power_binding *binding,
	const struct spaghetti_module_power_requirement *requirement,
	enum spaghetti_power_admission_state *out_state);

/**
 * @brief Admit one owner onto a rail after validating the binding.
 *
 * Enables switched backends on the first owner and rolls back on failure.
 *
 * @param[in] binding Selected Flow/Bay/rail placement.
 * @param[in] owner Distinct live owner.
 * @param[in] requirement Borrowed Module needs; may be NULL when undeclared.
 * @param[out] out_state Optional admission outcome written only on success.
 *
 * @retval 0 Owner admitted; switched backends enabled when required.
 * @retval -EINVAL Invalid pointer, owner, or unspecified rail/bay.
 * @retval -ENOENT Flow, Bay, rail, or mask bit is absent.
 * @retval -EALREADY Owner already holds the rail or Power is uninitialized.
 * @retval -ENOMEM Owner table is full.
 * @retval -ERANGE Declared voltage is incompatible with known rail limits.
 * @retval -ENOSPC Declared current would exceed the known rail budget.
 * @retval -ENOTSUP Assurance or backend cannot perform the request.
 * @retval Negative errno from the selected backend.
 */
int spaghetti_power_attach(
	const struct spaghetti_power_binding *binding,
	spaghetti_power_owner_id_t owner,
	const struct spaghetti_module_power_requirement *requirement,
	enum spaghetti_power_admission_state *out_state);

/**
 * @brief Remove one admitted owner and return switched rails to safe state.
 *
 * @param[in] binding Selected Flow/Bay/rail placement previously attached.
 * @param[in] owner Distinct live owner previously admitted.
 *
 * @retval 0 Owner removed; switched backends disabled after the final release.
 * @retval -EINVAL Invalid pointer or owner.
 * @retval -ENOENT Binding rail is absent or @p owner is not admitted.
 * @retval -EALREADY Power was not initialized.
 * @retval Negative errno from the selected backend.
 */
int spaghetti_power_detach(
	const struct spaghetti_power_binding *binding,
	spaghetti_power_owner_id_t owner);

#endif /* SPAGHETTI_POWER_H */
