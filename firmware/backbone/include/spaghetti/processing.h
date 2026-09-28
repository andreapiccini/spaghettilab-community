/**
 * @file
 * @brief Public processing-graph compile and execute contract.
 * @ingroup spaghetti_processing
 */

#ifndef SPAGHETTI_PROCESSING_H
#define SPAGHETTI_PROCESSING_H

#include <stddef.h>
#include <stdint.h>

#include <spaghetti/block_driver.h>
#include <spaghetti/config.h>
#include <spaghetti/schema.h>

/** Maximum fan-out edges from one (source, port) endpoint. */
#define SPAGHETTI_PROCESSING_FANOUT_MAX 4U

/** Maximum abstract cost units spent evaluating one trigger record. */
#define SPAGHETTI_PROCESSING_COST_BUDGET \
	CONFIG_SPAGHETTI_PROCESSING_COST_BUDGET

/** Maximum topological depth accepted in one compiled plan. */
#define SPAGHETTI_PROCESSING_DEPTH_MAX \
	CONFIG_SPAGHETTI_PROCESSING_DEPTH_MAX

/**
 * @brief Caller-owned snapshot of processing diagnostics.
 */
struct spaghetti_processing_stats {
	uint32_t evaluations; /**< Trigger records delivered to a live plan. */
	uint32_t block_errors; /**< Block process() failures that aborted a run. */
	uint32_t publishes; /**< Derived records accepted by the publish callback. */
	uint32_t skipped; /**< Blocks skipped for missing required inputs. */
};

/**
 * @brief Callback used when a block emits a derived record.
 *
 * @param[in] record Borrowed derived record.
 * @param[in,out] user_data Opaque Runtime context.
 *
 * @retval 0 The derived record was accepted.
 * @retval -errno The derived record was rejected.
 */
typedef int (*spaghetti_processing_publish_cb_t)(
	const struct spaghetti_record *record,
	void *user_data);

/**
 * @brief Initialize the empty processing engine.
 *
 * @retval 0 Processing accepts configure/on_record calls.
 * @retval -EALREADY Processing was initialized previously.
 *
 * @note Call once from the Core boot thread after Block Registry init.
 */
int spaghetti_processing_init(void);

/**
 * @brief Validate, compile, and atomically replace the live execution plan.
 *
 * On success the previous plan and contexts are released. On failure the
 * previous plan remains active unchanged (transactional rollback).
 *
 * Passing @p block_count and @p edge_count of zero clears the live plan.
 *
 * @param[in] blocks Caller-owned block array, or NULL when count is zero.
 * @param[in] block_count Number of elements at @p blocks.
 * @param[in] edges Caller-owned edge array, or NULL when count is zero.
 * @param[in] edge_count Number of elements at @p edges.
 *
 * @retval 0 The plan was replaced (or cleared).
 * @retval -EINVAL Pointer/count inconsistency or invalid graph field.
 * @retval -EACCES Processing has not been initialized.
 * @retval -ENOTSUP A block type is unknown or version-incompatible.
 * @retval -ELOOP The graph contains a cycle.
 * @retval -ENOSPC Fan-out, depth, context, or RAM budget exceeded.
 * @retval -ENOMEM State arena cannot hold active contexts.
 * @retval -errno Propagated from block validate/init.
 *
 * @note Call from thread context. Performs no Module hardware I/O.
 */
int spaghetti_processing_configure(
	const struct spaghetti_block_config *blocks,
	size_t block_count,
	const struct spaghetti_edge_config *edges,
	size_t edge_count);

/**
 * @brief Deliver one published source record to the live execution plan.
 *
 * Runs the topo-ordered plan for pipelines reachable from @p record. Block
 * errors increment stats and abort only that evaluation.
 *
 * @param[in] record Caller-owned record borrowed for this call.
 * @param[in] publish Optional callback for derived records (e.g. publish_field).
 * @param[in,out] publish_user_data Opaque context for @p publish.
 *
 * @retval 0 Evaluation finished (including partial skip/abort).
 * @retval -EINVAL @p record is NULL.
 * @retval -EACCES Processing has not been initialized.
 *
 * @note Call from thread context after the source record is published.
 */
int spaghetti_processing_on_record(
	const struct spaghetti_record *record,
	spaghetti_processing_publish_cb_t publish,
	void *publish_user_data);

/**
 * @brief Reset temporal state of every active block instance.
 *
 * @note Equivalent to re-init of stateful filters without changing the plan.
 */
void spaghetti_processing_reset(void);

/**
 * @brief Copy current processing diagnostics.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 Counters were copied.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES Processing has not been initialized.
 */
int spaghetti_processing_get_stats(struct spaghetti_processing_stats *out);

/**
 * @brief Validate a processing graph without installing it.
 *
 * Used by Config validation. Does not mutate live plan state.
 *
 * @param[in] blocks Block array or NULL when count is zero.
 * @param[in] block_count Number of blocks.
 * @param[in] edges Edge array or NULL when count is zero.
 * @param[in] edge_count Number of edges.
 * @param[in] modules Optional module array for source-key existence checks.
 * @param[in] module_count Number of @p modules entries.
 *
 * @retval 0 The graph is valid against the compiled Block Registry.
 * @retval -EINVAL Pointer/count inconsistency or invalid field.
 * @retval -EEXIST Duplicate block key or target input.
 * @retval -ENOENT Missing module/block endpoint.
 * @retval -ENOTSUP Unknown or version-incompatible block type.
 * @retval -ELOOP The graph contains a cycle.
 * @retval -ENOSPC Fan-out, depth, context, or cost budget exceeded.
 * @retval -ENOMEM State arena cannot hold active contexts.
 * @retval -errno Propagated from block validate/init.
 */
int spaghetti_processing_validate_graph(
	const struct spaghetti_block_config *blocks,
	size_t block_count,
	const struct spaghetti_edge_config *edges,
	size_t edge_count,
	const struct spaghetti_module_config *modules,
	size_t module_count);

#endif /* SPAGHETTI_PROCESSING_H */
