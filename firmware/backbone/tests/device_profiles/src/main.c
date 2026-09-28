#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>
#include <zcbor_encode.h>

#include "declarative_device.h"

#include <spaghetti/device_profile.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/schema.h>
#include <spaghetti/topology.h>

enum {
	FIELD_VALUE = 1U,
	FIELD_STATUS = 2U,
	FIELD_CRC = 3U,
	REG_DATA_BE = 0x10U,
	REG_DATA_LE = 0x20U,
	REG_STATUS = 0x30U,
	REG_MULTI = 0x40U,
	I2C_ADDR_A = 0x48U,
	I2C_ADDR_B = 0x49U,
	STATUS_READY = 0x01U,
};

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
};

struct fake_bus {
	uint8_t i2c_mem[0x80][256];
	uint8_t spi_last_tx[16];
	size_t spi_last_tx_len;
	spi_operation_t spi_last_operation;
	uint8_t spi_rx[16];
	size_t spi_rx_len;
	int32_t adc_microvolts;
	bool gpio_input;
	bool gpio_output;
	uint8_t uart_rx[32];
	size_t uart_rx_len;
	size_t uart_rx_pos;
	int i2c_error;
	uint8_t w1_last_rom[SPAGHETTI_ENDPOINT_VALUE_MAX];
	uint8_t w1_last_tx[16];
	size_t w1_last_tx_len;
	uint8_t w1_rx[16];
	size_t w1_rx_len;
};

static struct fake_bus bus;
static struct spaghetti_port fake_port = {
	.id = 0U,
	.capabilities = SPAGHETTI_PORT_CAP_I2C | SPAGHETTI_PORT_CAP_SPI |
			SPAGHETTI_PORT_CAP_UART | SPAGHETTI_PORT_CAP_DIGITAL_INPUT |
			SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT | SPAGHETTI_PORT_CAP_ADC |
			SPAGHETTI_PORT_CAP_W1,
};

static bool profile_referenced;
static const char *referenced_id;
static uint16_t referenced_version;

/* Proves ROM section registration; remaining fixtures install at runtime. */
SPAGHETTI_DEVICE_PROFILE_DEFINE(profile_i2c_be) = {
	.profile_id = "sensor-i2c-be",
	.version = 1U,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.max_total_time_ms = 1000U,
	.max_transactions = 8U,
	.max_bytes = 32U,
	.sample_ops = {
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST,
			.dst = 0U,
			.imm0 = 1U,
			.imm2 = REG_DATA_BE,
		},
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ,
			.dst = 1U,
			.src_a = 0U,
			.imm0 = 2U,
			.imm1 = 1U,
			.imm2 = 100U,
		},
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD,
			.dst = FIELD_VALUE,
			.src_a = 1U,
			.imm0 = 2U,
			.imm1 = 1U,
			.imm3 = 1U,
		},
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD,
		},
	},
	.sample_count = 4U,
	.sample_schema_id = "spaghetti.sensor-i2c-be.sample",
	.sample_schema_version = 1U,
	.sample_fields = {
		{
			.field_id = FIELD_VALUE,
			.type = SPAGHETTI_VALUE_INT64,
			.name = "value",
			.unit = "raw",
		},
	},
	.sample_field_count = 1U,
};

static struct spaghetti_device_profile_op make_op(
	uint8_t opcode,
	uint8_t dst,
	uint8_t src_a,
	uint8_t src_b,
	uint16_t imm0,
	uint16_t imm1,
	uint32_t imm2,
	uint32_t imm3)
{
	return (struct spaghetti_device_profile_op){
		.opcode = opcode,
		.dst = dst,
		.src_a = src_a,
		.src_b = src_b,
		.imm0 = imm0,
		.imm1 = imm1,
		.imm2 = imm2,
		.imm3 = imm3,
	};
}

static void bus_reset(void)
{
	memset(&bus, 0, sizeof(bus));
	bus.adc_microvolts = 1234000;
	bus.gpio_input = true;
	bus.i2c_mem[I2C_ADDR_A][REG_DATA_BE] = 0x12U;
	bus.i2c_mem[I2C_ADDR_A][REG_DATA_BE + 1U] = 0x34U;
	bus.i2c_mem[I2C_ADDR_B][REG_DATA_LE] = 0x78U;
	bus.i2c_mem[I2C_ADDR_B][REG_DATA_LE + 1U] = 0x56U;
	bus.i2c_mem[I2C_ADDR_B][REG_DATA_BE] = 0xAAU;
	bus.i2c_mem[I2C_ADDR_B][REG_DATA_BE + 1U] = 0xBBU;
	bus.i2c_mem[I2C_ADDR_A][REG_STATUS] = 0x00U;
	bus.i2c_mem[I2C_ADDR_A][REG_STATUS + 1U] = STATUS_READY;
	bus.i2c_mem[I2C_ADDR_A][REG_MULTI] = 0xABU;
	bus.i2c_mem[I2C_ADDR_A][REG_MULTI + 1U] = 0xCDU;
	bus.spi_rx[0] = 0x00U;
	bus.spi_rx[1] = 0x99U;
	bus.spi_rx_len = 2U;
	bus.w1_rx[0] = 0x12U;
	bus.w1_rx[1] = 0x34U;
	bus.w1_rx_len = 2U;
}

static bool hash_is_zero(const uint8_t *hash)
{
	static const uint8_t zero[SPAGHETTI_DEVICE_PROFILE_HASH_SIZE];

	return memcmp(hash, zero, sizeof(zero)) == 0;
}

