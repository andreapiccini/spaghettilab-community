/**
 * @file
 * @brief Public Flow and Function Bay topology API.
 * @ingroup spaghetti_topology
 */

#ifndef SPAGHETTI_TOPOLOGY_H
#define SPAGHETTI_TOPOLOGY_H

#include <stddef.h>
#include <stdint.h>

#include <spaghetti/port.h>

/** Fixed connector width for every Spaghetti LAB Flow. */
#define SPAGHETTI_FLOW_SIGNAL_COUNT 5U

/** Sentinel bay ID when Config cannot name a physical position. */
#define SPAGHETTI_BAY_ID_UNSPECIFIED UINT8_MAX

/** Stable Flow identifier copied by value. */
typedef uint8_t spaghetti_flow_id_t;

/** Stable Function Bay identifier copied by value. */
typedef uint8_t spaghetti_bay_id_t;

/**
 * @brief Orientation of a Flow relative to the field connector.
 */
enum spaghetti_flow_direction {
	SPAGHETTI_FLOW_FIELD_TO_CORE = 0, /**< Signals enter toward the Core. */
	SPAGHETTI_FLOW_CORE_TO_FIELD = 1, /**< Signals leave toward the field. */
	SPAGHETTI_FLOW_BIDIRECTIONAL = 2, /**< Path supports both directions. */
};

/**
 * @brief Immutable Flow descriptor owned by the topology subsystem.
 */
struct spaghetti_flow_descriptor {
	spaghetti_flow_id_t id; /**< Board-stable Flow identifier. */
	spaghetti_port_id_t port_id; /**< Terminating Port identifier. */
	enum spaghetti_flow_direction direction; /**< Path orientation. */
	uint8_t signal_count; /**< Always SPAGHETTI_FLOW_SIGNAL_COUNT. */
	uint8_t function_bay_count; /**< Ordered Bay count from the field. */
};

/**
 * @brief Caller-owned Function Bay descriptor filled by bay_get().
 */
struct spaghetti_bay_descriptor {
	spaghetti_flow_id_t flow_id; /**< Owning Flow identifier. */
	spaghetti_bay_id_t id; /**< Bay identifier within the Flow. */
	uint8_t ordinal_from_field; /**< Zero nearest the field connector. */
};

/**
 * @brief Validate Devicetree Flow catalog against Ports and resource limits.
 *
 * @retval 0 Catalog accepted.
 * @retval -EALREADY Topology was already initialized.
 * @retval -EINVAL Duplicate IDs, bad signal count, or invalid association.
 * @retval -ENOENT A Flow references a missing Port.
 * @retval -E2BIG Catalog exceeds the selected resource profile.
 */
int spaghetti_topology_init(void);

/**
 * @brief Return the number of Flows exposed by the selected Core board.
 *
 * @return Flow count from the validated catalog.
 */
size_t spaghetti_topology_flow_count(void);

/**
 * @brief Borrow the Flow descriptor for a Flow ID.
 *
 * @param[in] id Flow identifier.
 *
 * @return Firmware-lifetime const descriptor, or NULL when unknown.
 */
const struct spaghetti_flow_descriptor *spaghetti_topology_flow_get(
	spaghetti_flow_id_t id);

/**
 * @brief Borrow the Flow that terminates on the given Port.
 *
 * @param[in] port_id Port identifier.
 *
 * @return Firmware-lifetime const descriptor, or NULL when none.
 */
const struct spaghetti_flow_descriptor *spaghetti_topology_flow_for_port(
	spaghetti_port_id_t port_id);

/**
 * @brief Copy a Function Bay descriptor for a Flow position.
 *
 * @param[in] flow_id Owning Flow identifier.
 * @param[in] bay_id Bay identifier within that Flow.
 * @param[out] out Caller-owned storage written only on success.
 *
 * @retval 0 Descriptor copied.
 * @retval -EINVAL @p out is NULL or @p bay_id is unspecified.
 * @retval -ENOENT Flow or Bay does not exist.
 */
int spaghetti_topology_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_descriptor *out);

#endif /* SPAGHETTI_TOPOLOGY_H */
