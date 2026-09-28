#include <errno.h>
#include <stddef.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/driver_registry.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

#include "driver_registry_internal.h"

enum {
	EXAMPLE_CONFIG_VALUE = 1U,
	EXAMPLE_FIELD_VALUE = 1U,
};

static const struct spaghetti_schema_descriptor example_config_schema;
static const struct spaghetti_schema_descriptor example_sample_schema;

static int example_validate_config(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &example_config_schema);
}

static int example_describe_endpoint(const struct spaghetti_property_set *config,
				     struct spaghetti_module_endpoint *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = example_validate_config(config);
	if (err < 0) {
		return err;
	}

	*out = (struct spaghetti_module_endpoint){
		.kind = SPAGHETTI_ENDPOINT_I2C_ADDRESS,
		.value_size = 1U,
		.value = {0x50U},
	};
	return 0;
}

static int example_init(struct spaghetti_module *module,
			const struct spaghetti_property_set *config)
{
	ARG_UNUSED(config);
	return (module != NULL) ? 0 : -EINVAL;
}

static int example_read(struct spaghetti_module *module,
			struct spaghetti_record_payload *out)
{
	if ((module == NULL) || (out == NULL)) {
		return -EINVAL;
	}

	memset(out, 0, sizeof(*out));
	out->kind = SPAGHETTI_RECORD_SAMPLE;
	out->schema_version = 1U;
	strncpy(out->schema_id, example_sample_schema.schema_id,
		sizeof(out->schema_id) - 1U);
	out->values.field_count = 1U;
	out->values.fields[0] = (struct spaghetti_value){
		.field_id = EXAMPLE_FIELD_VALUE,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = 1,
	};
	return 0;
}

static int example_deinit(struct spaghetti_module *module)
{
	return (module != NULL) ? 0 : -EINVAL;
}

static int start_only(struct spaghetti_module *module,
		      spaghetti_module_event_cb_t emit,
		      void *emit_user_data)
{
	ARG_UNUSED(module);
	ARG_UNUSED(emit);
	ARG_UNUSED(emit_user_data);
	return 0;
}