static void fill_base(struct spaghetti_device_profile *profile,
		      const char *id,
		      enum spaghetti_port_transport transport,
		      uint32_t caps)
{
	memset(profile, 0, sizeof(*profile));
	strncpy(profile->profile_id, id, sizeof(profile->profile_id) - 1U);
	profile->version = 1U;
	profile->transport = transport;
	profile->required_capabilities = caps;
	profile->max_total_time_ms = 5000U;
	profile->max_transactions = 64U;
	profile->max_bytes = 256U;
	strncpy(profile->sample_schema_id, "spaghetti.test.sample",
		sizeof(profile->sample_schema_id) - 1U);
	profile->sample_schema_version = 1U;
	profile->sample_fields[0].field_id = FIELD_VALUE;
	profile->sample_fields[0].type = SPAGHETTI_VALUE_INT64;
	strncpy(profile->sample_fields[0].name, "value",
		sizeof(profile->sample_fields[0].name) - 1U);
	strncpy(profile->sample_fields[0].unit, "raw",
		sizeof(profile->sample_fields[0].unit) - 1U);
	profile->sample_field_count = 1U;
}

static void install_runtime_profiles(void)
{
	struct spaghetti_device_profile profile;

	fill_base(&profile, "sensor-i2c-le", SPAGHETTI_PORT_TRANSPORT_I2C,
		  SPAGHETTI_PORT_CAP_I2C);
	profile.sample_ops[0] = make_op(SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST, 0, 0, 0,
					1, 0, REG_DATA_LE, 0);
	profile.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ, 1, 0, 0, 2, 1, 100, 0);
	profile.sample_ops[2] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 1, 0, 2, 0, 0, 1);
	profile.sample_ops[3] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD, 0, 0, 0, 0, 0, 0, 0);
	profile.sample_count = 4U;
	strncpy(profile.sample_schema_id, "spaghetti.sensor-i2c-le.sample",
		sizeof(profile.sample_schema_id) - 1U);
	zassert_ok(spaghetti_device_profile_install_decoded(&profile));

	fill_base(&profile, "sensor-spi", SPAGHETTI_PORT_TRANSPORT_SPI,
		  SPAGHETTI_PORT_CAP_SPI);
	profile.sample_ops[0] = make_op(SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST, 0, 0, 0,
					2, 0, 0x00A5U, 0);
	profile.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_SPI_TRANSCEIVE, 1, 0, 0, 2, 100,
			1000000U, 0);
	profile.sample_ops[2] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 1, 0, 2, 1, 0, 1);
	profile.sample_ops[3] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD, 0, 0, 0, 0, 0, 0, 0);
	profile.sample_count = 4U;
	strncpy(profile.sample_schema_id, "spaghetti.sensor-spi.sample",
		sizeof(profile.sample_schema_id) - 1U);
	zassert_ok(spaghetti_device_profile_install_decoded(&profile));

	fill_base(&profile, "sensor-adc", SPAGHETTI_PORT_TRANSPORT_ADC,
		  SPAGHETTI_PORT_CAP_ADC);
	profile.sample_ops[0] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_ADC_READ, 0, 0, 0, 100, 0, 0, 0);
	profile.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 0, 0, 4, 1, 1, 1);
	profile.sample_ops[2] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD, 0, 0, 0, 0, 0, 0, 0);
	profile.sample_count = 3U;
	strncpy(profile.sample_schema_id, "spaghetti.sensor-adc.sample",
		sizeof(profile.sample_schema_id) - 1U);
	strncpy(profile.sample_fields[0].name, "microvolts",
		sizeof(profile.sample_fields[0].name) - 1U);
	strncpy(profile.sample_fields[0].unit, "uV",
		sizeof(profile.sample_fields[0].unit) - 1U);
	zassert_ok(spaghetti_device_profile_install_decoded(&profile));

	fill_base(&profile, "sensor-ready-crc", SPAGHETTI_PORT_TRANSPORT_I2C,
		  SPAGHETTI_PORT_CAP_I2C);
	profile.init_ops[0] = make_op(SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST, 0, 0, 0, 1, 0,
				      REG_STATUS, 0);
	profile.init_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE, 0, 0, 0, 1, 50, 0, 0);
	profile.init_count = 2U;
	profile.sample_ops[0] = make_op(SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST, 0, 0, 0, 1, 0,
					REG_STATUS, 0);
	profile.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_WAIT_FIELD_MASK, 1, 0, 0, 5, 1,
			STATUS_READY, STATUS_READY);
	profile.sample_ops[2] = make_op(SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST, 2, 0, 0, 1, 0,
					REG_MULTI, 0);
	profile.sample_ops[3] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ, 3, 2, 0, 2, 1, 100, 0);
	profile.sample_ops[4] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_CRC8, 4, 3, 0, 0, 0, 0, 0);
	profile.sample_ops[5] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 3, 0, 2, 1, 0, 1);
	profile.sample_ops[6] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_STATUS, 1, 0, 2, 1, 0, 1);
	profile.sample_ops[7] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_CRC, 4, 0, 1, 1, 0, 1);
	profile.sample_ops[8] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD, 0, 0, 0, 0, 0, 0, 0);
	profile.sample_count = 9U;
	profile.sample_fields[1].field_id = FIELD_STATUS;
	profile.sample_fields[1].type = SPAGHETTI_VALUE_UINT64;
	strncpy(profile.sample_fields[1].name, "status",
		sizeof(profile.sample_fields[1].name) - 1U);
	profile.sample_fields[2].field_id = FIELD_CRC;
	profile.sample_fields[2].type = SPAGHETTI_VALUE_UINT64;
	strncpy(profile.sample_fields[2].name, "crc8",
		sizeof(profile.sample_fields[2].name) - 1U);
	profile.sample_field_count = 3U;
	strncpy(profile.sample_schema_id, "spaghetti.ready-crc.sample",
		sizeof(profile.sample_schema_id) - 1U);
	zassert_ok(spaghetti_device_profile_install_decoded(&profile));
}

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	return (id == fake_port.id) ? &fake_port : NULL;
}

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				   uint32_t capabilities)
{
	return (port != NULL) && (capabilities != 0U) &&
	       ((port->capabilities & capabilities) == capabilities);
}

int spaghetti_port_acquire(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner,
	enum spaghetti_port_transport transport)
{
	ARG_UNUSED(transport);
	return ((port != NULL) && (owner != 0U)) ? 0 : -EINVAL;
}

