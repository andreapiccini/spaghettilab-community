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

/** One SLM1-validated module tag on a local antenna or reported by a peer. */
struct spaghetti_nfc_tag {
	uint8_t antenna; /**< Physical antenna 1 or 2 (Connector / Interface). */
	uint8_t type; /**< @ref SPAGHETTI_NFC_TYPE_T2T, T4T, or OTHER. */
	uint8_t uid_len; /**< Valid leading bytes in @ref uid. */
	uint8_t uid[SPAGHETTI_NFC_UID_SIZE]; /**< ISO 14443-A UID. */
	uint32_t node_id; /**< SLUP node that owns the antenna, or 0. */
	bool local; /**< true when the tag sits on this board. */
	uint16_t registry_id; /**< SLM1 registry authority id. */
	uint16_t vendor_id; /**< SLM1 vendor id. */
	uint32_t module_type_id; /**< SLM1 module type; 0 when not SLM1. */
	uint16_t fallback_class; /**< SLM1 fallback class for presentation. */
};

/**
 * @brief Probe the ST25R100 and arm low-power card detection on IRQ.
 *
 * The chip sits in wake-up mode and asserts the IRQ GPIO when I/Q load
 * changes. The work item then runs Type-A and notifies the host. A
 * periodic Type-A scan still runs so a missed wake-up does not hide a
 * tag that is already on the antenna. Missing Devicetree wiring or a
 * missing chip is not a boot failure: the table stays empty and later
 * copies succeed with a zero count.
 *
 * Only tags that decode as Spaghetti LAB module protocol V1 (`SLM1`)
 * are retained. Blank or third-party Type-A tags are ignored.
 *
 * @retval 0 Wake-up mode is armed, or this image has no NFC hardware.
 * @retval -EALREADY Initialization already completed.
 * @retval -ENODEV SPI, reset, or IC_ID probe failed.
 *
 * @note Thread context only. Call once during Core boot.
 */
int spaghetti_nfc_init(void);

/**
 * @brief Copy the last local SLM1 scan without touching the RF field.
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
 * @brief Map a validated tag onto the GET_STATUS type-id text.
 *
 * Prefers the SLM1 fallback class label (`sensor`, `actuator`, …). Falls
 * back to `t2t` / `t4t` / `tag` only when @p module_type_id is zero.
 *
 * @param[in] tag Tag from @ref spaghetti_nfc_copy_tags.
 *
 * @return A firmware-lifetime NUL-terminated token (max 15 ASCII chars).
 */
const char *spaghetti_nfc_type_id(const struct spaghetti_nfc_tag *tag);

#endif /* SPAGHETTI_NFC_H */
