/**
 * @file
 * @brief Compile-time resource-profile consistency helpers.
 * @ingroup spaghetti_core
 */

#ifndef SPAGHETTI_RESOURCE_CONTRACT_H
#define SPAGHETTI_RESOURCE_CONTRACT_H

#define SPAGHETTI_RESOURCE_POWER_RAIL_MASK_VALID(rail_count) \
	((rail_count) <= 32U)

#define SPAGHETTI_RESOURCE_SECURE_WORKSPACE_VALID( \
	secure_session_count, workspace_size) \
	((workspace_size) >= ((secure_session_count) * 16384U))

#define SPAGHETTI_RESOURCE_CONSUMERS_VALID( \
	consumer_count, required_consumer_count) \
	((consumer_count) >= (required_consumer_count))

#endif /* SPAGHETTI_RESOURCE_CONTRACT_H */
