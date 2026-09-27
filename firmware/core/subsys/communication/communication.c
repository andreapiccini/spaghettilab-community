#include <spaghetti/communication.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/iterable_sections.h>
#include <zephyr/sys/util.h>

#include <spaghetti/access_control.h>
#include <spaghetti/ble.h>
#include <spaghetti/health.h>
#include <spaghetti/protocol.h>

#include "communication_internal.h"

LOG_MODULE_REGISTER(spaghetti_communication,
		    CONFIG_SPAGHETTI_COMMUNICATION_LOG_LEVEL);

BUILD_ASSERT(SPAGHETTI_PROTOCOL_PAYLOAD_MAX <=
	     SPAGHETTI_PROTOCOL_PAYLOAD_ABSOLUTE_MAX);

SPAGHETTI_HEALTH_COMPONENT_DEFINE(communication_health) = {
	.id = SPAGHETTI_HEALTH_ID_COMMUNICATION,
	.name = "communication",
	.maximum_silence_ms = 3000U,
	.required_core_modes = BIT(SPAGHETTI_CORE_MODE_UNPROVISIONED) |
		BIT(SPAGHETTI_CORE_MODE_NORMAL) |
		BIT(SPAGHETTI_CORE_MODE_MAINTENANCE),
};

enum spaghetti_job_state {
	SPAGHETTI_JOB_FREE = 0,
	SPAGHETTI_JOB_PENDING,
	SPAGHETTI_JOB_RUNNING,
	SPAGHETTI_JOB_COMPLETED,
	SPAGHETTI_JOB_FAILED,
	SPAGHETTI_JOB_CANCELLED,
	SPAGHETTI_JOB_EXPIRED,
};

struct spaghetti_replay_entry {
	bool used;
	spaghetti_principal_id_t principal_id;
	uint32_t correlation_id;
	enum spaghetti_protocol_operation operation;
	uint8_t request_hash[32];
	struct spaghetti_protocol_response response;
	int64_t expires_at_ms;
};

struct spaghetti_mutation_slot {
	bool used;
	struct spaghetti_request_context context;
	const struct spaghetti_operation_handler *handler;
	struct spaghetti_protocol_payload request;
	struct spaghetti_protocol_response response;
	int execute_err;
	struct k_sem done;
};

struct spaghetti_job_slot {
	enum spaghetti_job_state state;
	uint32_t job_id;
	spaghetti_principal_id_t owner;
	enum spaghetti_protocol_operation operation;
	enum spaghetti_protocol_status protocol_status;
	uint8_t progress;
	int64_t deadline_ms;
	const struct spaghetti_operation_handler *handler;
	struct spaghetti_request_context context;
	struct spaghetti_protocol_payload request;
	struct spaghetti_protocol_payload result;
};

static void communication_health_keepalive_handler(struct k_work *work);
static void mutation_worker(void *p1, void *p2, void *p3);
static void job_worker(void *p1, void *p2, void *p3);

K_WORK_DELAYABLE_DEFINE(communication_health_keepalive,
			communication_health_keepalive_handler);

static atomic_t is_initialized;
K_MUTEX_DEFINE(communication_lock);

static struct spaghetti_replay_entry
	replay_cache[CONFIG_SPAGHETTI_MAX_INFLIGHT_REQUESTS];
static size_t replay_next_victim;

static struct spaghetti_mutation_slot
	mutation_slots[CONFIG_SPAGHETTI_MAX_INFLIGHT_REQUESTS];
K_MSGQ_DEFINE(mutation_queue, sizeof(struct spaghetti_mutation_slot *),
	      CONFIG_SPAGHETTI_MAX_INFLIGHT_REQUESTS, 4);

static struct spaghetti_job_slot job_slots[CONFIG_SPAGHETTI_MAX_INFLIGHT_REQUESTS];
K_MSGQ_DEFINE(job_queue, sizeof(struct spaghetti_job_slot *),
	      CONFIG_SPAGHETTI_MAX_INFLIGHT_REQUESTS, 4);
static atomic_t next_job_id;
static atomic_t event_sequence;

#define SPAGHETTI_COMM_WORKER_STACK 4096
K_THREAD_STACK_DEFINE(mutation_stack, SPAGHETTI_COMM_WORKER_STACK);
K_THREAD_STACK_DEFINE(job_stack, SPAGHETTI_COMM_WORKER_STACK);
static struct k_thread mutation_thread;
static struct k_thread job_thread;

