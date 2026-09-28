#include <spaghetti/runtime.h>

#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/data.h>
#include <spaghetti/health.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/core.h>
#include <spaghetti/processing.h>
#include <spaghetti/record_delivery.h>
#include <spaghetti/resources.h>
#include <spaghetti/rule_driver.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/schema.h>

LOG_MODULE_REGISTER(spaghetti_runtime, CONFIG_SPAGHETTI_RUNTIME_LOG_LEVEL);

SPAGHETTI_HEALTH_COMPONENT_DEFINE(runtime_health) = {
	.id = SPAGHETTI_HEALTH_ID_RUNTIME,
	.name = "runtime",
	.maximum_silence_ms = 3000U,
	.required_core_modes = BIT(SPAGHETTI_CORE_MODE_NORMAL),
};

static void runtime_health_keepalive_handler(struct k_work *work);

K_WORK_DELAYABLE_DEFINE(runtime_health_keepalive,
			runtime_health_keepalive_handler);

static void runtime_health_keepalive_handler(struct k_work *work)
{
	ARG_UNUSED(work);
	(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_RUNTIME);
	(void)k_work_reschedule(&runtime_health_keepalive,
		K_MSEC(CONFIG_SPAGHETTI_HEALTH_KEEPALIVE_MS));
}

enum spaghetti_runtime_state {
	SPAGHETTI_RUNTIME_UNINITIALIZED,
	SPAGHETTI_RUNTIME_STOPPED,
	SPAGHETTI_RUNTIME_RUNNING,
	SPAGHETTI_RUNTIME_STOPPING,
};

struct spaghetti_runtime_job {
	bool enabled;
	spaghetti_module_key_t source_key;
	spaghetti_module_id_t source_id;
	uint32_t period_ms;
	int64_t next_deadline_ms;
	uint32_t sequence;
	bool events_armed;
};

struct spaghetti_runtime_rule_slot {
	bool active;
	spaghetti_module_key_t key;
	const struct spaghetti_rule_driver *driver;
	void *context;
};

struct spaghetti_runtime_event {
	spaghetti_module_id_t source_id;
	spaghetti_module_key_t source_key;
	struct spaghetti_record_payload payload;
};

static enum spaghetti_runtime_state runtime_state =
	SPAGHETTI_RUNTIME_UNINITIALIZED;
static struct spaghetti_runtime_job jobs[SPAGHETTI_CONFIG_MAX_SCHEDULES];
static size_t job_count;
static struct spaghetti_runtime_rule_slot rule_slots[SPAGHETTI_CONFIG_MAX_RULES];
static size_t rule_count;
static uint64_t runtime_boot_id;
static uint8_t active_operations;
static uint32_t action_errors;
K_MUTEX_DEFINE(runtime_lock);
K_SEM_DEFINE(runtime_wake_sem, 0, 1);
K_SEM_DEFINE(runtime_stopped_sem, 0, 1);

K_MSGQ_DEFINE(runtime_event_queue,
	      sizeof(struct spaghetti_runtime_event),
	      CONFIG_SPAGHETTI_MAX_RECORD_QUEUE,
	      __alignof__(struct spaghetti_runtime_event));

static void finish_stop_if_quiescent(void)
{
	if ((runtime_state == SPAGHETTI_RUNTIME_STOPPING) &&
	    (active_operations == 0U)) {
		runtime_state = SPAGHETTI_RUNTIME_STOPPED;
		k_sem_give(&runtime_stopped_sem);
	}
}

static void complete_operation(void)
{
	(void)k_mutex_lock(&runtime_lock, K_FOREVER);
	if (active_operations > 0U) {
		--active_operations;
	}
	finish_stop_if_quiescent();
	k_mutex_unlock(&runtime_lock);
}

static void deinit_rules(struct spaghetti_runtime_rule_slot *slots, size_t count)
{
	for (size_t idx = count; idx > 0U; --idx) {
		struct spaghetti_runtime_rule_slot *slot = &slots[idx - 1U];

		if (!slot->active || (slot->driver == NULL) ||
		    (slot->driver->ops == NULL) ||
		    (slot->driver->ops->deinit == NULL)) {
			memset(slot, 0, sizeof(*slot));
			continue;
		}
		(void)slot->driver->ops->deinit(slot->context);
		memset(slot, 0, sizeof(*slot));
	}
}

