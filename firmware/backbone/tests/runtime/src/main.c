#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <zephyr/zbus/zbus.h>
#include <zephyr/ztest.h>

#include <spaghetti/config.h>
#include <spaghetti/data.h>
#include <spaghetti/health.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/processing.h>
#include <spaghetti/rule_driver.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/runtime.h>
#include <spaghetti/schema.h>

#include <threshold.h>

ZBUS_OBS_DECLARE(record_logger_subscriber, record_test_subscriber);

enum {
	FAKE_SOURCE_FIELD = 1U,
	FAKE_COMMAND_ID = 9U,
	FAKE_COMMAND_FIELD = 3U,
};

static bool block_read;
static int command_error;
static int read_error_for_id_4;
static uint32_t read_count_a;
static uint32_t read_count_b;
static uint32_t command_count;
static uint32_t start_events_count;
static uint32_t stop_events_count;
static bool last_command_on;
static spaghetti_module_key_t last_command_key;
static spaghetti_module_event_cb_t armed_emit;
static void *armed_user_data;
static bool events_armed;
K_SEM_DEFINE(read_entered_sem, 0, 1);
K_SEM_DEFINE(read_release_sem, 0, 1);
K_SEM_DEFINE(command_sem, 0, 8);
K_SEM_DEFINE(event_published_sem, 0, 8);

int spaghetti_health_heartbeat(spaghetti_health_component_id_t component_id)
{
	ARG_UNUSED(component_id);
	return 0;
}

int spaghetti_processing_on_record(
	const struct spaghetti_record *record,
	spaghetti_processing_publish_cb_t publish,
	void *publish_user_data)
{
	ARG_UNUSED(record);
	ARG_UNUSED(publish);
	ARG_UNUSED(publish_user_data);
	return 0;
}

int spaghetti_module_manager_get_by_key(
	spaghetti_module_key_t key,
	struct spaghetti_module_snapshot *out)
{
	if ((key == 0U) || (out == NULL)) {
		return -EINVAL;
	}

	memset(out, 0, sizeof(*out));
	out->key = key;
	out->state = SPAGHETTI_MODULE_READY;

	if (key == 10U) {
		out->id = 3U;
		return 0;
	}
	if (key == 11U) {
		out->id = 4U;
		return 0;
	}
	if (key == 20U) {
		out->id = 5U;
		return 0;
	}
	if (key == 30U) {
		out->id = 6U;
		return 0;
	}

	return -ENOENT;
}

int spaghetti_module_manager_get_by_id(
	spaghetti_module_id_t id,
	struct spaghetti_module_snapshot *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	if (id == 3U) {
		return spaghetti_module_manager_get_by_key(10U, out);
	}
	if (id == 4U) {
		return spaghetti_module_manager_get_by_key(11U, out);
	}
	if (id == 5U) {
		return spaghetti_module_manager_get_by_key(20U, out);
	}
	if (id == 6U) {
		return spaghetti_module_manager_get_by_key(30U, out);
	}

	return -ENOENT;
}

static void fill_sample(struct spaghetti_record *out,
			spaghetti_module_id_t id,
			spaghetti_module_key_t key,
			uint32_t sequence,
			const char *schema_id,
			int64_t value)
{
	memset(out, 0, sizeof(*out));
	out->source_id = id;
	out->source_key = key;
	out->timestamp_ms = k_uptime_get();
	out->sequence = sequence;
	out->payload.kind = SPAGHETTI_RECORD_SAMPLE;
	out->payload.schema_version = 1U;
	strncpy(out->payload.schema_id, schema_id,
		sizeof(out->payload.schema_id) - 1U);
	out->payload.values.field_count = 1U;
	out->payload.values.fields[0] = (struct spaghetti_value){
		.field_id = FAKE_SOURCE_FIELD,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = value,
	};
}

int spaghetti_module_manager_read(
	spaghetti_module_id_t id,
	struct spaghetti_record *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	if (block_read && (id == 3U)) {
		k_sem_give(&read_entered_sem);
		(void)k_sem_take(&read_release_sem, K_FOREVER);
	}
	if ((id == 4U) && (read_error_for_id_4 < 0)) {
		return read_error_for_id_4;
	}
	if (id == 3U) {
		fill_sample(out, 3U, 10U, ++read_count_a,
			    "spaghetti.test.schema_a", -120000);
		return 0;
	}
	if (id == 4U) {
		fill_sample(out, 4U, 11U, ++read_count_b,
			    "spaghetti.test.schema_b", 42);
		return 0;
	}

	return -ENOENT;
}

