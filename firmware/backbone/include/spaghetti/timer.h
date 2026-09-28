/**
 * @file
 * @brief Public bounded periodic Timer service contract.
 * @ingroup spaghetti_timer
 */

#ifndef SPAGHETTI_TIMER_H
#define SPAGHETTI_TIMER_H

#include <stdint.h>

#include <zephyr/kernel.h>

/**
 * @brief Initialize the single Runtime timer with its wake-up semaphore.
 *
 * @param[in] tick_sem Caller-owned semaphore retained for firmware lifetime.
 *                     It must be initialized before this call and must remain
 *                     valid because the timer expiry callback signals it.
 *
 * @retval 0 Timer is initialized and stopped.
 * @retval -EINVAL @p tick_sem is NULL.
 * @retval -EALREADY Timer was initialized previously.
 *
 * @note Call once from the boot thread. No timer is armed by this function.
 */
int spaghetti_timer_init(struct k_sem *tick_sem);

/**
 * @brief Start the periodic Runtime timer.
 *
 * The first expiry occurs after one complete period. The expiry callback only
 * gives the retained semaphore and never performs Manager, bus, or Data work.
 *
 * @param[in] period_ms Positive period in milliseconds, passed by value.
 *
 * @retval 0 The periodic timer is armed.
 * @retval -EINVAL @p period_ms is zero.
 * @retval -EACCES Timer has not been initialized.
 * @retval -EALREADY Timer is already running.
 *
 * @note Call from thread context.
 */
int spaghetti_timer_start(uint32_t period_ms);

/**
 * @brief Stop future periodic wake-ups.
 *
 * This operation is idempotent after initialization. A semaphore signal that
 * already exists remains owned by Runtime and is handled by its stop protocol.
 *
 * @retval 0 Timer is stopped.
 * @retval -EACCES Timer has not been initialized.
 *
 * @note Call from thread context. This function performs no blocking I/O.
 */
int spaghetti_timer_stop(void);

#endif /* SPAGHETTI_TIMER_H */
