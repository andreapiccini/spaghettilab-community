#include "can_rpc.h"
#include <spaghetti/can_link.h>
#include <spaghetti/communication.h>
#include <spaghetti/core.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/module_driver.h>
#include <string.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/crc.h>
#include <zephyr/ztest.h>
extern const struct spaghetti_module_driver spaghetti_can_link_driver;
static uint8_t frames[256][8], lengths[256];
static size_t frame_count;
static uint32_t current_node = 0x111111;
static unsigned dispatches, emissions;
static bool auto_reply;
static uint8_t outgoing[768];
static size_t outgoing_size;
static void simulated_reply(uint8_t tag);
static struct spaghetti_value received;
uint32_t spaghetti_field_update_local_node_id(void)
{
	return current_node;
}
void spaghetti_field_update_service_wake(void)
{
}
int spaghetti_field_update_can_ctrl(uint32_t node, uint8_t cmd, const uint8_t *data, size_t length)
{
	zassert_equal(node, 0x222222);
	zassert_true(frame_count < 256);
	zassert_true(length <= 7);
	frames[frame_count][0] = cmd;
	memcpy(frames[frame_count] + 1, data, length);
	lengths[frame_count] = length + 1;
	frame_count++;
	if (auto_reply && cmd == SPAGHETTI_CAN_RPC_REQUEST) {
		size_t offset = sys_get_le16(data + 1), count = length - 3;
		if (offset == 0) {
			outgoing_size = 0;
		}
		zassert_equal(offset, outgoing_size);
		memcpy(outgoing + offset, data + 3, count);
		outgoing_size += count;
		if (outgoing_size >= 9 && outgoing_size == sys_get_le16(outgoing) + 9U) {
			simulated_reply(data[0]);
		}
	}
	return 0;
}
int spaghetti_field_update_can_reply(uint32_t node, const uint8_t *data, size_t length)
{
	zassert_equal(node, current_node);
	zassert_true(frame_count < 256);
	memcpy(frames[frame_count], data, length);
	lengths[frame_count++] = length;
	return 0;
}
int spaghetti_core_get_info(struct spaghetti_core_info *out)
{
	memset(out, 0, sizeof(*out));
	out->mode = SPAGHETTI_CORE_MODE_NORMAL;
	return 0;
}
int spaghetti_communication_handle_request(const struct spaghetti_request_context *context,
                                           const struct spaghetti_protocol_request *request,
                                           struct spaghetti_protocol_response *response)
{
	zassert_false(context->local);
	dispatches++;
	memset(response, 0, sizeof(*response));
	response->version = 1;
	response->correlation_id = request->correlation_id;
	response->payload.bytes[0] = 0xa0;
	response->payload.size = 1;
	return 0;
}
static void simulated_reply(uint8_t tag)
{
	struct spaghetti_protocol_request request;
	zassert_ok(spaghetti_protocol_decode_request(outgoing + 9, outgoing_size - 9, &request));
	struct spaghetti_protocol_response response = {.version = 1,
	                                               .correlation_id = request.correlation_id,
	                                               .payload = {.size = 1, .bytes = {0xa0}}};
	uint8_t wire[128];
	size_t size;
	zassert_ok(
	    spaghetti_protocol_encode_response(&response, wire + 9, sizeof(wire) - 9, &size));
	memcpy(wire + 6, outgoing + 6, 3);
	sys_put_le16(size, wire);
	sys_put_le32(crc32_ieee(wire + 6, size + 3), wire + 2);
	size += 9;
	for (size_t offset = 0; offset < size; offset += 4) {
		uint8_t frame[8] = {SPAGHETTI_CAN_RPC_RESPONSE, tag};
		sys_put_le16(offset, frame + 2);
		size_t count = MIN(4U, size - offset);
		memcpy(frame + 4, wire + offset, count);
		frame[4] ^= 0xff;
		spaghetti_can_rpc_receive(0x333333, frame, count + 4, true);
		frame[4] ^= 0xff;
		frame[1] ^= 0xff;
		spaghetti_can_rpc_receive(0x222222, frame, count + 4, true);
		frame[1] ^= 0xff;
		spaghetti_can_rpc_receive(0x222222, frame, count + 4, true);
	}
}
ZTEST(can_transport, test_rpc_addressed_exchange)
{
	struct spaghetti_protocol_request request = {.version = 1,
	                                             .correlation_id = 12345,
	                                             .operation = SPAGHETTI_PROTOCOL_GET_CONFIG,
	                                             .payload = {.size = 1, .bytes = {0xa0}}};
	uint8_t encoded[128], reply[128];
	size_t size, written;
	zassert_ok(spaghetti_protocol_encode_request(&request, encoded, sizeof(encoded), &size));
	auto_reply = true;
	frame_count = 0;
	zassert_ok(
	    spaghetti_can_rpc_exchange(0x222222, encoded, size, reply, sizeof(reply), &written));
	struct spaghetti_protocol_response response;
	zassert_ok(spaghetti_protocol_decode_response(reply, written, &response));
	zassert_equal(response.correlation_id, 12345);
	frame_count = 0;
	zassert_equal(spaghetti_can_rpc_exchange(0x222222, encoded, size, reply, 1, &written),
	              -EMSGSIZE);
	zassert_equal(
	    spaghetti_can_rpc_exchange(current_node, encoded, size, reply, sizeof(reply), &written),
	    -EINVAL);
	auto_reply = false;
}
static int emit(const struct spaghetti_record_payload *payload, void *user)
{
	ARG_UNUSED(user);
	zassert_str_equal(payload->schema_id, "flow.can");
	received = payload->values.fields[0];
	emissions++;
	return 0;
}
static struct spaghetti_property_set props(uint32_t peer)
{
	struct spaghetti_property_set p = {.field_count = 2};
	p.fields[0] = (struct spaghetti_value){
	    .field_id = 1, .type = SPAGHETTI_VALUE_UINT64, .data.unsigned_integer = peer};
	p.fields[1] = (struct spaghetti_value){
	    .field_id = 2, .type = SPAGHETTI_VALUE_UINT64, .data.unsigned_integer = 42};
	return p;
}
ZTEST(can_transport, test_registry_accepts_native_link)
{
	int err = spaghetti_driver_registry_init();
	zassert_true(err == 0 || err == -EALREADY);
}
ZTEST(can_transport, test_typed_values_and_duplicate_frames)
{
	const struct spaghetti_module_driver_ops *ops = spaghetti_can_link_driver.ops;
	struct spaghetti_module tx = {0}, rx = {0};
	struct spaghetti_property_set a = props(0x222222), b = props(0x111111);
	zassert_ok(ops->validate_config(&a));
	zassert_ok(ops->init(&tx, &a));
	zassert_ok(ops->init(&rx, &b));
	zassert_ok(ops->start(&rx, emit, NULL));
	for (unsigned type = 0; type <= SPAGHETTI_VALUE_FLOAT; type++) {
		struct spaghetti_module_command cmd = {.command_id = 1, .arguments.field_count = 1};
		struct spaghetti_value *v = &cmd.arguments.fields[0];
		v->field_id = 1;
		v->type = type;
		switch (type) {
		case SPAGHETTI_VALUE_BOOL:
			v->data.boolean = false;
			break;
		case SPAGHETTI_VALUE_INT64:
			v->data.signed_integer = -123456789012345LL;
			break;
		case SPAGHETTI_VALUE_UINT64:
			v->data.unsigned_integer = UINT64_MAX;
			break;
		case SPAGHETTI_VALUE_FLOAT:
			v->data.decimal = 28.12;
			break;
		case SPAGHETTI_VALUE_TEXT:
			v->data.text.size = 7;
			strcpy(v->data.text.text, "#204060");
			break;
		case SPAGHETTI_VALUE_BYTES:
			v->data.bytes.size = 3;
			memcpy(v->data.bytes.bytes, "abc", 3);
			break;
		}
		frame_count = 0;
		emissions = 0;
		zassert_ok(ops->command(&tx, &cmd));
		for (size_t i = 0; i < frame_count; i++) {
			spaghetti_can_link_receive(frames[i], lengths[i]);
		}
		zassert_equal(emissions, 1);
		zassert_equal(received.type, type);
		zassert_equal(received.field_id, 1);
		if (type == SPAGHETTI_VALUE_FLOAT) {
			zassert_equal(received.data.decimal, v->data.decimal);
		}
		if (type == SPAGHETTI_VALUE_INT64) {
			zassert_equal(received.data.signed_integer, v->data.signed_integer);
		}
		if (type == SPAGHETTI_VALUE_UINT64) {
			zassert_equal(received.data.unsigned_integer, UINT64_MAX);
		}
		if (type == SPAGHETTI_VALUE_TEXT) {
			zassert_str_equal(received.data.text.text, "#204060");
		}
		for (size_t i = 0; i < frame_count; i++) {
			spaghetti_can_link_receive(frames[i], lengths[i]);
		}
		zassert_equal(emissions, 1);
	}
	zassert_ok(ops->stop(&rx));
	zassert_ok(ops->deinit(&tx));
	zassert_ok(ops->deinit(&rx));
}
ZTEST(can_transport, test_missing_signal_fragment_does_not_emit)
{
	const struct spaghetti_module_driver_ops *ops = spaghetti_can_link_driver.ops;
	struct spaghetti_module tx = {0}, rx = {0};
	struct spaghetti_property_set a = props(0x222222), b = props(0x111111);
	zassert_ok(ops->init(&tx, &a));
	zassert_ok(ops->init(&rx, &b));
	zassert_ok(ops->start(&rx, emit, NULL));
	struct spaghetti_module_command cmd = {.command_id = 1, .arguments.field_count = 1};
	cmd.arguments.fields[0] = (struct spaghetti_value){
	    .field_id = 1, .type = SPAGHETTI_VALUE_UINT64, .data.unsigned_integer = 100};
	frame_count = 0;
	emissions = 0;
	zassert_ok(ops->command(&tx, &cmd));
	for (size_t i = 0; i < frame_count; i++) {
		if (i != 1) {
			spaghetti_can_link_receive(frames[i], lengths[i]);
		}
	}
	zassert_equal(emissions, 0);
	frame_count = 0;
	zassert_ok(ops->command(&tx, &cmd));
	for (size_t i = 0; i < frame_count; i++) {
		spaghetti_can_link_receive(frames[i], lengths[i]);
	}
	zassert_equal(emissions, 1);
	zassert_ok(ops->stop(&rx));
	zassert_ok(ops->deinit(&tx));
	zassert_ok(ops->deinit(&rx));
}
static size_t rpc_request(uint8_t *wire, uint32_t operation, bool corrupt)
{
	struct spaghetti_protocol_request request = {.version = 1,
	                                             .correlation_id = 123,
	                                             .operation = operation,
	                                             .payload = {.size = 1, .bytes = {0xa0}}};
	size_t size;
	zassert_ok(spaghetti_protocol_encode_request(&request, wire + 9, 128, &size));
	sys_put_le16(size, wire);
	sys_put_be24(0x222222, wire + 6);
	sys_put_le32(crc32_ieee(wire + 6, size + 3) + (corrupt ? 1 : 0), wire + 2);
	return size + 9;
}
static void feed(const uint8_t *wire, size_t size, uint8_t tag, bool missing)
{
	for (size_t off = 0; off < size; off += 4) {
		uint8_t frame[8] = {SPAGHETTI_CAN_RPC_REQUEST, tag};
		sys_put_le16(off, frame + 2);
		size_t count = MIN(4U, size - off);
		memcpy(frame + 4, wire + off, count);
		if (!missing || off != 4) {
			spaghetti_can_rpc_receive(0, frame, 4 + count, false);
		}
	}
}
ZTEST(can_transport, test_rpc_scope_and_integrity)
{
	zassert_true(spaghetti_can_rpc_operation_allowed(SPAGHETTI_PROTOCOL_APPLY_CONFIG));
	zassert_false(spaghetti_can_rpc_operation_allowed(SPAGHETTI_PROTOCOL_FACTORY_RESET));
	zassert_false(spaghetti_can_rpc_operation_allowed(SPAGHETTI_PROTOCOL_CAN_REQUEST));
	zassert_false(spaghetti_can_rpc_operation_allowed(SPAGHETTI_PROTOCOL_OPEN_WIFI_UPDATE));
	uint8_t wire[160];
	size_t size = rpc_request(wire, SPAGHETTI_PROTOCOL_GET_CONFIG, false);
	dispatches = 0;
	frame_count = 0;
	feed(wire, size, 1, false);
	spaghetti_can_rpc_service();
	zassert_equal(dispatches, 1);
	zassert_true(frame_count > 0);
	frame_count = 0;
	size = rpc_request(wire, SPAGHETTI_PROTOCOL_FACTORY_RESET, false);
	feed(wire, size, 2, false);
	spaghetti_can_rpc_service();
	zassert_equal(dispatches, 1);
	zassert_true(frame_count > 0);
	size = rpc_request(wire, SPAGHETTI_PROTOCOL_GET_CONFIG, true);
	feed(wire, size, 3, false);
	spaghetti_can_rpc_service();
	zassert_equal(dispatches, 1);
	k_sleep(K_MSEC(3100));
	size = rpc_request(wire, SPAGHETTI_PROTOCOL_GET_CONFIG, false);
	feed(wire, size, 4, true);
	spaghetti_can_rpc_service();
	zassert_equal(dispatches, 1);
	k_sleep(K_MSEC(3100));
	feed(wire, size, 5, false);
	spaghetti_can_rpc_service();
	zassert_equal(dispatches, 2);
}
ZTEST_SUITE(can_transport, NULL, NULL, NULL, NULL, NULL);
