#include <spaghetti/device_profile.h>

#include <errno.h>
#include <string.h>

#include <zephyr/logging/log.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/util.h>

LOG_MODULE_DECLARE(spaghetti_device_profile,
		   CONFIG_SPAGHETTI_DEVICE_PROFILE_LOG_LEVEL);

struct spaghetti_device_profile_temp {
	size_t size;
	uint8_t bytes[SPAGHETTI_VALUE_BYTES_MAX];
};

static uint32_t binding_timeout_ms(
	const struct spaghetti_device_profile_binding *binding,
	uint16_t imm_timeout)
{
	if (imm_timeout != 0U) {
		return imm_timeout;
	}
	if ((binding != NULL) && (binding->default_timeout_ms != 0U)) {
		return binding->default_timeout_ms;
	}

	return 100U;
}

static int temp_get(
	struct spaghetti_device_profile_temp *temps,
	uint8_t idx,
	struct spaghetti_device_profile_temp **out)
{
	if (idx >= SPAGHETTI_DEVICE_PROFILE_TEMP_SLOTS) {
		return -EINVAL;
	}

	*out = &temps[idx];
	return 0;
}

static uint64_t load_unsigned_be(const uint8_t *bytes, size_t size)
{
	uint64_t value = 0U;

	for (size_t idx = 0U; idx < size; ++idx) {
		value = (value << 8) | bytes[idx];
	}

	return value;
}

static uint64_t load_unsigned_le(const uint8_t *bytes, size_t size)
{
	uint64_t value = 0U;

	for (size_t idx = 0U; idx < size; ++idx) {
		value |= ((uint64_t)bytes[idx]) << (8U * idx);
	}

	return value;
}

static void store_unsigned_be(uint8_t *bytes, size_t size, uint64_t value)
{
	for (size_t idx = 0U; idx < size; ++idx) {
		bytes[size - 1U - idx] = (uint8_t)(value & 0xFFU);
		value >>= 8;
	}
}

static uint8_t crc8_poly07(const uint8_t *data, size_t size)
{
	uint8_t crc = 0U;

	for (size_t idx = 0U; idx < size; ++idx) {
		crc ^= data[idx];
		for (uint8_t bit = 0U; bit < 8U; ++bit) {
			if ((crc & 0x80U) != 0U) {
				crc = (uint8_t)((crc << 1) ^ 0x07U);
			} else {
				crc <<= 1;
			}
		}
	}

	return crc;
}

static uint16_t crc16_ccitt(const uint8_t *data, size_t size)
{
	uint16_t crc = 0xFFFFU;

	for (size_t idx = 0U; idx < size; ++idx) {
		crc ^= ((uint16_t)data[idx]) << 8;
		for (uint8_t bit = 0U; bit < 8U; ++bit) {
			if ((crc & 0x8000U) != 0U) {
				crc = (uint16_t)((crc << 1) ^ 0x1021U);
			} else {
				crc <<= 1;
			}
		}
	}

	return crc;
}

static int exec_i2c_write(
	const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
	struct spaghetti_device_profile_temp *src,
	uint16_t len,
	uint16_t timeout_ms)
{
	struct i2c_msg msg;
	struct spaghetti_port_i2c_request request;

	if ((len == 0U) || (len > src->size)) {
		return -EINVAL;
	}

	msg.buf = src->bytes;
	msg.len = len;
	msg.flags = I2C_MSG_WRITE | I2C_MSG_STOP;
	request.address = binding->i2c_address;
	request.messages = &msg;
	request.message_count = 1U;
	return spaghetti_port_i2c_transfer(port, &request,
					   K_MSEC(binding_timeout_ms(binding,
								     timeout_ms)));
}

static int exec_i2c_read(
	const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
	struct spaghetti_device_profile_temp *dst,
	uint16_t len,
	uint16_t timeout_ms)
{
	struct i2c_msg msg;
	struct spaghetti_port_i2c_request request;
	int err;

	if ((len == 0U) || (len > SPAGHETTI_VALUE_BYTES_MAX)) {
		return -EINVAL;
	}

	msg.buf = dst->bytes;
	msg.len = len;
	msg.flags = I2C_MSG_READ | I2C_MSG_STOP;
	request.address = binding->i2c_address;
	request.messages = &msg;
	request.message_count = 1U;
	err = spaghetti_port_i2c_transfer(port, &request,
					  K_MSEC(binding_timeout_ms(binding,
								    timeout_ms)));
	if (err < 0) {
		return err;
	}

	dst->size = len;
	return 0;
}