int spaghetti_module_manager_command(
	spaghetti_module_id_t id,
	const struct spaghetti_module_command *command)
{
	const struct spaghetti_value *on_field;
	struct spaghetti_module_snapshot snapshot;
	int err;

	if (command == NULL) {
		return -EINVAL;
	}

	err = spaghetti_module_manager_get_by_id(id, &snapshot);
	if (err < 0) {
		return err;
	}
	if (command->command_id != FAKE_COMMAND_ID) {
		return -EINVAL;
	}

	on_field = spaghetti_property_find(&command->arguments,
					   FAKE_COMMAND_FIELD);
	if ((on_field == NULL) || (on_field->type != SPAGHETTI_VALUE_BOOL)) {
		return -EINVAL;
	}

	++command_count;
	last_command_on = on_field->data.boolean;
	last_command_key = snapshot.key;
	k_sem_give(&command_sem);
	return command_error;
}

int spaghetti_module_manager_start_events(
	spaghetti_module_id_t id,
	spaghetti_module_event_cb_t emit,
	void *emit_user_data)
{
	if (emit == NULL) {
		return -EINVAL;
	}
	if ((id != 3U) && (id != 4U) && (id != 6U)) {
		return -ENOTSUP;
	}
	if ((id == 6U) || (id == 3U)) {
		++start_events_count;
		armed_emit = emit;
		armed_user_data = emit_user_data;
		events_armed = true;
		return 0;
	}

	return -ENOTSUP;
}

int spaghetti_module_manager_stop_events(spaghetti_module_id_t id)
{
	if ((id != 3U) && (id != 4U) && (id != 6U)) {
		return -ENOTSUP;
	}
	if (!events_armed) {
		return -EALREADY;
	}
	++stop_events_count;
	events_armed = false;
	armed_emit = NULL;
	armed_user_data = NULL;
	return 0;
}

static struct spaghetti_runtime_schedule_config make_schedule(
	spaghetti_module_key_t key,
	uint32_t period_ms,
	bool enabled)
{
	return (struct spaghetti_runtime_schedule_config){
		.enabled = enabled,
		.source_key = key,
		.period_ms = period_ms,
	};
}

static struct spaghetti_rule_config make_threshold_rule(
	spaghetti_module_key_t source_key,
	spaghetti_module_key_t target_key,
	int64_t lower,
	int64_t upper)
{
	struct spaghetti_rule_config rule = {
		.key = 1U,
		.properties = {
			.field_count = 8U,
			.fields = {
				{
					.field_id = SPAGHETTI_THRESHOLD_SOURCE_KEY,
					.type = SPAGHETTI_VALUE_UINT64,
					.data.unsigned_integer = source_key,
				},
				{
					.field_id =
						SPAGHETTI_THRESHOLD_SOURCE_FIELD_ID,
					.type = SPAGHETTI_VALUE_UINT64,
					.data.unsigned_integer = FAKE_SOURCE_FIELD,
				},
				{
					.field_id = SPAGHETTI_THRESHOLD_LOWER,
					.type = SPAGHETTI_VALUE_INT64,
					.data.signed_integer = lower,
				},
				{
					.field_id = SPAGHETTI_THRESHOLD_UPPER,
					.type = SPAGHETTI_VALUE_INT64,
					.data.signed_integer = upper,
				},
				{
					.field_id = SPAGHETTI_THRESHOLD_TARGET_KEY,
					.type = SPAGHETTI_VALUE_UINT64,
					.data.unsigned_integer = target_key,
				},
				{
					.field_id = SPAGHETTI_THRESHOLD_COMMAND_ID,
					.type = SPAGHETTI_VALUE_UINT64,
					.data.unsigned_integer = FAKE_COMMAND_ID,
				},
				{
					.field_id =
						SPAGHETTI_THRESHOLD_COMMAND_FIELD_ID,
					.type = SPAGHETTI_VALUE_UINT64,
					.data.unsigned_integer = FAKE_COMMAND_FIELD,
				},
				{
					.field_id = SPAGHETTI_THRESHOLD_ABOVE_VALUE,
					.type = SPAGHETTI_VALUE_BOOL,
					.data.boolean = true,
				},
			},
		},
	};

	memcpy(rule.type_id, "threshold", sizeof("threshold"));
	return rule;
}

