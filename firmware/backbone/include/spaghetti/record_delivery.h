/**
 * @file
 * @brief Bounded RAM record delivery queue with per-consumer cursors.
 * @ingroup spaghetti_record_delivery
 *
 * Record Delivery keeps a fixed ring of full @ref spaghetti_record copies and
 * an independent cursor for every compiled adapter. An ACK from one consumer
 * never advances another. Overflow drops the oldest retained record and
 * increments @c lost only for active consumers that had not confirmed it.
 *
 * V1 does not retain history across reboot. A changed @c boot_id or an
 * increased @c lost counter is an explicit discontinuity for Node-RED.
 *
 * @p timestamp_ms on each record is monotonic uptime from @c k_uptime_get()
 * and restarts after reboot; @c boot_id changes each boot so two timelines
 * are not confused.
 */

#ifndef SPAGHETTI_RECORD_DELIVERY_H
#define SPAGHETTI_RECORD_DELIVERY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/iterable_sections.h>

#include <spaghetti/schema.h>

/** Stable non-zero ID for the MQTT record consumer. */
#define SPAGHETTI_RECORD_CONSUMER_ID_MQTT 1U

/** Stable non-zero ID for the BLE record consumer. */
#define SPAGHETTI_RECORD_CONSUMER_ID_BLE 2U

/**
 * @brief Cursor identifying one pending record for a single consumer.
 *
 * Matched against the next undelivered record for that consumer on @ref
 * spaghetti_record_delivery_ack. Callers treat a new @c boot_id as a
 * discontinuity.
 */
struct spaghetti_record_cursor {
	uint64_t boot_id; /**< Boot epoch of the pending record. */
	uint32_t sequence; /**< Sequence of the pending record. */
};

/** Stable non-zero consumer identifier passed by value. */
typedef uint16_t spaghetti_record_consumer_id_t;

/**
 * @brief Immutable adapter descriptor collected into the delivery section.
 *
 * Expand @ref SPAGHETTI_RECORD_CONSUMER_DEFINE with `= { ... };`. IDs must be
 * unique and non-zero across the firmware image.
 */
struct spaghetti_record_consumer_descriptor {
	spaghetti_record_consumer_id_t id; /**< Unique non-zero consumer ID. */
	const char *name; /**< Stable diagnostic name; never NULL. */
};

/**
 * @brief Caller-owned snapshot of one consumer's delivery progress.
 *
 * Written only on success by @ref spaghetti_record_delivery_get_consumer_status.
 */
struct spaghetti_record_consumer_status {
	spaghetti_record_consumer_id_t id; /**< Consumer ID for this snapshot. */
	bool active; /**< True when the adapter may peek and ack. */
	size_t pending; /**< Records still retained for this consumer. */
	uint32_t delivered; /**< Successful ACK count since the last init. */
	uint32_t lost; /**< Overflow drops while this consumer was active. */
};

/**
 * @brief Place one immutable consumer descriptor in the delivery section.
 *
 * Expand with `= { .id = ..., .name = "..." };` after the macro.
 *
 * @param name C identifier for the descriptor object.
 */
#define SPAGHETTI_RECORD_CONSUMER_DEFINE(name) \
	static const STRUCT_SECTION_ITERABLE( \
		spaghetti_record_consumer_descriptor, name)

/**
 * @brief Initialize or reset the delivery ring for one boot epoch.
 *
 * Validates compiled descriptors against @c CONFIG_SPAGHETTI_MAX_RECORD_CONSUMERS,
 * resets the ring and every consumer cursor, and stores @p boot_id for
 * discontinuity documentation. A later call with a new @p boot_id is an
 * explicit reboot discontinuity and clears retained records.
 *
 * @param[in] boot_id Boot epoch stamped on records for this run. Zero is
 *                    rejected.
 *
 * @retval 0 Delivery is ready.
 * @retval -EINVAL A descriptor is incomplete, uses ID zero, duplicates an ID,
 *                 or @p boot_id is zero.
 * @retval -ENOMEM More compiled descriptors than the profile capacity.
 *
 * @note Call from the Core boot path after Data init (or again from Runtime
 *       with the runtime boot ID). Thread context only. No heap.
 */