int spaghetti_port_release(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner)
{
	return ((port != NULL) && (owner != 0U)) ? 0 : -EINVAL;
}

int spaghetti_port_i2c_transfer(
	const struct spaghetti_port *port,
	const struct spaghetti_port_i2c_request *request,
	k_timeout_t timeout)
{
	ARG_UNUSED(timeout);

	if ((port != &fake_port) || (request == NULL) ||
	    (request->messages == NULL) || (request->message_count == 0U) ||
	    (request->address >= ARRAY_SIZE(bus.i2c_mem))) {
		return -EINVAL;
	}
	if (bus.i2c_error < 0) {
		return bus.i2c_error;
	}

	if ((request->message_count == 1U) &&
	    ((request->messages[0].flags & I2C_MSG_READ) == 0U)) {
		return 0;
	}

	if ((request->message_count == 2U) &&
	    ((request->messages[0].flags & I2C_MSG_READ) == 0U) &&
	    ((request->messages[1].flags & I2C_MSG_READ) != 0U)) {
		uint8_t reg = request->messages[0].buf[0];

		memcpy(request->messages[1].buf,
		       &bus.i2c_mem[request->address][reg],
		       request->messages[1].len);
		return 0;
	}

	if ((request->message_count == 1U) &&
	    ((request->messages[0].flags & I2C_MSG_READ) != 0U)) {
		memset(request->messages[0].buf, 0x5AU, request->messages[0].len);
		return 0;
	}

	return -EINVAL;
}

int spaghetti_port_spi_transceive(
	const struct spaghetti_port *port,
	const struct spaghetti_port_spi_request *request,
	k_timeout_t timeout)
{
	ARG_UNUSED(timeout);

	if ((port != &fake_port) || (request == NULL) || (request->tx == NULL) ||
	    (request->rx == NULL) || (request->tx->count == 0U) ||
	    (request->rx->count == 0U)) {
		return -EINVAL;
	}

	bus.spi_last_tx_len = MIN(request->tx->buffers[0].len,
				  sizeof(bus.spi_last_tx));
	memcpy(bus.spi_last_tx, request->tx->buffers[0].buf, bus.spi_last_tx_len);
	bus.spi_last_operation = request->operation;
	memcpy(request->rx->buffers[0].buf, bus.spi_rx,
	       MIN(request->rx->buffers[0].len, bus.spi_rx_len));
	return 0;
}

int spaghetti_port_set_output(const struct spaghetti_port *port, bool high)
{
	if (port != &fake_port) {
		return -EINVAL;
	}
	bus.gpio_output = high;
	return 0;
}

int spaghetti_port_get_input(const struct spaghetti_port *port, bool *out_high)
{
	if ((port != &fake_port) || (out_high == NULL)) {
		return -EINVAL;
	}
	*out_high = bus.gpio_input;
	return 0;
}

int spaghetti_port_adc_read(
	const struct spaghetti_port *port,
	uint8_t channel,
	int32_t *out_raw,
	int32_t *out_microvolts,
	k_timeout_t timeout)
{
	ARG_UNUSED(channel);
	ARG_UNUSED(timeout);

	if (port != &fake_port) {
		return -EINVAL;
	}
	if (out_raw != NULL) {
		*out_raw = bus.adc_microvolts / 1000;
	}
	if (out_microvolts != NULL) {
		*out_microvolts = bus.adc_microvolts;
	}
	return 0;
}

int spaghetti_port_uart_write(
	const struct spaghetti_port *port,
	const uint8_t *buf,
	size_t len,
	k_timeout_t timeout)
{
	ARG_UNUSED(buf);
	ARG_UNUSED(len);
	ARG_UNUSED(timeout);
	return (port == &fake_port) ? 0 : -EINVAL;
}

int spaghetti_port_uart_read_until(
	const struct spaghetti_port *port,
	uint8_t *buf,
	size_t capacity,
	uint8_t stop_byte,
	size_t *out_len,
	k_timeout_t timeout)
{
	ARG_UNUSED(timeout);

	if ((port != &fake_port) || (buf == NULL) || (out_len == NULL)) {
		return -EINVAL;
	}
	for (size_t idx = 0U;
	     (idx < capacity) && (bus.uart_rx_pos < bus.uart_rx_len); ++idx) {
		buf[idx] = bus.uart_rx[bus.uart_rx_pos++];
		*out_len = idx + 1U;
		if (buf[idx] == stop_byte) {
			return 0;
		}
	}
	return -ETIMEDOUT;
}

int spaghetti_port_uart_read(
	const struct spaghetti_port *port,
	uint8_t *buf,
	size_t len,
	k_timeout_t timeout)
{
	ARG_UNUSED(timeout);

	if ((port != &fake_port) || (buf == NULL) || (len == 0U)) {
		return -EINVAL;
	}
	if ((bus.uart_rx_pos + len) > bus.uart_rx_len) {
		return -ETIMEDOUT;
	}
	memcpy(buf, &bus.uart_rx[bus.uart_rx_pos], len);
	bus.uart_rx_pos += len;
	return 0;
}

int spaghetti_port_w1_write_read(
	const struct spaghetti_port *port,
	const uint8_t rom[SPAGHETTI_ENDPOINT_VALUE_MAX],
	const uint8_t *write_data,
	size_t write_size,
	uint8_t *read_data,
	size_t read_size,
	k_timeout_t timeout)
{
	ARG_UNUSED(timeout);

	if ((port != &fake_port) || (rom == NULL) ||
	    ((write_size > 0U) && (write_data == NULL)) ||
	    ((read_size > 0U) && (read_data == NULL))) {
		return -EINVAL;
	}
	if (!spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_W1)) {
		return -ENOTSUP;
	}

	memcpy(bus.w1_last_rom, rom, SPAGHETTI_ENDPOINT_VALUE_MAX);
	bus.w1_last_tx_len = MIN(write_size, sizeof(bus.w1_last_tx));
	if (bus.w1_last_tx_len > 0U) {
		memcpy(bus.w1_last_tx, write_data, bus.w1_last_tx_len);
	}
	if (read_size > 0U) {
		if (read_size > bus.w1_rx_len) {
			return -EIO;
		}
		memcpy(read_data, bus.w1_rx, read_size);
	}
	return 0;
}