static void receive_record(struct spaghetti_record *out)
{
	const struct zbus_channel *channel;

	zassert_ok(zbus_sub_wait_msg(&record_test_subscriber, &channel, out,
				     K_MSEC(200)));
	zassert_true(out->boot_id != 0U);
	zassert_true(out->sequence >= 1U);
}

ZTEST(runtime, test_multi_schedule_events_rules_and_stop)
{
	const struct spaghetti_runtime_schedule_config two_schedules[] = {
		make_schedule(10U, 20U, true),
		make_schedule(11U, 50U, true),
	};
	const struct spaghetti_runtime_schedule_config event_schedule[] = {
		make_schedule(30U, 1000U, false),
	};
	const struct spaghetti_runtime_schedule_config sampling[] = {
		make_schedule(10U, 20U, true),
	};
	const struct spaghetti_runtime_schedule_config missing[] = {
		make_schedule(99U, 20U, true),
	};
	struct spaghetti_rule_config threshold =
		make_threshold_rule(10U, 20U, 450000, 500000);
	struct spaghetti_rule_config missing_target =
		make_threshold_rule(10U, 99U, 450000, 500000);
	struct spaghetti_record record;
	struct spaghetti_record_payload event_payload = {
		.kind = SPAGHETTI_RECORD_EVENT,
		.schema_version = 1U,
		.values = {
			.field_count = 1U,
			.fields = {
				{
					.field_id = 7U,
					.type = SPAGHETTI_VALUE_BOOL,
					.data.boolean = true,
				},
			},
		},
	};
	uint32_t stopped_a;
	uint32_t stopped_b;
	size_t schema_a = 0U;
	size_t schema_b = 0U;

	strncpy(event_payload.schema_id, "spaghetti.test.button",
		sizeof(event_payload.schema_id) - 1U);

	zassert_equal(spaghetti_runtime_configure(sampling, 1U, NULL, 0U),
		      -EACCES);
	zassert_equal(spaghetti_runtime_start(), -EACCES);
	zassert_equal(spaghetti_runtime_stop(K_NO_WAIT), -EACCES);
	zassert_ok(spaghetti_data_init());
	zassert_ok(zbus_obs_set_enable(&record_logger_subscriber, false));
	zassert_ok(zbus_obs_set_enable(&record_test_subscriber, true));
	zassert_ok(spaghetti_rule_registry_init());
	zassert_ok(spaghetti_runtime_init());
	zassert_equal(spaghetti_runtime_init(), -EALREADY);

	zassert_equal(spaghetti_runtime_configure(NULL, 1U, NULL, 0U), -EINVAL);
	zassert_equal(spaghetti_runtime_configure(missing, 1U, NULL, 0U), 0);
	zassert_equal(spaghetti_runtime_start(), -ENOENT);

	zassert_ok(spaghetti_runtime_configure(two_schedules, 2U, NULL, 0U));
	zassert_ok(spaghetti_runtime_start());
	zassert_equal(spaghetti_runtime_start(), -EALREADY);
	zassert_equal(spaghetti_runtime_configure(two_schedules, 2U, NULL, 0U),
		      -EBUSY);

	for (size_t idx = 0U; idx < 6U; ++idx) {
		receive_record(&record);
		if (strcmp(record.payload.schema_id,
			   "spaghetti.test.schema_a") == 0) {
			++schema_a;
			zassert_equal(record.source_key, 10U);
		} else if (strcmp(record.payload.schema_id,
				  "spaghetti.test.schema_b") == 0) {
			++schema_b;
			zassert_equal(record.source_key, 11U);
		}
	}
	zassert_true(schema_a >= 1U);
	zassert_true(schema_b >= 1U);
	zassert_true(read_count_a > read_count_b);

	read_error_for_id_4 = -EIO;
	receive_record(&record);
	zassert_equal(strcmp(record.payload.schema_id,
			     "spaghetti.test.schema_a"),
		      0);
	read_error_for_id_4 = 0;

	zassert_ok(spaghetti_runtime_stop(K_MSEC(200)));
	stopped_a = read_count_a;
	stopped_b = read_count_b;
	k_sleep(K_MSEC(60));
	zassert_equal(read_count_a, stopped_a);
	zassert_equal(read_count_b, stopped_b);
	zassert_equal(spaghetti_runtime_stop(K_NO_WAIT), -EALREADY);

	zassert_ok(spaghetti_runtime_configure(event_schedule, 1U, NULL, 0U));
	zassert_ok(spaghetti_runtime_start());
	zassert_true(events_armed);
	zassert_not_null(armed_emit);
	zassert_ok(armed_emit(&event_payload, armed_user_data));
	receive_record(&record);
	zassert_equal(record.source_key, 30U);
	zassert_equal(strcmp(record.payload.schema_id,
			     "spaghetti.test.button"),
		      0);
	zassert_equal(record.payload.kind, SPAGHETTI_RECORD_EVENT);
	zassert_ok(spaghetti_runtime_stop(K_MSEC(200)));
	zassert_true(stop_events_count >= 1U);

	/* Fill the event queue while the worker is blocked in Manager read. */
	{
		const struct spaghetti_runtime_schedule_config blocked[] = {
			make_schedule(10U, 20U, true),
			make_schedule(30U, 1000U, false),
		};

		block_read = true;
		zassert_ok(spaghetti_runtime_configure(blocked, 2U, NULL, 0U));
		zassert_ok(spaghetti_runtime_start());
		zassert_ok(k_sem_take(&read_entered_sem, K_MSEC(200)));
		zassert_not_null(armed_emit);
		for (size_t idx = 0U;
		     idx < CONFIG_SPAGHETTI_MAX_RECORD_QUEUE; ++idx) {
			zassert_ok(armed_emit(&event_payload, armed_user_data));
		}
		zassert_equal(armed_emit(&event_payload, armed_user_data),
			      -ENOSPC);
		k_sem_give(&read_release_sem);
		zassert_ok(spaghetti_runtime_stop(K_MSEC(200)));
		block_read = false;
	}

	command_count = 0U;
	zassert_ok(spaghetti_runtime_configure(sampling, 1U, &threshold, 1U));
	zassert_ok(spaghetti_runtime_start());
	/* Force threshold transitions through published samples. */
	{
		struct spaghetti_record forced = {0};

		fill_sample(&forced, 3U, 10U, 1U, "spaghetti.test.schema_a",
			    449999);
		forced.boot_id = 1U;
		/* Drive the rule by publishing through Runtime sampling values. */
	}
	for (size_t idx = 0U; idx < 8U; ++idx) {
		receive_record(&record);
		if (command_count > 0U) {
			break;
		}
	}
	/*
	 * Sampling always returns -120000 which is below lower, so the first
	 * transition commands the below state.
	 */
	zassert_ok(k_sem_take(&command_sem, K_MSEC(200)));
	zassert_false(last_command_on);
	zassert_equal(last_command_key, 20U);
	zassert_ok(spaghetti_runtime_stop(K_MSEC(200)));

	command_error = -ENODEV;
	zassert_ok(spaghetti_runtime_configure(sampling, 1U, &threshold, 1U));
	zassert_ok(spaghetti_runtime_start());
	zassert_ok(k_sem_take(&command_sem, K_MSEC(200)));
	zassert_true(command_count >= 1U);
	zassert_ok(spaghetti_runtime_stop(K_MSEC(200)));
	command_error = 0;

	zassert_ok(spaghetti_runtime_configure(sampling, 1U, &missing_target,
					       1U));
	zassert_ok(spaghetti_runtime_start());
	k_sleep(K_MSEC(50));
	zassert_ok(spaghetti_runtime_stop(K_MSEC(200)));

	block_read = true;
	zassert_ok(spaghetti_runtime_configure(sampling, 1U, NULL, 0U));
	zassert_ok(spaghetti_runtime_start());
	zassert_ok(k_sem_take(&read_entered_sem, K_MSEC(200)));
	zassert_equal(spaghetti_runtime_stop(K_MSEC(5)), -ETIMEDOUT);
	k_sem_give(&read_release_sem);
	k_sleep(K_MSEC(30));
	zassert_equal(spaghetti_runtime_stop(K_NO_WAIT), -EALREADY);
	block_read = false;
	zassert_ok(zbus_obs_set_enable(&record_test_subscriber, false));
}

ZTEST_SUITE(runtime, NULL, NULL, NULL, NULL, NULL);
