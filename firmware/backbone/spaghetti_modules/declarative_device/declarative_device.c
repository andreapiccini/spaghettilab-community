#include "declarative_device.h"

#include <errno.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/device_profile.h>
#include <spaghetti/module.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

LOG_MODULE_REGISTER(spaghetti_declarative_device,
		    CONFIG_SPAGHETTI_DECLARATIVE_DEVICE_LOG_LEVEL);

struct spaghetti_declarative_context {
	const struct spaghetti_device_profile *profile;
	struct spaghetti_device_profile_binding binding;
	bool initialized;
};

K_MEM_SLAB_DEFINE(declarative_context_slab,
		  sizeof(struct spaghetti_declarative_context),
		  CONFIG_SPAGHETTI_DECLARATIVE_DEVICE_MAX_INSTANCES,
		  __alignof__(struct spaghetti_declarative_context));

static const struct spaghetti_field_descriptor declarative_config_fields[] = {
	{
		.field_id = SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_ID,
		.type = SPAGHETTI_VALUE_TEXT,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.name = "profile_id",
		.description = "Device Profile identifier",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_VERSION,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT16_MAX,
		.name = "profile_version",
		.description = "Device Profile version",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_HASH,
		.type = SPAGHETTI_VALUE_BYTES,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_WRITABLE,
		.bytes_min_size = 0U,
		.bytes_max_size = SPAGHETTI_VALUE_BYTES_MAX,
		.name = "profile_hash",
		.description = "Optional profile image digest prefix or full SHA-256",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_DECLARATIVE_CONFIG_I2C_ADDRESS,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0U,
		.unsigned_maximum = 0x7FU,
		.name = "i2c_address",
		.description = "Instance 7-bit I2C address",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_DECLARATIVE_CONFIG_SPI_CS,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0U,
		.unsigned_maximum = 4U,
		.name = "spi_cs",
		.description = "Instance SPI chip-select index",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_DECLARATIVE_CONFIG_ADC_CHANNEL,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0U,
		.unsigned_maximum = 4U,
		.name = "adc_channel",
		.description = "Instance ADC channel index",
		.unit = "",
	},
	{
		.field_id = SPAGHETTI_DECLARATIVE_CONFIG_SPI_FREQUENCY_HZ,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 1U,
		.unsigned_maximum = 40000000U,
		.name = "spi_frequency_hz",
		.description = "Instance SPI clock",
		.unit = "Hz",
	},
	{
		.field_id = SPAGHETTI_DECLARATIVE_CONFIG_W1_ROM,
		.type = SPAGHETTI_VALUE_BYTES,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_WRITABLE,
		.bytes_min_size = SPAGHETTI_ENDPOINT_VALUE_MAX,
		.bytes_max_size = SPAGHETTI_ENDPOINT_VALUE_MAX,
		.name = "w1_rom",
		.description = "Instance 1-Wire ROM identity",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor declarative_config_schema = {
	.schema_id = "spaghetti.decl.config",
	.version = 1U,
	.fields = declarative_config_fields,
	.field_count = ARRAY_SIZE(declarative_config_fields),
};

/*
 * Placeholder schema for Registry coherence. Live payloads use the profile's
 * owned sample schema and are validated inside read().
 */
static const struct spaghetti_field_descriptor declarative_sample_fields[] = {
	{
		.field_id = 1U,
		.type = SPAGHETTI_VALUE_INT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "value",
		.description = "Placeholder sample field",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor declarative_sample_schema = {
	.schema_id = "spaghetti.decl.sample",
	.version = 1U,
	.fields = declarative_sample_fields,
	.field_count = ARRAY_SIZE(declarative_sample_fields),
};

static const struct spaghetti_schema_descriptor *const declarative_record_schemas[] = {
	&declarative_sample_schema,
};

static int resolve_profile(
	const struct spaghetti_property_set *config,
	const struct spaghetti_device_profile **out_profile,
	struct spaghetti_device_profile_binding *out_binding)
{
	const struct spaghetti_value *id;
	const struct spaghetti_value *version;
	const struct spaghetti_value *hash;
	const struct spaghetti_value *i2c_address;
	const struct spaghetti_value *spi_cs;
	const struct spaghetti_value *adc_channel;
	const struct spaghetti_value *spi_frequency;
	const struct spaghetti_value *w1_rom;
	const struct spaghetti_device_profile *profile;
	const uint8_t *hash_bytes = NULL;
	int err;

	err = spaghetti_property_validate(config, &declarative_config_schema);
	if (err < 0) {
		return err;
	}

	id = spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_ID);
	version = spaghetti_property_find(
		config, SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_VERSION);
	if ((id == NULL) || (id->type != SPAGHETTI_VALUE_TEXT) ||
	    (version == NULL) || (version->type != SPAGHETTI_VALUE_UINT64) ||
	    (version->data.unsigned_integer == 0U) ||
	    (version->data.unsigned_integer > UINT16_MAX)) {
		return -EINVAL;
	}

	hash = spaghetti_property_find(config,
				       SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_HASH);
	if (hash != NULL) {
		if ((hash->type != SPAGHETTI_VALUE_BYTES) ||
		    (hash->data.bytes.size == 0U) ||
		    (hash->data.bytes.size > SPAGHETTI_DEVICE_PROFILE_HASH_SIZE)) {
			return -EINVAL;
		}
		if (hash->data.bytes.size == SPAGHETTI_DEVICE_PROFILE_HASH_SIZE) {
			hash_bytes = hash->data.bytes.bytes;
		} else {
			return -EPROTONOSUPPORT;
		}
	}

	profile = spaghetti_device_profile_find(
		id->data.text.text, (uint16_t)version->data.unsigned_integer,
		hash_bytes);
	if (profile == NULL) {
		return -ENOENT;
	}

	memset(out_binding, 0, sizeof(*out_binding));
	out_binding->default_timeout_ms = 100U;
	out_binding->spi_frequency_hz = 1000000U;

	i2c_address = spaghetti_property_find(
		config, SPAGHETTI_DECLARATIVE_CONFIG_I2C_ADDRESS);
	if (i2c_address != NULL) {
		if (i2c_address->type != SPAGHETTI_VALUE_UINT64) {
			return -EINVAL;
		}
		out_binding->i2c_address =
			(uint16_t)i2c_address->data.unsigned_integer;
	}

	spi_cs = spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_SPI_CS);
	if (spi_cs != NULL) {
		if (spi_cs->type != SPAGHETTI_VALUE_UINT64) {
			return -EINVAL;
		}
		out_binding->spi_cs = (uint8_t)spi_cs->data.unsigned_integer;
	}

	adc_channel = spaghetti_property_find(
		config, SPAGHETTI_DECLARATIVE_CONFIG_ADC_CHANNEL);
	if (adc_channel != NULL) {
		if (adc_channel->type != SPAGHETTI_VALUE_UINT64) {
			return -EINVAL;
		}
		out_binding->adc_channel =
			(uint8_t)adc_channel->data.unsigned_integer;
	}

	spi_frequency = spaghetti_property_find(
		config, SPAGHETTI_DECLARATIVE_CONFIG_SPI_FREQUENCY_HZ);
	if (spi_frequency != NULL) {
		if (spi_frequency->type != SPAGHETTI_VALUE_UINT64) {
			return -EINVAL;
		}
		out_binding->spi_frequency_hz =
			(uint32_t)spi_frequency->data.unsigned_integer;
	}

	w1_rom = spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_W1_ROM);
	if (w1_rom != NULL) {
		if ((w1_rom->type != SPAGHETTI_VALUE_BYTES) ||
		    (w1_rom->data.bytes.size != SPAGHETTI_ENDPOINT_VALUE_MAX)) {
			return -EINVAL;
		}
		memcpy(out_binding->w1_rom, w1_rom->data.bytes.bytes,
		       SPAGHETTI_ENDPOINT_VALUE_MAX);
	}

	*out_profile = profile;
	return 0;
}

static int declarative_validate_config(const struct spaghetti_property_set *config)
{
	const struct spaghetti_device_profile *profile;
	struct spaghetti_device_profile_binding binding;

	return resolve_profile(config, &profile, &binding);
}

static int declarative_describe_endpoint(
	const struct spaghetti_property_set *config,
	struct spaghetti_module_endpoint *out)
{
	const struct spaghetti_device_profile *profile;
	struct spaghetti_device_profile_binding binding;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = resolve_profile(config, &profile, &binding);
	if (err < 0) {
		return err;
	}

	memset(out, 0, sizeof(*out));
	switch (profile->transport) {
	case SPAGHETTI_PORT_TRANSPORT_I2C:
		out->kind = SPAGHETTI_ENDPOINT_I2C_ADDRESS;
		out->value_size = 1U;
		out->value[0] = (uint8_t)binding.i2c_address;
		break;
	case SPAGHETTI_PORT_TRANSPORT_SPI:
		out->kind = SPAGHETTI_ENDPOINT_SPI_CHIP_SELECT;
		out->value_size = 1U;
		out->value[0] = binding.spi_cs;
		break;
	case SPAGHETTI_PORT_TRANSPORT_UART:
		out->kind = SPAGHETTI_ENDPOINT_UART_EXCLUSIVE;
		break;
	case SPAGHETTI_PORT_TRANSPORT_GPIO:
		out->kind = SPAGHETTI_ENDPOINT_GPIO_LINE;
		out->value_size = 1U;
		out->value[0] = 0U;
		break;
	case SPAGHETTI_PORT_TRANSPORT_ADC:
		out->kind = SPAGHETTI_ENDPOINT_ADC_CHANNEL;
		out->value_size = 1U;
		out->value[0] = binding.adc_channel;
		break;
	case SPAGHETTI_PORT_TRANSPORT_W1:
		out->kind = SPAGHETTI_ENDPOINT_W1_ROM;
		out->value_size = SPAGHETTI_ENDPOINT_VALUE_MAX;
		memcpy(out->value, binding.w1_rom, SPAGHETTI_ENDPOINT_VALUE_MAX);
		break;
	default:
		return -ENOTSUP;
	}

	return 0;
}

static int declarative_run_safe_stop(struct spaghetti_declarative_context *context,
				     const struct spaghetti_port *port)
{
	if ((context->profile == NULL) ||
	    (context->profile->safe_stop_count == 0U)) {
		return 0;
	}

	return spaghetti_device_profile_exec(
		context->profile, context->profile->safe_stop_ops,
		context->profile->safe_stop_count, port, &context->binding,
		NULL);
}

static int declarative_init(
	struct spaghetti_module *module,
	const struct spaghetti_property_set *config)
{
	struct spaghetti_declarative_context *context;
	const struct spaghetti_device_profile *profile;
	struct spaghetti_device_profile_binding binding;
	int err;

	if ((module == NULL) || (module->context != NULL) ||
	    (module->port == NULL)) {
		return -EINVAL;
	}

	err = resolve_profile(config, &profile, &binding);
	if (err < 0) {
		return err;
	}

	if (!spaghetti_port_has_capability(module->port,
					   profile->required_capabilities)) {
		return -ENOTSUP;
	}

	err = k_mem_slab_alloc(&declarative_context_slab, (void **)&context,
			       K_NO_WAIT);
	if (err < 0) {
		return -ENOMEM;
	}

	memset(context, 0, sizeof(*context));
	context->profile = profile;
	context->binding = binding;
	module->context = context;

	err = spaghetti_device_profile_exec(profile, profile->init_ops,
					    profile->init_count, module->port,
					    &binding, NULL);
	if (err < 0) {
		(void)declarative_run_safe_stop(context, module->port);
		k_mem_slab_free(&declarative_context_slab, (void *)context);
		module->context = NULL;
		return err;
	}

	context->initialized = true;
	return 0;
}

static int declarative_read(
	struct spaghetti_module *module,
	struct spaghetti_record_payload *out)
{
	struct spaghetti_declarative_context *context;
	struct spaghetti_field_descriptor fields
		[SPAGHETTI_DEVICE_PROFILE_MAX_FIELDS];
	struct spaghetti_schema_descriptor schema;
	int err;

	if ((module == NULL) || (module->context == NULL) || (out == NULL) ||
	    (module->port == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	if (!context->initialized || (context->profile == NULL)) {
		return -EINVAL;
	}

	err = spaghetti_device_profile_exec(
		context->profile, context->profile->sample_ops,
		context->profile->sample_count, module->port, &context->binding,
		out);
	if (err < 0) {
		return err;
	}

	err = spaghetti_device_profile_make_schema(context->profile, fields,
						  &schema);
	if (err < 0) {
		return err;
	}

	return spaghetti_record_payload_validate(out, &schema);
}

static int declarative_deinit(struct spaghetti_module *module)
{
	struct spaghetti_declarative_context *context;
	int err;

	if ((module == NULL) || (module->context == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	err = declarative_run_safe_stop(context, module->port);
	context->initialized = false;
	k_mem_slab_free(&declarative_context_slab, (void *)context);
	module->context = NULL;
	module->state = SPAGHETTI_MODULE_UNINITIALIZED;
	return err;
}

static const struct spaghetti_module_driver_ops declarative_ops = {
	.validate_config = declarative_validate_config,
	.describe_endpoint = declarative_describe_endpoint,
	.init = declarative_init,
	.read = declarative_read,
	.command = NULL,
	.start = NULL,
	.stop = NULL,
	.deinit = declarative_deinit,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_declarative_device_driver) = {
	.type_id = "declarative-device",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = 0U,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.power_requirement = { .declared = false },
	.config_schema = &declarative_config_schema,
	.record_schemas = declarative_record_schemas,
	.record_schema_count = ARRAY_SIZE(declarative_record_schemas),
	.commands = NULL,
	.command_count = 0U,
	.ops = &declarative_ops,
};