static const uint32_t sensitive_ops_mask[] = {
	SPAGHETTI_PROTOCOL_APPLY_CONFIG,
	SPAGHETTI_PROTOCOL_ACCEPT_DISCOVERY,
	SPAGHETTI_PROTOCOL_MODULE_COMMAND,
	SPAGHETTI_PROTOCOL_ACQUIRE_CONNECTIVITY_LEASE,
	SPAGHETTI_PROTOCOL_RELEASE_CONNECTIVITY_LEASE,
	SPAGHETTI_PROTOCOL_OPEN_NETWORK_MAINTENANCE,
	SPAGHETTI_PROTOCOL_OPEN_WIFI_UPDATE,
	SPAGHETTI_PROTOCOL_OPEN_BLE_UPDATE,
	SPAGHETTI_PROTOCOL_WRITE_BLE_UPDATE,
	SPAGHETTI_PROTOCOL_FINISH_BLE_UPDATE,
	SPAGHETTI_PROTOCOL_CANCEL_BLE_UPDATE,
	SPAGHETTI_PROTOCOL_FACTORY_RESET,
	SPAGHETTI_PROTOCOL_INSTALL_DEVICE_PROFILE,
	SPAGHETTI_PROTOCOL_REMOVE_DEVICE_PROFILE,
};

static void communication_health_keepalive_handler(struct k_work *work)
{
	ARG_UNUSED(work);
	(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_COMMUNICATION);
	(void)k_work_reschedule(&communication_health_keepalive,
		K_MSEC(CONFIG_SPAGHETTI_HEALTH_KEEPALIVE_MS));
}

static bool operation_is_sensitive(enum spaghetti_protocol_operation operation)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(sensitive_ops_mask); ++idx) {
		if (sensitive_ops_mask[idx] == (uint32_t)operation) {
			return true;
		}
	}
	return false;
}

static int validate_handlers(void)
{
	STRUCT_SECTION_FOREACH(spaghetti_operation_handler, handler) {
		STRUCT_SECTION_FOREACH(spaghetti_operation_handler, other) {
			if ((handler != other) &&
			    (handler->operation == other->operation)) {
				LOG_ERR("duplicate handler for op %u",
					(unsigned int)handler->operation);
				return -EEXIST;
			}
		}
		if (handler->execute == NULL) {
			return -EINVAL;
		}
	}
	return 0;
}

static const struct spaghetti_operation_handler *find_handler(
	enum spaghetti_protocol_operation operation)
{
	STRUCT_SECTION_FOREACH(spaghetti_operation_handler, handler) {
		if (handler->operation == operation) {
			return handler;
		}
	}
	return NULL;
}

static void purge_expired_replay(int64_t now_ms)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(replay_cache); ++idx) {
		if (replay_cache[idx].used &&
		    (replay_cache[idx].expires_at_ms <= now_ms)) {
			replay_cache[idx].used = false;
		}
	}
}

static int replay_lookup(
	spaghetti_principal_id_t principal_id,
	uint32_t correlation_id,
	enum spaghetti_protocol_operation operation,
	const uint8_t request_hash[32],
	struct spaghetti_protocol_response *out_response,
	bool *found)
{
	const int64_t now_ms = k_uptime_get();

	*found = false;
	purge_expired_replay(now_ms);
	for (size_t idx = 0U; idx < ARRAY_SIZE(replay_cache); ++idx) {
		struct spaghetti_replay_entry *entry = &replay_cache[idx];

		if (!entry->used ||
		    (entry->principal_id != principal_id) ||
		    (entry->correlation_id != correlation_id)) {
			continue;
		}
		if ((entry->operation != operation) ||
		    (memcmp(entry->request_hash, request_hash, 32U) != 0)) {
			return -ESTALE;
		}
		*out_response = entry->response;
		*found = true;
		return 0;
	}
	return 0;
}

static void replay_store(
	spaghetti_principal_id_t principal_id,
	uint32_t correlation_id,
	enum spaghetti_protocol_operation operation,
	const uint8_t request_hash[32],
	const struct spaghetti_protocol_response *response)
{
	struct spaghetti_replay_entry *slot = NULL;
	const int64_t now_ms = k_uptime_get();

	purge_expired_replay(now_ms);
	for (size_t idx = 0U; idx < ARRAY_SIZE(replay_cache); ++idx) {
		if (!replay_cache[idx].used) {
			slot = &replay_cache[idx];
			break;
		}
	}
	if (slot == NULL) {
		slot = &replay_cache[replay_next_victim];
		replay_next_victim =
			(replay_next_victim + 1U) % ARRAY_SIZE(replay_cache);
	}

	slot->used = true;
	slot->principal_id = principal_id;
	slot->correlation_id = correlation_id;
	slot->operation = operation;
	memcpy(slot->request_hash, request_hash, 32U);
	slot->response = *response;
	slot->expires_at_ms =
		now_ms + (int64_t)CONFIG_SPAGHETTI_PROTOCOL_REPLAY_WINDOW_MS;
}

