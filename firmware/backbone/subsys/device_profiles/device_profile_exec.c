#include <spaghetti/device_profile.h>

#include <errno.h>
#include <string.h>
#include <stdio.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/util.h>

LOG_MODULE_DECLARE(spaghetti_device_profile, CONFIG_SPAGHETTI_DEVICE_PROFILE_LOG_LEVEL);

__weak bool spaghetti_device_profile_execution_cancelled(void) { return false; }

/* Pulse edges run on the system timer queue. The runtime worker never sleeps
 * for a duty interval. Control operations serialize cancellation before reuse;
 * the callback uses immutable slot fields until cancel_sync has joined it. */
struct gpio_pulse_slot {
	struct k_work_delayable off;
	struct k_work_sync sync;
	const struct spaghetti_port *port;
	const void *owner;
	uint8_t channel;
	bool restore;
	bool initialized;
};
static struct gpio_pulse_slot pulse_slots[4];
K_MUTEX_DEFINE(pulse_control_lock);
static void gpio_pulse_off(struct k_work *work)
{
	struct gpio_pulse_slot *slot = CONTAINER_OF(k_work_delayable_from_work(work), struct gpio_pulse_slot, off);
	(void)spaghetti_port_digital_output_set(slot->port, slot->channel, slot->restore);
}
static int gpio_pulse_start(const struct spaghetti_port *port, const void *owner,
	uint8_t channel, uint16_t duration, bool active, bool restore)
{
	if (owner == NULL) return -EINVAL;
	(void)k_mutex_lock(&pulse_control_lock, K_FOREVER);
	struct gpio_pulse_slot *slot = NULL;
	for (size_t i = 0; i < ARRAY_SIZE(pulse_slots); ++i)
		if (pulse_slots[i].owner == owner && pulse_slots[i].channel == channel) { slot = &pulse_slots[i]; break; }
	if (slot == NULL)
		for (size_t i = 0; i < ARRAY_SIZE(pulse_slots); ++i)
			if (pulse_slots[i].owner == NULL) { slot = &pulse_slots[i]; break; }
	int err = -ENOSPC;
	if (slot != NULL) {
		if (!slot->initialized) { k_work_init_delayable(&slot->off, gpio_pulse_off); slot->initialized = true; }
		(void)k_work_cancel_delayable_sync(&slot->off, &slot->sync);
		slot->owner = owner; slot->port = port; slot->channel = channel; slot->restore = restore;
		err = spaghetti_port_digital_output_set(port, channel, active);
		if (err == 0) {
			err = k_work_reschedule(&slot->off, K_MSEC(duration));
			if (err >= 0) err = 0;
		}
		if (err < 0) { (void)spaghetti_port_digital_output_set(port, channel, restore); slot->owner = NULL; }
	}
	k_mutex_unlock(&pulse_control_lock);
	return err;
}
void spaghetti_device_profile_cancel_pulses(const void *owner)
{
	if (owner == NULL) return;
	(void)k_mutex_lock(&pulse_control_lock, K_FOREVER);
	for (size_t i = 0; i < ARRAY_SIZE(pulse_slots); ++i) {
		struct gpio_pulse_slot *slot = &pulse_slots[i];
		if (slot->owner != owner) continue;
		(void)k_work_cancel_delayable_sync(&slot->off, &slot->sync);
		(void)spaghetti_port_digital_output_set(slot->port, slot->channel, slot->restore);
		slot->owner = NULL;
	}
	k_mutex_unlock(&pulse_control_lock);
}


/* ISR-safe local GPIO writes use a periodic timer, independent of blocking
 * NFC/CAN system work. The spinlock joins timer expiry with control/Stop. */