const struct spaghetti_flow_descriptor *spaghetti_topology_flow_for_port(
	spaghetti_port_id_t port_id)
{
	ARG_UNUSED(port_id);
	return NULL;
}

int spaghetti_topology_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_descriptor *out)
{
	ARG_UNUSED(flow_id);
	ARG_UNUSED(bay_id);
	ARG_UNUSED(out);
	return -ENOENT;
}

static bool reference_checker(const char *profile_id, uint16_t version,
			      void *user_data)
{
	ARG_UNUSED(user_data);
	return profile_referenced && (referenced_id != NULL) &&
	       (strcmp(profile_id, referenced_id) == 0) &&
	       (version == referenced_version);
}

static void make_config(
	struct spaghetti_property_set *out,
	const char *profile_id,
	uint16_t i2c_address,
	uint8_t spi_cs,
	uint8_t adc_channel)
{
	size_t id_len = strlen(profile_id);

	memset(out, 0, sizeof(*out));
	out->field_count = 2U;
	out->fields[0].field_id = SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_ID;
	out->fields[0].type = SPAGHETTI_VALUE_TEXT;
	out->fields[0].data.text.size = id_len;
	memcpy(out->fields[0].data.text.text, profile_id, id_len);
	out->fields[1].field_id = SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_VERSION;
	out->fields[1].type = SPAGHETTI_VALUE_UINT64;
	out->fields[1].data.unsigned_integer = 1U;

	if (i2c_address != 0U) {
		out->fields[out->field_count].field_id =
			SPAGHETTI_DECLARATIVE_CONFIG_I2C_ADDRESS;
		out->fields[out->field_count].type = SPAGHETTI_VALUE_UINT64;
		out->fields[out->field_count].data.unsigned_integer = i2c_address;
		out->field_count += 1U;
	}
	if (spi_cs != 0xFFU) {
		out->fields[out->field_count].field_id =
			SPAGHETTI_DECLARATIVE_CONFIG_SPI_CS;
		out->fields[out->field_count].type = SPAGHETTI_VALUE_UINT64;
		out->fields[out->field_count].data.unsigned_integer = spi_cs;
		out->field_count += 1U;
	}
	if (adc_channel != 0xFFU) {
		out->fields[out->field_count].field_id =
			SPAGHETTI_DECLARATIVE_CONFIG_ADC_CHANNEL;
		out->fields[out->field_count].type = SPAGHETTI_VALUE_UINT64;
		out->fields[out->field_count].data.unsigned_integer = adc_channel;
		out->field_count += 1U;
	}
}

static int encode_simple_cbor_opcode(
	uint8_t *out,
	size_t capacity,
	size_t *out_size,
	const char *profile_id,
	uint8_t first_sample_opcode)
{
	zcbor_state_t states[8];
	struct zcbor_string id = {
		.value = (const uint8_t *)profile_id,
		.len = strlen(profile_id),
	};
	bool ok;

	zcbor_new_state(states, ARRAY_SIZE(states), out, capacity, 1, NULL, 0);
	ok = zcbor_map_start_encode(states, 14) &&
	     zcbor_uint32_put(states, 0U) && zcbor_uint32_put(states, 1U) &&
	     zcbor_uint32_put(states, 1U) && zcbor_tstr_encode(states, &id) &&
	     zcbor_uint32_put(states, 2U) && zcbor_uint32_put(states, 1U) &&
	     zcbor_uint32_put(states, 3U) &&
	     zcbor_uint32_put(states, SPAGHETTI_PORT_TRANSPORT_I2C) &&
	     zcbor_uint32_put(states, 4U) &&
	     zcbor_uint32_put(states, SPAGHETTI_PORT_CAP_I2C) &&
	     zcbor_uint32_put(states, 5U) && zcbor_uint32_put(states, 1000U) &&
	     zcbor_uint32_put(states, 6U) && zcbor_uint32_put(states, 8U) &&
	     zcbor_uint32_put(states, 7U) && zcbor_uint32_put(states, 32U) &&
	     zcbor_uint32_put(states, 8U) && zcbor_list_start_encode(states, 0) &&
	     zcbor_list_end_encode(states, 0) &&
	     zcbor_uint32_put(states, 9U) && zcbor_list_start_encode(states, 4) &&
	     zcbor_list_start_encode(states, 8) &&
	     zcbor_uint32_put(states, first_sample_opcode) &&
	     zcbor_uint32_put(states, 0U) && zcbor_uint32_put(states, 0U) &&
	     zcbor_uint32_put(states, 0U) && zcbor_uint32_put(states, 1U) &&
	     zcbor_uint32_put(states, 0U) && zcbor_uint32_put(states, REG_DATA_BE) &&
	     zcbor_uint32_put(states, 0U) && zcbor_list_end_encode(states, 8) &&
	     zcbor_list_start_encode(states, 8) &&
	     zcbor_uint32_put(states, SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ) &&
	     zcbor_uint32_put(states, 1U) && zcbor_uint32_put(states, 0U) &&
	     zcbor_uint32_put(states, 0U) && zcbor_uint32_put(states, 2U) &&
	     zcbor_uint32_put(states, 1U) && zcbor_uint32_put(states, 100U) &&
	     zcbor_uint32_put(states, 0U) && zcbor_list_end_encode(states, 8) &&
	     zcbor_list_start_encode(states, 8) &&
	     zcbor_uint32_put(states, SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD) &&
	     zcbor_uint32_put(states, FIELD_VALUE) && zcbor_uint32_put(states, 1U) &&
	     zcbor_uint32_put(states, 0U) && zcbor_uint32_put(states, 2U) &&
	     zcbor_uint32_put(states, 1U) && zcbor_uint32_put(states, 0U) &&
	     zcbor_uint32_put(states, 1U) && zcbor_list_end_encode(states, 8) &&
	     zcbor_list_start_encode(states, 8) &&
	     zcbor_uint32_put(states, SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD) &&
	     zcbor_uint32_put(states, 0U) && zcbor_uint32_put(states, 0U) &&
	     zcbor_uint32_put(states, 0U) && zcbor_uint32_put(states, 0U) &&
	     zcbor_uint32_put(states, 0U) && zcbor_uint32_put(states, 0U) &&
	     zcbor_uint32_put(states, 0U) && zcbor_list_end_encode(states, 8) &&
	     zcbor_list_end_encode(states, 4) &&
	     zcbor_uint32_put(states, 10U) && zcbor_list_start_encode(states, 0) &&
	     zcbor_list_end_encode(states, 0) &&
	     zcbor_uint32_put(states, 11U) &&
	     zcbor_tstr_put_lit(states, "spaghetti.cbor.sample") &&
	     zcbor_uint32_put(states, 12U) && zcbor_uint32_put(states, 1U) &&
	     zcbor_uint32_put(states, 13U) && zcbor_list_start_encode(states, 1) &&
	     zcbor_list_start_encode(states, 4) &&
	     zcbor_uint32_put(states, FIELD_VALUE) &&
	     zcbor_uint32_put(states, SPAGHETTI_VALUE_INT64) &&
	     zcbor_tstr_put_lit(states, "value") &&
	     zcbor_tstr_put_lit(states, "raw") &&
	     zcbor_list_end_encode(states, 4) &&
	     zcbor_list_end_encode(states, 1) &&
	     zcbor_map_end_encode(states, 14);
	if (!ok) {
		return -EBADMSG;
	}

	*out_size = (size_t)(states[0].payload - out);
	return 0;
}