static void hash_request(
	const struct spaghetti_protocol_request *request,
	uint8_t out_hash[32])
{
	uint8_t encoded[SPAGHETTI_PROTOCOL_PAYLOAD_ABSOLUTE_MAX + 64U];
	size_t written = 0U;
	int err = spaghetti_protocol_encode_request(
		request, encoded, sizeof(encoded), &written);

	if (err < 0) {
		memset(out_hash, 0, 32U);
		spaghetti_ops_sha256(request->payload.bytes,
				     request->payload.size, out_hash);
		return;
	}
	spaghetti_ops_sha256(encoded, written, out_hash);
}

static int authorize_request(
	const struct spaghetti_request_context *context,
	const struct spaghetti_operation_handler *handler)
{
	int err;

	if (context->principal_id == 0U) {
		return -EINVAL;
	}
	if ((context->permissions & handler->required_permissions) !=
	    handler->required_permissions) {
		return -EACCES;
	}
	err = spaghetti_principal_authorize(
		context->principal_id, handler->required_permissions);
	if (err < 0) {
		return err;
	}
	return 0;
}

static void fill_error_response(
	struct spaghetti_protocol_response *response,
	uint32_t correlation_id,
	int error)
{
	response->version = SPAGHETTI_PROTOCOL_VERSION;
	response->correlation_id = correlation_id;
	response->status = spaghetti_protocol_status_from_errno(error);
	response->payload.size = 0U;
}

static int execute_handler(
	const struct spaghetti_operation_handler *handler,
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_payload *request,
	struct spaghetti_protocol_payload *response)
{
	response->size = 0U;
	return handler->execute(context, request, response);
}

static struct spaghetti_mutation_slot *mutation_acquire(void)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(mutation_slots); ++idx) {
		if (!mutation_slots[idx].used) {
			mutation_slots[idx].used = true;
			k_sem_init(&mutation_slots[idx].done, 0, 1);
			return &mutation_slots[idx];
		}
	}
	return NULL;
}

static void mutation_release(struct spaghetti_mutation_slot *slot)
{
	slot->used = false;
}

static void mutation_worker(void *p1, void *p2, void *p3)
{
	ARG_UNUSED(p1);
	ARG_UNUSED(p2);
	ARG_UNUSED(p3);

	for (;;) {
		struct spaghetti_mutation_slot *slot = NULL;

		if (k_msgq_get(&mutation_queue, &slot, K_FOREVER) != 0) {
			continue;
		}
		slot->response.payload.size = 0U;
		slot->execute_err = execute_handler(
			slot->handler, &slot->context, &slot->request,
			&slot->response.payload);
		k_sem_give(&slot->done);
	}
}

static int run_serialized_mutation(
	const struct spaghetti_operation_handler *handler,
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_request *request,
	struct spaghetti_protocol_response *response)
{
	struct spaghetti_mutation_slot *slot;
	int err;

	k_mutex_lock(&communication_lock, K_FOREVER);
	slot = mutation_acquire();
	if (slot == NULL) {
		k_mutex_unlock(&communication_lock);
		return -ENOSPC;
	}
	slot->context = *context;
	slot->handler = handler;
	slot->request = request->payload;
	slot->response.version = SPAGHETTI_PROTOCOL_VERSION;
	slot->response.correlation_id = request->correlation_id;
	slot->response.status = SPAGHETTI_PROTOCOL_STATUS_OK;
	slot->execute_err = 0;
	k_mutex_unlock(&communication_lock);

	err = k_msgq_put(&mutation_queue, &slot, K_NO_WAIT);
	if (err < 0) {
		k_mutex_lock(&communication_lock, K_FOREVER);
		mutation_release(slot);
		k_mutex_unlock(&communication_lock);
		return -ENOSPC;
	}

	(void)k_sem_take(&slot->done, K_FOREVER);
	if (slot->execute_err < 0) {
		fill_error_response(response, request->correlation_id,
				    slot->execute_err);
		err = slot->execute_err;
	} else {
		*response = slot->response;
		response->status = SPAGHETTI_PROTOCOL_STATUS_OK;
		err = 0;
	}

