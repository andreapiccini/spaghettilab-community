/**
 * @file
 * @brief Health supervisor and bounded component heartbeat contract.
 * @ingroup spaghetti_health
 */

#ifndef SPAGHETTI_HEALTH_H
#define SPAGHETTI_HEALTH_H

#include <stdbool.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/iterable_sections.h>
#include <zephyr/sys/util.h>

/** Stable component identifier passed by value. */
typedef uint16_t spaghetti_health_component_id_t;

/** Opaque non-zero token for one temporary silence window. */
typedef uint32_t spaghetti_health_window_token_t;

/** Aggregate health observed by the supervisor. */
enum spaghetti_health_state {
	SPAGHETTI_HEALTH_STARTING, /**< Initialized but not started. */
	SPAGHETTI_HEALTH_HEALTHY, /**< Required components are timely; HW WDT armed. */
	SPAGHETTI_HEALTH_DEGRADED, /**< Components timely without hardware WDT. */
	SPAGHETTI_HEALTH_STALE, /**< A required component exceeded its deadline. */
};

/** Immutable descriptor owned by one monitored component. */
struct spaghetti_health_component_descriptor {
	spaghetti_health_component_id_t id; /**< Unique non-zero component ID. */
	const char *name; /**< Stable diagnostic name; never NULL. */
	uint32_t maximum_silence_ms; /**< Heartbeat deadline without a window. */
	uint32_t required_core_modes; /**< BIT(enum spaghetti_core_mode) mask. */
};

/** Caller-owned coherent health snapshot. */
struct spaghetti_health_status {
	enum spaghetti_health_state state; /**< Current aggregate state. */
	bool hardware_watchdog_available; /**< True when a chosen WDT exists. */
	spaghetti_health_component_id_t stale_component_id; /**< First stale ID. */
	uint32_t last_reset_cause; /**< Raw hwinfo reset cause bits. */
	uint32_t watchdog_feed_count; /**< Supervisor feed attempts while healthy. */
};

/** Stable non-zero IDs for the built-in monitored owners. */
#define SPAGHETTI_HEALTH_ID_RUNTIME 1U
#define SPAGHETTI_HEALTH_ID_COMMUNICATION 2U
#define SPAGHETTI_HEALTH_ID_CONNECTIVITY 3U
#define SPAGHETTI_HEALTH_ID_UPDATE 4U

/**
 * @brief Place one immutable component descriptor in the health iterable section.
 *
 * Expand with `= { ... };` after the macro. Descriptors are linker-collected.
 */
#define SPAGHETTI_HEALTH_COMPONENT_DEFINE(name) \
	static STRUCT_SECTION_ITERABLE(spaghetti_health_component_descriptor, name)

/**
 * @brief Initialize the health owner and capture the boot reset cause.
 *
 * @retval 0 Health is ready in @ref SPAGHETTI_HEALTH_STARTING.
 * @retval -EALREADY Health was already initialized.
 * @retval -ENOMEM More compiled descriptors than the profile capacity.
 * @retval -EINVAL A descriptor is incomplete or uses a duplicate ID.
 *
 * @note Call once from the Core boot thread after mode selection and before
 *       starting monitored workers.
 */
int spaghetti_health_init(void);

/**
 * @brief Start the single supervisor thread and optional hardware watchdog.
 *
 * @retval 0 The supervisor is running.
 * @retval -EACCES Health is not initialized.
 * @retval -EALREADY The supervisor was already started.
 * @return A negative watchdog-driver error when hardware setup fails.
 *
 * @note Call once after monitored workers have started.
 */
int spaghetti_health_start(void);

/**
 * @brief Record a useful-work heartbeat for one registered component.
 *
 * @param[in] component_id Non-zero ID matching a compiled descriptor.
 *
 * @retval 0 The heartbeat was recorded.
 * @retval -EINVAL @p component_id is zero.
 * @retval -ENOENT No descriptor matches @p component_id.
 * @retval -EACCES Health is not initialized.
 *
 * @note Call from the component worker after completed useful work, not from a
 *       blind timer. Thread context only.
 */
int spaghetti_health_heartbeat(spaghetti_health_component_id_t component_id);

/**
 * @brief Acquire one temporary silence extension for a component.
 *
 * @param[in] component_id Non-zero ID matching a compiled descriptor.
 * @param[in] duration Bounded extension copied by value; K_FOREVER is rejected.
 * @param[out] out_token Caller-owned token written only on success.
 *
 * @retval 0 @p out_token owns the window until release or expiry.
 * @retval -EINVAL A pointer, ID, or duration is invalid.
 * @retval -ENOENT No descriptor matches @p component_id.
 * @retval -EACCES Health is not initialized.
 * @retval -ENOMEM The bounded window pool is full.
 *
 * @note Thread context only. The window expires automatically.
 */
int spaghetti_health_window_acquire(
	spaghetti_health_component_id_t component_id,
	k_timeout_t duration,
	spaghetti_health_window_token_t *out_token);

/**
 * @brief Release a previously acquired silence window.
 *
 * @param[in] token Non-zero token returned by acquire.
 *
 * @retval 0 The window was released.
 * @retval -EINVAL @p token is zero.
 * @retval -ENOENT @p token is unknown.
 * @retval -ETIMEDOUT @p token already expired.
 * @retval -EACCES Health is not initialized.
 */
int spaghetti_health_window_release(spaghetti_health_window_token_t token);

/**
 * @brief Copy the current health status snapshot.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains a coherent snapshot.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES Health is not initialized.
 */
int spaghetti_health_get_status(struct spaghetti_health_status *out);

#endif /* SPAGHETTI_HEALTH_H */