static struct {
	struct k_timer tick;
	const void *owner;
	const struct spaghetti_port *port;
	int32_t position;
	int32_t remaining;
	uint32_t module_key;
	uint32_t completed;
	int error;
	bool finite;
	bool paused;
	uint16_t steps_per_rev;
	uint16_t interval_ms;
	uint8_t channels;
	uint8_t phase;
	bool continuous;
	bool initialized;
} stepper;
K_MUTEX_DEFINE(stepper_control_lock);
static struct k_spinlock stepper_phase_lock;
static const uint8_t half_steps[] = { 1U, 3U, 2U, 6U, 4U, 12U, 8U, 9U };
static int stepper_coils(uint8_t pattern)
{
	int result = 0;
	for (unsigned i = 0; i < 4U; ++i) {
		int err = spaghetti_port_digital_output_set(stepper.port, (stepper.channels >> (2U * i)) & 3U, (pattern & BIT(i)) != 0U);
		if (err < 0) result = err;
	}
	return result;
}
static void stepper_tick(struct k_timer *timer)
{
	k_spinlock_key_t key = k_spin_lock(&stepper_phase_lock);
	if (stepper.paused || (!stepper.continuous && stepper.remaining == 0)) goto done;
	int direction = stepper.continuous || stepper.remaining > 0 ? 1 : -1;
	uint8_t next = (stepper.phase + (direction > 0 ? 1U : 7U)) & 7U;
	if (stepper_coils(half_steps[next]) < 0) {
		stepper.continuous = false; stepper.remaining = 0;
		stepper.finite = false; stepper.error = -EIO;
		(void)stepper_coils(0U); goto done;
	}
	stepper.phase = next;
	stepper.position = (stepper.position + direction + stepper.steps_per_rev) % stepper.steps_per_rev;
	if (!stepper.continuous) stepper.remaining -= direction;
 if (stepper.finite && stepper.remaining == 0) {
   stepper.finite = false;
   stepper.completed++;
 }
	done:
	if (stepper.paused || (!stepper.continuous && stepper.remaining == 0)) k_timer_stop(timer);
	k_spin_unlock(&stepper_phase_lock, key);
}
void spaghetti_device_profile_cancel_stepper(const void *owner)
{
	if (owner == NULL) return;
	(void)k_mutex_lock(&stepper_control_lock, K_FOREVER);
	k_spinlock_key_t key = k_spin_lock(&stepper_phase_lock);
	if (stepper.owner == owner) {
		k_timer_stop(&stepper.tick);
		stepper.continuous = false; stepper.remaining = 0;
		(void)stepper_coils(0U); stepper.owner = NULL;
		stepper.module_key = 0; stepper.finite = false; stepper.paused = false;
	}
	k_spin_unlock(&stepper_phase_lock, key);
	k_mutex_unlock(&stepper_control_lock);
}
static int stepper_command(const struct spaghetti_port *port, const void *owner,
	const struct spaghetti_device_profile_op *op, uint64_t degrees, uint32_t module_key)
{
	if (owner == NULL || (op->imm0 == 2U && degrees > 360U)) return -EINVAL;
	(void)k_mutex_lock(&stepper_control_lock, K_FOREVER);
	int err = 0;
	k_spinlock_key_t key = k_spin_lock(&stepper_phase_lock);
	if (stepper.owner != NULL && stepper.owner != owner) { err = -EBUSY; goto out; }
	if (stepper.owner == owner && (stepper.channels != op->imm1 || stepper.steps_per_rev != op->imm3)) { err = -EINVAL; goto out; }
	if (!stepper.initialized) { k_timer_init(&stepper.tick, stepper_tick, NULL); stepper.initialized = true; }
	k_timer_stop(&stepper.tick);
	bool first = stepper.owner == NULL;
	if (first) { stepper.position = 0; stepper.phase = 0; stepper.completed = 0; }
 stepper.module_key = module_key; stepper.paused = false; stepper.error = 0;
 stepper.finite = op->imm0 == 2U;
	stepper.owner = owner; stepper.port = port; stepper.channels = op->imm1;
	stepper.steps_per_rev = op->imm3; stepper.interval_ms = op->imm2;
	stepper.continuous = op->imm0 == 1U; stepper.remaining = 0;
	/* Probe every output before scheduling; a partially configured connector is rejected. */
	err = stepper_coils(first ? 0U : half_steps[stepper.phase]);
	if (err < 0) { stepper.error = err; stepper.finite = false; stepper.continuous = false; (void)stepper_coils(0U); goto out; }
	if (op->imm0 == 2U) {
		int32_t target = ((degrees * stepper.steps_per_rev + 180U) / 360U) % stepper.steps_per_rev;
		int32_t delta = target - stepper.position;
		if (delta > stepper.steps_per_rev / 2) delta -= stepper.steps_per_rev;
		if (delta < -(int32_t)(stepper.steps_per_rev / 2)) delta += stepper.steps_per_rev;
		stepper.remaining = delta;
		if (delta == 0) { stepper.finite = false; stepper.completed++; }
	}
	if (stepper.continuous || stepper.remaining != 0) {
		k_timer_start(&stepper.tick, K_MSEC(stepper.interval_ms), K_MSEC(stepper.interval_ms));
	}
out:
	k_spin_unlock(&stepper_phase_lock, key);
	k_mutex_unlock(&stepper_control_lock);
	return err;
}

int spaghetti_device_profile_motion_status(uint32_t key, struct spaghetti_motion_status *out)
{
 if (!key || !out) return -EINVAL;
 k_spinlock_key_t lock = k_spin_lock(&stepper_phase_lock);
 int err = stepper.owner && stepper.module_key == key ? 0 : -ENOENT;
 if (!err) *out = (struct spaghetti_motion_status){
   .completed = stepper.completed, .busy = stepper.continuous || stepper.remaining != 0,
   .paused = stepper.paused, .error = stepper.error,
 };
 k_spin_unlock(&stepper_phase_lock, lock);
 return err;
}
int spaghetti_device_profile_motion_pause(uint32_t key, bool pause)
{
 if (!key) return -EINVAL;
 (void)k_mutex_lock(&stepper_control_lock, K_FOREVER);
 k_spinlock_key_t lock = k_spin_lock(&stepper_phase_lock);
 int err = stepper.owner && stepper.module_key == key ? 0 : -ENOENT;
 if (!err) {
   stepper.paused = pause;
   if (pause) k_timer_stop(&stepper.tick);
   else if (stepper.continuous || stepper.remaining != 0)
     k_timer_start(&stepper.tick, K_MSEC(stepper.interval_ms), K_MSEC(stepper.interval_ms));
 }
 k_spin_unlock(&stepper_phase_lock, lock);
 k_mutex_unlock(&stepper_control_lock);
 return err;
}
int spaghetti_device_profile_motion_stop(uint32_t key)
{
 if (!key) return -EINVAL;
 (void)k_mutex_lock(&stepper_control_lock, K_FOREVER);
 k_spinlock_key_t lock = k_spin_lock(&stepper_phase_lock);
 int err = stepper.owner && stepper.module_key == key ? 0 : -ENOENT;
 if (!err) {
   k_timer_stop(&stepper.tick);
   stepper.continuous = false; stepper.remaining = 0;
   stepper.finite = false; stepper.paused = false;
   err = stepper_coils(0U);
 }
 k_spin_unlock(&stepper_phase_lock, lock);
 k_mutex_unlock(&stepper_control_lock);
 return err;
}