	k_mutex_lock(&communication_lock, K_FOREVER);
	mutation_release(slot);
	k_mutex_unlock(&communication_lock);
	return err;
}

static struct spaghetti_job_slot *job_acquire(void)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(job_slots); ++idx) {
		if (job_slots[idx].state == SPAGHETTI_JOB_FREE) {
			return &job_slots[idx];
		}
	}
	return NULL;
}

static void job_worker(void *p1, void *p2, void *p3)
{
	ARG_UNUSED(p1);
	ARG_UNUSED(p2);
	ARG_UNUSED(p3);

	for (;;) {
		struct spaghetti_job_slot *slot = NULL;
		int err;

		if (k_msgq_get(&job_queue, &slot, K_FOREVER) != 0) {
			continue;
		}
		if (k_uptime_get() > slot->deadline_ms) {
			slot->state = SPAGHETTI_JOB_EXPIRED;
			slot->protocol_status = SPAGHETTI_PROTOCOL_STATUS_TIMEOUT;
			slot->progress = 100U;
			continue;
		}
		slot->state = SPAGHETTI_JOB_RUNNING;
		slot->progress = 1U;
		slot->result.size = 0U;
		err = execute_handler(slot->handler, &slot->context,
				      &slot->request, &slot->result);
		if (err < 0) {
			slot->state = SPAGHETTI_JOB_FAILED;
			slot->protocol_status =
				spaghetti_protocol_status_from_errno(err);
		} else {
			slot->state = SPAGHETTI_JOB_COMPLETED;
			slot->protocol_status = SPAGHETTI_PROTOCOL_STATUS_OK;
		}
		slot->progress = 100U;
	}
}

static int run_async_job(
	const struct spaghetti_operation_handler *handler,
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_request *request,
	struct spaghetti_protocol_response *response)
{
	struct spaghetti_job_slot *slot;
	uint32_t keys[1];
	uint32_t values[1];
	int err;

	k_mutex_lock(&communication_lock, K_FOREVER);
	slot = job_acquire();
	if (slot == NULL) {
		k_mutex_unlock(&communication_lock);
		return -ENOSPC;
	}
	slot->state = SPAGHETTI_JOB_PENDING;
	slot->job_id = (uint32_t)atomic_inc(&next_job_id) + 1U;
	if (slot->job_id == 0U) {
		slot->job_id = (uint32_t)atomic_inc(&next_job_id) + 1U;
	}
	slot->owner = context->principal_id;
	slot->operation = request->operation;
	slot->protocol_status = SPAGHETTI_PROTOCOL_STATUS_OK;
	slot->progress = 0U;
	slot->deadline_ms = k_uptime_get() +
		(int64_t)CONFIG_SPAGHETTI_PROTOCOL_REPLAY_WINDOW_MS;
	slot->handler = handler;
	slot->context = *context;
	slot->request = request->payload;
	slot->result.size = 0U;
	k_mutex_unlock(&communication_lock);

	err = k_msgq_put(&job_queue, &slot, K_NO_WAIT);
	if (err < 0) {
		k_mutex_lock(&communication_lock, K_FOREVER);
		slot->state = SPAGHETTI_JOB_FREE;
		k_mutex_unlock(&communication_lock);
		return -ENOSPC;
	}

	keys[0] = 0U;
	values[0] = slot->job_id;
	response->version = SPAGHETTI_PROTOCOL_VERSION;
	response->correlation_id = request->correlation_id;
	response->status = SPAGHETTI_PROTOCOL_STATUS_OK;
	return spaghetti_ops_encode_u32_map(&response->payload, keys, values, 1U);
}

