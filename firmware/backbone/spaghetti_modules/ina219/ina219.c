#include <ina219.h>

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/device.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/util.h>

#include <spaghetti/module.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

LOG_MODULE_REGISTER(spaghetti_ina219, CONFIG_SPAGHETTI_INA219_LOG_LEVEL);

#define SPAGHETTI_INA219_REG_CONFIG 0x00U
#define SPAGHETTI_INA219_REG_BUS_VOLTAGE 0x02U
#define SPAGHETTI_INA219_REG_POWER 0x03U
#define SPAGHETTI_INA219_REG_CURRENT 0x04U
#define SPAGHETTI_INA219_REG_CALIBRATION 0x05U

#define SPAGHETTI_INA219_CONFIG_RESET 0x8000U
#define SPAGHETTI_INA219_CONFIG_TRIGGERED 0x399BU
#define SPAGHETTI_INA219_BUS_CNVR BIT(1)
#define SPAGHETTI_INA219_BUS_OVF BIT(0)

#define SPAGHETTI_INA219_ADDRESS_MIN 0x40U
#define SPAGHETTI_INA219_ADDRESS_MAX 0x4FU
#define SPAGHETTI_INA219_CALIBRATION_NUMERATOR 40960000ULL
#define SPAGHETTI_INA219_BUS_VOLTAGE_LSB_UV 4000ULL
#define SPAGHETTI_INA219_POWER_LSB_MULTIPLIER 20ULL
#define SPAGHETTI_INA219_CONVERSION_ATTEMPTS 10U

struct spaghetti_ina219_context {
	const struct spaghetti_port *port;
	struct spaghetti_ina219_config config;
	uint16_t calibration;
	bool initialized;
};

K_MEM_SLAB_DEFINE(ina219_context_slab,
		  sizeof(struct spaghetti_ina219_context),
		  CONFIG_SPAGHETTI_INA219_MAX_INSTANCES,
		  __alignof__(struct spaghetti_ina219_context));

static const struct spaghetti_field_descriptor ina219_config_fields[] = {
	{
		.field_id = SPAGHETTI_INA219_CONFIG_ADDRESS,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = SPAGHETTI_INA219_ADDRESS_MIN,
		.unsigned_maximum = SPAGHETTI_INA219_ADDRESS_MAX,
		.name = "address",
		.description = "INA219 7-bit I2C address",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_INA219_CONFIG_SHUNT_MILLIOHM,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT64_MAX,
		.name = "shunt_milliohm",
		.description = "Shunt resistance",
		.unit = "mOhm",
	},
	{
		.field_id = SPAGHETTI_INA219_CONFIG_CURRENT_LSB_MICROAMP,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT64_MAX,
		.name = "current_lsb_microamp",
		.description = "Current register LSB weight",
		.unit = "uA",
	},
};

static const struct spaghetti_schema_descriptor ina219_config_schema = {
	.schema_id = "spaghetti.ina219.config",
	.version = 1U,
	.fields = ina219_config_fields,
	.field_count = ARRAY_SIZE(ina219_config_fields),
};

static const struct spaghetti_field_descriptor ina219_sample_fields[] = {
	{
		.field_id = SPAGHETTI_INA219_FIELD_BUS_VOLTAGE_MICROVOLTS,
		.type = SPAGHETTI_VALUE_INT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "bus_voltage_microvolts",
		.description = "Bus voltage",
		.unit = "uV",
	},
	{
		.field_id = SPAGHETTI_INA219_FIELD_CURRENT_MICROAMPS,
		.type = SPAGHETTI_VALUE_INT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "current_microamps",
		.description = "Signed shunt current",
		.unit = "uA",
	},
	{
		.field_id = SPAGHETTI_INA219_FIELD_POWER_MICROWATTS,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_minimum = 0U,
		.unsigned_maximum = UINT64_MAX,
		.name = "power_microwatts",
		.description = "Instantaneous power",
		.unit = "uW",
	},
};

static const struct spaghetti_schema_descriptor ina219_sample_schema = {
	.schema_id = "spaghetti.ina219.sample",
	.version = 1U,
	.fields = ina219_sample_fields,
	.field_count = ARRAY_SIZE(ina219_sample_fields),
};