static int exec_i2c_write_read(
	const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
	struct spaghetti_device_profile_temp *src,
	struct spaghetti_device_profile_temp *dst,
	uint16_t read_len,
	uint16_t write_len,
	uint16_t timeout_ms)
{
	struct i2c_msg messages[2];
	struct spaghetti_port_i2c_request request;
	int err;

	if ((write_len == 0U) || (write_len > src->size) || (read_len == 0U) ||
	    (read_len > SPAGHETTI_VALUE_BYTES_MAX)) {
		return -EINVAL;
	}

	messages[0].buf = src->bytes;
	messages[0].len = write_len;
	messages[0].flags = I2C_MSG_WRITE;
	messages[1].buf = dst->bytes;
	messages[1].len = read_len;
	messages[1].flags = I2C_MSG_READ | I2C_MSG_STOP;
	request.address = binding->i2c_address;
	request.messages = messages;
	request.message_count = 2U;
	err = spaghetti_port_i2c_transfer(port, &request,
					  K_MSEC(binding_timeout_ms(binding,
								    timeout_ms)));
	if (err < 0) {
		return err;
	}

	dst->size = read_len;
	return 0;
}

static int exec_spi(
	const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
	struct spaghetti_device_profile_temp *src,
	struct spaghetti_device_profile_temp *dst,
	uint16_t len,
	uint16_t timeout_ms,
	uint32_t frequency_hz,
	uint32_t mode)
{
	struct spi_buf tx_buf;
	struct spi_buf rx_buf;
	struct spi_buf_set tx_set;
	struct spi_buf_set rx_set;
	struct spaghetti_port_spi_request request;
	spi_operation_t operation;
	int err;

	if ((len == 0U) || (len > src->size) ||
	    (len > SPAGHETTI_VALUE_BYTES_MAX) || (mode > 3U)) {
		return -EINVAL;
	}

	operation = SPI_OP_MODE_MASTER | SPI_WORD_SET(8) | SPI_TRANSFER_MSB;
	if ((mode & 1U) != 0U) {
		operation |= SPI_MODE_CPHA;
	}
	if ((mode & 2U) != 0U) {
		operation |= SPI_MODE_CPOL;
	}

	tx_buf.buf = src->bytes;
	tx_buf.len = len;
	rx_buf.buf = dst->bytes;
	rx_buf.len = len;
	tx_set.buffers = &tx_buf;
	tx_set.count = 1U;
	rx_set.buffers = &rx_buf;
	rx_set.count = 1U;
	request.chip_select = binding->spi_cs;
	request.frequency_hz = (frequency_hz != 0U) ? frequency_hz :
						      binding->spi_frequency_hz;
	request.operation = operation;
	request.tx = &tx_set;
	request.rx = &rx_set;
	err = spaghetti_port_spi_transceive(
		port, &request,
		K_MSEC(binding_timeout_ms(binding, timeout_ms)));
	if (err < 0) {
		return err;
	}

	dst->size = len;
	return 0;
}

static int exec_wait_field_mask(
	const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
	struct spaghetti_device_profile_temp *temps,
	const struct spaghetti_device_profile_op *op)
{
	struct spaghetti_device_profile_temp *dst;
	struct spaghetti_device_profile_temp *tx;
	int err;

	err = temp_get(temps, op->dst, &dst);
	if (err < 0) {
		return err;
	}
	err = temp_get(temps, op->src_a, &tx);
	if (err < 0) {
		return err;
	}

	for (uint16_t attempt = 0U; attempt < op->imm0; ++attempt) {
		uint32_t value;

		if (tx->size > 0U) {
			err = exec_i2c_write_read(port, binding, tx, dst, 2U,
						  (uint16_t)tx->size, op->imm1);
		} else {
			err = exec_i2c_read(port, binding, dst, 2U, op->imm1);
		}
		if (err < 0) {
			return err;
		}

		value = (uint32_t)load_unsigned_be(dst->bytes,
						   MIN(dst->size, 4U));
		if ((value & op->imm2) == (op->imm3 & op->imm2)) {
			return 0;
		}

		if ((attempt + 1U) < op->imm0) {
			k_sleep(K_MSEC(op->imm1));
		}
	}

	return -ETIMEDOUT;
}

