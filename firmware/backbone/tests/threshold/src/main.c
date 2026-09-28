#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/rule_driver.h>
#include <spaghetti/schema.h>

#include <threshold.h>

static uint32_t emit_count;
static bool last_emit_value;
static spaghetti_module_key_t last_target_key;
static int emit_error;

static int capture_emit(const struct spaghetti_rule_action *action,
			void *user_data)
{
	ARG_UNUSED(user_data);

	if (action == NULL) {
		return -EINVAL;
	}
	if (emit_error < 0) {
		return emit_error;
	}

	++emit_count;
	last_target_key = action->target_key;
	last_emit_value = action->command.arguments.fields[0].data.boolean;
	zassert_equal(action->command.command_id, 9U);
	zassert_equal(action->command.arguments.fields[0].field_id, 3U);
	zassert_equal(action->command.arguments.fields[0].type,
		      SPAGHETTI_VALUE_BOOL);
	return 0;
}

static struct spaghetti_property_set valid_config(void)
{
	return (struct spaghetti_property_set){
		.field_count = 8U,
		.fields = {
			{
				.field_id = SPAGHETTI_THRESHOLD_SOURCE_KEY,
				.type = SPAGHETTI_VALUE_UINT64,
				.data.unsigned_integer = 10U,
			},
			{
				.field_id = SPAGHETTI_THRESHOLD_SOURCE_FIELD_ID,
				.type = SPAGHETTI_VALUE_UINT64,
				.data.unsigned_integer = 2U,
			},
			{
				.field_id = SPAGHETTI_THRESHOLD_LOWER,
				.type = SPAGHETTI_VALUE_INT64,
				.data.signed_integer = 100,
			},
			{
				.field_id = SPAGHETTI_THRESHOLD_UPPER,
				.type = SPAGHETTI_VALUE_INT64,
				.data.signed_integer = 200,
			},
			{
				.field_id = SPAGHETTI_THRESHOLD_TARGET_KEY,
				.type = SPAGHETTI_VALUE_UINT64,
				.data.unsigned_integer = 20U,
			},
			{
				.field_id = SPAGHETTI_THRESHOLD_COMMAND_ID,
				.type = SPAGHETTI_VALUE_UINT64,
				.data.unsigned_integer = 9U,
			},
			{
				.field_id = SPAGHETTI_THRESHOLD_COMMAND_FIELD_ID,
				.type = SPAGHETTI_VALUE_UINT64,
				.data.unsigned_integer = 3U,
			},
			{
				.field_id = SPAGHETTI_THRESHOLD_ABOVE_VALUE,
				.type = SPAGHETTI_VALUE_BOOL,
				.data.boolean = true,
			},
		},
	};
}

static struct spaghetti_record make_record(spaghetti_module_key_t key,
					   uint16_t field_id,
					   enum spaghetti_value_type type,
					   int64_t signed_value,
					   uint64_t unsigned_value)
{
	struct spaghetti_record record = {
		.source_id = 1U,
		.source_key = key,
		.boot_id = 1U,
		.timestamp_ms = 1,
		.sequence = 1U,
		.payload = {
			.kind = SPAGHETTI_RECORD_SAMPLE,
			.schema_version = 1U,
			.values = {
				.field_count = 1U,
				.fields = {
					{
						.field_id = field_id,
						.type = type,
					},
				},
			},
		},
	};

	strncpy(record.payload.schema_id, "spaghetti.test.sample",
		sizeof(record.payload.schema_id) - 1U);
	if (type == SPAGHETTI_VALUE_INT64) {
		record.payload.values.fields[0].data.signed_integer =
			signed_value;
	} else {
		record.payload.values.fields[0].data.unsigned_integer =
			unsigned_value;
	}

	return record;
}