static const struct spaghetti_schema_descriptor *const ina219_record_schemas[] = {
	&ina219_sample_schema,
};

int spaghetti_ina219_config_to_properties(
	const struct spaghetti_ina219_config *in,
	struct spaghetti_property_set *out)
{
	if ((in == NULL) || (out == NULL)) {
		return -EINVAL;
	}

	memset(out, 0, sizeof(*out));
	out->field_count = 3U;
	out->fields[0] = (struct spaghetti_value){
		.field_id = SPAGHETTI_INA219_CONFIG_ADDRESS,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = in->i2c_address,
	};
	out->fields[1] = (struct spaghetti_value){
		.field_id = SPAGHETTI_INA219_CONFIG_SHUNT_MILLIOHM,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = in->shunt_milliohm,
	};
	out->fields[2] = (struct spaghetti_value){
		.field_id = SPAGHETTI_INA219_CONFIG_CURRENT_LSB_MICROAMP,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = in->current_lsb_microamp,
	};
	return 0;
}

int spaghetti_ina219_config_from_properties(
	const struct spaghetti_property_set *in,
	struct spaghetti_ina219_config *out)
{
	const struct spaghetti_value *address;
	const struct spaghetti_value *shunt;
	const struct spaghetti_value *lsb;

	if ((in == NULL) || (out == NULL)) {
		return -EINVAL;
	}

	address = spaghetti_property_find(in, SPAGHETTI_INA219_CONFIG_ADDRESS);
	shunt = spaghetti_property_find(in, SPAGHETTI_INA219_CONFIG_SHUNT_MILLIOHM);
	lsb = spaghetti_property_find(in,
				      SPAGHETTI_INA219_CONFIG_CURRENT_LSB_MICROAMP);
	if ((address == NULL) || (address->type != SPAGHETTI_VALUE_UINT64) ||
	    (shunt == NULL) || (shunt->type != SPAGHETTI_VALUE_UINT64) ||
	    (lsb == NULL) || (lsb->type != SPAGHETTI_VALUE_UINT64)) {
		return -EINVAL;
	}
	if ((address->data.unsigned_integer > UINT8_MAX) ||
	    (shunt->data.unsigned_integer > UINT16_MAX) ||
	    (lsb->data.unsigned_integer > UINT16_MAX)) {
		return -ERANGE;
	}

	out->i2c_address = (uint8_t)address->data.unsigned_integer;
	out->shunt_milliohm = (uint16_t)shunt->data.unsigned_integer;
	out->current_lsb_microamp = (uint16_t)lsb->data.unsigned_integer;
	return 0;
}

static int ina219_write_register(const struct spaghetti_ina219_context *context,
				 uint8_t reg, uint16_t value)
{
	uint8_t buffer[3] = {reg, 0U, 0U};
	struct i2c_msg message = {
		.buf = buffer,
		.len = sizeof(buffer),
		.flags = I2C_MSG_WRITE | I2C_MSG_STOP,
	};
	const struct spaghetti_port_i2c_request request = {
		.address = context->config.i2c_address,
		.messages = &message,
		.message_count = 1U,
	};

	sys_put_be16(value, &buffer[1]);
	return spaghetti_port_i2c_transfer(context->port, &request, K_MSEC(100));
}

static int ina219_read_register(const struct spaghetti_ina219_context *context,
				uint8_t reg, uint16_t *out)
{
	uint8_t buffer[2];
	struct i2c_msg messages[2] = {
		{
			.buf = &reg,
			.len = sizeof(reg),
			.flags = I2C_MSG_WRITE,
		},
		{
			.buf = buffer,
			.len = sizeof(buffer),
			.flags = I2C_MSG_READ | I2C_MSG_STOP,
		},
	};
	const struct spaghetti_port_i2c_request request = {
		.address = context->config.i2c_address,
		.messages = messages,
		.message_count = 2U,
	};
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = spaghetti_port_i2c_transfer(context->port, &request, K_MSEC(100));
	if (err < 0) {
		return err;
	}

	*out = sys_get_be16(buffer);
	return 0;
}

