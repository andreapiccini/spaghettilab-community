#include <spaghetti/data.h>

#include <errno.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/zbus/zbus.h>

#include <spaghetti/record_delivery.h>

LOG_MODULE_REGISTER(spaghetti_data, CONFIG_SPAGHETTI_DATA_LOG_LEVEL);

ZBUS_MSG_SUBSCRIBER_DEFINE(record_logger_subscriber);
ZBUS_MSG_SUBSCRIBER_DEFINE_WITH_ENABLE(record_test_subscriber, false);
ZBUS_MSG_SUBSCRIBER_DEFINE_WITH_ENABLE(record_mqtt_subscriber, false);

ZBUS_CHAN_DEFINE(spaghetti_record_chan,
		 struct spaghetti_record,
		 NULL,
		 NULL,
		 ZBUS_OBSERVERS(record_logger_subscriber,
				record_test_subscriber,
				record_mqtt_subscriber),
		 ZBUS_MSG_INIT(0));

static atomic_t is_initialized;
static atomic_t published_count;
static atomic_t rejected_count;
static atomic_t delivery_error_count;
K_MUTEX_DEFINE(data_lock);

#if CONFIG_SPAGHETTI_DATA_LOGGER
static void record_logger_thread(void *first, void *second, void *third)
{
	const struct zbus_channel *channel;
	struct spaghetti_record record;

	ARG_UNUSED(first);
	ARG_UNUSED(second);
	ARG_UNUSED(third);

	while (true) {
		int err = zbus_sub_wait_msg(&record_logger_subscriber,
					    &channel, &record, K_FOREVER);

		if (err < 0) {
			LOG_ERR("logger receive failed: err=%d", err);
			continue;
		}
		if (channel != &spaghetti_record_chan) {
			LOG_ERR("logger received an unexpected channel");
			continue;
		}

		LOG_INF("record key=%u id=%u schema=%s v=%u boot=%llu ts=%lld "
			"seq=%u fields=%u",
			record.source_key, (uint32_t)record.source_id,
			record.payload.schema_id, record.payload.schema_version,
			(unsigned long long)record.boot_id,
			(long long)record.timestamp_ms, record.sequence,
			(uint32_t)record.payload.values.field_count);
		for (size_t idx = 0U; idx < record.payload.values.field_count;
		     ++idx) {
			const struct spaghetti_value *field =
				&record.payload.values.fields[idx];

			LOG_INF("  field id=%u type=%d", field->field_id,
				(int)field->type);
		}
	}
}

K_THREAD_DEFINE(record_logger_thread_id,
		CONFIG_SPAGHETTI_DATA_LOGGER_STACK_SIZE,
		record_logger_thread, NULL, NULL, NULL,
		CONFIG_SPAGHETTI_DATA_LOGGER_PRIORITY, 0, 0);
#endif

int spaghetti_data_init(void)
{
	uint64_t boot_id;
	int err = k_mutex_lock(&data_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (atomic_get(&is_initialized) != 0) {
		k_mutex_unlock(&data_lock);
		return -EALREADY;
	}

	boot_id = (uint64_t)k_cycle_get_32();
	if (boot_id == 0U) {
		boot_id = 1U;
	}
	err = spaghetti_record_delivery_init(boot_id);
	if (err < 0) {
		k_mutex_unlock(&data_lock);
		return err;
	}

	atomic_set(&published_count, 0);
	atomic_set(&rejected_count, 0);
	atomic_set(&delivery_error_count, 0);
	atomic_set(&is_initialized, 1);
	k_mutex_unlock(&data_lock);

	LOG_INF("ready");
	return 0;
}

int spaghetti_data_publish(
	const struct spaghetti_record *record,
	k_timeout_t timeout)
{
	int err;

	if (record == NULL) {
		if (atomic_get(&is_initialized) != 0) {
			atomic_inc(&rejected_count);
		}
		return -EINVAL;
	}
	if (atomic_get(&is_initialized) == 0) {
		return -EACCES;
	}

	err = zbus_chan_pub(&spaghetti_record_chan, record, timeout);
	if (err < 0) {
		atomic_inc(&delivery_error_count);
		return err;
	}

	(void)spaghetti_record_delivery_push(record);
	atomic_inc(&published_count);
	return 0;
}

int spaghetti_data_get_stats(struct spaghetti_data_stats *out)
{
	struct spaghetti_data_stats stats;

	if (out == NULL) {
		return -EINVAL;
	}
	if (atomic_get(&is_initialized) == 0) {
		return -EACCES;
	}

	stats.published = (uint32_t)atomic_get(&published_count);
	stats.rejected = (uint32_t)atomic_get(&rejected_count);
	stats.delivery_errors = (uint32_t)atomic_get(&delivery_error_count);
	*out = stats;
	return 0;
}