int spaghetti_communication_job_get_status(
	const struct spaghetti_request_context *context,
	uint32_t job_id,
	struct spaghetti_protocol_payload *response)
{
	ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, response->bytes,
		       sizeof(response->bytes), 1U);
	const struct spaghetti_job_slot *slot = NULL;

	if ((context == NULL) || (response == NULL) || (job_id == 0U)) {
		return -EINVAL;
	}

	k_mutex_lock(&communication_lock, K_FOREVER);
	for (size_t idx = 0U; idx < ARRAY_SIZE(job_slots); ++idx) {
		if ((job_slots[idx].state != SPAGHETTI_JOB_FREE) &&
		    (job_slots[idx].job_id == job_id)) {
			slot = &job_slots[idx];
			break;
		}
	}
	if (slot == NULL) {
		k_mutex_unlock(&communication_lock);
		return -ENOENT;
	}
	if ((slot->owner != context->principal_id) &&
	    ((context->permissions & SPAGHETTI_PERMISSION_PROVISION) == 0U)) {
		k_mutex_unlock(&communication_lock);
		return -EACCES;
	}
	if ((slot->state == SPAGHETTI_JOB_PENDING) ||
	    (slot->state == SPAGHETTI_JOB_RUNNING)) {
		if (k_uptime_get() > slot->deadline_ms) {
			((struct spaghetti_job_slot *)slot)->state =
				SPAGHETTI_JOB_EXPIRED;
			((struct spaghetti_job_slot *)slot)->protocol_status =
				SPAGHETTI_PROTOCOL_STATUS_TIMEOUT;
			((struct spaghetti_job_slot *)slot)->progress = 100U;
		}
	}

	if (!zcbor_map_start_encode(state, 5U) ||
	    !zcbor_uint32_put(state, 0U) ||
	    !zcbor_uint32_put(state, slot->job_id) ||
	    !zcbor_uint32_put(state, 1U) ||
	    !zcbor_uint32_put(state, (uint32_t)slot->state) ||
	    !zcbor_uint32_put(state, 2U) ||
	    !zcbor_uint32_put(state, slot->progress) ||
	    !zcbor_uint32_put(state, 3U) ||
	    !zcbor_uint32_put(state, (uint32_t)slot->protocol_status) ||
	    !zcbor_uint32_put(state, 4U) ||
	    !zcbor_uint32_put(state, (uint32_t)slot->operation) ||
	    !zcbor_map_end_encode(state, 5U)) {
		k_mutex_unlock(&communication_lock);
		return -EMSGSIZE;
	}
	response->size = (size_t)(state->payload - response->bytes);
	k_mutex_unlock(&communication_lock);
	return 0;
}