static int encode_simple_cbor(
	uint8_t *out,
	size_t capacity,
	size_t *out_size,
	const char *profile_id)
{
	return encode_simple_cbor_opcode(
		out, capacity, out_size, profile_id,
		SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST);
}

static int configure_module(
	spaghetti_module_key_t key,
	const char *profile_id,
	uint16_t i2c_address,
	uint8_t spi_cs,
	uint8_t adc_channel,
	spaghetti_module_id_t *out_id)
{
	struct spaghetti_property_set config;
	struct spaghetti_module_request request;

	memset(&request, 0, sizeof(request));
	make_config(&config, profile_id, i2c_address, spi_cs, adc_channel);
	request.key = key;
	request.port_id = 0U;
	request.type_id = "declarative-device";
	request.config = &config;
	request.placement.bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	request.placement.power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	request.revision = 1U;
	return spaghetti_module_manager_configure(&request, out_id);
}

static void append_w1_rom(struct spaghetti_property_set *out,
			  const uint8_t rom[SPAGHETTI_ENDPOINT_VALUE_MAX])
{
	out->fields[out->field_count].field_id =
		SPAGHETTI_DECLARATIVE_CONFIG_W1_ROM;
	out->fields[out->field_count].type = SPAGHETTI_VALUE_BYTES;
	out->fields[out->field_count].data.bytes.size =
		SPAGHETTI_ENDPOINT_VALUE_MAX;
	memcpy(out->fields[out->field_count].data.bytes.bytes, rom,
	       SPAGHETTI_ENDPOINT_VALUE_MAX);
	out->field_count += 1U;
}

static int configure_module_w1(
	spaghetti_module_key_t key,
	const char *profile_id,
	const uint8_t rom[SPAGHETTI_ENDPOINT_VALUE_MAX],
	spaghetti_module_id_t *out_id)
{
	struct spaghetti_property_set config;
	struct spaghetti_module_request request;

	memset(&request, 0, sizeof(request));
	make_config(&config, profile_id, 0U, 0xFFU, 0xFFU);
	append_w1_rom(&config, rom);
	request.key = key;
	request.port_id = 0U;
	request.type_id = "declarative-device";
	request.config = &config;
	request.placement.bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	request.placement.power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	request.revision = 1U;
	return spaghetti_module_manager_configure(&request, out_id);
}

static void *device_profiles_setup(void)
{
	bus_reset();
	profile_referenced = false;
	referenced_id = NULL;
	referenced_version = 0U;
	fake_port.capabilities =
		SPAGHETTI_PORT_CAP_I2C | SPAGHETTI_PORT_CAP_SPI |
		SPAGHETTI_PORT_CAP_UART | SPAGHETTI_PORT_CAP_DIGITAL_INPUT |
		SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT | SPAGHETTI_PORT_CAP_ADC |
		SPAGHETTI_PORT_CAP_W1;
	spaghetti_device_profile_clear_persisted_for_test();
	spaghetti_device_profile_reset_for_test();
	zassert_ok(spaghetti_device_profile_init());
	install_runtime_profiles();
	zassert_ok(spaghetti_driver_registry_init());
	zassert_ok(spaghetti_module_manager_init());
	spaghetti_device_profile_set_reference_checker(reference_checker, NULL);
	return NULL;
}

