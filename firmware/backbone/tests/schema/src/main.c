#include <errno.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/schema.h>

static const struct spaghetti_value default_threshold = {
	.field_id = 2U,
	.type = SPAGHETTI_VALUE_INT64,
	.data.signed_integer = 10,
};

static const struct spaghetti_enum_option mode_options[] = {
	{
		.value = {
			.field_id = 3U,
			.type = SPAGHETTI_VALUE_UINT64,
			.data.unsigned_integer = 0U,
		},
		.name = "off",
		.description = "Disabled",
	},
	{
		.value = {
			.field_id = 3U,
			.type = SPAGHETTI_VALUE_UINT64,
			.data.unsigned_integer = 1U,
		},
		.name = "on",
		.description = "Enabled",
	},
};

static const struct spaghetti_field_descriptor sample_fields[] = {
	{
		.field_id = 1U,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_maximum = UINT64_MAX,
		.name = "bus_uv",
		.description = "Bus voltage",
		.unit = "uV",
	},
	{
		.field_id = 2U,
		.type = SPAGHETTI_VALUE_INT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_WRITABLE | SPAGHETTI_FIELD_HAS_DEFAULT,
		.signed_minimum = -100,
		.signed_maximum = 100,
		.name = "threshold",
		.description = "Signed threshold",
		.unit = "",
		.default_value = &default_threshold,
	},
	{
		.field_id = 3U,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.flags = SPAGHETTI_FIELD_ENUM | SPAGHETTI_FIELD_REQUIRED,
		.unsigned_maximum = UINT64_MAX,
		.name = "mode",
		.description = "Mode enum",
		.unit = "",
		.enum_options = mode_options,
		.enum_option_count = ARRAY_SIZE(mode_options),
	},
	{
		.field_id = 4U,
		.type = SPAGHETTI_VALUE_BOOL,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.name = "enabled",
		.description = "Boolean flag",
		.unit = "",
	},
	{
		.field_id = 5U,
		.type = SPAGHETTI_VALUE_TEXT,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.name = "label",
		.description = "UTF-8 label",
		.unit = "",
	},
	{
		.field_id = 6U,
		.type = SPAGHETTI_VALUE_BYTES,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
		.bytes_min_size = 1U,
		.bytes_max_size = 8U,
		.name = "blob",
		.description = "Opaque bytes",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor sample_schema = {
	.schema_id = "spaghetti.test.sample",
	.version = 1U,
	.fields = sample_fields,
	.field_count = ARRAY_SIZE(sample_fields),
};

static const struct spaghetti_field_descriptor ref_fields[] = {
	{
		.field_id = 10U,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF,
		.reference_group = 1U,
		.flags = SPAGHETTI_FIELD_REQUIRED,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT64_MAX,
		.name = "source_key",
		.description = "Source module",
		.unit = "",
	},
	{
		.field_id = 11U,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_RECORD_FIELD_REF,
		.reference_group = 1U,
		.unsigned_minimum = 1U,
		.unsigned_maximum = UINT64_MAX,
		.name = "source_field",
		.description = "Source field",
		.unit = "",
	},
	{
		.field_id = 12U,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_FLOW_REF,
		.unsigned_maximum = UINT8_MAX,
		.name = "flow",
		.description = "Flow reference",
		.unit = "",
	},
	{
		.field_id = 13U,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_BAY_REF,
		.unsigned_maximum = UINT8_MAX,
		.name = "bay",
		.description = "Bay reference",
		.unit = "",
	},
	{
		.field_id = 14U,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_POWER_RAIL_REF,
		.unsigned_maximum = UINT8_MAX,
		.name = "rail",
		.description = "Rail reference",
		.unit = "",
	},
	{
		.field_id = 15U,
		.type = SPAGHETTI_VALUE_UINT64,
		.semantic = SPAGHETTI_FIELD_SEMANTIC_PORT_REF,
		.unsigned_maximum = UINT8_MAX,
		.name = "port",
		.description = "Port reference",
		.unit = "",
	},
};

static const struct spaghetti_schema_descriptor ref_schema = {
	.schema_id = "spaghetti.test.refs",
	.version = 1U,
	.fields = ref_fields,
	.field_count = ARRAY_SIZE(ref_fields),
};

struct fake_resolver_state {
	bool allow_module;
	bool allow_flow;
	bool allow_bay;
	bool allow_rail;
	bool allow_port;
	int calls;
};

static int fake_resolve(enum spaghetti_field_semantic semantic,
			uint8_t reference_group,
			const struct spaghetti_value *value,
			void *user_data)
{
	struct fake_resolver_state *state = user_data;

	ARG_UNUSED(reference_group);
	zassert_not_null(value);
	state->calls += 1;

	switch (semantic) {
	case SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF:
		return state->allow_module ? 0 : -ENOENT;
	case SPAGHETTI_FIELD_SEMANTIC_RECORD_FIELD_REF:
		return 0;
	case SPAGHETTI_FIELD_SEMANTIC_FLOW_REF:
		return state->allow_flow ? 0 : -ENOENT;
	case SPAGHETTI_FIELD_SEMANTIC_BAY_REF:
		return state->allow_bay ? 0 : -ENOENT;
	case SPAGHETTI_FIELD_SEMANTIC_POWER_RAIL_REF:
		return state->allow_rail ? 0 : -ENOENT;
	case SPAGHETTI_FIELD_SEMANTIC_PORT_REF:
		return state->allow_port ? 0 : -ENOENT;
	default:
		return -EINVAL;
	}
}

static void fill_text(struct spaghetti_value *value, uint16_t field_id,
		      const char *text)
{
	size_t size = strlen(text);

	value->field_id = field_id;
	value->type = SPAGHETTI_VALUE_TEXT;
	value->data.text.size = size;
	memcpy(value->data.text.text, text, size);
	value->data.text.text[size] = '\0';
}

static void fill_valid_sample(struct spaghetti_property_set *set)
{
	memset(set, 0, sizeof(*set));
	set->field_count = 6U;
	set->fields[0] = (struct spaghetti_value){
		.field_id = 1U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 5000000U,
	};
	set->fields[1] = (struct spaghetti_value){
		.field_id = 2U,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = 42,
	};
	set->fields[2] = (struct spaghetti_value){
		.field_id = 3U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 1U,
	};
	set->fields[3] = (struct spaghetti_value){
		.field_id = 4U,
		.type = SPAGHETTI_VALUE_BOOL,
		.data.boolean = true,
	};
	fill_text(&set->fields[4], 5U, "café");
	set->fields[5].field_id = 6U;
	set->fields[5].type = SPAGHETTI_VALUE_BYTES;
	set->fields[5].data.bytes.size = 2U;
	set->fields[5].data.bytes.bytes[0] = 0xABU;
	set->fields[5].data.bytes.bytes[1] = 0xCDU;
}

ZTEST(schema, test_find_validate_and_record_sizes)
{
	struct spaghetti_property_set set;
	struct spaghetti_record record;
	const struct spaghetti_value *found;
	struct spaghetti_property_set before;

	fill_valid_sample(&set);
	before = set;

	zassert_ok(spaghetti_property_validate(&set, &sample_schema));
	zassert_mem_equal(&set, &before, sizeof(set));

	found = spaghetti_property_find(&set, 1U);
	zassert_not_null(found);
	zassert_equal(found->data.unsigned_integer, 5000000U);
	zassert_is_null(spaghetti_property_find(&set, 99U));
	zassert_is_null(spaghetti_property_find(NULL, 1U));

	memset(&record, 0, sizeof(record));
	record.source_id = 7U;
	record.source_key = 42U;
	record.boot_id = 9U;
	record.timestamp_ms = 1234;
	record.sequence = 1U;
	record.payload.kind = SPAGHETTI_RECORD_SAMPLE;
	record.payload.schema_version = 1U;
	strncpy(record.payload.schema_id, sample_schema.schema_id,
		SPAGHETTI_SCHEMA_ID_SIZE - 1U);
	record.payload.values = set;

	zassert_ok(spaghetti_record_validate(&record, &sample_schema));

	printk("schema sizeof value=%zu property_set=%zu record=%zu\n",
	       sizeof(struct spaghetti_value),
	       sizeof(struct spaghetti_property_set),
	       sizeof(struct spaghetti_record));
	zassert_true(sizeof(struct spaghetti_record) > 0U);
}

ZTEST(schema, test_rejects_duplicates_required_range_utf8_and_schema)
{
	struct spaghetti_property_set set;

	fill_valid_sample(&set);
	set.fields[5] = set.fields[0];
	zassert_equal(spaghetti_property_validate(&set, &sample_schema),
		      -EEXIST);

	fill_valid_sample(&set);
	set.fields[0].field_id = 99U;
	zassert_equal(spaghetti_property_validate(&set, &sample_schema),
		      -ENOENT);

	fill_valid_sample(&set);
	set.field_count = 5U; /* drops optional blob only */
	zassert_ok(spaghetti_property_validate(&set, &sample_schema));
	set.fields[0] = set.fields[1];
	set.field_count = 1U;
	zassert_equal(spaghetti_property_validate(&set, &sample_schema),
		      -ENOENT);

	fill_valid_sample(&set);
	set.fields[1].data.signed_integer = 101;
	zassert_equal(spaghetti_property_validate(&set, &sample_schema),
		      -ERANGE);

	fill_valid_sample(&set);
	set.fields[2].data.unsigned_integer = 9U;
	zassert_equal(spaghetti_property_validate(&set, &sample_schema),
		      -EINVAL);

	fill_valid_sample(&set);
	set.fields[4].data.text.text[0] = (char)0xC0;
	set.fields[4].data.text.text[1] = (char)0x80;
	set.fields[4].data.text.size = 2U;
	set.fields[4].data.text.text[2] = '\0';
	zassert_equal(spaghetti_property_validate(&set, &sample_schema),
		      -EINVAL);

	fill_valid_sample(&set);
	set.fields[5].data.bytes.size = 9U;
	zassert_equal(spaghetti_property_validate(&set, &sample_schema),
		      -EMSGSIZE);

	{
		struct spaghetti_record_payload payload = {
			.kind = SPAGHETTI_RECORD_EVENT,
			.schema_version = 2U,
		};

		fill_valid_sample(&payload.values);
		strncpy(payload.schema_id, sample_schema.schema_id,
			SPAGHETTI_SCHEMA_ID_SIZE - 1U);
		zassert_equal(
			spaghetti_record_payload_validate(&payload,
							  &sample_schema),
			-EPROTONOSUPPORT);
	}

	{
		struct spaghetti_record record = {
			.source_key = 0U,
			.sequence = 1U,
			.timestamp_ms = 1,
		};

		zassert_equal(spaghetti_record_validate(&record, &sample_schema),
			      -EINVAL);
	}

	{
		struct spaghetti_record record = {
			.source_key = 1U,
			.sequence = 0U,
			.timestamp_ms = 1,
		};

		zassert_equal(spaghetti_record_validate(&record, &sample_schema),
			      -EINVAL);
	}
}

ZTEST(schema, test_semantic_reference_groups_and_resolver)
{
	struct spaghetti_property_set set;
	struct fake_resolver_state state = {
		.allow_module = true,
		.allow_flow = true,
		.allow_bay = true,
		.allow_rail = true,
		.allow_port = true,
	};
	struct spaghetti_property_set before;

	memset(&set, 0, sizeof(set));
	set.field_count = 6U;
	set.fields[0] = (struct spaghetti_value){
		.field_id = 10U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 100U,
	};
	set.fields[1] = (struct spaghetti_value){
		.field_id = 11U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 1U,
	};
	set.fields[2] = (struct spaghetti_value){
		.field_id = 12U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 0U,
	};
	set.fields[3] = (struct spaghetti_value){
		.field_id = 13U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 0U,
	};
	set.fields[4] = (struct spaghetti_value){
		.field_id = 14U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 0U,
	};
	set.fields[5] = (struct spaghetti_value){
		.field_id = 15U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 0U,
	};
	before = set;

	zassert_ok(spaghetti_property_validate_with_resolver(
		&set, &ref_schema, fake_resolve, &state));
	zassert_true(state.calls >= 5);
	zassert_mem_equal(&set, &before, sizeof(set));

	state.allow_module = false;
	state.calls = 0;
	zassert_equal(spaghetti_property_validate_with_resolver(
			      &set, &ref_schema, fake_resolve, &state),
		      -ENOENT);

	/* Missing required MODULE_KEY_REF. */
	set.field_count = 5U;
	memmove(&set.fields[0], &set.fields[1],
		5U * sizeof(set.fields[0]));
	zassert_equal(spaghetti_property_validate(&set, &ref_schema),
		      -ENOENT);

	/* Present MODULE_KEY_REF without its compound peer. */
	set.field_count = 1U;
	set.fields[0] = (struct spaghetti_value){
		.field_id = 10U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = 100U,
	};
	zassert_equal(spaghetti_property_validate(&set, &ref_schema),
		      -EPROTONOSUPPORT);

	{
		static const struct spaghetti_field_descriptor bad_fields[] = {
			{
				.field_id = 1U,
				.type = SPAGHETTI_VALUE_INT64,
				.semantic = SPAGHETTI_FIELD_SEMANTIC_PORT_REF,
				.signed_minimum = INT64_MIN,
				.signed_maximum = INT64_MAX,
				.name = "bad",
				.description = "Wrong type for semantic",
				.unit = "",
			},
		};
		static const struct spaghetti_schema_descriptor bad_schema = {
			.schema_id = "spaghetti.test.bad",
			.version = 1U,
			.fields = bad_fields,
			.field_count = ARRAY_SIZE(bad_fields),
		};
		struct spaghetti_property_set empty = { 0 };

		zassert_equal(spaghetti_property_validate(&empty, &bad_schema),
			      -EPROTONOSUPPORT);
	}

	{
		static const struct spaghetti_field_descriptor value_group[] = {
			{
				.field_id = 1U,
				.type = SPAGHETTI_VALUE_BOOL,
				.semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE,
				.reference_group = 1U,
				.name = "flag",
				.description = "VALUE must use group zero",
				.unit = "",
			},
		};
		static const struct spaghetti_schema_descriptor bad_group = {
			.schema_id = "spaghetti.test.group",
			.version = 1U,
			.fields = value_group,
			.field_count = ARRAY_SIZE(value_group),
		};
		struct spaghetti_property_set empty = { 0 };

		zassert_equal(spaghetti_property_validate(&empty, &bad_group),
			      -EPROTONOSUPPORT);
	}
}

ZTEST_SUITE(schema, NULL, NULL, NULL, NULL, NULL);