int spaghetti_communication_init(void)
{
	int err = k_mutex_lock(&communication_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (atomic_get(&is_initialized) != 0) {
		k_mutex_unlock(&communication_lock);
		return -EALREADY;
	}

	err = validate_handlers();
	if (err < 0) {
		k_mutex_unlock(&communication_lock);
		return err;
	}

	memset(replay_cache, 0, sizeof(replay_cache));
	memset(mutation_slots, 0, sizeof(mutation_slots));
	memset(job_slots, 0, sizeof(job_slots));
	atomic_set(&next_job_id, 0);
	atomic_set(&event_sequence, 1);

	k_thread_create(&mutation_thread, mutation_stack,
			K_THREAD_STACK_SIZEOF(mutation_stack), mutation_worker,
			NULL, NULL, NULL, K_PRIO_PREEMPT(8), 0, K_NO_WAIT);
	k_thread_name_set(&mutation_thread, "spaghetti_mut");
	k_thread_create(&job_thread, job_stack,
			K_THREAD_STACK_SIZEOF(job_stack), job_worker, NULL,
			NULL, NULL, K_PRIO_PREEMPT(8), 0, K_NO_WAIT);
	k_thread_name_set(&job_thread, "spaghetti_job");

	err = spaghetti_communication_shell_init();
	if (err == 0) {
		const int usb_err = spaghetti_usb_protocol_init();

		if (usb_err < 0) {
			LOG_WRN("USB Protocol adapter skipped: %d", usb_err);
		}
		atomic_set(&is_initialized, 1);
	}
	k_mutex_unlock(&communication_lock);
	if (err < 0) {
		return err;
	}

	(void)k_work_reschedule(&communication_health_keepalive,
		K_MSEC(CONFIG_SPAGHETTI_HEALTH_KEEPALIVE_MS));
	LOG_INF("ready");
	return 0;
}

int spaghetti_communication_handle_request(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_request *request,
	struct spaghetti_protocol_response *response)
{
	const struct spaghetti_operation_handler *handler;
	struct spaghetti_protocol_response result = {0};
	uint8_t request_hash[32];
	bool replay_hit = false;
	int err;

	if ((context == NULL) || (request == NULL) || (response == NULL)) {
		return -EINVAL;
	}
	if (atomic_get(&is_initialized) == 0) {
		return -EACCES;
	}
	if (request->version != SPAGHETTI_PROTOCOL_VERSION) {
		return -ENOTSUP;
	}
	if (request->correlation_id == 0U) {
		return -EINVAL;
	}
	if (request->payload.size > SPAGHETTI_PROTOCOL_PAYLOAD_MAX) {
		return -EMSGSIZE;
	}

	handler = find_handler(request->operation);
	if (handler == NULL) {
		return -ENOTSUP;
	}

	hash_request(request, request_hash);
	k_mutex_lock(&communication_lock, K_FOREVER);
	err = replay_lookup(context->principal_id, request->correlation_id,
			    request->operation, request_hash, &result,
			    &replay_hit);
	k_mutex_unlock(&communication_lock);
	if (err < 0) {
		fill_error_response(&result, request->correlation_id, err);
		*response = result;
		(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_COMMUNICATION);
		return 0;
	}
	if (replay_hit) {
		*response = result;
		(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_COMMUNICATION);
		return 0;
	}

	err = authorize_request(context, handler);
	if (err < 0) {
		fill_error_response(&result, request->correlation_id, err);
		if (operation_is_sensitive(request->operation)) {
			(void)spaghetti_audit_record(context->principal_id,
				(uint16_t)request->operation, err);
		}
		*response = result;
		(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_COMMUNICATION);
		return 0;
	}

	switch (handler->execution) {
	case SPAGHETTI_OPERATION_IMMEDIATE_READ:
		result.version = SPAGHETTI_PROTOCOL_VERSION;
		result.correlation_id = request->correlation_id;
		err = execute_handler(handler, context, &request->payload,
				      &result.payload);
		if (err < 0) {
			fill_error_response(&result, request->correlation_id, err);
		} else {
			result.status = SPAGHETTI_PROTOCOL_STATUS_OK;
		}
		break;
	case SPAGHETTI_OPERATION_SERIALIZED_MUTATION:
		err = run_serialized_mutation(handler, context, request, &result);
		break;
	case SPAGHETTI_OPERATION_ASYNC_JOB:
		err = run_async_job(handler, context, request, &result);
		if (err < 0) {
			fill_error_response(&result, request->correlation_id, err);
		}
		break;
	default:
		return -ENOTSUP;
	}

	if (operation_is_sensitive(request->operation)) {
		(void)spaghetti_audit_record(context->principal_id,
			(uint16_t)request->operation,
			(result.status == SPAGHETTI_PROTOCOL_STATUS_OK) ? 0 :
				-(int)result.status);
	}

	k_mutex_lock(&communication_lock, K_FOREVER);
	replay_store(context->principal_id, request->correlation_id,
		     request->operation, request_hash, &result);
	k_mutex_unlock(&communication_lock);

	*response = result;
	(void)spaghetti_health_heartbeat(SPAGHETTI_HEALTH_ID_COMMUNICATION);
	return 0;
}

void spaghetti_communication_invalidate_sessions(void)
{
	/*
	 * Transport adapters own live sockets/console clients. Protocol V1
	 * registers no durable session table yet; revoke hooks remain safe.
	 */
}

int spaghetti_communication_emit_discovery(
	uint32_t candidate_id,
	uint8_t port_id,
	uint32_t generation)
{
	struct spaghetti_protocol_payload body;
	uint8_t envelope[SPAGHETTI_PROTOCOL_PAYLOAD_MAX + 64U];
	size_t written = 0U;
	uint32_t sequence;
	int err;

	if (atomic_get(&is_initialized) == 0) {
		return -EACCES;
	}

	err = spaghetti_protocol_encode_discovery_event_payload(
		candidate_id, port_id, generation, &body);
	if (err < 0) {
		return err;
	}

	sequence = (uint32_t)atomic_inc(&event_sequence);
	if (sequence == 0U) {
		sequence = (uint32_t)atomic_inc(&event_sequence);
	}

	err = spaghetti_protocol_encode_event(
		SPAGHETTI_PROTOCOL_EVENT_DISCOVERY, sequence, &body, envelope,
		sizeof(envelope), &written);
	if (err < 0) {
		return err;
	}

	return spaghetti_usb_protocol_send_event(envelope, written);
}

void spaghetti_communication_invalidate_principal(
	spaghetti_principal_id_t principal_id)
{
	if (principal_id == 0U) {
		return;
	}

	k_mutex_lock(&communication_lock, K_FOREVER);
	for (size_t idx = 0U; idx < ARRAY_SIZE(replay_cache); ++idx) {
		if (replay_cache[idx].used &&
		    (replay_cache[idx].principal_id == principal_id)) {
			replay_cache[idx].used = false;
		}
	}
	k_mutex_unlock(&communication_lock);
	spaghetti_ble_close_peers_for_principal(principal_id);
}
