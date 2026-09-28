#include <errno.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/zbus/zbus.h>
#include <zephyr/ztest.h>

#include <spaghetti/data.h>
#include <spaghetti/schema.h>

ZBUS_CHAN_DECLARE(spaghetti_record_chan);
ZBUS_OBS_DECLARE(record_logger_subscriber,
		 record_test_subscriber);

static struct spaghetti_record make_record(uint32_t sequence)
{
	struct spaghetti_record record = {
		.source_id = 3U,
		.source_key = 11U,
		.boot_id = 42U,
		.timestamp_ms = 1234,
		.sequence = sequence,
		.payload = {
			.kind = SPAGHETTI_RECORD_SAMPLE,
			.schema_version = 1U,
			.values = {
				.field_count = 2U,
				.fields = {
					{
						.field_id = 1U,
						.type = SPAGHETTI_VALUE_INT64,
						.data.signed_integer = -25,
					},
					{
						.field_id = 2U,
						.type = SPAGHETTI_VALUE_UINT64,
						.data.unsigned_integer = 7U,
					},
				},
			},
		},
	};

	strncpy(record.payload.schema_id, "spaghetti.test.sample",
		sizeof(record.payload.schema_id) - 1U);
	return record;
}

static void receive_and_assert(
	const struct zbus_observer *subscriber,
	const struct spaghetti_record *expected)
{
	const struct zbus_channel *channel;
	struct spaghetti_record received;

	zassert_ok(zbus_sub_wait_msg(subscriber, &channel, &received, K_NO_WAIT));
	zassert_equal(channel, &spaghetti_record_chan);
	zassert_equal(received.source_id, expected->source_id);
	zassert_equal(received.source_key, expected->source_key);
	zassert_equal(received.boot_id, expected->boot_id);
	zassert_equal(received.timestamp_ms, expected->timestamp_ms);
	zassert_equal(received.sequence, expected->sequence);
	zassert_equal(strcmp(received.payload.schema_id,
			     expected->payload.schema_id),
		      0);
	zassert_equal(received.payload.values.field_count,
		      expected->payload.values.field_count);
	zassert_equal(received.payload.values.fields[0].field_id, 1U);
	zassert_equal(received.payload.values.fields[0].type,
		      SPAGHETTI_VALUE_INT64);
	zassert_equal(received.payload.values.fields[1].field_id, 2U);
	zassert_equal(received.payload.values.fields[1].type,
		      SPAGHETTI_VALUE_UINT64);
}

static size_t drain_subscriber(const struct zbus_observer *subscriber)
{
	const struct zbus_channel *channel;
	struct spaghetti_record record;
	size_t count = 0U;

	while (zbus_sub_wait_msg(subscriber, &channel, &record,
				 K_NO_WAIT) == 0) {
		++count;
	}

	return count;
}

ZTEST(data, test_fan_out_and_bounded_pool_exhaustion)
{
	struct spaghetti_data_stats unchanged = {
		.published = 99U,
		.rejected = 99U,
		.delivery_errors = 99U,
	};
	struct spaghetti_data_stats stats = unchanged;
	struct spaghetti_record message = make_record(7U);
	int publish_error = 0;
	size_t successful_fill_count = 0U;

	zassert_equal(spaghetti_data_publish(&message, K_NO_WAIT), -EACCES);
	zassert_equal(spaghetti_data_get_stats(&stats), -EACCES);
	zassert_mem_equal(&stats, &unchanged, sizeof(stats));
	zassert_ok(spaghetti_data_init());
	zassert_equal(spaghetti_data_init(), -EALREADY);
	zassert_ok(zbus_obs_set_enable(&record_test_subscriber, true));

	zassert_ok(spaghetti_data_publish(&message, K_NO_WAIT));
	receive_and_assert(&record_logger_subscriber, &message);
	receive_and_assert(&record_test_subscriber, &message);

	zassert_equal(spaghetti_data_publish(NULL, K_NO_WAIT), -EINVAL);
	for (size_t attempt = 0U; attempt < 8U; ++attempt) {
		message = make_record(100U + (uint32_t)attempt);
		publish_error = spaghetti_data_publish(&message, K_NO_WAIT);
		if (publish_error < 0) {
			break;
		}
		++successful_fill_count;
	}

	zassert_equal(publish_error, -ENOMEM);
	zassert_true(successful_fill_count > 0U);
	zassert_true(successful_fill_count < 8U);
	zassert_ok(spaghetti_data_get_stats(&stats));
	zassert_equal(stats.published, 1U + successful_fill_count);
	zassert_equal(stats.rejected, 1U);
	zassert_equal(stats.delivery_errors, 1U);
	zassert_true(drain_subscriber(&record_logger_subscriber) >=
		     successful_fill_count);
	zassert_equal(drain_subscriber(&record_test_subscriber),
		      successful_fill_count);
	zassert_ok(zbus_obs_set_enable(&record_test_subscriber, false));
}

ZTEST_SUITE(data, NULL, NULL, NULL, NULL, NULL);
