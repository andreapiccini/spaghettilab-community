/* Bounded Protocol relay on the trusted physical CAN bus. No background polling. */
#include "can_rpc.h"
#include "field_update_internal.h"
#include <errno.h>
#include <spaghetti/communication.h>
#include <spaghetti/core.h>
#include <spaghetti/field_update.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/crc.h>

#define SPAGHETTI_CAN_RPC_MAX (SPAGHETTI_PROTOCOL_PAYLOAD_MAX + 32U)
#define SPAGHETTI_CAN_RPC_HEADER 9U
struct rpc_packet {
	uint8_t bytes[SPAGHETTI_CAN_RPC_MAX + SPAGHETTI_CAN_RPC_HEADER];
	size_t received, total;
	uint8_t tag;
};
static K_MUTEX_DEFINE(rpc_lock);
static K_MUTEX_DEFINE(rpc_send_lock);
static K_SEM_DEFINE(rpc_done, 0, 1);
static struct rpc_packet *incoming, *reply;
static bool ready;
static uint32_t expected_node;
static uint8_t next_tag;
static int64_t incoming_expires;
static void expire(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(expiry, expire);
static void expire(struct k_work *work)
{
	ARG_UNUSED(work);
	k_mutex_lock(&rpc_lock, K_FOREVER);
	if (incoming && !ready) {
		int64_t remaining = incoming_expires - k_uptime_get();
		if (remaining > 0) {
			k_work_reschedule(&expiry, K_MSEC(remaining));
		} else {
			k_free(incoming);
			incoming = NULL;
		}
	}
	k_mutex_unlock(&rpc_lock);
}
bool spaghetti_can_rpc_operation_allowed(uint32_t op)
{
	switch (op) {
	case SPAGHETTI_PROTOCOL_GET_STATUS:
	case SPAGHETTI_PROTOCOL_GET_CONFIG:
	case SPAGHETTI_PROTOCOL_VALIDATE_CONFIG:
	case SPAGHETTI_PROTOCOL_APPLY_CONFIG:
	case SPAGHETTI_PROTOCOL_MODULE_COMMAND:
	case SPAGHETTI_PROTOCOL_GET_JOB_STATUS:
	case SPAGHETTI_PROTOCOL_LIST_DEVICE_PROFILES:
	case SPAGHETTI_PROTOCOL_GET_DEVICE_PROFILE:
	case SPAGHETTI_PROTOCOL_VALIDATE_DEVICE_PROFILE:
	case SPAGHETTI_PROTOCOL_INSTALL_DEVICE_PROFILE:
	case SPAGHETTI_PROTOCOL_REMOVE_DEVICE_PROFILE:
	case SPAGHETTI_PROTOCOL_GET_CAPABILITIES:
	case SPAGHETTI_PROTOCOL_GET_RESOURCES:
		return true;
	default:
		return false;
	}
}
static int send_packet(uint32_t node, struct rpc_packet *packet, bool response)
{
	for (size_t offset = 0; offset < packet->total; offset += 4U) {
		uint8_t frame[8] = {
		    response ? SPAGHETTI_CAN_RPC_RESPONSE : SPAGHETTI_CAN_RPC_REQUEST, packet->tag};
		sys_put_le16(offset, frame + 2);
		size_t count = MIN(4U, packet->total - offset);
		memcpy(frame + 4, packet->bytes + offset, count);
		int err =
		    response
		        ? spaghetti_field_update_can_reply(spaghetti_field_update_local_node_id(),
		                                           frame, 4U + count)
		        : spaghetti_field_update_can_ctrl(node, frame[0], frame + 1, 3U + count);
		if (err < 0) {
			return err;
		}
		k_sleep(K_MSEC(1));
	}
	return 0;
}
void spaghetti_can_rpc_receive(uint32_t node, const uint8_t *frame, uint8_t dlc, bool response)
{
	if (!frame || dlc < 5U || dlc > 8U) {
		return;
	}
	size_t offset = sys_get_le16(frame + 2), count = dlc - 4U;
	k_mutex_lock(&rpc_lock, K_FOREVER);
	struct rpc_packet **slot = response ? &reply : &incoming;
	if (response && (node != expected_node || !reply || frame[1] != reply->tag)) {
		goto out;
	}
	if (!response && offset == 0U && !incoming) {
		incoming = k_calloc(1, sizeof(*incoming));
		if (incoming) {
			incoming->tag = frame[1];
		}
	}
	struct rpc_packet *p = *slot;
	if (!p || (!response && ready) || p->tag != frame[1] || offset + count > sizeof(p->bytes)) {
		goto out;
	}
	if (offset < p->received) {
		/* An identical retransmitted fragment is harmless; conflicting data is ignored. */
		goto out;
	}
	if (offset != p->received) {
		goto out;
	}
	memcpy(p->bytes + offset, frame + 4, count);
	p->received += count;
	if (p->received >= SPAGHETTI_CAN_RPC_HEADER && !p->total) {
		size_t length = sys_get_le16(p->bytes);
		if (!length || length > SPAGHETTI_CAN_RPC_MAX) {
			goto out;
		}
		p->total = length + SPAGHETTI_CAN_RPC_HEADER;
	}
	if (!response) {
		incoming_expires = k_uptime_get() + 3000;
		k_work_reschedule(&expiry, K_SECONDS(3));
	}
	if (p->total && p->received == p->total &&
	    crc32_ieee(p->bytes + 6, p->total - 6U) == sys_get_le32(p->bytes + 2)) {
		if (response) {
			if (sys_get_be24(p->bytes + 6) == spaghetti_field_update_local_node_id()) {
				k_sem_give(&rpc_done);
			}
		} else {
			uint32_t origin = sys_get_be24(p->bytes + 6);
			if (origin && origin != spaghetti_field_update_local_node_id()) {
				ready = true;
				spaghetti_field_update_service_wake();
			}
		}
	}
out:
	k_mutex_unlock(&rpc_lock);
}
int spaghetti_can_rpc_exchange(uint32_t node, const uint8_t *request, size_t length,
                               uint8_t *response, size_t capacity, size_t *written)
{
	if (!node || node > 0xffffffU || node == spaghetti_field_update_local_node_id() ||
	    !request || !response || !written || !length || length > SPAGHETTI_CAN_RPC_MAX) {
		return -EINVAL;
	}
	int err = k_mutex_lock(&rpc_send_lock, K_SECONDS(1));
	if (err < 0) {
		return -EBUSY;
	}
	struct rpc_packet *tx = k_calloc(1, sizeof(*tx));
	struct rpc_packet *rx = k_calloc(1, sizeof(*rx));
	if (!tx || !rx) {
		err = -ENOMEM;
		goto finish;
	}
	tx->tag = ++next_tag;
	tx->total = length + SPAGHETTI_CAN_RPC_HEADER;
	sys_put_le16(length, tx->bytes);
	sys_put_be24(spaghetti_field_update_local_node_id(), tx->bytes + 6);
	memcpy(tx->bytes + SPAGHETTI_CAN_RPC_HEADER, request, length);
	sys_put_le32(crc32_ieee(tx->bytes + 6, tx->total - 6U), tx->bytes + 2);
	rx->tag = tx->tag;
	k_mutex_lock(&rpc_lock, K_FOREVER);
	reply = rx;
	expected_node = node;
	k_sem_reset(&rpc_done);
	k_mutex_unlock(&rpc_lock);
	err = send_packet(node, tx, false);
	if (!err && k_sem_take(&rpc_done, K_SECONDS(3)) < 0) {
		err = -ETIMEDOUT;
	}
	k_mutex_lock(&rpc_lock, K_FOREVER);
	if (!err) {
		size_t size = rx->total - SPAGHETTI_CAN_RPC_HEADER;
		if (size > capacity) {
			err = -EMSGSIZE;
		} else {
			memcpy(response, rx->bytes + SPAGHETTI_CAN_RPC_HEADER, size);
			*written = size;
		}
	}
	reply = NULL;
	expected_node = 0;
	k_mutex_unlock(&rpc_lock);
finish:
	k_free(tx);
	k_free(rx);
	k_mutex_unlock(&rpc_send_lock);
	return err;
}
void spaghetti_can_rpc_service(void)
{
	k_mutex_lock(&rpc_lock, K_FOREVER);
	struct rpc_packet *packet = ready ? incoming : NULL;
	if (packet) {
		incoming = NULL;
		ready = false;
	}
	k_mutex_unlock(&rpc_lock);
	if (!packet) {
		return;
	}
	struct spaghetti_protocol_request *request = k_malloc(sizeof(*request));
	struct spaghetti_protocol_response *response = k_malloc(sizeof(*response));
	struct spaghetti_core_info info;
	if (!request || !response || spaghetti_core_get_info(&info) < 0 ||
	    spaghetti_protocol_decode_request(packet->bytes + SPAGHETTI_CAN_RPC_HEADER,
	                                      packet->total - SPAGHETTI_CAN_RPC_HEADER,
	                                      request) < 0) {
		goto finish;
	}
	memset(response, 0, sizeof(*response));
	response->version = request->version;
	response->correlation_id = request->correlation_id;
	response->status = SPAGHETTI_PROTOCOL_STATUS_UNAUTHORIZED;
	if (spaghetti_can_rpc_operation_allowed(request->operation)) {
		const struct spaghetti_request_context context = {
		    .principal_id = SPAGHETTI_PRINCIPAL_MAINTENANCE_ID,
		    .permissions = SPAGHETTI_PERMISSION_READ | SPAGHETTI_PERMISSION_CONFIGURE |
		                   SPAGHETTI_PERMISSION_COMMAND,
		    .local = false,
		    .core_mode = info.mode,
		};
		if (spaghetti_communication_handle_request(&context, request, response) < 0) {
			goto finish;
		}
	}
	size_t size;
	if (!spaghetti_protocol_encode_response(response, packet->bytes + SPAGHETTI_CAN_RPC_HEADER,
	                                        SPAGHETTI_CAN_RPC_MAX, &size)) {
		packet->total = size + SPAGHETTI_CAN_RPC_HEADER;
		sys_put_le16(size, packet->bytes);
		sys_put_le32(crc32_ieee(packet->bytes + 6, packet->total - 6U), packet->bytes + 2);
		(void)send_packet(0, packet, true);
	}
finish:
	k_free(request);
	k_free(response);
	k_free(packet);
}