ZTEST(threshold, test_hysteresis_and_field_filtering)
{
	struct spaghetti_property_set config = valid_config();
	struct spaghetti_property_set invalid = config;
	void *context = NULL;
	struct spaghetti_record record;

	zassert_equal(strcmp(spaghetti_threshold_rule_driver.type_id,
			     "threshold"),
		      0);
	zassert_equal(strcmp(spaghetti_threshold_rule_driver.config_schema
				     ->schema_id,
			     "spaghetti.rule.threshold"),
		      0);
	zassert_equal(spaghetti_threshold_rule_driver.config_schema->version,
		      1U);
	zassert_equal(spaghetti_threshold_rule_driver.config_schema->fields[0]
			      .reference_group,
		      1U);
	zassert_equal(spaghetti_threshold_rule_driver.config_schema->fields[4]
			      .reference_group,
		      2U);

	invalid.fields[2].data.signed_integer = 200;
	invalid.fields[3].data.signed_integer = 100;
	zassert_equal(spaghetti_threshold_rule_driver.ops->validate_config(
			      &invalid),
		      -EINVAL);

	zassert_ok(spaghetti_threshold_rule_driver.ops->init(&config, &context));
	zassert_not_null(context);

	record = make_record(99U, 2U, SPAGHETTI_VALUE_INT64, 300, 0U);
	zassert_ok(spaghetti_threshold_rule_driver.ops->on_record(
		context, &record, capture_emit, NULL));
	zassert_equal(emit_count, 0U);

	record = make_record(10U, 9U, SPAGHETTI_VALUE_INT64, 300, 0U);
	zassert_ok(spaghetti_threshold_rule_driver.ops->on_record(
		context, &record, capture_emit, NULL));
	zassert_equal(emit_count, 0U);

	record = make_record(10U, 2U, SPAGHETTI_VALUE_INT64, 150, 0U);
	zassert_ok(spaghetti_threshold_rule_driver.ops->on_record(
		context, &record, capture_emit, NULL));
	zassert_equal(emit_count, 0U);

	record = make_record(10U, 2U, SPAGHETTI_VALUE_INT64, 99, 0U);
	zassert_ok(spaghetti_threshold_rule_driver.ops->on_record(
		context, &record, capture_emit, NULL));
	zassert_equal(emit_count, 1U);
	zassert_false(last_emit_value);
	zassert_equal(last_target_key, 20U);

	record = make_record(10U, 2U, SPAGHETTI_VALUE_INT64, 50, 0U);
	zassert_ok(spaghetti_threshold_rule_driver.ops->on_record(
		context, &record, capture_emit, NULL));
	zassert_equal(emit_count, 1U);

	record = make_record(10U, 2U, SPAGHETTI_VALUE_UINT64, 0, 201U);
	zassert_ok(spaghetti_threshold_rule_driver.ops->on_record(
		context, &record, capture_emit, NULL));
	zassert_equal(emit_count, 2U);
	zassert_true(last_emit_value);

	record = make_record(10U, 2U, SPAGHETTI_VALUE_INT64, 250, 0U);
	zassert_ok(spaghetti_threshold_rule_driver.ops->on_record(
		context, &record, capture_emit, NULL));
	zassert_equal(emit_count, 2U);

	emit_error = -ENODEV;
	record = make_record(10U, 2U, SPAGHETTI_VALUE_INT64, 50, 0U);
	zassert_equal(spaghetti_threshold_rule_driver.ops->on_record(
			      context, &record, capture_emit, NULL),
		      -ENODEV);
	zassert_equal(emit_count, 2U);
	emit_error = 0;

	record = make_record(10U, 2U, SPAGHETTI_VALUE_INT64, 50, 0U);
	zassert_ok(spaghetti_threshold_rule_driver.ops->on_record(
		context, &record, capture_emit, NULL));
	zassert_equal(emit_count, 3U);
	zassert_false(last_emit_value);

	zassert_ok(spaghetti_threshold_rule_driver.ops->deinit(context));
}

ZTEST_SUITE(threshold, NULL, NULL, NULL, NULL, NULL);