static struct spaghetti_profile_rx_capture init_rx;
static k_tid_t capture_owner;
static bool capture_commands;
void spaghetti_device_profile_capture_begin(void)
{
	memset(&init_rx, 0, sizeof(init_rx));
	capture_owner = k_current_get();
	capture_commands = false;
}
void spaghetti_device_profile_capture_command_begin(void)
{
	spaghetti_device_profile_capture_begin();
	capture_commands = true;
}

void spaghetti_device_profile_capture_finish(struct spaghetti_profile_rx_capture *out)
{
	if (capture_owner == k_current_get()) {
		*out = init_rx;
		capture_owner = NULL;
	}
}

struct spaghetti_device_profile_temp {
	size_t size;
	uint8_t bytes[SPAGHETTI_VALUE_BYTES_MAX];
};

static uint32_t binding_timeout_ms(const struct spaghetti_device_profile_binding *binding,
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

static int temp_get(struct spaghetti_device_profile_temp *temps, uint8_t idx,
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

static int exec_i2c_write(const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
			  struct spaghetti_device_profile_temp *src, uint16_t len,
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
					   K_MSEC(binding_timeout_ms(binding, timeout_ms)));
}

static int exec_i2c_read(const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
			 struct spaghetti_device_profile_temp *dst, uint16_t len,
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
					  K_MSEC(binding_timeout_ms(binding, timeout_ms)));
	if (err < 0) {
		return err;
	}

	dst->size = len;
	return 0;
}

static int exec_i2c_write_read(const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
	struct spaghetti_device_profile_temp *src,
			       struct spaghetti_device_profile_temp *dst, uint16_t read_len,
			       uint16_t write_len, uint16_t timeout_ms)
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
	messages[1].flags = I2C_MSG_READ | I2C_MSG_RESTART | I2C_MSG_STOP;
	request.address = binding->i2c_address;
	request.messages = messages;
	request.message_count = 2U;
	err = spaghetti_port_i2c_transfer(port, &request,
					  K_MSEC(binding_timeout_ms(binding, timeout_ms)));
	if (err < 0) {
		return err;
	}

	dst->size = read_len;
	return 0;
}

