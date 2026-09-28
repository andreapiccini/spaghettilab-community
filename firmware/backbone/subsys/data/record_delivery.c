#include <spaghetti/record_delivery.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/resources.h>

LOG_MODULE_REGISTER(spaghetti_record_delivery,
		    CONFIG_SPAGHETTI_RECORD_DELIVERY_LOG_LEVEL);

#define SPAGHETTI_RECORD_QUEUE_CAPACITY CONFIG_SPAGHETTI_MAX_RECORD_QUEUE
#define SPAGHETTI_RECORD_CONSUMER_CAPACITY \
	CONFIG_SPAGHETTI_MAX_RECORD_CONSUMERS

struct spaghetti_record_slot {
	struct spaghetti_record record;
	uint64_t abs_index;
};

struct spaghetti_record_consumer_runtime {
	const struct spaghetti_record_consumer_descriptor *descriptor;
	uint64_t next_index;
	uint32_t delivered;
	uint32_t lost;
	bool active;
};

struct spaghetti_record_delivery_context {
	struct spaghetti_record_slot
		slots[SPAGHETTI_RECORD_QUEUE_CAPACITY];
	struct spaghetti_record_consumer_runtime
		consumers[SPAGHETTI_RECORD_CONSUMER_CAPACITY];
	uint64_t boot_id;
	uint64_t write_index;
	uint64_t oldest_index;
	size_t count;
	size_t consumer_count;
	bool initialized;
};

static struct spaghetti_record_delivery_context context;
K_MUTEX_DEFINE(record_delivery_lock);

static size_t slot_offset(uint64_t abs_index)
{
	return (size_t)(abs_index % SPAGHETTI_RECORD_QUEUE_CAPACITY);
}

static struct spaghetti_record_consumer_runtime *find_consumer_locked(
	spaghetti_record_consumer_id_t consumer_id)
{
	for (size_t idx = 0U; idx < context.consumer_count; ++idx) {
		if (context.consumers[idx].descriptor->id == consumer_id) {
			return &context.consumers[idx];
		}
	}

	return NULL;
}

static bool any_active_consumer_locked(void)
{
	for (size_t idx = 0U; idx < context.consumer_count; ++idx) {
		if (context.consumers[idx].active) {
			return true;
		}
	}

	return false;
}

static bool active_consumer_holds_oldest_locked(void)
{
	for (size_t idx = 0U; idx < context.consumer_count; ++idx) {
		const struct spaghetti_record_consumer_runtime *consumer =
			&context.consumers[idx];

		if (consumer->active &&
		    (consumer->next_index == context.oldest_index)) {
			return true;
		}
	}

	return false;
}

static void reclaim_acked_locked(void)
{
	if (!any_active_consumer_locked()) {
		return;
	}

	while ((context.count > 0U) && !active_consumer_holds_oldest_locked()) {
		context.oldest_index++;
		context.count--;
	}
}

static void drop_oldest_locked(void)
{
	const uint64_t victim = context.oldest_index;

	for (size_t idx = 0U; idx < context.consumer_count; ++idx) {
		struct spaghetti_record_consumer_runtime *consumer =
			&context.consumers[idx];

		if (consumer->active && (consumer->next_index == victim)) {
			consumer->lost++;
			consumer->next_index = victim + 1U;
		}
	}

	context.oldest_index = victim + 1U;
	context.count--;
}

static int load_descriptors_locked(void)
{
	size_t count = 0U;

	STRUCT_SECTION_FOREACH(spaghetti_record_consumer_descriptor,
			       descriptor) {
		if ((descriptor->id == 0U) || (descriptor->name == NULL) ||
		    (descriptor->name[0] == '\0')) {
			return -EINVAL;
		}
		for (size_t idx = 0U; idx < count; ++idx) {
			if (context.consumers[idx].descriptor->id ==
			    descriptor->id) {
				return -EINVAL;
			}
		}
		if (count >= ARRAY_SIZE(context.consumers)) {
			return -ENOMEM;
		}
		context.consumers[count].descriptor = descriptor;
		context.consumers[count].next_index = 0U;
		context.consumers[count].delivered = 0U;
		context.consumers[count].lost = 0U;
		context.consumers[count].active = false;
		count++;
	}

	context.consumer_count = count;
	return 0;
}

static size_t pending_for_consumer_locked(
	const struct spaghetti_record_consumer_runtime *consumer)
{
	if (!consumer->active || (context.count == 0U) ||
	    (consumer->next_index >= context.write_index)) {
		return 0U;
	}
	if (consumer->next_index < context.oldest_index) {
		return (size_t)(context.write_index - context.oldest_index);
	}

	return (size_t)(context.write_index - consumer->next_index);
}

