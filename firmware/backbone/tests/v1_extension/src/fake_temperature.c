/**
 * @file
 * @brief Fake temperature Module: I2C config, INT64 sample, sync read.
 */

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/sys/util.h>

#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

enum {
	FAKE_TEMP_CFG_ADDRESS = 1U,
	FAKE_TEMP_FIELD_MILLI_C = 1U,
};

struct fake_temp_context {
	bool used;
	uint8_t address;
	int64_t milli_c;
};

static struct fake_temp_context contexts[CONFIG_SPAGHETTI_MAX_MODULES];

static const struct spaghetti_field_descriptor config_fields[] = {
	{
		.field_id = FAKE_TEMP_CFG_ADDRESS,
		.type = SPAGHETTI_VALUE_UINT64,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0x08U,
		.unsigned_maximum = 0x77U,
		.name = "address",
		.description = "Fake temperature I2C address",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor config_schema = {
	.schema_id = "spaghetti.fake_temp.config",
	.version = 1U,
	.fields = config_fields,
	.field_count = ARRAY_SIZE(config_fields),
};

static const struct spaghetti_field_descriptor sample_fields[] = {
	{
		.field_id = FAKE_TEMP_FIELD_MILLI_C,
		.type = SPAGHETTI_VALUE_INT64,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "temperature_milli_c",
		.description = "Fake temperature",
		.unit = "mC",
	},
};

static const struct spaghetti_schema_descriptor sample_schema = {
	.schema_id = "spaghetti.fake_temp.sample",
	.version = 1U,
	.fields = sample_fields,
	.field_count = ARRAY_SIZE(sample_fields),
};

static const struct spaghetti_schema_descriptor *const record_schemas[] = {
	&sample_schema,
};

static int validate_config(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &config_schema);
}

static int describe_endpoint(const struct spaghetti_property_set *config,
			     struct spaghetti_module_endpoint *out)
{
	const struct spaghetti_value *address;

	if (out == NULL) {
		return -EINVAL;
	}
	address = spaghetti_property_find(config, FAKE_TEMP_CFG_ADDRESS);
	if ((address == NULL) || (address->type != SPAGHETTI_VALUE_UINT64)) {
		return -EINVAL;
	}
	*out = (struct spaghetti_module_endpoint){
		.kind = SPAGHETTI_ENDPOINT_I2C_ADDRESS,
		.value_size = 1U,
		.value = {(uint8_t)address->data.unsigned_integer},
	};
	return 0;
}

static int init_module(struct spaghetti_module *module,
		       const struct spaghetti_property_set *config)
{
	const struct spaghetti_value *address =
		spaghetti_property_find(config, FAKE_TEMP_CFG_ADDRESS);

	if ((module == NULL) || (module->context != NULL) || (address == NULL)) {
		return -EINVAL;
	}
	for (size_t idx = 0U; idx < ARRAY_SIZE(contexts); ++idx) {
		if (!contexts[idx].used) {
			contexts[idx].used = true;
			contexts[idx].address =
				(uint8_t)address->data.unsigned_integer;
			contexts[idx].milli_c = 25000;
			module->context = &contexts[idx];
			return 0;
		}
	}
	return -ENOMEM;
}

static int read_module(struct spaghetti_module *module,
		       struct spaghetti_record_payload *out)
{
	struct fake_temp_context *ctx;

	if ((module == NULL) || (module->context == NULL) || (out == NULL)) {
		return -EINVAL;
	}
	ctx = module->context;
	memset(out, 0, sizeof(*out));
	out->kind = SPAGHETTI_RECORD_SAMPLE;
	out->schema_version = 1U;
	strncpy(out->schema_id, sample_schema.schema_id,
		sizeof(out->schema_id) - 1U);
	out->values.field_count = 1U;
	out->values.fields[0] = (struct spaghetti_value){
		.field_id = FAKE_TEMP_FIELD_MILLI_C,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = ctx->milli_c,
	};
	return 0;
}

static int deinit_module(struct spaghetti_module *module)
{
	struct fake_temp_context *ctx;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}
	ctx = module->context;
	ctx->used = false;
	module->context = NULL;
	return 0;
}

static const struct spaghetti_module_driver_ops ops = {
	.validate_config = validate_config,
	.describe_endpoint = describe_endpoint,
	.init = init_module,
	.read = read_module,
	.deinit = deinit_module,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_fake_temperature_driver) = {
	.type_id = "fake_temperature",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.power_requirement = {
		.declared = true,
		.min_microvolts = 3000000U,
		.max_microvolts = 3600000U,
		.max_microamps = 10000U,
	},
	.config_schema = &config_schema,
	.record_schemas = record_schemas,
	.record_schema_count = ARRAY_SIZE(record_schemas),
	.ops = &ops,
};