static int emit_rule_action(const struct spaghetti_rule_action *action,
			    void *user_data)
{
	struct spaghetti_module_snapshot target;
	int err;

	ARG_UNUSED(user_data);

	if ((action == NULL) || (action->target_key == 0U)) {
		return -EINVAL;
	}

	err = spaghetti_module_manager_get_by_key(action->target_key, &target);
	if ((err < 0) || (target.state != SPAGHETTI_MODULE_READY)) {
		LOG_WRN("rule target missing: key=%u err=%d", action->target_key,
			err);
		++action_errors;
		return (err < 0) ? err : -ENOENT;
	}

	err = spaghetti_module_manager_command(target.id, &action->command);
	if (err < 0) {
		LOG_WRN("rule action failed: key=%u err=%d", action->target_key,
			err);
		++action_errors;
	}

	return err;
}

static void dispatch_rules(const struct spaghetti_record *record)
{
	struct spaghetti_runtime_rule_slot local_slots[SPAGHETTI_CONFIG_MAX_RULES];
	size_t local_count;

	(void)k_mutex_lock(&runtime_lock, K_FOREVER);
	if (runtime_state != SPAGHETTI_RUNTIME_RUNNING) {
		k_mutex_unlock(&runtime_lock);
		return;
	}
	local_count = rule_count;
	memcpy(local_slots, rule_slots, sizeof(local_slots));
	++active_operations;
	k_mutex_unlock(&runtime_lock);

	for (size_t idx = 0U; idx < local_count; ++idx) {
		const struct spaghetti_runtime_rule_slot *slot = &local_slots[idx];
		int err;

		if (!slot->active || (slot->driver == NULL) ||
		    (slot->driver->ops == NULL) ||
		    (slot->driver->ops->on_record == NULL)) {
			continue;
		}

		err = slot->driver->ops->on_record(slot->context, record,
						   emit_rule_action, NULL);
		if (err < 0) {
			LOG_WRN("rule on_record failed: key=%u err=%d",
				slot->key, err);
		}
	}

	complete_operation();
}

static int publish_derived_record(const struct spaghetti_record *record,
				  void *user_data)
{
	int err;

	ARG_UNUSED(user_data);
	err = spaghetti_data_publish(record, K_NO_WAIT);
	if (err < 0) {
		return err;
	}
	dispatch_rules(record);
	return 0;
}

static int publish_record(struct spaghetti_record *record)
{
	int err;

	record->boot_id = runtime_boot_id;
	err = spaghetti_data_publish(record, K_NO_WAIT);
	if (err < 0) {
		LOG_WRN("record publish failed: key=%u err=%d",
			record->source_key, err);
		return err;
	}

	(void)spaghetti_processing_on_record(record, publish_derived_record,
					     NULL);
	dispatch_rules(record);
	return 0;
}

static int runtime_event_emit(const struct spaghetti_record_payload *payload,
			      void *user_data)
{
	struct spaghetti_runtime_event event;
	const struct spaghetti_runtime_job *job = user_data;

	if ((payload == NULL) || (job == NULL)) {
		return -EINVAL;
	}

	memset(&event, 0, sizeof(event));
	event.source_id = job->source_id;
	event.source_key = job->source_key;
	event.payload = *payload;

	if (k_msgq_put(&runtime_event_queue, &event, K_NO_WAIT) < 0) {
		return -ENOSPC;
	}

	k_sem_give(&runtime_wake_sem);
	return 0;
}

static void process_event(struct spaghetti_runtime_event *event)
{
	struct spaghetti_record record;
	size_t job_idx = SIZE_MAX;

	(void)k_mutex_lock(&runtime_lock, K_FOREVER);
	if (runtime_state != SPAGHETTI_RUNTIME_RUNNING) {
		k_mutex_unlock(&runtime_lock);
		return;
	}

	for (size_t idx = 0U; idx < job_count; ++idx) {
		if (jobs[idx].source_key == event->source_key) {
			job_idx = idx;
			break;
		}
	}
	if (job_idx == SIZE_MAX) {
		k_mutex_unlock(&runtime_lock);
		return;
	}

	memset(&record, 0, sizeof(record));
	record.source_id = event->source_id;
	record.source_key = event->source_key;
	record.timestamp_ms = k_uptime_get();
	if (jobs[job_idx].sequence == UINT32_MAX) {
		jobs[job_idx].sequence = 0U;
	}
	++jobs[job_idx].sequence;
	record.sequence = jobs[job_idx].sequence;
	record.payload = event->payload;
	++active_operations;
	k_mutex_unlock(&runtime_lock);

	(void)publish_record(&record);
	complete_operation();
}