int spaghetti_record_delivery_init(uint64_t boot_id)
{
	int err;

	if (boot_id == 0U) {
		return -EINVAL;
	}

	err = k_mutex_lock(&record_delivery_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	memset(&context, 0, sizeof(context));
	context.boot_id = boot_id;
	err = load_descriptors_locked();
	if (err < 0) {
		k_mutex_unlock(&record_delivery_lock);
		return err;
	}

	context.initialized = true;
	{
		const size_t consumer_count = context.consumer_count;

		k_mutex_unlock(&record_delivery_lock);
		LOG_INF("ready: boot_id=%llu consumers=%u capacity=%u",
			(unsigned long long)boot_id,
			(uint32_t)consumer_count,
			(uint32_t)SPAGHETTI_RECORD_QUEUE_CAPACITY);
	}
	return 0;
}

int spaghetti_record_delivery_push(const struct spaghetti_record *record)
{
	int err;

	if (record == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&record_delivery_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&record_delivery_lock);
		return -EACCES;
	}

	reclaim_acked_locked();
	if (context.count >= SPAGHETTI_RECORD_QUEUE_CAPACITY) {
		drop_oldest_locked();
	}

	{
		struct spaghetti_record_slot *slot =
			&context.slots[slot_offset(context.write_index)];

		slot->record = *record;
		slot->abs_index = context.write_index;
		context.write_index++;
		context.count++;
		spaghetti_resources_note_used(
			SPAGHETTI_RESOURCE_OWNER_RECORDS,
			(uint16_t)MIN(context.count, UINT16_MAX));
	}

	k_mutex_unlock(&record_delivery_lock);
	return 0;
}

int spaghetti_record_delivery_set_consumer_active(
	spaghetti_record_consumer_id_t consumer_id,
	bool active)
{
	struct spaghetti_record_consumer_runtime *consumer;
	int err;

	if (consumer_id == 0U) {
		return -EINVAL;
	}

	err = k_mutex_lock(&record_delivery_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&record_delivery_lock);
		return -EACCES;
	}

	consumer = find_consumer_locked(consumer_id);
	if (consumer == NULL) {
		k_mutex_unlock(&record_delivery_lock);
		return -ENOENT;
	}

	if (active) {
		if (!consumer->active) {
			consumer->next_index = context.oldest_index;
		}
		consumer->active = true;
	} else {
		consumer->active = false;
		reclaim_acked_locked();
	}

	k_mutex_unlock(&record_delivery_lock);
	return 0;
}

int spaghetti_record_delivery_peek(
	spaghetti_record_consumer_id_t consumer_id,
	struct spaghetti_record *out,
	struct spaghetti_record_cursor *out_cursor)
{
	struct spaghetti_record_consumer_runtime *consumer;
	const struct spaghetti_record_slot *slot;
	int err;

	if ((consumer_id == 0U) || (out == NULL) || (out_cursor == NULL)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&record_delivery_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&record_delivery_lock);
		return -EACCES;
	}

	consumer = find_consumer_locked(consumer_id);
	if (consumer == NULL) {
		k_mutex_unlock(&record_delivery_lock);
		return -ENOENT;
	}
	if (!consumer->active) {
		k_mutex_unlock(&record_delivery_lock);
		return -EACCES;
	}
	if ((context.count == 0U) ||
	    (consumer->next_index >= context.write_index) ||
	    (consumer->next_index < context.oldest_index)) {
		k_mutex_unlock(&record_delivery_lock);
		return -ENOENT;
	}

	slot = &context.slots[slot_offset(consumer->next_index)];
	*out = slot->record;
	out_cursor->boot_id = slot->record.boot_id;
	out_cursor->sequence = slot->record.sequence;
	k_mutex_unlock(&record_delivery_lock);
	return 0;
}

int spaghetti_record_delivery_ack(
	spaghetti_record_consumer_id_t consumer_id,
	const struct spaghetti_record_cursor *cursor)
{
	struct spaghetti_record_consumer_runtime *consumer;
	const struct spaghetti_record_slot *slot;
	int err;

	if ((consumer_id == 0U) || (cursor == NULL)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&record_delivery_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&record_delivery_lock);
		return -EACCES;
	}

	consumer = find_consumer_locked(consumer_id);
	if (consumer == NULL) {
		k_mutex_unlock(&record_delivery_lock);
		return -ENOENT;
	}
	if (!consumer->active) {
		k_mutex_unlock(&record_delivery_lock);
		return -EACCES;
	}
	if ((context.count == 0U) ||
	    (consumer->next_index >= context.write_index) ||
	    (consumer->next_index < context.oldest_index)) {
		k_mutex_unlock(&record_delivery_lock);
		return -ENOENT;
	}

	slot = &context.slots[slot_offset(consumer->next_index)];
	if ((cursor->boot_id != slot->record.boot_id) ||
	    (cursor->sequence != slot->record.sequence)) {
		k_mutex_unlock(&record_delivery_lock);
		return -ESTALE;
	}

	consumer->next_index++;
	consumer->delivered++;
	reclaim_acked_locked();
	k_mutex_unlock(&record_delivery_lock);
	return 0;
}

int spaghetti_record_delivery_get_consumer_status(
	spaghetti_record_consumer_id_t consumer_id,
	struct spaghetti_record_consumer_status *out)
{
	struct spaghetti_record_consumer_runtime *consumer;
	struct spaghetti_record_consumer_status status;
	int err;

	if ((consumer_id == 0U) || (out == NULL)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&record_delivery_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&record_delivery_lock);
		return -EACCES;
	}

	consumer = find_consumer_locked(consumer_id);
	if (consumer == NULL) {
		k_mutex_unlock(&record_delivery_lock);
		return -ENOENT;
	}

	status.id = consumer->descriptor->id;
	status.active = consumer->active;
	status.pending = pending_for_consumer_locked(consumer);
	status.delivered = consumer->delivered;
	status.lost = consumer->lost;
	*out = status;
	k_mutex_unlock(&record_delivery_lock);
	return 0;
}
