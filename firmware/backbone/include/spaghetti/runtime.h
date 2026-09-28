/**
 * @file
 * @brief Public Runtime multi-schedule, event, and rule contract.
 * @ingroup spaghetti_runtime
 */

#ifndef SPAGHETTI_RUNTIME_H
#define SPAGHETTI_RUNTIME_H

#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

#include <spaghetti/config.h>

/**
 * @brief Initialize the stopped Runtime worker.
 *
 * @retval 0 Runtime is initialized, stopped, and has no loaded work.
 * @retval -EALREADY Runtime was initialized previously.
 *
 * @note Call once from the Core boot thread after Data initialization.
 */
int spaghetti_runtime_init(void);

/**
 * @brief Validate, copy schedules, and (re)create rule instances while stopped.
 *
 * Input pointers are borrowed only for this call. Runtime copies every accepted
 * schedule and rule property set before returning. When rule init fails,
 * Runtime deinitializes partially created rules in reverse order and keeps the
 * previous configuration unchanged.
 *
 * @param[in] schedules Caller-owned schedule array, or NULL when @p schedule_count
 *                      is zero.
 * @param[in] schedule_count Number of elements at @p schedules.
 * @param[in] rules Caller-owned rule array, or NULL when @p rule_count is zero.
 * @param[in] rule_count Number of elements at @p rules.
 *
 * @retval 0 The configuration was copied and rules were initialized.
 * @retval -EINVAL A pointer/count pair is inconsistent or a schedule is invalid.
 * @retval -EACCES Runtime has not been initialized.
 * @retval -EBUSY Runtime is running or stopping.
 * @retval -ENOTSUP A rule type is unknown or incomplete.
 * @retval -errno Propagated from rule validate/init.
 *
 * @note Call from thread context. This function performs no Module bus I/O.
 */
int spaghetti_runtime_configure(
	const struct spaghetti_runtime_schedule_config *schedules,
	size_t schedule_count,
	const struct spaghetti_rule_config *rules,
	size_t rule_count);

/**
 * @brief Resolve schedule keys, arm events, and start the worker.
 *
 * @retval 0 The Runtime worker is active.
 * @retval -EACCES Runtime has not been initialized.
 * @retval -ENOENT No schedule or rule is configured.
 * @retval -EALREADY Runtime is already running.
 * @retval -EBUSY Runtime is still stopping.
 * @retval -ENOENT A schedule source key is not live and READY.
 *
 * @note Call from thread context.
 */
int spaghetti_runtime_start(void);

/**
 * @brief Stop events, drain the event queue, and wait for the worker.
 *
 * @param[in] timeout Maximum wait for in-flight Manager and publish work.
 *                    `K_NO_WAIT`, finite timeouts, and `K_FOREVER` are accepted.
 *
 * @retval 0 Runtime reached the stopped state.
 * @retval -EACCES Runtime has not been initialized.
 * @retval -EALREADY Runtime is already stopped.
 * @retval -EBUSY Another caller is already stopping Runtime.
 * @retval -ETIMEDOUT The worker did not quiesce within @p timeout.
 *
 * @note Call from thread context, never from the Runtime worker itself.
 */
int spaghetti_runtime_stop(k_timeout_t timeout);

#endif /* SPAGHETTI_RUNTIME_H */