static const struct spaghetti_field_descriptor example_config_fields[] = {
	{
		.field_id = EXAMPLE_CONFIG_VALUE,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED | SPAGHETTI_FIELD_WRITABLE,
		.unsigned_minimum = 0U,
		.unsigned_maximum = UINT64_MAX,
		.name = "value",
		.description = "Example config value",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor example_config_schema = {
	.schema_id = "spaghetti.example.config",
	.version = 1U,
	.fields = example_config_fields,
	.field_count = ARRAY_SIZE(example_config_fields),
};

static const struct spaghetti_field_descriptor example_sample_fields[] = {
	{
		.field_id = EXAMPLE_FIELD_VALUE,
		.type = SPAGHETTI_VALUE_INT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.signed_minimum = INT64_MIN,
		.signed_maximum = INT64_MAX,
		.name = "value",
		.description = "Example sample value",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor example_sample_schema = {
	.schema_id = "spaghetti.example.sample",
	.version = 1U,
	.fields = example_sample_fields,
	.field_count = ARRAY_SIZE(example_sample_fields),
};

static const struct spaghetti_schema_descriptor *const example_record_schemas[] = {
	&example_sample_schema,
};

static const struct spaghetti_module_driver_ops example_ops = {
	.validate_config = example_validate_config,
	.describe_endpoint = example_describe_endpoint,
	.init = example_init,
	.read = example_read,
	.command = NULL,
	.start = NULL,
	.stop = NULL,
	.deinit = example_deinit,
};

SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_example_driver) = {
	.type_id = "example",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.power_requirement = { .declared = false },
	.config_schema = &example_config_schema,
	.record_schemas = example_record_schemas,
	.record_schema_count = ARRAY_SIZE(example_record_schemas),
	.commands = NULL,
	.command_count = 0U,
	.ops = &example_ops,
};

static const struct spaghetti_field_descriptor bad_enum_fields[] = {
	{
		.field_id = 1U,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_ENUM | SPAGHETTI_FIELD_REQUIRED,
		.unsigned_maximum = UINT64_MAX,
		.name = "mode",
		.description = "Broken enum",
		.unit = "",
		.enum_options = NULL,
		.enum_option_count = 0U,
	},
};

static const struct spaghetti_schema_descriptor incoherent_schema = {
	.schema_id = "spaghetti.example.bad",
	.version = 1U,
	.fields = bad_enum_fields,
	.field_count = ARRAY_SIZE(bad_enum_fields),
};

static const struct spaghetti_module_driver_ops start_without_stop_ops = {
	.validate_config = example_validate_config,
	.describe_endpoint = example_describe_endpoint,
	.init = example_init,
	.read = example_read,
	.start = start_only,
	.stop = NULL,
	.deinit = example_deinit,
};

static const struct spaghetti_module_driver_ops incoherent_ops = {
	.validate_config = example_validate_config,
	.describe_endpoint = example_describe_endpoint,
	.init = example_init,
	.read = example_read,
	.deinit = example_deinit,
};

static const struct spaghetti_module_driver_ops no_io_ops = {
	.validate_config = example_validate_config,
	.describe_endpoint = example_describe_endpoint,
	.init = example_init,
	.read = NULL,
	.command = NULL,
	.start = NULL,
	.stop = NULL,
	.deinit = example_deinit,
};

ZTEST(driver_registry, test_iterable_example_and_invalid_descriptors)
{
	const struct spaghetti_module_driver bad_api_version = {
		.type_id = "bad-api",
		.api_version = 1U,
		.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
		.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
		.power_requirement = { .declared = false },
		.config_schema = &example_config_schema,
		.record_schemas = example_record_schemas,
		.record_schema_count = ARRAY_SIZE(example_record_schemas),
		.ops = &example_ops,
	};
	const struct spaghetti_module_driver start_without_stop = {
		.type_id = "start-only",
		.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
		.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
		.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
		.power_requirement = { .declared = false },
		.config_schema = &example_config_schema,
		.record_schemas = example_record_schemas,
		.record_schema_count = ARRAY_SIZE(example_record_schemas),
		.ops = &start_without_stop_ops,
	};
	const struct spaghetti_module_driver incoherent = {
		.type_id = "incoherent",
		.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
		.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
		.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
		.power_requirement = { .declared = false },
		.config_schema = &incoherent_schema,
		.record_schemas = example_record_schemas,
		.record_schema_count = ARRAY_SIZE(example_record_schemas),
		.ops = &incoherent_ops,
	};
	const struct spaghetti_module_driver no_io = {
		.type_id = "no-io",
		.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
		.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
		.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
		.power_requirement = { .declared = false },
		.config_schema = &example_config_schema,
		.ops = &no_io_ops,
	};
	const struct spaghetti_module_driver duplicate = {
		.type_id = "example",
		.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
		.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
		.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
		.power_requirement = { .declared = false },
		.config_schema = &example_config_schema,
		.record_schemas = example_record_schemas,
		.record_schema_count = ARRAY_SIZE(example_record_schemas),
		.ops = &example_ops,
	};
	const struct spaghetti_module_driver incomplete = {
		.type_id = "incomplete",
		.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	};
	const struct spaghetti_module_driver *valid_entries[] = {
		&spaghetti_example_driver,
	};
	const struct spaghetti_module_driver *duplicate_entries[] = {
		&spaghetti_example_driver,
		&duplicate,
	};
	const struct spaghetti_module_driver *incomplete_entries[] = {
		&incomplete,
	};
	const struct spaghetti_module_driver *bad_api_entries[] = {
		&bad_api_version,
	};
	const struct spaghetti_module_driver *start_stop_entries[] = {
		&start_without_stop,
	};
	const struct spaghetti_module_driver *incoherent_entries[] = {
		&incoherent,
	};
	const struct spaghetti_module_driver *no_io_entries[] = {
		&no_io,
	};
	const struct spaghetti_module_driver *null_entries[] = {
		NULL,
	};
	struct spaghetti_property_set config = {
		.field_count = 1U,
		.fields = {
			{
				.field_id = EXAMPLE_CONFIG_VALUE,
				.type = SPAGHETTI_VALUE_UINT64,
				.data.unsigned_integer = 7U,
			},
		},
	};
	const struct spaghetti_property_set before = config;
	const struct spaghetti_module_driver *first_lookup;
	struct spaghetti_module_endpoint endpoint;

	zassert_equal(spaghetti_driver_registry_validate(NULL, 0U), -EINVAL);
	zassert_equal(spaghetti_driver_registry_validate(null_entries, 1U), -EINVAL);
	zassert_equal(spaghetti_driver_registry_validate(incomplete_entries, 1U),
		      -EINVAL);
	zassert_equal(spaghetti_driver_registry_validate(bad_api_entries, 1U),
		      -EINVAL);
	zassert_equal(spaghetti_driver_registry_validate(start_stop_entries, 1U),
		      -EINVAL);
	zassert_equal(spaghetti_driver_registry_validate(incoherent_entries, 1U),
		      -EINVAL);
	zassert_equal(spaghetti_driver_registry_validate(no_io_entries, 1U),
		      -EINVAL);
	zassert_equal(spaghetti_driver_registry_validate(duplicate_entries, 2U),
		      -EINVAL);
	zassert_ok(spaghetti_driver_registry_validate(valid_entries, 1U));

	zassert_ok(spaghetti_example_driver.ops->validate_config(&config));
	zassert_mem_equal(&config, &before, sizeof(config));
	zassert_ok(spaghetti_example_driver.ops->describe_endpoint(&config,
								   &endpoint));
	zassert_mem_equal(&config, &before, sizeof(config));
	zassert_equal(endpoint.kind, SPAGHETTI_ENDPOINT_I2C_ADDRESS);

	zassert_ok(spaghetti_driver_registry_init());
	zassert_equal(spaghetti_driver_registry_count(), 1U);

	first_lookup = spaghetti_driver_registry_find("example");
	zassert_equal_ptr(first_lookup, &spaghetti_example_driver);
	zassert_equal_ptr(spaghetti_driver_registry_find("example"), first_lookup);
	zassert_is_null(spaghetti_driver_registry_find(NULL));
	zassert_is_null(spaghetti_driver_registry_find(""));
	zassert_is_null(spaghetti_driver_registry_find("unknown"));
	zassert_equal_ptr(spaghetti_driver_registry_get(0U),
			  &spaghetti_example_driver);
	zassert_is_null(spaghetti_driver_registry_get(1U));
}

ZTEST_SUITE(driver_registry, NULL, NULL, NULL, NULL, NULL);