ZTEST(device_profiles, test_profiles_transports_and_instances)
{
	struct spaghetti_record record;
	spaghetti_module_id_t id_a;
	spaghetti_module_id_t id_b;
	spaghetti_module_id_t id_spi;
	spaghetti_module_id_t id_adc;
	spaghetti_module_id_t id_crc;

	zassert_ok(configure_module(1U, "sensor-i2c-be", I2C_ADDR_A, 0xFFU, 0xFFU,
				    &id_a));
	zassert_ok(spaghetti_module_manager_read(id_a, &record));
	zassert_equal(record.payload.values.fields[0].data.signed_integer, 0x1234);

	zassert_ok(configure_module(2U, "sensor-i2c-le", I2C_ADDR_B, 0xFFU, 0xFFU,
				    &id_b));
	zassert_ok(spaghetti_module_manager_read(id_b, &record));
	zassert_equal(record.payload.values.fields[0].data.signed_integer, 0x5678);
	zassert_ok(spaghetti_module_manager_remove(id_b, 1U));

	zassert_ok(configure_module(3U, "sensor-i2c-be", I2C_ADDR_B, 0xFFU, 0xFFU,
				    &id_spi));
	zassert_ok(spaghetti_module_manager_read(id_spi, &record));
	zassert_equal(record.payload.values.fields[0].data.signed_integer, 0xAABB);
	zassert_ok(spaghetti_module_manager_remove(id_spi, 1U));

	zassert_ok(configure_module(4U, "sensor-spi", 0U, 0U, 0xFFU, &id_spi));
	zassert_ok(spaghetti_module_manager_read(id_spi, &record));
	zassert_equal(record.payload.values.fields[0].data.signed_integer, 0x0099);
	zassert_ok(spaghetti_module_manager_remove(id_spi, 1U));

	zassert_ok(configure_module(5U, "sensor-adc", 0U, 0xFFU, 0U, &id_adc));
	zassert_ok(spaghetti_module_manager_read(id_adc, &record));
	zassert_equal(record.payload.values.fields[0].data.signed_integer, 1234000);
	zassert_ok(spaghetti_module_manager_remove(id_adc, 1U));
	zassert_ok(spaghetti_module_manager_remove(id_a, 1U));

	zassert_ok(configure_module(6U, "sensor-ready-crc", I2C_ADDR_A, 0xFFU, 0xFFU,
				    &id_crc));
	zassert_ok(spaghetti_module_manager_read(id_crc, &record));
	zassert_equal(record.payload.values.field_count, 3U);
	zassert_equal(record.payload.values.fields[0].data.signed_integer, 0xABCD);

	zassert_ok(spaghetti_module_manager_remove(id_crc, 1U));
}

ZTEST(device_profiles, test_negatives_persist_and_caps)
{
	struct spaghetti_device_profile bad;
	struct spaghetti_device_profile_budget budget;
	uint8_t cbor[CONFIG_SPAGHETTI_MAX_DEVICE_PROFILE_BYTES];
	size_t cbor_size = 0U;
	size_t before;
	const struct spaghetti_device_profile *found;
	spaghetti_module_id_t id;

	fill_base(&bad, "bad-opcode", SPAGHETTI_PORT_TRANSPORT_I2C,
		  SPAGHETTI_PORT_CAP_I2C);
	bad.sample_ops[0] = make_op(0xFEU, 0, 0, 0, 0, 0, 0, 0);
	bad.sample_count = 1U;
	zassert_equal(spaghetti_device_profile_validate(&bad, &budget), -ENOTSUP);

	fill_base(&bad, "bad-wait", SPAGHETTI_PORT_TRANSPORT_I2C,
		  SPAGHETTI_PORT_CAP_I2C);
	bad.sample_ops[0] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_WAIT_FIELD_MASK, 0, 0, 0, 0, 1, 1, 1);
	bad.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 0, 0, 1, 1, 0, 1);
	bad.sample_count = 2U;
	zassert_equal(spaghetti_device_profile_validate(&bad, &budget), -EINVAL);

	fill_base(&bad, "bad-time", SPAGHETTI_PORT_TRANSPORT_I2C,
		  SPAGHETTI_PORT_CAP_I2C);
	bad.max_total_time_ms = 1U;
	bad.sample_ops[0] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_DELAY_BOUNDED, 0, 0, 0, 50, 0, 0, 0);
	bad.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 0, 0, 1, 1, 0, 1);
	bad.sample_count = 2U;
	zassert_equal(spaghetti_device_profile_validate(&bad, &budget), -EFBIG);

	fill_base(&bad, "bad-schema", SPAGHETTI_PORT_TRANSPORT_I2C,
		  SPAGHETTI_PORT_CAP_I2C);
	bad.sample_ops[0] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, 99, 0, 0, 1, 1, 0, 1);
	bad.sample_count = 1U;
	zassert_equal(spaghetti_device_profile_validate(&bad, &budget),
		      -EPROTONOSUPPORT);

	before = spaghetti_device_profile_count();
	zassert_ok(encode_simple_cbor(cbor, sizeof(cbor), &cbor_size, "sensor-cbor"));
	zassert_true(cbor_size > 0U);
	zassert_equal(spaghetti_device_profile_install(cbor, cbor_size / 2U), -EBADMSG);
	zassert_equal(spaghetti_device_profile_count(), before);
	{
		const int install_rc =
			spaghetti_device_profile_install(cbor, cbor_size);

		zassert_equal(install_rc, 0, "install rc=%d size=%u", install_rc,
			      (uint32_t)cbor_size);
	}

	profile_referenced = true;
	referenced_id = "sensor-cbor";
	referenced_version = 1U;
	zassert_equal(spaghetti_device_profile_remove("sensor-cbor", 1U), -EBUSY);
	profile_referenced = false;
	zassert_ok(spaghetti_device_profile_remove("sensor-cbor", 1U));

	fake_port.capabilities = SPAGHETTI_PORT_CAP_I2C;
	zassert_equal(configure_module(20U, "sensor-spi", 0U, 0U, 0xFFU, &id),
		      -ENOTSUP);
	fake_port.capabilities =
		SPAGHETTI_PORT_CAP_I2C | SPAGHETTI_PORT_CAP_SPI |
		SPAGHETTI_PORT_CAP_UART | SPAGHETTI_PORT_CAP_DIGITAL_INPUT |
		SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT | SPAGHETTI_PORT_CAP_ADC |
		SPAGHETTI_PORT_CAP_W1;

	zassert_ok(encode_simple_cbor(cbor, sizeof(cbor), &cbor_size,
				      "sensor-persist"));
	zassert_ok(spaghetti_device_profile_install(cbor, cbor_size));
	spaghetti_device_profile_reset_for_test();
	zassert_ok(spaghetti_device_profile_init());
	found = spaghetti_device_profile_find("sensor-persist", 1U, NULL);
	zassert_not_null(found);
	zassert_false(hash_is_zero(found->hash));
	install_runtime_profiles();
}