static bool w1_rom_is_present(const uint8_t rom[SPAGHETTI_ENDPOINT_VALUE_MAX])
{
	for (size_t idx = 0U; idx < SPAGHETTI_ENDPOINT_VALUE_MAX; ++idx) {
		if (rom[idx] != 0U) {
			return true;
		}
	}

	return false;
}

static int exec_wait_gpio(
	const struct spaghetti_port *port,
	struct spaghetti_device_profile_temp *temps,
	const struct spaghetti_device_profile_op *op)
{
	struct spaghetti_device_profile_temp *dst;
	int err;

	if (!spaghetti_port_has_capability(port,
					   SPAGHETTI_PORT_CAP_DIGITAL_INPUT)) {
		return -ENOTSUP;
	}
	if (op->imm2 > 1U) {
		return -EINVAL;
	}

	err = temp_get(temps, op->dst, &dst);
	if (err < 0) {
		return err;
	}

	for (uint16_t attempt = 0U; attempt < op->imm0; ++attempt) {
		bool high = false;

		err = spaghetti_port_get_input(port, &high);
		if (err < 0) {
			return err;
		}

		dst->bytes[0] = high ? 1U : 0U;
		dst->size = 1U;
		if ((high ? 1U : 0U) == op->imm2) {
			return 0;
		}

		if ((attempt + 1U) < op->imm0) {
			k_sleep(K_MSEC(op->imm1));
		}
	}

	return -ETIMEDOUT;
}

static int exec_emit_field(
	const struct spaghetti_device_profile *profile,
	struct spaghetti_device_profile_temp *src,
	const struct spaghetti_device_profile_op *op,
	struct spaghetti_record_payload *out_record)
{
	const struct spaghetti_device_profile_field *field = NULL;
	struct spaghetti_value *value;
	uint16_t width = op->imm0;
	bool big_endian = op->imm1 != 0U;
	uint64_t raw;

	if ((out_record == NULL) || (width == 0U) || (width > src->size) ||
	    (width > 8U) ||
	    (out_record->values.field_count >= SPAGHETTI_PROPERTY_MAX_FIELDS)) {
		return -EINVAL;
	}

	for (size_t idx = 0U; idx < profile->sample_field_count; ++idx) {
		if (profile->sample_fields[idx].field_id == op->dst) {
			field = &profile->sample_fields[idx];
			break;
		}
	}
	if (field == NULL) {
		return -ENOENT;
	}

	raw = big_endian ? load_unsigned_be(src->bytes, width) :
			   load_unsigned_le(src->bytes, width);
	value = &out_record->values.fields[out_record->values.field_count];
	memset(value, 0, sizeof(*value));
	value->field_id = field->field_id;
	value->type = field->type;
	if (field->type == SPAGHETTI_VALUE_INT64) {
		int64_t signed_value = (int64_t)raw;

		if ((op->imm2 != 0U) && (width < 8U)) {
			uint64_t sign_bit = 1ULL << ((width * 8U) - 1U);

			if ((raw & sign_bit) != 0U) {
				uint64_t mask = (sign_bit << 1) - 1U;

				signed_value = (int64_t)(raw | ~mask);
			}
		}
		if (op->imm3 > 1U) {
			signed_value *= (int64_t)op->imm3;
		}
		value->data.signed_integer = signed_value;
	} else {
		if (op->imm3 > 1U) {
			raw *= op->imm3;
		}
		value->data.unsigned_integer = raw;
	}

	out_record->values.field_count += 1U;
	return 0;
}

int spaghetti_device_profile_exec(
	const struct spaghetti_device_profile *profile,
	const struct spaghetti_device_profile_op *ops,
	size_t op_count,
	const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
	struct spaghetti_record_payload *out_record)
{
	struct spaghetti_device_profile_temp temps[SPAGHETTI_DEVICE_PROFILE_TEMP_SLOTS];

	if ((profile == NULL) || ((op_count > 0U) && (ops == NULL)) ||
	    (port == NULL) || (binding == NULL)) {
		return -EINVAL;
	}

	memset(temps, 0, sizeof(temps));
	if (out_record != NULL) {
		memset(out_record, 0, sizeof(*out_record));
	}