static void process_due_jobs(int64_t now_ms)
{
	for (size_t idx = 0U; idx < SPAGHETTI_CONFIG_MAX_SCHEDULES; ++idx) {
		struct spaghetti_runtime_job job;
		struct spaghetti_record record;
		int err;

		(void)k_mutex_lock(&runtime_lock, K_FOREVER);
		if ((runtime_state != SPAGHETTI_RUNTIME_RUNNING) ||
		    (idx >= job_count) || !jobs[idx].enabled ||
		    (jobs[idx].next_deadline_ms > now_ms)) {
			k_mutex_unlock(&runtime_lock);
			continue;
		}

		job = jobs[idx];
		++active_operations;
		k_mutex_unlock(&runtime_lock);

		err = spaghetti_module_manager_read(job.source_id, &record);
		(void)k_mutex_lock(&runtime_lock, K_FOREVER);
		if ((runtime_state == SPAGHETTI_RUNTIME_RUNNING) &&
		    (idx < job_count) &&
		    (jobs[idx].source_key == job.source_key)) {
			/* Advance from the previous deadline to avoid drift. */
			do {
				jobs[idx].next_deadline_ms +=
					(int64_t)jobs[idx].period_ms;
			} while (jobs[idx].next_deadline_ms <= now_ms);

			if (err == 0) {
				if (jobs[idx].sequence == UINT32_MAX) {
					jobs[idx].sequence = 0U;
				}
				++jobs[idx].sequence;
				record.sequence = jobs[idx].sequence;
				record.source_id = jobs[idx].source_id;
				record.source_key = jobs[idx].source_key;
				record.timestamp_ms = k_uptime_get();
			}
		}
		k_mutex_unlock(&runtime_lock);

		if (err < 0) {
			LOG_WRN("sample read failed: key=%u err=%d",
				job.source_key, err);
		} else {
			(void)publish_record(&record);
		}

		complete_operation();
		(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_RUNTIME);
	}
}

static int64_t nearest_deadline_ms(void)
{
	int64_t nearest = INT64_MAX;

	for (size_t idx = 0U; idx < job_count; ++idx) {
		if (jobs[idx].enabled &&
		    (jobs[idx].next_deadline_ms < nearest)) {
			nearest = jobs[idx].next_deadline_ms;
		}
	}

	return nearest;
}

static void runtime_worker_entry(void *first, void *second, void *third)
{
	ARG_UNUSED(first);
	ARG_UNUSED(second);
	ARG_UNUSED(third);

	while (true) {
		struct spaghetti_runtime_event event;
		int64_t now_ms;
		int64_t nearest;
		k_timeout_t wait;
		bool running;

		(void)k_mutex_lock(&runtime_lock, K_FOREVER);
		running = (runtime_state == SPAGHETTI_RUNTIME_RUNNING);
		if (runtime_state == SPAGHETTI_RUNTIME_STOPPING) {
			finish_stop_if_quiescent();
			k_mutex_unlock(&runtime_lock);
			(void)k_sem_take(&runtime_wake_sem, K_FOREVER);
			continue;
		}
		if (!running) {
			k_mutex_unlock(&runtime_lock);
			(void)k_sem_take(&runtime_wake_sem, K_FOREVER);
			continue;
		}

		now_ms = k_uptime_get();
		nearest = nearest_deadline_ms();
		if (nearest == INT64_MAX) {
			wait = K_FOREVER;
		} else if (nearest <= now_ms) {
			wait = K_NO_WAIT;
		} else {
			const int64_t delta_ms = nearest - now_ms;

			wait = K_MSEC((delta_ms > (int64_t)UINT32_MAX) ?
				      UINT32_MAX : (uint32_t)delta_ms);
		}
		k_mutex_unlock(&runtime_lock);

		if (k_msgq_get(&runtime_event_queue, &event, K_NO_WAIT) == 0) {
			process_event(&event);
			continue;
		}

		(void)k_sem_take(&runtime_wake_sem, wait);

		while (k_msgq_get(&runtime_event_queue, &event, K_NO_WAIT) ==
		       0) {
			process_event(&event);
		}

		now_ms = k_uptime_get();
		process_due_jobs(now_ms);
	}
}

K_THREAD_DEFINE(runtime_worker_thread_id,
		CONFIG_SPAGHETTI_RUNTIME_STACK_SIZE,
		runtime_worker_entry, NULL, NULL, NULL,
		CONFIG_SPAGHETTI_RUNTIME_PRIORITY, 0, 0);

