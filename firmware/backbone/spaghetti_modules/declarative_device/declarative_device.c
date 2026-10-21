#include "declarative_device.h"

#include <errno.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>
#include <zephyr/sys/byteorder.h>

#include <spaghetti/device_profile.h>
#include <spaghetti/module.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

LOG_MODULE_REGISTER(spaghetti_declarative_device, CONFIG_SPAGHETTI_DECLARATIVE_DEVICE_LOG_LEVEL);

struct parameter_cache {
	struct parameter_cache *next;
	uint16_t action_id;
	struct spaghetti_property_set arguments;
};

struct spaghetti_declarative_context {
	struct parameter_cache *parameters;
	struct spaghetti_property_set *values;
	const struct spaghetti_device_profile *profile;
	struct spaghetti_device_profile_binding binding;
	bool initialized;
	uint8_t pending_commands;
	uint32_t motion_completed;
	struct spaghetti_rgb_state rgb;
	struct spaghetti_dht22_state dht22;
	uint32_t rgb_published;
	bool rgb_read;
};

K_MEM_SLAB_DEFINE(declarative_context_slab, sizeof(struct spaghetti_declarative_context),
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

static int resolve_profile(const struct spaghetti_property_set *config,
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
	version = spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_VERSION);
	if ((id == NULL) || (id->type != SPAGHETTI_VALUE_TEXT) || (version == NULL) ||
	    (version->type != SPAGHETTI_VALUE_UINT64) || (version->data.unsigned_integer == 0U) ||
	    (version->data.unsigned_integer > UINT16_MAX)) {
		return -EINVAL;
	}

	hash = spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_PROFILE_HASH);
	if (hash != NULL) {
		if ((hash->type != SPAGHETTI_VALUE_BYTES) || (hash->data.bytes.size == 0U) ||
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
		id->data.text.text, (uint16_t)version->data.unsigned_integer, hash_bytes);
	if (profile == NULL) {
		return -ENOENT;
	}

	memset(out_binding, 0, sizeof(*out_binding));
	out_binding->default_timeout_ms = 100U;
	out_binding->spi_frequency_hz = 1000000U;

	i2c_address = spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_I2C_ADDRESS);
	if (i2c_address != NULL) {
		if (i2c_address->type != SPAGHETTI_VALUE_UINT64) {
			return -EINVAL;
		}
		out_binding->i2c_address = (uint16_t)i2c_address->data.unsigned_integer;
	}

	spi_cs = spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_SPI_CS);
	if (spi_cs != NULL) {
		if (spi_cs->type != SPAGHETTI_VALUE_UINT64) {
			return -EINVAL;
		}
		out_binding->spi_cs = (uint8_t)spi_cs->data.unsigned_integer;
	}

	adc_channel = spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_ADC_CHANNEL);
	if (adc_channel != NULL) {
		if (adc_channel->type != SPAGHETTI_VALUE_UINT64) {
			return -EINVAL;
		}
		out_binding->adc_channel = (uint8_t)adc_channel->data.unsigned_integer;
	}

	spi_frequency =
		spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_SPI_FREQUENCY_HZ);
	if (spi_frequency != NULL) {
		if (spi_frequency->type != SPAGHETTI_VALUE_UINT64) {
			return -EINVAL;
		}
		out_binding->spi_frequency_hz = (uint32_t)spi_frequency->data.unsigned_integer;
	}

	w1_rom = spaghetti_property_find(config, SPAGHETTI_DECLARATIVE_CONFIG_W1_ROM);
	if (w1_rom != NULL) {
		if ((w1_rom->type != SPAGHETTI_VALUE_BYTES) ||
		    (w1_rom->data.bytes.size != SPAGHETTI_ENDPOINT_VALUE_MAX)) {
			return -EINVAL;
		}
		memcpy(out_binding->w1_rom, w1_rom->data.bytes.bytes, SPAGHETTI_ENDPOINT_VALUE_MAX);
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

static bool profile_uses_physical_port(const struct spaghetti_device_profile *profile)
{
	const struct spaghetti_device_profile_op *plans[] = { profile->init_ops, profile->sample_ops, profile->safe_stop_ops };
	size_t counts[] = { profile->init_count, profile->sample_count, profile->safe_stop_count };
	for (size_t p = 0; p < ARRAY_SIZE(plans); ++p)
		for (size_t i = 0; i < counts[p]; ++i) {
			uint8_t code = plans[p][i].opcode;
			if (code <= SPAGHETTI_DEVICE_PROFILE_OP_ADC_READ || code == SPAGHETTI_DEVICE_PROFILE_OP_WAIT_FIELD_MASK ||
			    code == SPAGHETTI_DEVICE_PROFILE_OP_W1_WRITE_READ || code == SPAGHETTI_DEVICE_PROFILE_OP_UART_READ ||
			    code == SPAGHETTI_DEVICE_PROFILE_OP_WAIT_GPIO || code == SPAGHETTI_DEVICE_PROFILE_OP_I2C_MESSAGE_WRITE ||
			    code == SPAGHETTI_DEVICE_PROFILE_OP_PWM_SET || code == SPAGHETTI_DEVICE_PROFILE_OP_GPIO_SET_VALUE || code == SPAGHETTI_DEVICE_PROFILE_OP_GPIO_PULSE || code == SPAGHETTI_DEVICE_PROFILE_OP_STEPPER || code == SPAGHETTI_DEVICE_PROFILE_OP_RGB_PROGRAM || code == SPAGHETTI_DEVICE_PROFILE_OP_DS18B20_SETUP || code == SPAGHETTI_DEVICE_PROFILE_OP_DS18B20_READ || code == SPAGHETTI_DEVICE_PROFILE_OP_DHT22_POWER || code == SPAGHETTI_DEVICE_PROFILE_OP_DHT22_READ) return true;
		}
	return false;
}

static int declarative_describe_endpoint(const struct spaghetti_property_set *config,
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
	if (!profile_uses_physical_port(profile)) { out->kind = SPAGHETTI_ENDPOINT_LOGICAL; return 0; }
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
	case SPAGHETTI_PORT_TRANSPORT_GPIO: {
    uint8_t mask=0U;
    const struct spaghetti_device_profile_op *plans[]={profile->init_ops,profile->sample_ops,profile->safe_stop_ops};
    size_t counts[]={profile->init_count,profile->sample_count,profile->safe_stop_count};
    for(size_t p=0;p<ARRAY_SIZE(plans);p++) for(size_t i=0;i<counts[p];i++) {
      const struct spaghetti_device_profile_op *op=&plans[p][i];
      switch(op->opcode) {
      case SPAGHETTI_DEVICE_PROFILE_OP_STEPPER: out->kind=SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE;return 0;
      case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_SET: mask|=BIT(op->imm1);break;
      case SPAGHETTI_DEVICE_PROFILE_OP_WAIT_GPIO: mask|=BIT(0);break;
      case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_GET:
      case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_SET_VALUE:
      case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_PULSE:
      case SPAGHETTI_DEVICE_PROFILE_OP_PWM_SET:
      case SPAGHETTI_DEVICE_PROFILE_OP_DS18B20_READ: mask|=BIT(op->imm0);break;
      case SPAGHETTI_DEVICE_PROFILE_OP_DS18B20_SETUP:
        mask|=BIT(op->imm0);if(op->imm2 && op->imm2<5U)mask|=BIT(op->imm2-1);break;
      case SPAGHETTI_DEVICE_PROFILE_OP_DHT22_POWER:
      case SPAGHETTI_DEVICE_PROFILE_OP_DHT22_READ: mask|=BIT(op->imm0)|BIT(op->imm1);break;
      case SPAGHETTI_DEVICE_PROFILE_OP_RGB_PROGRAM:
        if(op->imm3>>1){out->kind=SPAGHETTI_ENDPOINT_LOGICAL;out->value_size=0;return 0;}
        for(unsigned c=0;c<3;c++){mask|=BIT((op->imm2>>(2*c))&3U);}
        break;
      default:break;
      }
    }
    out->kind=SPAGHETTI_ENDPOINT_GPIO_LINE;out->value_size=0;
    for(unsigned c=0;c<4;c++)if(mask&BIT(c))out->value[out->value_size++]=c;
    if(!out->value_size){out->value_size=1;out->value[0]=0;}
    break;
  }
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
	spaghetti_device_profile_cancel_pulses(context);
	spaghetti_device_profile_cancel_stepper(context);
	spaghetti_device_profile_rgb_stop(&context->rgb, port);
	if ((context->profile == NULL) || (context->profile->safe_stop_count == 0U)) {
		return 0;
	}

	return spaghetti_device_profile_exec(context->profile, context->profile->safe_stop_ops,
					     context->profile->safe_stop_count, port,
					     &context->binding, NULL);
}

static int declarative_init(struct spaghetti_module *module,
	const struct spaghetti_property_set *config)
{
	struct spaghetti_declarative_context *context;
	const struct spaghetti_device_profile *profile;
	struct spaghetti_device_profile_binding binding;
	int err;

	if ((module == NULL) || (module->context != NULL) || (module->port == NULL)) {
		return -EINVAL;
	}

	err = resolve_profile(config, &profile, &binding);
	if (err < 0) {
		return err;
	}

	if (profile->required_capabilities != 0U && !spaghetti_port_has_capability(module->port, profile->required_capabilities)) {
		return -ENOTSUP;
	}

	err = k_mem_slab_alloc(&declarative_context_slab, (void **)&context, K_NO_WAIT);
	if (err < 0) {
		return -ENOMEM;
	}

	memset(context, 0, sizeof(*context));
	context->profile = profile;
	context->binding = binding;
	context->binding.pulse_owner = context;
	context->binding.module_key = module->key;
	context->binding.rgb = &context->rgb;
	context->binding.dht22 = &context->dht22;
	context->values = k_calloc(1, sizeof(*context->values));
	if (!context->values) {
		k_mem_slab_free(&declarative_context_slab, context);
		return -ENOMEM;
	}
	module->context = context;

	err = spaghetti_device_profile_exec(profile, profile->init_ops, profile->init_count,
					    module->port, &context->binding, NULL);
	if (err < 0) {
		(void)declarative_run_safe_stop(context, module->port);
		k_free(context->values);
		k_mem_slab_free(&declarative_context_slab, (void *)context);
		module->context = NULL;
		return err;
	}

	context->initialized = true;
	return 0;
}

static const struct spaghetti_device_profile_action *
find_profile_action(const struct spaghetti_device_profile *profile, uint16_t id)
{
	for (size_t i = 0; i < profile->action_count; ++i) {
		if (profile->actions[i].id == id) {
			return &profile->actions[i];
		}
	}
	return NULL;
}

static struct parameter_cache *find_parameters(struct spaghetti_declarative_context *context,
					       uint16_t id)
{
	ARG_UNUSED(id);
	if (context->parameters) {
		return context->parameters;
		}
	return NULL;
	}

static int merge_parameters(struct spaghetti_declarative_context *context,
			    const struct spaghetti_module_command *command,
			    struct spaghetti_property_set *out)
{
	struct parameter_cache *cached = find_parameters(context, command->command_id);
	memset(out, 0, sizeof(*out));
	if (cached) {
		*out = cached->arguments;
	}
	for (size_t i = 0; i < command->arguments.field_count; ++i) {
		const struct spaghetti_value *value = &command->arguments.fields[i];
		size_t index = 0;
		while (index < out->field_count && out->fields[index].field_id != value->field_id) {
			index++;
		}
		if (index == out->field_count) {
			if (index == SPAGHETTI_PROPERTY_MAX_FIELDS) {
				return -E2BIG;
			}
			out->field_count++;
		}
		out->fields[index] = *value;
	}
	return 0;
}

static int declarative_validate_command(struct spaghetti_module *module,
					const struct spaghetti_module_command *command)
{
	if (!module || !module->context || !command ||
	    command->arguments.field_count > SPAGHETTI_PROPERTY_MAX_FIELDS) {
		return -EINVAL;
	}
	struct spaghetti_declarative_context *context = module->context;
	const struct spaghetti_device_profile_action *action =
		find_profile_action(context->profile, command->command_id);
	if (!action) {
		return -ENOTSUP;
	}
	struct spaghetti_property_set *merged = k_malloc(sizeof(*merged));
	if (!merged) {
		return -ENOMEM;
	}
	int err = merge_parameters(context, command, merged);
	uint16_t used = 0, seen = 0;
	uint8_t packed[8];
	for (size_t i = action->first; err == 0 && i < action->first + action->count; i++) {
		const struct spaghetti_device_profile_op *op = &context->profile->sample_ops[i];
		if (op->opcode == SPAGHETTI_DEVICE_PROFILE_OP_LOAD_VALUE && !command->update_only) {
			err = spaghetti_device_profile_pack_argument(op, context->values, packed);
			continue;
		}
        if(op->opcode==SPAGHETTI_DEVICE_PROFILE_OP_RGB_PROGRAM){
          for(unsigned offset=op->imm0;err==0 && offset<op->imm0+op->imm1;offset+=6){
            const uint8_t *row=context->profile->message_data+offset;
            if(row[0]!=7U)continue;
            uint32_t id=sys_get_le32(row+2);
            used|=BIT(id);
            const struct spaghetti_value *value=spaghetti_property_find(merged,id);
            if(!value){if(!command->update_only)err=-ENOENT;continue;}
            if(value->type==SPAGHETTI_VALUE_UINT64){if(value->data.unsigned_integer>0xffffffU)err=-ERANGE;}
            else if(value->type!=SPAGHETTI_VALUE_TEXT || value->data.text.size!=7 || value->data.text.text[0]!='#')err=-EINVAL;
            else for(unsigned c=1;c<7;c++){char ch=value->data.text.text[c];if(!((ch>='0'&&ch<='9')||(ch>='a'&&ch<='f')||(ch>='A'&&ch<='F')))err=-EINVAL;}
          }
        }
		if (op->opcode != SPAGHETTI_DEVICE_PROFILE_OP_LOAD_ARGUMENT) {
			continue;
		}
		used |= BIT(op->src_a);
		if (command->update_only && !spaghetti_property_find(merged, op->src_a)) {
			continue;
		}
		err = spaghetti_device_profile_pack_argument(op, merged, packed);
	}
	for (size_t i = 0; err == 0 && i < command->arguments.field_count; i++) {
		uint16_t id = command->arguments.fields[i].field_id;
		if (!id || id > SPAGHETTI_PROPERTY_MAX_FIELDS || !(used & BIT(id)) ||
		    (seen & BIT(id))) {
			err = -EINVAL;
			break;
		}
		seen |= BIT(id);
	}
	k_free(merged);
	return err;
}

/* Keep schema descriptors off the small runtime worker stack. */
static int validate_result(const struct spaghetti_device_profile *profile, struct spaghetti_record_payload *out)
{
	struct spaghetti_field_descriptor *fields = k_calloc(SPAGHETTI_DEVICE_PROFILE_MAX_FIELDS, sizeof(*fields));
	struct spaghetti_schema_descriptor schema;
	if (fields == NULL) return -ENOMEM;
	int err = spaghetti_device_profile_make_schema(profile, fields, &schema);
	if (err == 0) err = spaghetti_record_payload_validate(out, &schema);
	k_free(fields);
	return err;
}

static int declarative_command(struct spaghetti_module *module,
			       const struct spaghetti_module_command *command)
{
	int err = declarative_validate_command(module, command);
	if (err < 0) {
		return err;
	}
	struct spaghetti_declarative_context *context = module->context;
	struct spaghetti_property_set *merged = k_malloc(sizeof(*merged));
	if (!merged) {
		return -ENOMEM;
	}
	err = merge_parameters(context, command, merged);
	if (err < 0) {
		k_free(merged);
		return err;
	}
	if (command->update_only) {
		struct parameter_cache *cached = find_parameters(context, command->command_id);
		if (!cached) {
			cached = k_calloc(1, sizeof(*cached));
			if (!cached) {
				k_free(merged);
				return -ENOMEM;
			}
			cached->action_id = command->command_id;
			cached->next = context->parameters;
			context->parameters = cached;
		}
		cached->arguments = *merged;
		if (command->trigger_pending) {
			context->pending_commands |= BIT(command->command_id - 1);
		}
		k_free(merged);
		if (command->result) {
			memset(command->result, 0, sizeof(*command->result));
		}
		if (context->pending_commands & BIT(command->command_id - 1)) {
			struct spaghetti_module_command *pending = k_calloc(1, sizeof(*pending));
			if (!pending) {
				return -ENOMEM;
			}
			pending->command_id = command->command_id;
			pending->result = command->result;
			err = declarative_command(module, pending);
			k_free(pending);
			if (err == -ENOENT) {
				return 0;
			}
			if (err == 0) {
				context->pending_commands &= ~BIT(command->command_id - 1);
			}
			return err;
		}
		return 0;
	}
	const struct spaghetti_device_profile_action *action =
		find_profile_action(context->profile, command->command_id);
	struct spaghetti_record_payload *out = command->result;
	bool owned = out == NULL;
	if (owned) {
		out = k_malloc(sizeof(*out));
	}
	if (!out) {
		k_free(merged);
		return -ENOMEM;
	}
	struct spaghetti_device_profile_binding binding = context->binding;
	binding.arguments = merged;
	binding.values = context->values;
	err = spaghetti_device_profile_exec(context->profile,
					    &context->profile->sample_ops[action->first],
					    action->count, module->port, &binding, out);
	if (err == 0) {
		err = validate_result(context->profile, out);
		if (err == 0) {
			out->action_id = action->id;
			out->kind = SPAGHETTI_RECORD_EVENT;
			for (size_t i = 0; i < out->values.field_count; i++) {
				size_t index = 0;
				while (index < context->values->field_count &&
				       context->values->fields[index].field_id !=
					       out->values.fields[i].field_id) {
					index++;
				}
				if (index == context->values->field_count &&
				    index < SPAGHETTI_PROPERTY_MAX_FIELDS) {
					context->values->field_count++;
				}
				if (index < SPAGHETTI_PROPERTY_MAX_FIELDS) {
					context->values->fields[index] = out->values.fields[i];
				}
			}
		}
	}
	if (owned) {
		k_free(out);
	}
	k_free(merged);
	return err;
}

static const struct spaghetti_field_descriptor declarative_command_fields[1];
static const struct spaghetti_schema_descriptor declarative_command_schema = {
	.schema_id = "spaghetti.decl.command",
	.version = 1U,
	.fields = declarative_command_fields,
	.field_count = 0U,
};
#define ACTION_DESCRIPTOR(n)                                                                       \
	{.command_id = n, .name = "action_" #n, .argument_schema = &declarative_command_schema}
static const struct spaghetti_command_descriptor declarative_commands[] = {
	ACTION_DESCRIPTOR(1), ACTION_DESCRIPTOR(2), ACTION_DESCRIPTOR(3), ACTION_DESCRIPTOR(4),
	ACTION_DESCRIPTOR(5), ACTION_DESCRIPTOR(6), ACTION_DESCRIPTOR(7), ACTION_DESCRIPTOR(8),
};

static int declarative_read(struct spaghetti_module *module, struct spaghetti_record_payload *out)
{
	struct spaghetti_declarative_context *context;
	int err;

	if ((module == NULL) || (module->context == NULL) || (out == NULL) ||
	    (module->port == NULL)) {
		return -EINVAL;
	}

	context = module->context;
	if (!context->initialized || (context->profile == NULL)) {
		return -EINVAL;
	}

 if (context->rgb.initialized) {
   if (context->rgb_read && context->rgb_published == context->rgb.revision) return -EAGAIN;
   context->rgb_read = true; context->rgb_published = context->rgb.revision;
   memset(out, 0, sizeof(*out));
   strncpy(out->schema_id, context->profile->sample_schema_id, sizeof(out->schema_id) - 1);
   out->schema_version = context->profile->sample_schema_version;
   out->kind = SPAGHETTI_RECORD_EVENT;
   spaghetti_device_profile_rgb_record(&context->rgb, out);
   return validate_result(context->profile, out);
 }
 /* Stepper schedules monitor completion; they must never replay action 1 (Stop). */
 bool motion = false;
 for (size_t i = 0; i < context->profile->sample_count; i++)
   if ((context->profile->sample_ops[i].opcode == SPAGHETTI_DEVICE_PROFILE_OP_DS18B20_READ || (context->profile->sample_ops[i].opcode == SPAGHETTI_DEVICE_PROFILE_OP_DHT22_READ && context->profile->sample_ops[i].imm2 == 1U)) && !context->dht22.pending)
     return -EAGAIN;
 for (size_t i = 0; i < context->profile->sample_count; i++)
   if (context->profile->sample_ops[i].opcode == SPAGHETTI_DEVICE_PROFILE_OP_STEPPER) motion = true;
 if (motion) {
   struct spaghetti_motion_status status;
   err = spaghetti_device_profile_motion_status(module->key, &status);
   if (err < 0) return err;
   if (status.error) return status.error;
   if (status.completed == context->motion_completed) return -EAGAIN;
   context->motion_completed++;
   memset(out, 0, sizeof(*out));
   out->kind = SPAGHETTI_RECORD_EVENT;
   strncpy(out->schema_id, context->profile->sample_schema_id, sizeof(out->schema_id) - 1);
   out->schema_version = context->profile->sample_schema_version;
   out->values.field_count = 1;
   out->values.fields[0].field_id = 65534;
   out->values.fields[0].type = SPAGHETTI_VALUE_UINT64;
   out->values.fields[0].data.unsigned_integer = 1;
   return validate_result(context->profile, out);
 }

	if (context->profile->action_count > 0U) {
		struct spaghetti_module_command *command = k_calloc(1, sizeof(*command));
		if (command == NULL) {
			return -ENOMEM;
		}
		command->command_id = context->profile->actions[0].id;
		command->result = out;
		err = declarative_command(module, command);
		k_free(command);
		return err;
	}
	err = spaghetti_device_profile_exec(context->profile, context->profile->sample_ops,
					    context->profile->sample_count, module->port,
					    &context->binding, out);
	if (err < 0) {
		return err;
	}

	return validate_result(context->profile, out);
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
	k_free(context->values);
	while (context->parameters) {
		struct parameter_cache *cached = context->parameters;
		context->parameters = cached->next;
		k_free(cached);
	}
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
	.command = declarative_command,
	.validate_command = declarative_validate_command,
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
	.commands = declarative_commands,
	.command_count = ARRAY_SIZE(declarative_commands),
	.ops = &declarative_ops,
};
