/**
 * @file
 * @brief Live ST25R100 Type-A tag presence on a Backbone.
 * @ingroup spaghetti_nfc
 */

#ifndef SPAGHETTI_NFC_H
#define SPAGHETTI_NFC_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/** Maximum UID bytes retained for one ISO 14443-A tag. */
#define SPAGHETTI_NFC_UID_SIZE 10U

/** Maximum simultaneous tags retained across both antennas and remotes. */
#define SPAGHETTI_NFC_TAGS_MAX 16U

/** ISO 14443-A Type 2 tag. */
#define SPAGHETTI_NFC_TYPE_T2T 1U

/** ISO 14443-A Type 4 tag. */
#define SPAGHETTI_NFC_TYPE_T4T 2U

/** Tag class that is not T2T or T4T. */
#define SPAGHETTI_NFC_TYPE_OTHER 3U

/** One tag seen on a local antenna or reported by a CAN peer. */
struct spaghetti_nfc_tag {
	uint8_t antenna; /**< Physical antenna 1 or 2. */
	uint8_t type; /**< @ref SPAGHETTI_NFC_TYPE_T2T, T4T, or OTHER. */
	uint8_t uid_len; /**< Valid leading bytes in @ref uid. */
	uint8_t uid[SPAGHETTI_NFC_UID_SIZE]; /**< ISO 14443-A UID. */
	uint32_t node_id; /**< SLUP node that owns the antenna, or 0. */
	bool local; /**< true when the tag sits on this board. */
};

/**
 * @brief Probe the ST25R100 and start the periodic Type-A scan.
 *
 * Missing Devicetree wiring or a missing chip is not a boot failure: the
 * table stays empty and later copies succeed with a zero count.
 *
 * @retval 0 The poller is running, or this image has no NFC hardware.
 * @retval -EALREADY Initialization already completed.
 * @retval -ENODEV SPI, reset, or IC_ID probe failed.
 *
 * @note Thread context only. Call once during Core boot.
 */
int spaghetti_nfc_init(void);

/**
 * @brief Copy the last local Type-A scan without touching the RF field.
 *
 * @param[out] out Caller-owned table, or NULL when only @p count is needed.
 * @param[in] max Number of entries at @p out; ignored when @p out is NULL.
 * @param[out] count Receives the number of copied tags.
 *
 * @retval 0 The table was copied.
 * @retval -EINVAL @p count is NULL, or @p out is NULL while @p max is not
 *                 zero.
 *
 * @note Thread-safe after @ref spaghetti_nfc_init. @c node_id is 0; the
 *       caller fills the local SLUP node when publishing GET_STATUS.
 */
int spaghetti_nfc_copy_tags(struct spaghetti_nfc_tag *out, size_t max,
			    size_t *count);

/**
 * @brief Map a firmware tag type onto the GET_STATUS type-id text.
 *
 * @param[in] type @ref SPAGHETTI_NFC_TYPE_T2T, T4T, or OTHER.
 *
 * @return A firmware-lifetime NUL-terminated token: `t2t`, `t4t`, or `tag`.
 */
const char *spaghetti_nfc_type_id(uint8_t type);

#endif /* SPAGHETTI_NFC_H */