ZTEST(device_profiles, test_validate_cbor_does_not_install)
{
	uint8_t cbor[CONFIG_SPAGHETTI_MAX_DEVICE_PROFILE_BYTES];
	size_t cbor_size = 0U;
	size_t before;
	struct spaghetti_device_profile_failure failure = {
		.field = SPAGHETTI_DEVICE_PROFILE_FAILURE_BUDGET,
		.reason = SPAGHETTI_DEVICE_PROFILE_FAILURE_RANGE,
	};

	zassert_ok(encode_simple_cbor(cbor, sizeof(cbor), &cbor_size, "sensor-validate"));
	before = spaghetti_device_profile_count();
	zassert_ok(spaghetti_device_profile_validate_cbor(cbor, cbor_size, &failure));
	zassert_equal(spaghetti_device_profile_count(), before);

	zassert_equal(spaghetti_device_profile_validate_cbor(NULL, 1U, &failure),
		      -EINVAL);
	zassert_equal(failure.field, SPAGHETTI_DEVICE_PROFILE_FAILURE_WIRE);
	zassert_equal(failure.reason, SPAGHETTI_DEVICE_PROFILE_FAILURE_REQUIRED);

	zassert_equal(spaghetti_device_profile_validate_cbor(cbor, cbor_size / 2U,
							     &failure),
		      -EBADMSG);
	zassert_equal(failure.field, SPAGHETTI_DEVICE_PROFILE_FAILURE_WIRE);
	zassert_equal(failure.reason, SPAGHETTI_DEVICE_PROFILE_FAILURE_MALFORMED);
	zassert_equal(spaghetti_device_profile_count(), before);

	zassert_ok(encode_simple_cbor_opcode(cbor, sizeof(cbor), &cbor_size,
					    "sensor-bad-op", 0xFEU));
	zassert_equal(spaghetti_device_profile_validate_cbor(cbor, cbor_size, &failure),
		      -ENOTSUP);
	zassert_equal(spaghetti_device_profile_install(cbor, cbor_size), -ENOTSUP);
	zassert_equal(failure.field, SPAGHETTI_DEVICE_PROFILE_FAILURE_PLAN);
	zassert_equal(failure.reason, SPAGHETTI_DEVICE_PROFILE_FAILURE_UNSUPPORTED);
	zassert_equal(spaghetti_device_profile_count(), before);
}

