#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/ztest.h>

#include <spaghetti/record_delivery.h>
#include <spaghetti/schema.h>

#define CONSUMER_FAST 10U
#define CONSUMER_SLOW 11U

SPAGHETTI_RECORD_CONSUMER_DEFINE(test_fast_consumer) = {
	.id = CONSUMER_FAST,
	.name = "fast",
};

SPAGHETTI_RECORD_CONSUMER_DEFINE(test_slow_consumer) = {
	.id = CONSUMER_SLOW,
	.name = "slow",
};

static struct spaghetti_record make_record(uint64_t boot_id, uint32_t sequence)
{
	struct spaghetti_record record = {
		.source_id = 1U,
		.source_key = 2U,
		.boot_id = boot_id,
		.timestamp_ms = (int64_t)sequence * 10,
		.sequence = sequence,
		.payload = {
			.kind = SPAGHETTI_RECORD_SAMPLE,
			.schema_version = 1U,
			.values = {
				.field_count = 1U,
				.fields = {
					{
						.field_id = 1U,
						.type = SPAGHETTI_VALUE_UINT64,
						.data.unsigned_integer = sequence,
					},
				},
			},
		},
	};

	strncpy(record.payload.schema_id, "spaghetti.test.sample",
		sizeof(record.payload.schema_id) - 1U);
	return record;
}

static void assert_status(spaghetti_record_consumer_id_t id, bool active,
			  size_t pending, uint32_t delivered, uint32_t lost)
{
	struct spaghetti_record_consumer_status status = {
		.id = 0U,
		.active = !active,
		.pending = pending + 99U,
		.delivered = delivered + 99U,
		.lost = lost + 99U,
	};

	zassert_ok(spaghetti_record_delivery_get_consumer_status(id, &status));
	zassert_equal(status.id, id);
	zassert_equal(status.active, active);
	zassert_equal(status.pending, pending);
	zassert_equal(status.delivered, delivered);
	zassert_equal(status.lost, lost);
}

static void peek_ack(spaghetti_record_consumer_id_t id, uint32_t sequence)
{
	struct spaghetti_record record;
	struct spaghetti_record_cursor cursor;

	zassert_ok(spaghetti_record_delivery_peek(id, &record, &cursor));
	zassert_equal(record.sequence, sequence);
	zassert_equal(cursor.sequence, sequence);
	zassert_ok(spaghetti_record_delivery_ack(id, &cursor));
}

static void delivery_before(void *fixture)
{
	ARG_UNUSED(fixture);
	zassert_ok(spaghetti_record_delivery_init(100U));
}

ZTEST(record_delivery, test_peek_ack_immutability_and_errors)
{
	struct spaghetti_record sentinel = make_record(9U, 9U);
	struct spaghetti_record out = sentinel;
	struct spaghetti_record_cursor cursor = {
		.boot_id = 9U,
		.sequence = 9U,
	};
	struct spaghetti_record_consumer_status status = {
		.id = 99U,
		.active = true,
		.pending = 99U,
		.delivered = 99U,
		.lost = 99U,
	};
	const struct spaghetti_record first = make_record(100U, 1U);

	zassert_equal(spaghetti_record_delivery_push(NULL), -EINVAL);
	zassert_equal(spaghetti_record_delivery_peek(0U, &out, &cursor),
		      -EINVAL);
	zassert_equal(spaghetti_record_delivery_peek(CONSUMER_FAST, NULL,
						     &cursor),
		      -EINVAL);
	zassert_equal(spaghetti_record_delivery_peek(99U, &out, &cursor),
		      -ENOENT);
	zassert_mem_equal(&out, &sentinel, sizeof(out));
	zassert_equal(cursor.boot_id, 9U);
	zassert_equal(cursor.sequence, 9U);

	zassert_equal(spaghetti_record_delivery_set_consumer_active(99U, true),
		      -ENOENT);
	zassert_equal(spaghetti_record_delivery_get_consumer_status(99U,
								    &status),
		      -ENOENT);
	zassert_equal(status.id, 99U);

	zassert_ok(spaghetti_record_delivery_push(&first));
	zassert_equal(spaghetti_record_delivery_peek(CONSUMER_FAST, &out,
						     &cursor),
		      -EACCES);
	zassert_mem_equal(&out, &sentinel, sizeof(out));

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_FAST,
								 true));
	zassert_ok(spaghetti_record_delivery_peek(CONSUMER_FAST, &out,
						  &cursor));
	zassert_equal(out.sequence, 1U);
	zassert_equal(cursor.boot_id, 100U);
	zassert_equal(cursor.sequence, 1U);

	cursor.sequence = 99U;
	zassert_equal(spaghetti_record_delivery_ack(CONSUMER_FAST, &cursor),
		      -ESTALE);
	cursor.boot_id = 100U;
	cursor.sequence = 1U;
	zassert_ok(spaghetti_record_delivery_ack(CONSUMER_FAST, &cursor));
	assert_status(CONSUMER_FAST, true, 0U, 1U, 0U);
}