static int ina219_validate_config(const struct spaghetti_property_set *config)
{
	struct spaghetti_ina219_config ignored;
	int err;

	if (config == NULL) {
		return -EINVAL;
	}

	err = spaghetti_property_validate(config, &ina219_config_schema);
	if (err < 0) {
		return err;
	}

	return spaghetti_ina219_config_from_properties(config, &ignored);
}

static int ina219_describe_endpoint(const struct spaghetti_property_set *config,
				    struct spaghetti_module_endpoint *out)
{
	struct spaghetti_ina219_config ina219_config;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = ina219_validate_config(config);
	if (err < 0) {
		return err;
	}

	err = spaghetti_ina219_config_from_properties(config, &ina219_config);
	if (err < 0) {
		return err;
	}

	const struct spaghetti_module_endpoint endpoint = {
		.kind = SPAGHETTI_ENDPOINT_I2C_ADDRESS,
		.value_size = 1U,
		.value = {ina219_config.i2c_address},
	};

	*out = endpoint;
	return 0;
}

static void ina219_free_context(struct spaghetti_ina219_context *context)
{
	memset(context, 0, sizeof(*context));
	k_mem_slab_free(&ina219_context_slab, context);
}

static int ina219_init(struct spaghetti_module *module,
		       const struct spaghetti_property_set *config)
{
	struct spaghetti_ina219_config ina219_config;
	struct spaghetti_ina219_context *context;
	void *context_block;
	uint64_t denominator;
	uint64_t calibration;
	int err;

	if ((module == NULL) || (module->port == NULL) || (module->context != NULL)) {
		return -EINVAL;
	}

	err = ina219_validate_config(config);
	if (err < 0) {
		return err;
	}

	err = spaghetti_ina219_config_from_properties(config, &ina219_config);
	if (err < 0) {
		return err;
	}

	err = k_mem_slab_alloc(&ina219_context_slab, &context_block, K_NO_WAIT);
	if (err < 0) {
		return -ENOMEM;
	}

	context = context_block;
	memset(context, 0, sizeof(*context));
	if (!spaghetti_port_has_capability(module->port, SPAGHETTI_PORT_CAP_I2C)) {
		err = -ENOTSUP;
		goto free_context;
	}

	denominator = (uint64_t)ina219_config.shunt_milliohm *
		      (uint64_t)ina219_config.current_lsb_microamp;
	calibration = SPAGHETTI_INA219_CALIBRATION_NUMERATOR / denominator;
	if ((calibration == 0U) || (calibration > UINT16_MAX)) {
		err = -ERANGE;
		goto free_context;
	}

	context->port = module->port;
	context->config = ina219_config;
	context->calibration = (uint16_t)calibration;

	err = ina219_write_register(context, SPAGHETTI_INA219_REG_CONFIG,
				    SPAGHETTI_INA219_CONFIG_RESET);
	if (err < 0) {
		err = (err == -EIO) ? -ENODEV : err;
		goto free_context;
	}

	k_sleep(K_MSEC(1));
	err = ina219_write_register(context, SPAGHETTI_INA219_REG_CONFIG,
				    SPAGHETTI_INA219_CONFIG_TRIGGERED);
	if (err < 0) {
		goto free_context;
	}

	err = ina219_write_register(context, SPAGHETTI_INA219_REG_CALIBRATION,
				    context->calibration);
	if (err < 0) {
		goto free_context;
	}

	context->initialized = true;
	module->context = context;
	return 0;

free_context:
	ina219_free_context(context);
	return err;
}

static int ina219_read(struct spaghetti_module *module,
		       struct spaghetti_record_payload *out)
{
	struct spaghetti_ina219_context *context;
	struct spaghetti_record_payload payload;
	uint16_t bus_raw = 0U;
	uint16_t current_raw;
	uint16_t power_raw;
	bool is_conversion_ready = false;
	int64_t current_ua;
	uint64_t bus_uv;
	uint64_t power_uw;
	int err;