static int exec_spi(const struct spaghetti_port *port,
	const struct spaghetti_device_profile_binding *binding,
	struct spaghetti_device_profile_temp *src,
		    struct spaghetti_device_profile_temp *dst, uint16_t len, uint16_t timeout_ms,
		    uint32_t frequency_hz, uint32_t mode)
{
	struct spi_buf tx_buf;
	struct spi_buf rx_buf;
	struct spi_buf_set tx_set;
	struct spi_buf_set rx_set;
	struct spaghetti_port_spi_request request;
	spi_operation_t operation;
	int err;

	if ((len == 0U) || (len > src->size) || (len > SPAGHETTI_VALUE_BYTES_MAX) || (mode > 3U)) {
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
	request.frequency_hz = (frequency_hz != 0U) ? frequency_hz : binding->spi_frequency_hz;
	request.operation = operation;
	request.tx = &tx_set;
	request.rx = &rx_set;
	err = spaghetti_port_spi_transceive(port, &request,
		K_MSEC(binding_timeout_ms(binding, timeout_ms)));
	if (err < 0) {
		return err;
	}

	dst->size = len;
	return 0;
}

static int exec_wait_field_mask(const struct spaghetti_port *port,
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
			err = exec_i2c_write_read(port, binding, tx, dst, 2U, (uint16_t)tx->size,
						  op->imm1);
		} else {
			err = exec_i2c_read(port, binding, dst, 2U, op->imm1);
		}
		if (err < 0) {
			return err;
		}

		value = (uint32_t)load_unsigned_be(dst->bytes, MIN(dst->size, 4U));
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

static int exec_wait_gpio(const struct spaghetti_port *port,
	struct spaghetti_device_profile_temp *temps,
	const struct spaghetti_device_profile_op *op)
{
	struct spaghetti_device_profile_temp *dst;
	int err;

	if (!spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_DIGITAL_INPUT)) {
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

static int exec_emit_field(const struct spaghetti_device_profile *profile,
	struct spaghetti_device_profile_temp *src,
	const struct spaghetti_device_profile_op *op,
	struct spaghetti_record_payload *out_record)
{
	const struct spaghetti_device_profile_field *field = NULL;
	struct spaghetti_value *value;
	uint16_t width = op->imm0;
	bool big_endian = op->imm1 != 0U;
	uint64_t raw;

	if ((out_record == NULL) || (width == 0U) || (width > src->size) || (width > 8U) ||
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

	raw = big_endian ? load_unsigned_be(src->bytes, width)
			 : load_unsigned_le(src->bytes, width);
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

static int rgb_apply(const struct spaghetti_rgb_state *state, const struct spaghetti_port *port)
{
 int err = 0;
 for (unsigned i = 0; i < 3; i++) {
   uint8_t component = state->on ? (state->color >> (16U - 8U * i)) & 255U : 0;
   uint16_t duty = ((uint32_t)component * 10000U + 127U) / 255U;
   if (state->inverted) duty = 10000U - duty;
   int result = spaghetti_port_pwm_set(port, (state->channels >> (2U * i)) & 3U, duty);
   if (result < 0) err = result;
 }
 return err;
}
void spaghetti_device_profile_rgb_stop(struct spaghetti_rgb_state *state, const struct spaghetti_port *port)
{
 if (!state || !state->initialized) return;
 state->on = false;
 (void)rgb_apply(state, port);
 state->initialized = false;
}
void spaghetti_device_profile_rgb_record(const struct spaghetti_rgb_state *state, struct spaghetti_record_payload *out)
{
 if (!state || !out) return;
 out->values.field_count = 2;
 out->values.fields[0] = (struct spaghetti_value){ .field_id = 65531, .type = SPAGHETTI_VALUE_UINT64 };
 out->values.fields[0].data.unsigned_integer = state->on ? 1U : 0U;
 out->values.fields[1] = (struct spaghetti_value){ .field_id = 65532, .type = SPAGHETTI_VALUE_UINT64 };
 out->values.fields[1].data.unsigned_integer = state->on ? state->color : 0U;
}
static int rgb_program(const struct spaghetti_device_profile *profile,
 const struct spaghetti_device_profile_op *op, const struct spaghetti_port *port,
 const struct spaghetti_device_profile_binding *binding,
 struct spaghetti_device_profile_temp *temps, struct spaghetti_record_payload *out)
{
 if (!binding->rgb || !profile->message_data || !op->imm1 || op->imm1 > 96U ||
     op->imm1 % 6U || (uint64_t)op->imm0 + op->imm1 > profile->message_data_size) return -EINVAL;
 struct spaghetti_rgb_state next = *binding->rgb;
 next.channels = op->imm2; next.inverted = op->imm3 != 0;
 for (unsigned offset = op->imm0; offset < op->imm0 + op->imm1; offset += 6) {
   const uint8_t *row = profile->message_data + offset;
   uint32_t value = sys_get_le32(row + 2);
   if (row[0] > 5U || row[1] >= 8U) return -EINVAL;
   switch (row[0]) {
   case 0: next.on = false; break;
   case 1: next.on = true; break;
   case 2: if (value > 0xffffffU) return -ERANGE; next.color = value; next.on = true; break;
   case 3: next.color = next.variables[row[1]]; next.on = true; break;
   case 4: {
     struct spaghetti_device_profile_temp *src;
     if (value >= SPAGHETTI_DEVICE_PROFILE_TEMP_SLOTS || temp_get(temps, value, &src) || !src->size || src->size > 8) return -EINVAL;
     uint64_t color = load_unsigned_le(src->bytes, src->size);
     if (color > 0xffffffU) return -ERANGE;
     next.variables[row[1]] = color;
     break;
   }
   case 5: if (value > 0xffffffU) return -ERANGE; next.variables[row[1]] = value; break;
   }
 }
 int err = rgb_apply(&next, port);
 if (err) {
   if (binding->rgb->initialized) (void)rgb_apply(binding->rgb, port);
   else { next.on = false; (void)rgb_apply(&next, port); }
   return err;
 }
 next.initialized = true;
 if (!binding->rgb->initialized || next.on != binding->rgb->on || next.color != binding->rgb->color)
   next.revision++;
 *binding->rgb = next;
 spaghetti_device_profile_rgb_record(&next, out);
 return 0;
}

static int exec_with_message(uint8_t *message, const struct spaghetti_device_profile *profile,
			     const struct spaghetti_device_profile_op *ops, size_t op_count,
			     const struct spaghetti_port *port,
			     const struct spaghetti_device_profile_binding *binding,
			     struct spaghetti_record_payload *out_record)
{
	struct spaghetti_device_profile_temp temps[SPAGHETTI_DEVICE_PROFILE_TEMP_SLOTS];

	if ((profile == NULL) || ((op_count > 0U) && (ops == NULL)) || (port == NULL) ||
	    (binding == NULL)) {
		return -EINVAL;
	}

	size_t message_size = 0U;
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
		case SPAGHETTI_DEVICE_PROFILE_OP_MESSAGE_LOAD:
			if (message == NULL || op->imm0 == 0U ||
			    op->imm0 > SPAGHETTI_PROFILE_MESSAGE_MAX ||
			    profile->message_data == NULL ||
			    (uint64_t)op->imm2 + op->imm0 > profile->message_data_size)
				return -EINVAL;
			memcpy(message, profile->message_data + op->imm2, op->imm0);
			message_size = op->imm0;
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_MESSAGE_PATCH:
			err = temp_get(temps, op->src_a, &src_a);
			if (err != 0 || message == NULL || op->imm1 == 0U ||
			    op->imm1 > src_a->size || (size_t)op->imm0 + op->imm1 > message_size)
				return -EINVAL;
			memcpy(message + op->imm0, src_a->bytes, op->imm1);
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_I2C_MESSAGE_WRITE: {
			if (message == NULL || message_size == 0U || op->imm0 != message_size)
				return -EINVAL;
			struct i2c_msg msg = {.buf = message,
					      .len = message_size,
					      .flags = I2C_MSG_WRITE | I2C_MSG_STOP};
			struct spaghetti_port_i2c_request request = {
			    .address = binding->i2c_address, .messages = &msg, .message_count = 1U};
			err = spaghetti_port_i2c_transfer(
			    port, &request, K_MSEC(binding_timeout_ms(binding, op->imm1)));
			message_size = 0U;
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = exec_i2c_write(port, binding, src_a, op->imm0, op->imm1);
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_I2C_READ:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = exec_i2c_read(port, binding, dst, op->imm0, op->imm1);
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = temp_get(temps, op->dst, &dst);
			}
			if (err == 0) {
				err = exec_i2c_write_read(port, binding, src_a, dst, op->imm0,
							  (op->imm1 != 0U) ? op->imm1
									   : (uint16_t)src_a->size,
					(uint16_t)op->imm2);
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_SPI_TRANSCEIVE:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = temp_get(temps, op->dst, &dst);
			}
			if (err == 0) {
				err = exec_spi(port, binding, src_a, dst, op->imm0, op->imm1,
					       op->imm2, op->imm3);
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_UART_WRITE:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = spaghetti_port_uart_write(
					port, src_a->bytes,
					(op->imm0 != 0U) ? op->imm0 : src_a->size,
					K_MSEC(binding_timeout_ms(binding, op->imm1)));
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_UART_READ_UNTIL: {
			size_t out_len = 0U;

			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = spaghetti_port_uart_read_until(
					port, dst->bytes, op->imm0, (uint8_t)op->imm2, &out_len,
					K_MSEC(binding_timeout_ms(binding, op->imm1)));
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
					K_MSEC(binding_timeout_ms(binding, op->imm1)));
				if (err == 0) {
					dst->size = op->imm0;
				}
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_W1_WRITE_READ: {
			uint16_t write_size;

			if (!spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_W1)) {
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
			write_size = (op->imm1 != 0U) ? op->imm1 : (uint16_t)src_a->size;
			if ((write_size > src_a->size) || (op->imm0 > SPAGHETTI_VALUE_BYTES_MAX)) {
				err = -EINVAL;
				break;
			}
			err = spaghetti_port_w1_write_read(
				port, binding->w1_rom, src_a->bytes, write_size, dst->bytes,
				op->imm0, K_MSEC(binding_timeout_ms(binding, (uint16_t)op->imm2)));
			if (err == 0) {
				dst->size = op->imm0;
			}
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_GET: {
			bool high = false;

			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = spaghetti_port_digital_state_get(port, (uint8_t)op->imm0, &high);
				if (err == 0) {
					dst->bytes[0] = high ? 1U : 0U;
					dst->size = 1U;
				}
			}
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_SET:
			spaghetti_device_profile_cancel_pulses(binding->pulse_owner);
			err = spaghetti_port_digital_output_set(port, (uint8_t)op->imm1, op->imm0 != 0U);
			break;
    case SPAGHETTI_DEVICE_PROFILE_OP_DS18B20_SETUP: {
      struct spaghetti_dht22_state *s=binding->dht22;
      if(!s || op->imm2>4 || (op->imm2 && op->imm2-1==op->imm0))return -EINVAL;
      if(op->imm2) {
        err=spaghetti_port_dht22_power(port,op->imm0,op->imm2-1,op->imm1!=0);
        if(err)return err;
      }
      err=spaghetti_port_ds18b20_setup(port,op->imm0);
      if(!err) {
        memset(s,0,sizeof(*s));s->powered=op->imm1!=0;s->data_channel=op->imm0;
        s->power_channel=op->imm2?op->imm2-1:UINT8_MAX;
        s->ready_at=op->imm2 && s->powered?k_uptime_get()+1000:0;
      }
      break;
    }
    case SPAGHETTI_DEVICE_PROFILE_OP_DS18B20_READ: {
      struct spaghetti_dht22_state *s=binding->dht22;
      if(!s || !s->powered || s->data_channel!=op->imm0 || temp_get(temps,op->dst,&dst))return -EINVAL;
      if(!s->pending) { s->pending=true;s->attempted=false; }
      if(k_uptime_get()<s->ready_at)return -EAGAIN;
      if(!s->attempted) {
        err=spaghetti_port_ds18b20_start(port,op->imm0,s->power_channel==UINT8_MAX);
        if(err) { s->pending=false;return err; }
        s->attempted=true;s->ready_at=k_uptime_get()+750;return -EAGAIN;
      }
      err = op->imm1 ? spaghetti_port_ds18b20_finish_raw(port, op->imm0, dst->bytes)
                      : spaghetti_port_ds18b20_finish(port, op->imm0, &s->temperature);
      s->pending=false;s->attempted=false;s->ready_at=0;s->valid=err==0;
      if(err)return err;
      if (op->imm1) dst->size = 9;
      else { sys_put_le16((uint16_t)s->temperature,dst->bytes);dst->size=2; }
      break;
    }
    case SPAGHETTI_DEVICE_PROFILE_OP_DHT22_POWER: {
      struct spaghetti_dht22_state *state = binding->dht22;
      if (!state || op->imm0 > 3 || op->imm1 > 3 || op->imm0 == op->imm1 || op->imm2 > 1) return -EINVAL;
      err = spaghetti_port_dht22_power(port, op->imm0, op->imm1, op->imm2 != 0);
      if (!err) {
        bool restarting = !state->powered || state->data_channel != op->imm0 || state->power_channel != op->imm1;
        state->data_channel = op->imm0; state->power_channel = op->imm1;
        state->powered = op->imm2 != 0;
        if (!state->powered || restarting) { state->valid = false; state->pending = false; state->ready_at = k_uptime_get() + 2000; state->sampled_at = 0; state->attempted = false; }
      }
      break;
    }
    case SPAGHETTI_DEVICE_PROFILE_OP_DHT22_READ: {
      struct spaghetti_dht22_state *state = binding->dht22;
      if (!state || op->dst == op->src_a || temp_get(temps, op->dst, &dst) || temp_get(temps, op->src_a, &src_a)) return -EINVAL;
      if (!state->powered) return -EHOSTDOWN;
      if (state->data_channel != op->imm0 || state->power_channel != op->imm1) return -EINVAL;
      if (op->imm2 == 1U) state->pending = true;
      int64_t now = k_uptime_get();
      if (now < state->ready_at) return -EAGAIN;
      if (state->attempted && now - state->sampled_at < 2000) {
        if (op->imm2 == 1U) return -EAGAIN;
        if (!state->valid) return -EAGAIN;
      } else {
        state->sampled_at = now; state->attempted = true;
        err = op->imm3 ? spaghetti_port_dht11_read(port, op->imm0, op->imm1, &state->temperature, &state->humidity) : spaghetti_port_dht22_read(port, op->imm0, op->imm1, &state->temperature, &state->humidity);
        state->pending = false;
        state->valid = err == 0;
        if (err) break;
      }
      sys_put_le16((uint16_t)state->temperature, dst->bytes); dst->size = 2;
      sys_put_le16(state->humidity, src_a->bytes); src_a->size = 2;
      break;
    }
    case SPAGHETTI_DEVICE_PROFILE_OP_RGB_PROGRAM:
      err = rgb_program(profile, op, port, binding, temps, out_record);
      break;
		case SPAGHETTI_DEVICE_PROFILE_OP_STEPPER: {
			uint64_t degrees = 0U;
			if (op->imm0 == 2U) {
				err = temp_get(temps, op->src_a, &src_a);
				if (err < 0 || src_a->size == 0U || src_a->size > 8U) return -EINVAL;
				degrees = load_unsigned_le(src_a->bytes, src_a->size);
			}
			err = stepper_command(port, binding->pulse_owner, op, degrees, binding->module_key);
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_PULSE:
			err = gpio_pulse_start(port, binding->pulse_owner, op->imm0, op->imm1,
				(op->imm2 & 1U) != 0U, (op->imm2 & 2U) != 0U);
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_SET_VALUE: {
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				/* Digital values are exactly 0 or 1; never truncate e.g. 256 to zero. */
				if (src_a->size == 0U || src_a->size > 8U || src_a->bytes[0] > 1U) err = -ERANGE;
				for (size_t i = 1U; err == 0 && i < src_a->size; ++i)
					if (src_a->bytes[i] != 0U) err = -ERANGE;
				if (err == 0) {
					spaghetti_device_profile_cancel_pulses(binding->pulse_owner);
					err = spaghetti_port_digital_output_set(port, (uint8_t)op->imm0, (src_a->bytes[0] != 0U) != (op->imm1 != 0U));
				}
			}
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_ADC_READ: {
			int32_t microvolts = 0;

			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = spaghetti_port_adc_read(
					port, binding->adc_channel, NULL, &microvolts,
					K_MSEC(binding_timeout_ms(binding, op->imm0)));
				if (err == 0) {
					sys_put_be32((uint32_t)microvolts, dst->bytes);
					dst->size = 4U;
				}
			}
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_DELAY_BOUNDED: {
			int64_t until = k_uptime_get() + op->imm0;
			while (k_uptime_get() < until) {
				if (spaghetti_device_profile_execution_cancelled()) { err = -ECANCELED; break; }
				int64_t remaining = until - k_uptime_get();
				if (remaining > 0) { k_sleep(K_MSEC(MIN(10, remaining))); }
			}
			break;
		}
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
				size_t len = (op->imm0 != 0U) ? op->imm0 : src_a->size;

				if (((len + op->imm1) > src_a->size) ||
				    (len > SPAGHETTI_VALUE_BYTES_MAX)) {
					err = -EINVAL;
				} else {
					memmove(dst->bytes, src_a->bytes + op->imm1, len);
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
				if ((src_a->size + src_b->size) > SPAGHETTI_VALUE_BYTES_MAX) {
					err = -EMSGSIZE;
				} else {
					memcpy(dst->bytes, src_a->bytes, src_a->size);
					memcpy(&dst->bytes[src_a->size], src_b->bytes, src_b->size);
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
				uint32_t value = (uint32_t)load_unsigned_be(src_a->bytes,
									    MIN(src_a->size, 4U));

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
				uint64_t value =
					load_unsigned_be(src_a->bytes, MIN(src_a->size, 8U));

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

				if ((bits == 0U) || (bits > 64U) || (src_a->size == 0U)) {
					err = -EINVAL;
					break;
				}
				value = load_unsigned_be(src_a->bytes, MIN(src_a->size, 8U));
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
				dst->bytes[0] = crc8_poly07(src_a->bytes, src_a->size);
				dst->size = 1U;
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_CRC16:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = temp_get(temps, op->src_a, &src_a);
			}
			if (err == 0) {
				sys_put_be16(crc16_ccitt(src_a->bytes, src_a->size), dst->bytes);
				dst->size = 2U;
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_SCALE_PACK: {
			if (op->imm0 < 1 || op->imm0 > 8 || op->imm1 == 0 || op->src_b > 7) {
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
			if (!src_a->size || src_a->size > 8) {
				err = -EINVAL;
				break;
			}
			uint64_t raw = (op->src_b & 1)
					       ? load_unsigned_be(src_a->bytes, src_a->size)
					       : load_unsigned_le(src_a->bytes, src_a->size);
			if ((op->src_b & 2) && src_a->size < 8 &&
			    (raw & BIT64(src_a->size * 8 - 1))) {
				raw |= ~((1ULL << (src_a->size * 8)) - 1);
			}
			if (!(op->src_b & 2) && raw > INT64_MAX) {
				err = -ERANGE;
				break;
			}
			int64_t value = (int64_t)raw;
			if (__builtin_mul_overflow(value, (int64_t)(int32_t)op->imm2, &value)) {
				err = -ERANGE;
				break;
			}
			value /= op->imm1;
			if (__builtin_add_overflow(value, (int64_t)(int32_t)op->imm3, &value)) {
				err = -ERANGE;
				break;
			}
			if (op->imm0 < 8 &&
			    (value < -(1LL << (op->imm0 * 8 - 1)) ||
			     (value >= 0 && (uint64_t)value >= (1ULL << (op->imm0 * 8))))) {
				err = -ERANGE;
				break;
			}
			for (size_t i = 0; i < op->imm0; i++) {
				dst->bytes[(op->src_b & 4) ? op->imm0 - i - 1 : i] =
					((uint64_t)value >> (i * 8)) & 0xff;
			}
			dst->size = op->imm0;
			break;
		}
		case SPAGHETTI_DEVICE_PROFILE_OP_LOAD_VALUE:
		case SPAGHETTI_DEVICE_PROFILE_OP_LOAD_ARGUMENT:
			err = temp_get(temps, op->dst, &dst);
			if (err == 0) {
				err = spaghetti_device_profile_pack_argument(
					op,
					op->opcode == SPAGHETTI_DEVICE_PROFILE_OP_LOAD_VALUE
						? binding->values
						: binding->arguments,
					dst->bytes);
				if (err == 0) {
					dst->size = op->imm0;
				}
			}
			break;
		case SPAGHETTI_DEVICE_PROFILE_OP_EMIT_DECIMAL: {
            if (!out_record || op->imm0 > 1 || temp_get(temps, op->src_a, &src_a) || src_a->size != 2 ||
                out_record->values.field_count >= SPAGHETTI_PROPERTY_MAX_FIELDS) return -EINVAL;
            const struct spaghetti_device_profile_field *field = NULL;
            for (size_t f = 0; f < profile->sample_field_count; f++)
                if (profile->sample_fields[f].field_id == op->dst) field = &profile->sample_fields[f];
            if (!field || field->type != (op->imm0 ? SPAGHETTI_VALUE_TEXT : SPAGHETTI_VALUE_FLOAT)) return -EINVAL;
            int32_t raw = op->imm2 ? sys_get_le16(src_a->bytes) : (int16_t)sys_get_le16(src_a->bytes);
            unsigned divisor=op->imm1?op->imm1:10;
            struct spaghetti_value *value = &out_record->values.fields[out_record->values.field_count++];
            memset(value, 0, sizeof(*value)); value->field_id = op->dst; value->type = field->type;
            if (!op->imm0) value->data.decimal = (double)raw / divisor;
            else {
                int magnitude = raw < 0 ? -(int)raw : raw;
                int length = snprintf(value->data.text.text, sizeof(value->data.text.text), "%s%d.%0*u %s", raw < 0 ? "-" : "", magnitude / divisor, divisor==16?4:1, (unsigned)(magnitude % divisor)*(divisor==16?10000:10)/divisor, op->imm2?"%RH":"°C");
                if (length < 0 || length >= sizeof(value->data.text.text)) return -EMSGSIZE;
                value->data.text.size = length;
            }
            break;
        }
		case SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD:
			err = temp_get(temps, op->src_a, &src_a);
			if (err == 0) {
				err = exec_emit_field(profile, src_a, op, out_record);
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
			out_record->schema_id[sizeof(out_record->schema_id) - 1U] = '\0';
			out_record->schema_version = profile->sample_schema_version;
			break;
		default:
			err = -ENOTSUP;
			break;
		}

		if (err < 0) {
			return err;
		}
		if (capture_owner == k_current_get() &&
		    (ops == profile->init_ops || capture_commands) &&
		    (op->opcode == SPAGHETTI_DEVICE_PROFILE_OP_I2C_READ ||
		     op->opcode == SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ ||
		     op->opcode == SPAGHETTI_DEVICE_PROFILE_OP_GPIO_GET)) {
			if (init_rx.count < SPAGHETTI_PROFILE_RX_MAX) {
				const uint8_t index = init_rx.count++;
				init_rx.lengths[index] = temps[op->dst].size;
				memcpy(init_rx.bytes[index], temps[op->dst].bytes,
				       temps[op->dst].size);
			} else {
				init_rx.truncated = true;
			}
		}
	}

	return 0;
}

/* One dedicated workspace, shared with a bounded lock; ordinary actions allocate none. */
K_MUTEX_DEFINE(message_lock);

int spaghetti_device_profile_exec(const struct spaghetti_device_profile *profile,
				  const struct spaghetti_device_profile_op *ops, size_t op_count,
				  const struct spaghetti_port *port,
				  const struct spaghetti_device_profile_binding *binding,
				  struct spaghetti_record_payload *out_record)
{
	bool needs_message = false;
	if (ops == NULL && op_count != 0U)
		return -EINVAL;
	for (size_t i = 0U; i < op_count; ++i)
		if (ops[i].opcode == SPAGHETTI_DEVICE_PROFILE_OP_MESSAGE_LOAD ||
		    ops[i].opcode == SPAGHETTI_DEVICE_PROFILE_OP_MESSAGE_PATCH ||
		    ops[i].opcode == SPAGHETTI_DEVICE_PROFILE_OP_I2C_MESSAGE_WRITE)
			needs_message = true;
	if (!needs_message)
		return exec_with_message(NULL, profile, ops, op_count, port, binding, out_record);
	int err = k_mutex_lock(&message_lock, K_MSEC(1000));
	if (err < 0)
		return err;
	uint8_t *workspace = k_malloc(SPAGHETTI_PROFILE_MESSAGE_MAX);
	if (workspace == NULL) {
		k_mutex_unlock(&message_lock);
		return -ENOMEM;
	}
	err = exec_with_message(workspace, profile, ops, op_count, port, binding, out_record);
	k_free(workspace);
	k_mutex_unlock(&message_lock);
	return err;
}

int spaghetti_device_profile_pack_argument(const struct spaghetti_device_profile_op *op,
					   const struct spaghetti_property_set *arguments,
					   uint8_t out[8])
{
	if (op == NULL || out == NULL || op->imm0 == 0U || op->imm0 > 8U) {
		return -EINVAL;
	}
	const struct spaghetti_value *value =
		arguments ? spaghetti_property_find(arguments, op->src_a) : NULL;
	uint64_t raw = (uint64_t)op->imm2 | ((uint64_t)op->imm3 << 32);
	if (value == NULL) {
		if (op->src_b) {
			return -ENOENT;
		}
		if (op->imm0 < 8U && (raw >> (op->imm0 * 8U)) != 0U) {
			return -ERANGE;
		}
	} else if (value->type == SPAGHETTI_VALUE_BYTES) {
		if (value->data.bytes.size != op->imm0) {
			return -ERANGE;
		}
		memcpy(out, value->data.bytes.bytes, op->imm0);
		return 0;
	} else if (value->type == SPAGHETTI_VALUE_UINT64) {
		raw = value->data.unsigned_integer;
		if (op->imm0 < 8U && (raw >> (op->imm0 * 8U)) != 0U) {
			return -ERANGE;
		}
	} else if (value->type == SPAGHETTI_VALUE_INT64) {
		int64_t signed_value = value->data.signed_integer;
		if (op->imm0 < 8U) {
			int64_t limit = 1LL << (op->imm0 * 8U - 1U);
			if (signed_value < -limit ||
			    (signed_value >= 0 &&
			     (uint64_t)signed_value >= (1ULL << (op->imm0 * 8U)))) {
				return -ERANGE;
			}
		}
		raw = (uint64_t)signed_value;
	} else if (value->type == SPAGHETTI_VALUE_BOOL) {
		raw = value->data.boolean ? 1U : 0U;
	} else {
		return -ENOTSUP;
	}
	for (size_t i = 0; i < op->imm0; ++i) {
		size_t shift = op->imm1 ? i : op->imm0 - i - 1;
		out[i] = (uint8_t)(raw >> (shift * 8U));
	}
	return 0;
}