ZTEST(record_delivery, test_two_consumers_different_speeds)
{
	if (CONFIG_SPAGHETTI_MAX_RECORD_QUEUE < 3) {
		ztest_test_skip();
	}

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_FAST,
								 true));
	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_SLOW,
								 true));

	for (uint32_t seq = 1U; seq <= 3U; ++seq) {
		struct spaghetti_record record = make_record(100U, seq);

		zassert_ok(spaghetti_record_delivery_push(&record));
	}

	peek_ack(CONSUMER_FAST, 1U);
	peek_ack(CONSUMER_FAST, 2U);
	assert_status(CONSUMER_FAST, true, 1U, 2U, 0U);
	assert_status(CONSUMER_SLOW, true, 3U, 0U, 0U);

	peek_ack(CONSUMER_SLOW, 1U);
	assert_status(CONSUMER_SLOW, true, 2U, 1U, 0U);
	peek_ack(CONSUMER_FAST, 3U);
	peek_ack(CONSUMER_SLOW, 2U);
	peek_ack(CONSUMER_SLOW, 3U);
	assert_status(CONSUMER_FAST, true, 0U, 3U, 0U);
	assert_status(CONSUMER_SLOW, true, 0U, 3U, 0U);
}

ZTEST(record_delivery, test_ring_wrap_and_sequence_wrap)
{
	const uint32_t capacity = CONFIG_SPAGHETTI_MAX_RECORD_QUEUE;

	if (capacity < 2U) {
		ztest_test_skip();
	}

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_FAST,
								 true));

	for (uint32_t seq = 1U; seq <= capacity; ++seq) {
		struct spaghetti_record record = make_record(100U, seq);

		zassert_ok(spaghetti_record_delivery_push(&record));
	}

	for (uint32_t seq = 1U; seq <= capacity; ++seq) {
		peek_ack(CONSUMER_FAST, seq);
	}

	{
		struct spaghetti_record wrap = make_record(100U, UINT32_MAX);
		struct spaghetti_record next = make_record(100U, 1U);

		zassert_ok(spaghetti_record_delivery_push(&wrap));
		zassert_ok(spaghetti_record_delivery_push(&next));
		peek_ack(CONSUMER_FAST, UINT32_MAX);
		peek_ack(CONSUMER_FAST, 1U);
	}

	for (uint32_t seq = 0U; seq < (capacity * 2U); ++seq) {
		struct spaghetti_record record =
			make_record(100U, 50U + seq);

		zassert_ok(spaghetti_record_delivery_push(&record));
		peek_ack(CONSUMER_FAST, 50U + seq);
	}

	assert_status(CONSUMER_FAST, true, 0U,
		      capacity + 2U + (capacity * 2U), 0U);
}

ZTEST(record_delivery, test_overflow_increments_only_relevant_lost)
{
	const uint32_t capacity = CONFIG_SPAGHETTI_MAX_RECORD_QUEUE;

	if (capacity < 2U) {
		ztest_test_skip();
	}

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_FAST,
								 true));
	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_SLOW,
								 true));

	for (uint32_t seq = 1U; seq <= capacity; ++seq) {
		struct spaghetti_record record = make_record(100U, seq);

		zassert_ok(spaghetti_record_delivery_push(&record));
	}

	peek_ack(CONSUMER_FAST, 1U);

	{
		struct spaghetti_record overflow =
			make_record(100U, capacity + 1U);

		zassert_ok(spaghetti_record_delivery_push(&overflow));
	}

	assert_status(CONSUMER_FAST, true, capacity, 1U, 0U);
	assert_status(CONSUMER_SLOW, true, capacity, 0U, 1U);

	peek_ack(CONSUMER_SLOW, 2U);
}

