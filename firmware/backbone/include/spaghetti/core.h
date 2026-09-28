/**
 * @file
 * @brief Core functionality for the Spaghetti firmware.
 * @ingroup spaghetti_core
 */

#ifndef SPAGHETTI_CORE_H
#define SPAGHETTI_CORE_H

#include <stdbool.h>
#include <stdint.h>

/** Maximum bytes in the NUL-terminated signed application version. */
#define SPAGHETTI_CORE_VERSION_SIZE 24U

/**
 * @brief Overall initialization state of the firmware Core.
 */
enum spaghetti_core_state {
	SPAGHETTI_CORE_UNINITIALIZED, /**< Core initialization has not started. */
	SPAGHETTI_CORE_INITIALIZING, /**< Mandatory dependencies are being initialized. */
	SPAGHETTI_CORE_READY, /**< Initialization completed; start is allowed. */
	SPAGHETTI_CORE_RUNNING, /**< Infrastructure is running and accepts requests. */
	SPAGHETTI_CORE_FAILED, /**< A mandatory dependency failed. */
};

/** Operational policy selected from Config and maintenance requests. */
enum spaghetti_core_mode {
	SPAGHETTI_CORE_MODE_UNPROVISIONED, /**< No valid Config; local serial only. */
	SPAGHETTI_CORE_MODE_NORMAL, /**< Valid Config; the Engine may run. */
	SPAGHETTI_CORE_MODE_MAINTENANCE, /**< One-shot or bootstrap request accepted. */
};

/** MCUboot permanence state, independent from the operational mode. */
enum spaghetti_core_image_state {
	SPAGHETTI_CORE_IMAGE_CONFIRMED, /**< MCUboot will retain the running image. */
	SPAGHETTI_CORE_IMAGE_TRIAL, /**< Health checks must confirm this image. */
};

/** Caller-owned immutable boot information snapshot. */
struct spaghetti_core_info {
	enum spaghetti_core_state state; /**< Current Core lifecycle state. */
	enum spaghetti_core_mode mode; /**< Selected operational policy. */
	enum spaghetti_core_image_state image_state; /**< Confirmed or trial image. */
	uint8_t active_slot; /**< MCUboot slot currently executing: zero or one. */
	bool image_confirmed; /**< True after durable MCUboot confirmation. */
	char version[SPAGHETTI_CORE_VERSION_SIZE]; /**< Signed image version string. */
};

/**
 * @brief Initialize the firmware Core.
 *
 * @retval 0 Core initialization completed successfully.
 * @retval -EINVAL A compiled dependency contract is invalid.
 * @retval -EALREADY A mandatory subsystem was initialized previously.
 * @retval -ENODEV Required flash, bus, or Module hardware is unavailable.
 * @retval -ENOTSUP A stored Module is incompatible with its selected Port.
 * @retval -ENOSPC A bounded Manager or backend pool is full.
 * @retval -ENOMEM A backend or driver context pool is full.
 * @retval -EBUSY A required Module is already executing another operation.
 * @retval -ERANGE A stored driver value cannot be represented safely.
 * @retval -EIO Persistent Storage or a Module driver failed.
 * @retval -ETIMEDOUT A bounded hardware operation timed out.
 *
 * @note Call once from the boot thread. Missing or corrupt stored Config is
 *       handled as a safe empty state; a valid record is retained for start.
 */
int spaghetti_core_init(void);

/**
 * @brief Start the initialized engine and apply a retained startup Config.
 *
 * A stored Config that cannot be applied because removable hardware is absent
 * is reported but does not make the communication infrastructure unavailable.
 *
 * @retval 0 Core reached @ref SPAGHETTI_CORE_RUNNING.
 * @retval -EACCES Core is not in @ref SPAGHETTI_CORE_READY.
 *
 * @note Call once from the boot thread after @ref spaghetti_core_init.
 */
int spaghetti_core_start(void);

/**
 * @brief Return the current Core state.
 *
 * @return Current Core state.
 */
enum spaghetti_core_state spaghetti_core_get_state(void);

/**
 * @brief Copy current Core boot and image information.
 *
 * @param[out] out Caller-owned destination written only on success. Core does
 *                 not retain the pointer.
 *
 * @retval 0 @p out contains a coherent snapshot.
 * @retval -EINVAL @p out is NULL.
 * @retval -EAGAIN Core has not completed boot-mode selection.
 *
 * @note Thread context only. No hardware or persistent storage is accessed.
 */
int spaghetti_core_get_info(struct spaghetti_core_info *out);

#endif /* SPAGHETTI_CORE_H */