static int validate_schedules(
	const struct spaghetti_runtime_schedule_config *schedules,
	size_t schedule_count)
{
	if ((schedule_count > SPAGHETTI_CONFIG_MAX_SCHEDULES) ||
	    ((schedules == NULL) && (schedule_count > 0U))) {
		return -EINVAL;
	}

	for (size_t idx = 0U; idx < schedule_count; ++idx) {
		if ((schedules[idx].source_key == 0U) ||
		    (schedules[idx].period_ms == 0U)) {
			return -EINVAL;
		}
	}

	return 0;
}

static int init_rules_copy(
	const struct spaghetti_rule_config *rules,
	size_t count,
	struct spaghetti_runtime_rule_slot *out_slots)
{
	if ((count > SPAGHETTI_CONFIG_MAX_RULES) ||
	    ((rules == NULL) && (count > 0U))) {
		return -EINVAL;
	}

	memset(out_slots, 0, sizeof(*out_slots) * SPAGHETTI_CONFIG_MAX_RULES);

	for (size_t idx = 0U; idx < count; ++idx) {
		const struct spaghetti_rule_driver *driver;
		void *context = NULL;
		int err;

		if ((rules[idx].key == 0U) || (rules[idx].type_id[0] == '\0')) {
			deinit_rules(out_slots, idx);
			return -EINVAL;
		}

		driver = spaghetti_rule_registry_find(rules[idx].type_id);
		if ((driver == NULL) || (driver->ops == NULL) ||
		    (driver->ops->validate_config == NULL) ||
		    (driver->ops->init == NULL) ||
		    (driver->ops->on_record == NULL) ||
		    (driver->ops->deinit == NULL)) {
			deinit_rules(out_slots, idx);
			return -ENOTSUP;
		}

		err = driver->ops->validate_config(&rules[idx].properties);
		if (err < 0) {
			deinit_rules(out_slots, idx);
			return err;
		}

		err = driver->ops->init(&rules[idx].properties, &context);
		if (err < 0) {
			deinit_rules(out_slots, idx);
			return err;
		}

		out_slots[idx].active = true;
		out_slots[idx].key = rules[idx].key;
		out_slots[idx].driver = driver;
		out_slots[idx].context = context;
	}

	return 0;
}

