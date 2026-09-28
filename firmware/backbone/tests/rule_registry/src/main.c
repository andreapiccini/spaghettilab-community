#include <errno.h>
#include <stddef.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/rule_driver.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/schema.h>

#include "rule_registry_internal.h"

static const struct spaghetti_field_descriptor example_fields[] = {
	{
		.field_id = 1U,
		.type = SPAGHETTI_VALUE_BOOL,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.name = "enabled",
		.description = "Example",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor example_schema = {
	.schema_id = "spaghetti.example.rule",
	.version = 1U,
	.fields = example_fields,
	.field_count = ARRAY_SIZE(example_fields),
};

static int example_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &example_schema);
}

static int example_init(const struct spaghetti_property_set *config,
			void **out_context)
{
	static int context;

	ARG_UNUSED(config);
	*out_context = &context;
	return 0;
}

static int example_on_record(void *context,
			     const struct spaghetti_record *record,
			     spaghetti_rule_emit_action_cb_t emit,
			     void *emit_user_data)
{
	ARG_UNUSED(context);
	ARG_UNUSED(record);
	ARG_UNUSED(emit);
	ARG_UNUSED(emit_user_data);
	return 0;
}

static int example_deinit(void *context)
{
	ARG_UNUSED(context);
	return 0;
}

static const struct spaghetti_rule_driver_ops example_ops = {
	.validate_config = example_validate,
	.init = example_init,
	.on_record = example_on_record,
	.deinit = example_deinit,
};

SPAGHETTI_RULE_DRIVER_DEFINE(spaghetti_example_rule_driver) = {
	.type_id = "example-rule",
	.api_version = SPAGHETTI_RULE_DRIVER_API_VERSION,
	.config_schema = &example_schema,
	.ops = &example_ops,
};

ZTEST(rule_registry, test_iterable_and_invalid_descriptors)
{
	const struct spaghetti_rule_driver bad_api = {
		.type_id = "bad",
		.api_version = 0U,
		.config_schema = &example_schema,
		.ops = &example_ops,
	};
	const struct spaghetti_rule_driver incomplete = {
		.type_id = "incomplete",
		.api_version = SPAGHETTI_RULE_DRIVER_API_VERSION,
		.config_schema = &example_schema,
		.ops = NULL,
	};
	const struct spaghetti_rule_driver *valid_entries[] = {
		&spaghetti_example_rule_driver,
	};
	const struct spaghetti_rule_driver *bad_entries[] = {
		&bad_api,
	};
	const struct spaghetti_rule_driver *incomplete_entries[] = {
		&incomplete,
	};
	const struct spaghetti_rule_driver *duplicate_entries[] = {
		&spaghetti_example_rule_driver,
		&spaghetti_example_rule_driver,
	};

	zassert_ok(spaghetti_rule_registry_validate(valid_entries, 1U));
	zassert_equal(spaghetti_rule_registry_validate(bad_entries, 1U),
		      -EINVAL);
	zassert_equal(spaghetti_rule_registry_validate(incomplete_entries, 1U),
		      -EINVAL);
	zassert_equal(spaghetti_rule_registry_validate(duplicate_entries, 2U),
		      -EINVAL);
	zassert_ok(spaghetti_rule_registry_validate(NULL, 0U));

	zassert_ok(spaghetti_rule_registry_init());
	zassert_equal(spaghetti_rule_registry_count(), 1U);
	zassert_equal_ptr(spaghetti_rule_registry_find("example-rule"),
			  &spaghetti_example_rule_driver);
	zassert_is_null(spaghetti_rule_registry_find("unknown"));
	zassert_equal_ptr(spaghetti_rule_registry_get(0U),
			  &spaghetti_example_rule_driver);
	zassert_is_null(spaghetti_rule_registry_get(1U));
}

ZTEST_SUITE(rule_registry, NULL, NULL, NULL, NULL, NULL);