	for (size_t idx = 0U; idx < op_count; ++idx) {
		const struct spaghetti_device_profile_op *op = &ops[idx];
		struct spaghetti_device_profile_temp *dst;
		struct spaghetti_device_profile_temp *src_a;
		struct spaghetti_device_profile_temp *src_b;
		int err = 0;

		switch (op->opcode) {
		case SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = exec_i2c_write(port, binding, src_a,
						     op->imm0, op->imm1);
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_I2C_READ:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = exec_i2c_read(port, binding, dst, op->imm0,
						    op->imm1);
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = temp_get(temps, op->dst, &dst);
			}
			if (err == 0) {
				err = exec_i2c_write_read(
					port, binding, src_a, dst, op->imm0,
					(op->imm1 != 0U) ? op->imm1 :
							   (uint16_t)src_a->size,
					(uint16_t)op->imm2);
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_SPI_TRANSCEIVE:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = temp_get(temps, op->dst, &dst);
			}
			if (err == 0) {
				err = exec_spi(port, binding, src_a, dst,
					       op->imm0, op->imm1, op->imm2,
					       op->imm3);
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_UART_WRITE:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = spaghetti_port_uart_write(
					port, src_a->bytes,
					(op->imm0 != 0U) ? op->imm0 : src_a->size,
					K_MSEC(binding_timeout_ms(binding,
								  op->imm1)));
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_UART_READ_UNTIL: {
			size_t out_len = 0U;

			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = spaghetti_port_uart_read_until(
					port, dst->bytes, op->imm0,
					(uint8_t)op->imm2, &out_len,
					K_MSEC(binding_timeout_ms(binding,
								  op->imm1)));
				if (err == 0) {
					dst->size = out_len;
				}
			}
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_UART_READ:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = spaghetti_port_uart_read(
					port, dst->bytes, op->imm0,
					K_MSEC(binding_timeout_ms(binding,
								  op->imm1)));
				if (err == 0) {
					dst->size = op->imm0;
				}
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_W1_WRITE_READ: {
			uint16_t write_size;

			if (!spaghetti_port_has_capability(
				    port, SPAGHETTI_PORT_CAP_W1)) {
				err = -ENOTSUP;
				break;
			}
			if (!w1_rom_is_present(binding->w1_rom)) {
				err = -EINVAL;
				break;
			}
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = temp_get(temps, op->dst, &dst);
			}
			if (err < 0) {
				break;
			}
			write_size = (op->imm1 != 0U) ? op->imm1 :
						       (uint16_t)src_a->size;
			if ((write_size > src_a->size) ||
			    (op->imm0 > SPAGHETTI_VALUE_BYTES_MAX)) {
				err = -EINVAL;
				break;
			}
			err = spaghetti_port_w1_write_read(
				port, binding->w1_rom, src_a->bytes, write_size,
				dst->bytes, op->imm0,
				K_MSEC(binding_timeout_ms(binding,
							  (uint16_t)op->imm2)));
			if (err == 0) {
				dst->size = op->imm0;
			}
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_GET: {
			bool high = false;

			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = spaghetti_port_get_input(port, &high);
				if (err == 0) {
					dst->bytes[0] = high ? 1U : 0U;
					dst->size = 1U;
				}
			}
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_SET:
			err = spaghetti_port_set_output(port, op->imm0 != 0U);
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_ADC_READ: {
			int32_t microvolts = 0;

			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = spaghetti_port_adc_read(
					port, binding->adc_channel, NULL,
					&microvolts,
					K_MSEC(binding_timeout_ms(binding,
								  op->imm0)));
				if (err == 0) {
					sys_put_be32((uint32_t)microvolts,
						     dst->bytes);
					dst->size = 4U;
				}
			}
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_DELAY_BOUNDED:
			k_sleep(K_MSEC(op->imm0));
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_WAIT_FIELD_MASK:
			err = exec_wait_field_mask(port, binding, temps, op);
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_WAIT_GPIO:
			err = exec_wait_gpio(port, temps, op);
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST: {
			uint8_t raw[8];

			err = temp_get(temps, op->dst, &dst);
			if (err < 0) {
				break;
			}
			sys_put_le32(op->imm2, &raw[0]);
			sys_put_le32(op->imm3, &raw[4]);
			memcpy(dst->bytes, raw, op->imm0);
			dst->size = op->imm0;
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_COPY_BYTES:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = temp_get(temps, op->src_a, &src_a);
			}
			if (err == 0) {
				size_t len = (op->imm0 != 0U) ? op->imm0 :
								src_a->size;

				if ((len > src_a->size) ||
				    (len > SPAGHETTI_VALUE_BYTES_MAX)) {
					err = -EINVAL;
				} else {
					memcpy(dst->bytes, src_a->bytes, len);
					dst->size = len;
				}
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_CONCAT:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = temp_get(temps, op->src_a, &src_a);
			}
			if (err == 0) {
				err = temp_get(temps, op->src_b, &src_b);
			}
			if (err == 0) {
				if ((src_a->size + src_b->size) >
				    SPAGHETTI_VALUE_BYTES_MAX) {
					err = -EMSGSIZE;
				} else {
					memcpy(dst->bytes, src_a->bytes,
					       src_a->size);
					memcpy(&dst->bytes[src_a->size],
					       src_b->bytes, src_b->size);
					dst->size = src_a->size + src_b->size;
				}
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_BYTE_SWAP:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = temp_get(temps, op->src_a, &src_a);
			}
			if (err == 0) {
				if (src_a->size < op->imm0) {
					err = -EINVAL;
				} else if (op->imm0 == 2U) {
					dst->bytes[0] = src_a->bytes[1];
					dst->bytes[1] = src_a->bytes[0];
					dst->size = 2U;
				} else {
					dst->bytes[0] = src_a->bytes[3];
					dst->bytes[1] = src_a->bytes[2];
					dst->bytes[2] = src_a->bytes[1];
					dst->bytes[3] = src_a->bytes[0];
					dst->size = 4U;
				}
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_MASK:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = temp_get(temps, op->src_a, &src_a);
			}
			if (err == 0) {
				uint32_t value = (uint32_t)load_unsigned_be(
					src_a->bytes, MIN(src_a->size, 4U));

				value &= op->imm2;
				store_unsigned_be(dst->bytes, 4U, value);
				dst->size = 4U;
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_SHIFT:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = temp_get(temps, op->src_a, &src_a);
			}
			if (err == 0) {
				uint64_t value = load_unsigned_be(
					src_a->bytes, MIN(src_a->size, 8U));

				if (op->imm1 == 0U) {
					value <<= op->imm0;
				} else {
					value >>= op->imm0;
				}
				store_unsigned_be(dst->bytes, 8U, value);
				dst->size = 8U;
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_SIGN_EXTEND:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = temp_get(temps, op->src_a, &src_a);
			}
			if (err == 0) {
				uint16_t bits = op->imm0;
				uint64_t value;
				uint64_t sign_bit;

				if ((bits == 0U) || (bits > 64U) ||
				    (src_a->size == 0U)) {
					err = -EINVAL;
					break;
				}
				value = load_unsigned_be(src_a->bytes,
							 MIN(src_a->size, 8U));
				sign_bit = 1ULL << (bits - 1U);
				if ((value & sign_bit) != 0U) {
					uint64_t mask = (sign_bit << 1) - 1U;

					value |= ~mask;
				} else {
					uint64_t mask = (sign_bit << 1) - 1U;

					value &= mask;
				}
				store_unsigned_be(dst->bytes, 8U, value);
				dst->size = 8U;
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_CRC8:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = temp_get(temps, op->src_a, &src_a);
			}
			if (err == 0) {
				dst->bytes[0] =
					crc8_poly07(src_a->bytes, src_a->size);
				dst->size = 1U;
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_CRC16:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = temp_get(temps, op->src_a, &src_a);
			}
			if (err == 0) {
				sys_put_be16(crc16_ccitt(src_a->bytes,
							 src_a->size),
					     dst->bytes);
				dst->size = 2U;
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = exec_emit_field(profile, src_a, op,
						      out_record);
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD:
			if (out_record == NULL) {
				err = -EINVAL;
				break;
			}
			out_record->kind = SPAGHETTI_RECORD_SAMPLE;
			strncpy(out_record->schema_id, profile->sample_schema_id,
				sizeof(out_record->schema_id) - 1U);
			out_record->schema_id[sizeof(out_record->schema_id) - 1U] =
				'\0';
			out_record->schema_version =
				profile->sample_schema_version;
			break;
		default:
			err = -ENOTSUP;
			break;
		}

		if (err < 0) {
			return err;
		}
	}

	return 0;
}