int spaghetti_runtime_init(void)
{
	int err = k_mutex_lock(&runtime_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (runtime_state != SPAGHETTI_RUNTIME_UNINITIALIZED) {
		k_mutex_unlock(&runtime_lock);
		return -EALREADY;
	}

	memset(jobs, 0, sizeof(jobs));
	memset(rule_slots, 0, sizeof(rule_slots));
	job_count = 0U;
	rule_count = 0U;
	active_operations = 0U;
	action_errors = 0U;
	runtime_boot_id = (uint64_t)k_cycle_get_32();
	if (runtime_boot_id == 0U) {
		runtime_boot_id = 1U;
	}
	err = spaghetti_record_delivery_init(runtime_boot_id);
	if (err < 0) {
		k_mutex_unlock(&runtime_lock);
		return err;
	}
	k_sem_reset(&runtime_wake_sem);
	k_sem_reset(&runtime_stopped_sem);
	k_msgq_purge(&runtime_event_queue);
	runtime_state = SPAGHETTI_RUNTIME_STOPPED;
	k_mutex_unlock(&runtime_lock);

	(void)k_work_reschedule(&runtime_health_keepalive,
		K_MSEC(CONFIG_SPAGHETTI_HEALTH_KEEPALIVE_MS));
	LOG_INF("ready: boot_id=%llu", (unsigned long long)runtime_boot_id);
	return 0;
}

int spaghetti_runtime_configure(
	const struct spaghetti_runtime_schedule_config *schedules,
	size_t schedule_count,
	const struct spaghetti_rule_config *rules,
	size_t count)
{
	struct spaghetti_runtime_rule_slot pending_rules[SPAGHETTI_CONFIG_MAX_RULES];
	struct spaghetti_runtime_job pending_jobs[SPAGHETTI_CONFIG_MAX_SCHEDULES];
	int err;

	err = validate_schedules(schedules, schedule_count);
	if (err < 0) {
		return err;
	}

	err = k_mutex_lock(&runtime_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (runtime_state == SPAGHETTI_RUNTIME_UNINITIALIZED) {
		err = -EACCES;
		goto unlock;
	}
	if (runtime_state != SPAGHETTI_RUNTIME_STOPPED) {
		err = -EBUSY;
		goto unlock;
	}

	err = init_rules_copy(rules, count, pending_rules);
	if (err < 0) {
		goto unlock;
	}

	memset(pending_jobs, 0, sizeof(pending_jobs));
	for (size_t idx = 0U; idx < schedule_count; ++idx) {
		pending_jobs[idx].enabled = schedules[idx].enabled;
		pending_jobs[idx].source_key = schedules[idx].source_key;
		pending_jobs[idx].period_ms = schedules[idx].period_ms;
		pending_jobs[idx].sequence = 0U;
	}

	deinit_rules(rule_slots, rule_count);
	memcpy(rule_slots, pending_rules, sizeof(rule_slots));
	rule_count = count;
	memcpy(jobs, pending_jobs, sizeof(jobs));
	job_count = schedule_count;
	spaghetti_resources_note_used(SPAGHETTI_RESOURCE_OWNER_RULES,
				      (uint16_t)MIN(rule_count, UINT16_MAX));
	err = 0;

unlock:
	k_mutex_unlock(&runtime_lock);
	return err;
}

static int stop_armed_events_locked(void)
{
	int first_error = 0;

	for (size_t idx = 0U; idx < job_count; ++idx) {
		int err;

		if (!jobs[idx].events_armed) {
			continue;
		}

		err = spaghetti_module_manager_stop_events(jobs[idx].source_id);
		jobs[idx].events_armed = false;
		if ((err < 0) && (err != -EALREADY) && (first_error == 0)) {
			first_error = err;
		}
	}

	return first_error;
}

int spaghetti_runtime_start(void)
{
	const int64_t now_ms = k_uptime_get();
	int err = k_mutex_lock(&runtime_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (runtime_state == SPAGHETTI_RUNTIME_UNINITIALIZED) {
		err = -EACCES;
		goto unlock;
	}
	if (runtime_state == SPAGHETTI_RUNTIME_RUNNING) {
		err = -EALREADY;
		goto unlock;
	}
	if (runtime_state == SPAGHETTI_RUNTIME_STOPPING) {
		err = -EBUSY;
		goto unlock;
	}
	if ((job_count == 0U) && (rule_count == 0U)) {
		err = -ENOENT;
		goto unlock;
	}

	for (size_t idx = 0U; idx < job_count; ++idx) {
		struct spaghetti_module_snapshot source;

		err = spaghetti_module_manager_get_by_key(jobs[idx].source_key,
							  &source);
		if ((err < 0) || (source.state != SPAGHETTI_MODULE_READY)) {
			err = -ENOENT;
			goto unlock;
		}

		jobs[idx].source_id = source.id;
		jobs[idx].next_deadline_ms = now_ms;
		jobs[idx].sequence = 0U;
		jobs[idx].events_armed = false;
	}

	k_msgq_purge(&runtime_event_queue);
	k_sem_reset(&runtime_wake_sem);
	k_sem_reset(&runtime_stopped_sem);
	action_errors = 0U;

	for (size_t idx = 0U; idx < job_count; ++idx) {
		err = spaghetti_module_manager_start_events(
			jobs[idx].source_id, runtime_event_emit, &jobs[idx]);
		if (err == -ENOTSUP) {
			err = 0;
			continue;
		}
		if (err < 0) {
			(void)stop_armed_events_locked();
			goto unlock;
		}
		jobs[idx].events_armed = true;
	}

	runtime_state = SPAGHETTI_RUNTIME_RUNNING;
	k_sem_give(&runtime_wake_sem);
	err = 0;

unlock:
	k_mutex_unlock(&runtime_lock);
	return err;
}

int spaghetti_runtime_stop(k_timeout_t timeout)
{
	int err = k_mutex_lock(&runtime_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (runtime_state == SPAGHETTI_RUNTIME_UNINITIALIZED) {
		err = -EACCES;
		goto unlock;
	}
	if (runtime_state == SPAGHETTI_RUNTIME_STOPPED) {
		err = -EALREADY;
		goto unlock;
	}
	if (runtime_state == SPAGHETTI_RUNTIME_STOPPING) {
		err = -EBUSY;
		goto unlock;
	}

	runtime_state = SPAGHETTI_RUNTIME_STOPPING;
	(void)stop_armed_events_locked();
	k_msgq_purge(&runtime_event_queue);
	k_sem_reset(&runtime_stopped_sem);
	finish_stop_if_quiescent();
	k_sem_give(&runtime_wake_sem);
	k_mutex_unlock(&runtime_lock);

	err = k_sem_take(&runtime_stopped_sem, timeout);
	return (err < 0) ? -ETIMEDOUT : 0;

unlock:
	k_mutex_unlock(&runtime_lock);
	return err;
}
