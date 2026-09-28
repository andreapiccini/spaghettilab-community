/**
 * @file
 * @brief Stable device identity and friendly-name contract.
 * @ingroup spaghetti_identity
 */

#ifndef SPAGHETTI_IDENTITY_H
#define SPAGHETTI_IDENTITY_H

#include <stddef.h>
#include <stdint.h>

/** Fixed hardware-derived device identity size in bytes. */
#define SPAGHETTI_DEVICE_ID_SIZE 32U

/** Maximum friendly device-name bytes including the terminating NUL. */
#define SPAGHETTI_DEVICE_NAME_SIZE 32U

/** Caller-owned copy of the Core identity snapshot. */
struct spaghetti_identity {
	/** Hardware-derived identity; not a secret and never modified after init. */
	uint8_t device_id[SPAGHETTI_DEVICE_ID_SIZE];
	/** NUL-terminated UTF-8 friendly name; not a cryptographic peer identity. */
	char device_name[SPAGHETTI_DEVICE_NAME_SIZE];
};

/**
 * @brief Initialize identity from hardware and optional Settings name.
 *
 * @retval 0 Identity is ready for get/set operations.
 * @retval -EALREADY Identity was already initialized.
 * @retval -EIO Hardware identity could not be read.
 * @retval -errno Settings initialization or load failed.
 *
 * @note Call once from the boot thread after Storage has initialized Settings.
 */
int spaghetti_identity_init(void);

/**
 * @brief Copy the current identity snapshot.
 *
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains device_id and device_name.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES Identity has not been initialized.
 */
int spaghetti_identity_get(struct spaghetti_identity *out);

/**
 * @brief Replace the persisted friendly device name.
 *
 * @param[in] name Caller-owned NUL-terminated UTF-8 name borrowed only for this
 *                 call. Length must be from 1 to
 *                 @ref SPAGHETTI_DEVICE_NAME_SIZE minus one.
 *
 * @retval 0 The name was copied and persisted under Settings.
 * @retval -EINVAL @p name is NULL, empty, or too long.
 * @retval -EACCES Identity has not been initialized.
 * @retval -errno Settings rejected the write.
 *
 * @note The pointer is never retained. The name is not a credential.
 */
int spaghetti_identity_set_name(const char *name);

#endif /* SPAGHETTI_IDENTITY_H */