int spaghetti_record_delivery_init(uint64_t boot_id);

/**
 * @brief Copy one record into the bounded ring.
 *
 * When the ring is full, the oldest record is dropped first. Active consumers
 * that had not ACKed that oldest record increment @c lost. Inactive consumers
 * do not retain slots. With no active consumers the ring still keeps the last
 * @c CONFIG_SPAGHETTI_MAX_RECORD_QUEUE records.
 *
 * @param[in] record Caller-owned record borrowed only for this call and copied
 *                   on success. Must not be NULL and is never retained.
 *
 * @retval 0 The record was retained (possibly after dropping the oldest).
 * @retval -EINVAL @p record is NULL.
 * @retval -EACCES Delivery has not been initialized.
 *
 * @note Thread-safe. Callable from the Data publish path.
 */
int spaghetti_record_delivery_push(const struct spaghetti_record *record);

/**
 * @brief Enable or disable peek/ack for one compiled consumer.
 *
 * An inactive consumer does not hold the queue. When reactivated, the consumer
 * starts from the oldest record still present in the ring.
 *
 * @param[in] consumer_id Non-zero ID matching a compiled descriptor.
 * @param[in] active True to allow peek/ack; false to release the queue hold.
 *
 * @retval 0 The active flag was updated.
 * @retval -EINVAL @p consumer_id is zero.
 * @retval -ENOENT No descriptor matches @p consumer_id.
 * @retval -EACCES Delivery has not been initialized.
 *
 * @note Thread context only.
 */
int spaghetti_record_delivery_set_consumer_active(
	spaghetti_record_consumer_id_t consumer_id,
	bool active);

/**
 * @brief Copy the next pending record for one active consumer without removing it.
 *
 * @param[in] consumer_id Non-zero ID matching a compiled descriptor.
 * @param[out] out Caller-owned record written only on success.
 * @param[out] out_cursor Caller-owned cursor written only on success; pass the
 *                        same values to @ref spaghetti_record_delivery_ack.
 *
 * @retval 0 @p out and @p out_cursor contain the next pending record.
 * @retval -EINVAL A pointer is NULL or @p consumer_id is zero.
 * @retval -ENOENT Unknown @p consumer_id, or no pending record for that consumer.
 * @retval -EACCES Delivery is uninitialized or the consumer is inactive.
 *
 * @note Thread context only. Failed calls leave @p out and @p out_cursor unchanged.
 */
int spaghetti_record_delivery_peek(
	spaghetti_record_consumer_id_t consumer_id,
	struct spaghetti_record *out,
	struct spaghetti_record_cursor *out_cursor);

/**
 * @brief Confirm delivery of the pending record for one consumer.
 *
 * @param[in] consumer_id Non-zero ID matching a compiled descriptor.
 * @param[in] cursor Cursor previously returned by peek for the same consumer.
 *
 * @retval 0 The consumer advanced past the pending record.
 * @retval -EINVAL A pointer is NULL or @p consumer_id is zero.
 * @retval -ENOENT Unknown @p consumer_id.
 * @retval -EACCES Delivery is uninitialized or the consumer is inactive.
 * @retval -ESTALE @p cursor does not match the current pending record.
 * @retval -ENOENT No pending record remains for that consumer.
 *
 * @note Thread context only. ACK for one consumer never advances another.
 */
int spaghetti_record_delivery_ack(
	spaghetti_record_consumer_id_t consumer_id,
	const struct spaghetti_record_cursor *cursor);

/**
 * @brief Copy one consumer's delivery status snapshot.
 *
 * @param[in] consumer_id Non-zero ID matching a compiled descriptor.
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains a coherent snapshot.
 * @retval -EINVAL A pointer is NULL or @p consumer_id is zero.
 * @retval -ENOENT Unknown @p consumer_id.
 * @retval -EACCES Delivery has not been initialized.
 *
 * @note Thread-safe. Counters may wrap.
 */
int spaghetti_record_delivery_get_consumer_status(
	spaghetti_record_consumer_id_t consumer_id,
	struct spaghetti_record_consumer_status *out);

#endif /* SPAGHETTI_RECORD_DELIVERY_H */