	if ((module == NULL) || (out == NULL) ||
	    (module->state != SPAGHETTI_MODULE_READY) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	if (!context->initialized) {
		return -EINVAL;
	}

	err = ina219_write_register(context, SPAGHETTI_INA219_REG_CONFIG,
				    SPAGHETTI_INA219_CONFIG_TRIGGERED);
	if (err < 0) {
		return err;
	}

	k_sleep(K_MSEC(2));
	for (size_t attempt_idx = 0U;
	     attempt_idx < SPAGHETTI_INA219_CONVERSION_ATTEMPTS;
	     ++attempt_idx) {
		err = ina219_read_register(context, SPAGHETTI_INA219_REG_BUS_VOLTAGE,
					  &bus_raw);
		if (err < 0) {
			return err;
		}

		if ((bus_raw & SPAGHETTI_INA219_BUS_CNVR) != 0U) {
			is_conversion_ready = true;
			break;
		}

		k_sleep(K_MSEC(1));
	}

	if (!is_conversion_ready) {
		return -ETIMEDOUT;
	}

	if ((bus_raw & SPAGHETTI_INA219_BUS_OVF) != 0U) {
		return -ERANGE;
	}

	err = ina219_read_register(context, SPAGHETTI_INA219_REG_CURRENT, &current_raw);
	if (err < 0) {
		return err;
	}

	err = ina219_read_register(context, SPAGHETTI_INA219_REG_POWER, &power_raw);
	if (err < 0) {
		return err;
	}

	bus_uv = (uint64_t)(bus_raw >> 3U) * SPAGHETTI_INA219_BUS_VOLTAGE_LSB_UV;
	current_ua = (int64_t)(int16_t)current_raw *
		     (int64_t)context->config.current_lsb_microamp;
	power_uw = (uint64_t)power_raw *
		   (uint64_t)context->config.current_lsb_microamp *
		   SPAGHETTI_INA219_POWER_LSB_MULTIPLIER;

	if (bus_uv > (uint64_t)INT64_MAX) {
		return -ERANGE;
	}

	memset(&payload, 0, sizeof(payload));
	payload.kind = SPAGHETTI_RECORD_SAMPLE;
	payload.schema_version = ina219_sample_schema.version;
	strncpy(payload.schema_id, ina219_sample_schema.schema_id,
		sizeof(payload.schema_id) - 1U);
	payload.values.field_count = 3U;
	payload.values.fields[0] = (struct spaghetti_value){
		.field_id = SPAGHETTI_INA219_FIELD_BUS_VOLTAGE_MICROVOLTS,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = (int64_t)bus_uv,
	};
	payload.values.fields[1] = (struct spaghetti_value){
		.field_id = SPAGHETTI_INA219_FIELD_CURRENT_MICROAMPS,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = current_ua,
	};
	payload.values.fields[2] = (struct spaghetti_value){
		.field_id = SPAGHETTI_INA219_FIELD_POWER_MICROWATTS,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = power_uw,
	};

	*out = payload;
	return 0;
}

static int ina219_deinit(struct spaghetti_module *module)
{
	struct spaghetti_ina219_context *context;
	int err;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	if (!context->initialized) {
		return -EINVAL;
	}

	err = ina219_write_register(context, SPAGHETTI_INA219_REG_CONFIG, 0x0000U);
	context->initialized = false;
	ina219_free_context(context);
	module->context = NULL;
	module->state = SPAGHETTI_MODULE_UNINITIALIZED;
	return err;
}

static const struct spaghetti_module_driver_ops ina219_ops = {
	.validate_config = ina219_validate_config,
	.describe_endpoint = ina219_describe_endpoint,
	.init = ina219_init,
	.read = ina219_read,
	.command = NULL,
	.start = NULL,
	.stop = NULL,
	.deinit = ina219_deinit,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_ina219_driver) = {
	.type_id = "ina219",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.power_requirement = { .declared = false },
	.config_schema = &ina219_config_schema,
	.record_schemas = ina219_record_schemas,
	.record_schema_count = ARRAY_SIZE(ina219_record_schemas),
	.commands = NULL,
	.command_count = 0U,
	.ops = &ina219_ops,
};