ZTEST(record_delivery, test_inactive_does_not_block_and_restart)
{
	const uint32_t capacity = CONFIG_SPAGHETTI_MAX_RECORD_QUEUE;

	if (capacity < 2U) {
		ztest_test_skip();
	}

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_FAST,
								 true));
	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_SLOW,
								 true));

	{
		struct spaghetti_record first = make_record(100U, 1U);
		struct spaghetti_record second = make_record(100U, 2U);

		zassert_ok(spaghetti_record_delivery_push(&first));
		zassert_ok(spaghetti_record_delivery_push(&second));
	}

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_SLOW,
								 false));
	peek_ack(CONSUMER_FAST, 1U);
	peek_ack(CONSUMER_FAST, 2U);
	assert_status(CONSUMER_SLOW, false, 0U, 0U, 0U);

	for (uint32_t seq = 3U; seq <= (capacity + 2U); ++seq) {
		struct spaghetti_record record = make_record(100U, seq);

		zassert_ok(spaghetti_record_delivery_push(&record));
		peek_ack(CONSUMER_FAST, seq);
	}

	assert_status(CONSUMER_SLOW, false, 0U, 0U, 0U);

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_SLOW,
								 true));
	{
		struct spaghetti_record record;
		struct spaghetti_record_cursor cursor;
		int err = spaghetti_record_delivery_peek(CONSUMER_SLOW, &record,
							 &cursor);

		if (err == 0) {
			zassert_true(record.sequence >= 3U);
			zassert_ok(spaghetti_record_delivery_ack(CONSUMER_SLOW,
								 &cursor));
		} else {
			zassert_equal(err, -ENOENT);
		}
	}
}

ZTEST(record_delivery, test_no_active_consumers_retain_last_n)
{
	const uint32_t capacity = CONFIG_SPAGHETTI_MAX_RECORD_QUEUE;

	for (uint32_t seq = 1U; seq <= (capacity + 3U); ++seq) {
		struct spaghetti_record record = make_record(100U, seq);

		zassert_ok(spaghetti_record_delivery_push(&record));
	}

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_FAST,
								 true));
	peek_ack(CONSUMER_FAST, 4U);
	assert_status(CONSUMER_FAST, true, capacity - 1U, 1U, 0U);
}

ZTEST(record_delivery, test_two_boot_ids)
{
	struct spaghetti_record before = make_record(100U, 1U);
	struct spaghetti_record after = make_record(200U, 1U);
	struct spaghetti_record out;
	struct spaghetti_record_cursor cursor;

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_FAST,
								 true));
	zassert_ok(spaghetti_record_delivery_push(&before));
	zassert_ok(spaghetti_record_delivery_init(200U));
	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_FAST,
								 true));
	zassert_equal(spaghetti_record_delivery_peek(CONSUMER_FAST, &out,
						     &cursor),
		      -ENOENT);
	zassert_ok(spaghetti_record_delivery_push(&after));
	zassert_ok(spaghetti_record_delivery_peek(CONSUMER_FAST, &out,
						  &cursor));
	zassert_equal(out.boot_id, 200U);
	zassert_equal(cursor.boot_id, 200U);
	zassert_ok(spaghetti_record_delivery_ack(CONSUMER_FAST, &cursor));
	assert_status(CONSUMER_FAST, true, 0U, 1U, 0U);
}

ZTEST(record_delivery, test_capacity_one_overflow)
{
	struct spaghetti_record first = make_record(100U, 1U);
	struct spaghetti_record second = make_record(100U, 2U);
	struct spaghetti_record out;
	struct spaghetti_record_cursor cursor;

	if (CONFIG_SPAGHETTI_MAX_RECORD_QUEUE != 1) {
		ztest_test_skip();
	}

	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_FAST,
								 true));
	zassert_ok(spaghetti_record_delivery_set_consumer_active(CONSUMER_SLOW,
								 true));
	zassert_ok(spaghetti_record_delivery_push(&first));
	peek_ack(CONSUMER_FAST, 1U);
	zassert_ok(spaghetti_record_delivery_push(&second));
	assert_status(CONSUMER_FAST, true, 1U, 1U, 0U);
	assert_status(CONSUMER_SLOW, true, 1U, 0U, 1U);
	zassert_ok(spaghetti_record_delivery_peek(CONSUMER_FAST, &out,
						  &cursor));
	zassert_equal(out.sequence, 2U);
	zassert_ok(spaghetti_record_delivery_ack(CONSUMER_FAST, &cursor));
	zassert_ok(spaghetti_record_delivery_peek(CONSUMER_SLOW, &out,
						  &cursor));
	zassert_equal(out.sequence, 2U);
}

ZTEST_SUITE(record_delivery, NULL, NULL, delivery_before, NULL, NULL);