ZTEST(device_profiles, test_w1_uart_spi_mode_wait_gpio)
{
	struct spaghetti_record record;
	struct spaghetti_device_profile profile;
	struct spaghetti_device_profile bad;
	struct spaghetti_device_profile_budget budget;
	struct spaghetti_device_profile_binding binding;
	struct spaghetti_record_payload payload;
	spaghetti_module_id_t id;
	static const uint8_t rom[SPAGHETTI_ENDPOINT_VALUE_MAX] = {
		0x28U, 0x11U, 0x22U, 0x33U, 0x44U, 0x55U, 0x66U, 0x77U,
	};

	fill_base(&profile, "sensor-w1", SPAGHETTI_PORT_TRANSPORT_W1,
		  SPAGHETTI_PORT_CAP_W1);
	profile.sample_ops[0] = make_op(SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST, 0, 0, 0,
					1, 0, 0xBEU, 0);
	profile.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_W1_WRITE_READ, 1, 0, 0, 2, 1, 100, 0);
	profile.sample_ops[2] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 1, 0, 2, 1, 0, 1);
	profile.sample_ops[3] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD, 0, 0, 0, 0, 0, 0, 0);
	profile.sample_count = 4U;
	strncpy(profile.sample_schema_id, "spaghetti.w1.sample",
		sizeof(profile.sample_schema_id) - 1U);
	zassert_ok(spaghetti_device_profile_install_decoded(&profile));

	zassert_ok(configure_module_w1(30U, "sensor-w1", rom, &id));
	zassert_ok(spaghetti_module_manager_read(id, &record));
	zassert_equal(record.payload.values.fields[0].data.signed_integer, 0x1234);
	zassert_mem_equal(bus.w1_last_rom, rom, sizeof(rom));
	zassert_ok(spaghetti_module_manager_remove(id, 1U));

	memset(&binding, 0, sizeof(binding));
	binding.default_timeout_ms = 100U;
	zassert_equal(spaghetti_device_profile_exec(&profile, profile.sample_ops,
						    profile.sample_count,
						    &fake_port, &binding, &payload),
		      -EINVAL);

	fake_port.capabilities &= ~SPAGHETTI_PORT_CAP_W1;
	memcpy(binding.w1_rom, rom, sizeof(rom));
	zassert_equal(spaghetti_device_profile_exec(&profile, profile.sample_ops,
						    profile.sample_count,
						    &fake_port, &binding, &payload),
		      -ENOTSUP);
	fake_port.capabilities |= SPAGHETTI_PORT_CAP_W1;
	zassert_ok(spaghetti_device_profile_remove("sensor-w1", 1U));

	fill_base(&bad, "bad-w1-transport", SPAGHETTI_PORT_TRANSPORT_I2C,
		  SPAGHETTI_PORT_CAP_I2C);
	bad.sample_ops[0] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_W1_WRITE_READ, 1, 0, 0, 2, 1, 100, 0);
	bad.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 1, 0, 2, 1, 0, 1);
	bad.sample_count = 2U;
	zassert_equal(spaghetti_device_profile_validate(&bad, &budget), -EINVAL);

	fill_base(&bad, "bad-w1-caps", SPAGHETTI_PORT_TRANSPORT_W1,
		  SPAGHETTI_PORT_CAP_I2C);
	bad.sample_ops[0] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 0, 0, 1, 1, 0, 1);
	bad.sample_count = 1U;
	zassert_equal(spaghetti_device_profile_validate(&bad, &budget), -EINVAL);

	fill_base(&profile, "sensor-uart-bin", SPAGHETTI_PORT_TRANSPORT_UART,
		  SPAGHETTI_PORT_CAP_UART);
	profile.sample_ops[0] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_UART_READ, 0, 0, 0, 4, 50, 0, 0);
	profile.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 0, 0, 4, 1, 0, 1);
	profile.sample_ops[2] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD, 0, 0, 0, 0, 0, 0, 0);
	profile.sample_count = 3U;
	strncpy(profile.sample_schema_id, "spaghetti.uart-bin.sample",
		sizeof(profile.sample_schema_id) - 1U);
	zassert_ok(spaghetti_device_profile_install_decoded(&profile));

	bus.uart_rx[0] = 0x42U;
	bus.uart_rx[1] = 0x00U;
	bus.uart_rx[2] = 0xFFU;
	bus.uart_rx[3] = 0x0AU;
	bus.uart_rx_len = 4U;
	bus.uart_rx_pos = 0U;
	zassert_ok(configure_module(31U, "sensor-uart-bin", 0U, 0xFFU, 0xFFU, &id));
	zassert_ok(spaghetti_module_manager_read(id, &record));
	zassert_equal(record.payload.values.fields[0].data.signed_integer,
		      (int64_t)0x4200FF0A);
	zassert_ok(spaghetti_module_manager_remove(id, 1U));

	memset(&binding, 0, sizeof(binding));
	binding.default_timeout_ms = 100U;
	bus.uart_rx_len = 0U;
	bus.uart_rx_pos = 0U;
	zassert_equal(spaghetti_device_profile_exec(&profile, profile.sample_ops,
						    profile.sample_count,
						    &fake_port, &binding, &payload),
		      -ETIMEDOUT);
	zassert_ok(spaghetti_device_profile_remove("sensor-uart-bin", 1U));

	fill_base(&profile, "sensor-spi-mode3", SPAGHETTI_PORT_TRANSPORT_SPI,
		  SPAGHETTI_PORT_CAP_SPI);
	profile.sample_ops[0] = make_op(SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST, 0, 0, 0,
					2, 0, 0x00A5U, 0);
	profile.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_SPI_TRANSCEIVE, 1, 0, 0, 2, 100,
			1000000U, 3U);
	profile.sample_ops[2] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 1, 0, 2, 1, 0, 1);
	profile.sample_ops[3] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD, 0, 0, 0, 0, 0, 0, 0);
	profile.sample_count = 4U;
	strncpy(profile.sample_schema_id, "spaghetti.spi-m3.sample",
		sizeof(profile.sample_schema_id) - 1U);
	zassert_ok(spaghetti_device_profile_install_decoded(&profile));

	zassert_ok(configure_module(32U, "sensor-spi-mode3", 0U, 0U, 0xFFU, &id));
	zassert_ok(spaghetti_module_manager_read(id, &record));
	zassert_true((bus.spi_last_operation & SPI_MODE_CPOL) != 0U);
	zassert_true((bus.spi_last_operation & SPI_MODE_CPHA) != 0U);
	zassert_ok(spaghetti_module_manager_remove(id, 1U));
	zassert_ok(spaghetti_device_profile_remove("sensor-spi-mode3", 1U));

	fill_base(&bad, "bad-spi-mode", SPAGHETTI_PORT_TRANSPORT_SPI,
		  SPAGHETTI_PORT_CAP_SPI);
	bad.sample_ops[0] = make_op(SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST, 0, 0, 0,
				    2, 0, 0x00A5U, 0);
	bad.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_SPI_TRANSCEIVE, 1, 0, 0, 2, 100,
			1000000U, 4U);
	bad.sample_ops[2] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 1, 0, 2, 1, 0, 1);
	bad.sample_count = 3U;
	zassert_equal(spaghetti_device_profile_validate(&bad, &budget), -EINVAL);

	fill_base(&profile, "sensor-wait-gpio", SPAGHETTI_PORT_TRANSPORT_I2C,
		  SPAGHETTI_PORT_CAP_I2C | SPAGHETTI_PORT_CAP_DIGITAL_INPUT);
	profile.sample_ops[0] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_WAIT_GPIO, 0, 0, 0, 5, 1, 1, 0);
	profile.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 0, 0, 1, 1, 0, 1);
	profile.sample_ops[2] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD, 0, 0, 0, 0, 0, 0, 0);
	profile.sample_count = 3U;
	strncpy(profile.sample_schema_id, "spaghetti.wait-gpio.sample",
		sizeof(profile.sample_schema_id) - 1U);
	zassert_ok(spaghetti_device_profile_install_decoded(&profile));

	zassert_ok(configure_module(33U, "sensor-wait-gpio", I2C_ADDR_A, 0xFFU, 0xFFU,
				    &id));
	bus.gpio_input = true;
	zassert_ok(spaghetti_module_manager_read(id, &record));
	zassert_equal(record.payload.values.fields[0].data.signed_integer, 1);
	zassert_ok(spaghetti_module_manager_remove(id, 1U));

	memset(&binding, 0, sizeof(binding));
	binding.default_timeout_ms = 100U;
	fake_port.capabilities &= ~SPAGHETTI_PORT_CAP_DIGITAL_INPUT;
	zassert_equal(spaghetti_device_profile_exec(&profile, profile.sample_ops,
						    profile.sample_count,
						    &fake_port, &binding, &payload),
		      -ENOTSUP);
	fake_port.capabilities |= SPAGHETTI_PORT_CAP_DIGITAL_INPUT;
	zassert_ok(spaghetti_device_profile_remove("sensor-wait-gpio", 1U));

	fill_base(&bad, "bad-wait-gpio-cap", SPAGHETTI_PORT_TRANSPORT_I2C,
		  SPAGHETTI_PORT_CAP_I2C);
	bad.sample_ops[0] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_WAIT_GPIO, 0, 0, 0, 5, 1, 1, 0);
	bad.sample_ops[1] =
		make_op(SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD, FIELD_VALUE, 0, 0, 1, 1, 0, 1);
	bad.sample_count = 2U;
	zassert_equal(spaghetti_device_profile_validate(&bad, &budget), -EINVAL);
}

ZTEST_SUITE(device_profiles, NULL, device_profiles_setup, NULL, NULL, NULL);
