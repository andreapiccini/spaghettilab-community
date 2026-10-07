/** @file @brief Physical Backbone wire descriptor. */
#ifndef SPAGHETTI_PHYSICAL_H
#define SPAGHETTI_PHYSICAL_H

#include <stdint.h>

#define SPAGHETTI_PHYSICAL_CONFIG_SIZE 20U
#define SPAGHETTI_PHYSICAL_SIZE 33U
#define SPAGHETTI_PHYSICAL_EXPECTED_SIZE 20U

/** @brief Load persisted pins and NFC catalog after Port init, before NFC init.
 * @retval 0 Loaded; -ENOTSUP absent layout; negative settings/hardware errno.
 * @note Boot thread only; records copied, not retained from callers. */
int spaghetti_physical_init(void);

/** @brief Apply catalog mapping after a local NFC scan; caller releases NFC lock.
 * @retval 0 Unchanged/applied; -EBUSY lock/owner; negative hardware errno.
 * @note Thread context; bounded 100ms lock. */
int spaghetti_physical_refresh(void);

/** @brief Apply pins only if Function tag still matches the host snapshot.
 * @param[in] modes Non-NULL borrowed four-byte user signal map.
 * @param[in] speed 0 standard, 1 fast I2C.
 * @param[in] expected Non-NULL 20-byte identity/UID/automatic snapshot, copied.
 * @retval 0 Applied/persisted; -ESTALE tag changed; -EACCES catalog owns pins;
 * -EINVAL malformed; -ENOSPC catalog full; negative settings/hardware errno.
 * @note Thread-only, 100ms lock; flash writes synchronous, bounded by backend. */
int spaghetti_physical_apply_checked(const uint8_t modes[4], uint8_t speed,
		const uint8_t expected[SPAGHETTI_PHYSICAL_EXPECTED_SIZE]);
int spaghetti_physical_apply_config(const uint8_t modes[4], uint8_t speed,
	const uint8_t expected[SPAGHETTI_PHYSICAL_EXPECTED_SIZE], const uint8_t config[20]);

/**
 * @brief Copy the local DTS layout and live user pin state.
 * @param[out] out Caller-owned 13-byte buffer, non-NULL; copied synchronously.
 * @retval 0 Snapshot copied.
 * @retval -ENOTSUP Board has no physical Backbone layout.
 * @retval -EINVAL out is NULL.
 * @note Thread context; serialized with Port configuration, bounded 100ms.
 */
int spaghetti_physical_describe(uint8_t out[SPAGHETTI_PHYSICAL_SIZE]);

/**
 * @brief Apply four signal modes to Function port 2 on this board.
 * @param[in] modes Borrowed four-byte map of physical pins 2..5, non-NULL.
 * @param[in] speed 0 = 100kHz, 1 = 400kHz.
 * @retval 0 Hardware configured; subsequent descriptor contains these modes.
 * @retval -EINVAL Invalid modes or speed.
 * @retval -ENOTSUP Board or requested transport is unsupported.
 * @retval -EBUSY Port is owned by runtime Modules.
 * @retval -errno Hardware configuration failed; signals return to input.
 * @note Thread context only. Bounded lock; caller data copied, never retained.
 */
int spaghetti_physical_apply(const uint8_t modes[4], uint8_t speed);

#endif
