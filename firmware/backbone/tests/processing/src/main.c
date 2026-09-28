#include <errno.h>
#include <limits.h>
#include <stddef.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/block_driver.h>
#include <spaghetti/block_registry.h>
#include <spaghetti/processing.h>
#include <spaghetti/schema.h>

#include "block_registry_internal.h"

static int published_count;
static struct spaghetti_record last_published;

static const struct spaghetti_field_descriptor fake_fields[1];
static const struct spaghetti_schema_descriptor fake_schema = {
	.schema_id = "spaghetti.block.fake_double",
	.version = 1U,
	.fields = fake_fields,
	.field_count = 0U,
};

static const struct spaghetti_block_port_descriptor fake_in[] = {
	{ .port_id = 0U, .name = "in", .accepted_types = SPAGHETTI_BLOCK_TYPE_INT64,
	  .required = true },
};
static const struct spaghetti_block_port_descriptor fake_out[] = {
	{ .port_id = 0U, .name = "out", .accepted_types = SPAGHETTI_BLOCK_TYPE_INT64,
	  .required = false },
};

static int fake_validate(const struct spaghetti_property_set *config)
{
	ARG_UNUSED(config);
	return 0;
}

static int fake_init(const struct spaghetti_property_set *config, void *state)
{
	ARG_UNUSED(config);
	ARG_UNUSED(state);
	return 0;
}

static int fake_process(void *state, void *workspace,
			const struct spaghetti_value *inputs,
			const bool *input_valid, size_t input_count,
			struct spaghetti_value *outputs, bool *output_valid,
			size_t output_count,
			const struct spaghetti_record *source_record,
			spaghetti_block_publish_cb_t publish,
			void *publish_user_data)
{
	ARG_UNUSED(state);
	ARG_UNUSED(workspace);
	ARG_UNUSED(source_record);
	ARG_UNUSED(publish);
	ARG_UNUSED(publish_user_data);
	if ((input_count < 1U) || !input_valid[0] || (output_count < 1U)) {
		return -EINVAL;
	}
	outputs[0].field_id = 0U;
	outputs[0].type = SPAGHETTI_VALUE_INT64;
	outputs[0].data.signed_integer = inputs[0].data.signed_integer * 2;
	output_valid[0] = true;
	return 0;
}

static void fake_reset(void *state)
{
	ARG_UNUSED(state);
}

static void fake_deinit(void *state)
{
	ARG_UNUSED(state);
}

static const struct spaghetti_block_driver_ops fake_ops = {
	.validate = fake_validate,
	.init = fake_init,
	.process = fake_process,
	.reset = fake_reset,
	.deinit = fake_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_fake_double) = {
	.type_id = "fake_double",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &fake_schema,
	.inputs = fake_in,
	.input_count = 1U,
	.outputs = fake_out,
	.output_count = 1U,
	.state_size = 0U,
	.state_align = 1U,
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &fake_ops,
};

static int capture_publish(const struct spaghetti_record *record, void *user_data)
{
	ARG_UNUSED(user_data);
	last_published = *record;
	++published_count;
	return 0;
}

static struct spaghetti_value make_i64(uint16_t field_id, int64_t value)
{
	struct spaghetti_value out = {
		.field_id = field_id,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = value,
	};

	return out;
}

static struct spaghetti_record make_record(uint32_t source_key, uint16_t field_id,
					   int64_t value)
{
	struct spaghetti_record record;

	memset(&record, 0, sizeof(record));
	record.source_key = source_key;
	record.timestamp_ms = 1;
	record.sequence = 1U;
	record.payload.kind = SPAGHETTI_RECORD_SAMPLE;
	strcpy(record.payload.schema_id, "test.sample");
	record.payload.schema_version = 1U;
	record.payload.values.field_count = 1U;
	record.payload.values.fields[0] = make_i64(field_id, value);
	return record;
}

static void prop_i64(struct spaghetti_property_set *props, uint16_t field_id,
		     int64_t value)
{
	props->fields[props->field_count++] = make_i64(field_id, value);
}

static void prop_u64(struct spaghetti_property_set *props, uint16_t field_id,
		     uint64_t value)
{
	struct spaghetti_value out = {
		.field_id = field_id,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = value,
	};

	props->fields[props->field_count++] = out;
}

static void *processing_setup(void)
{
	(void)spaghetti_block_registry_init();
	(void)spaghetti_processing_init();
	published_count = 0;
	return NULL;
}

ZTEST(processing, test_fake_block_auto_registers)
{
	zassert_not_null(spaghetti_block_registry_find("fake_double"));
	zassert_not_null(spaghetti_block_registry_find("add"));
	zassert_not_null(spaghetti_block_registry_find("kalman"));
	zassert_true(spaghetti_block_registry_count() > 10U);
}

ZTEST(processing, test_pipeline_fanout_two_sources)
{
	struct spaghetti_block_config blocks[3] = { 0 };
	struct spaghetti_edge_config edges[4] = { 0 };
	struct spaghetti_record record;
	struct spaghetti_processing_stats stats;
	blocks[0].key = 10U;
	strcpy(blocks[0].type_id, "add");
	blocks[0].min_version = 1U;
	blocks[1].key = 11U;
	strcpy(blocks[1].type_id, "scale_offset");
	blocks[1].min_version = 1U;
	prop_i64(&blocks[1].properties, 1U, 3);
	prop_i64(&blocks[1].properties, 2U, 1);
	blocks[2].key = 12U;
	strcpy(blocks[2].type_id, "publish_field");
	blocks[2].min_version = 1U;
	{
		struct spaghetti_value schema = {
			.field_id = 1U,
			.type = SPAGHETTI_VALUE_TEXT,
		};
		strcpy(schema.data.text.text, "derived.sample");
		schema.data.text.size = strlen(schema.data.text.text);
		blocks[2].properties.fields[blocks[2].properties.field_count++] =
			schema;
	}
	prop_u64(&blocks[2].properties, 2U, 1U);
	prop_u64(&blocks[2].properties, 3U, 7U);
	prop_u64(&blocks[2].properties, 4U, 99U);

	edges[0] = (struct spaghetti_edge_config){
		.source_key = 1U,
		.source_port_or_field = 1U,
		.target_key = 10U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_MODULE,
	};
	edges[1] = (struct spaghetti_edge_config){
		.source_key = 2U,
		.source_port_or_field = 1U,
		.target_key = 10U,
		.target_input = 1U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_MODULE,
	};
	edges[2] = (struct spaghetti_edge_config){
		.source_key = 10U,
		.source_port_or_field = 0U,
		.target_key = 11U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_BLOCK,
	};
	edges[3] = (struct spaghetti_edge_config){
		.source_key = 11U,
		.source_port_or_field = 0U,
		.target_key = 12U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_BLOCK,
	};

	published_count = 0;
	zassert_ok(spaghetti_processing_configure(blocks, 3U, edges, 4U));

	record = make_record(1U, 1U, 4);
	zassert_ok(spaghetti_processing_on_record(&record, capture_publish, NULL));
	record = make_record(2U, 1U, 6);
	zassert_ok(spaghetti_processing_on_record(&record, capture_publish, NULL));

	zassert_equal(published_count, 1);
	zassert_equal(last_published.source_key, 99U);
	zassert_equal(last_published.payload.values.fields[0].data.signed_integer,
		      31); /* (4+6)*3+1 */
	zassert_ok(spaghetti_processing_get_stats(&stats));
	zassert_true(stats.evaluations >= 2U);
}

ZTEST(processing, test_stateful_filter_and_reset)
{
	struct spaghetti_block_config block = { 0 };
	struct spaghetti_edge_config edge = {
		.source_key = 1U,
		.source_port_or_field = 1U,
		.target_key = 20U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_MODULE,
	};
	struct spaghetti_record record;
	struct spaghetti_block_config publish = { 0 };
	struct spaghetti_edge_config edges[2];
	struct spaghetti_block_config blocks[2];

	block.key = 20U;
	strcpy(block.type_id, "moving_average");
	block.min_version = 1U;
	prop_u64(&block.properties, 1U, 2U);

	publish.key = 21U;
	strcpy(publish.type_id, "publish_field");
	publish.min_version = 1U;
	{
		struct spaghetti_value schema = {
			.field_id = 1U,
			.type = SPAGHETTI_VALUE_TEXT,
		};
		strcpy(schema.data.text.text, "avg.sample");
		schema.data.text.size = strlen(schema.data.text.text);
		publish.properties.fields[publish.properties.field_count++] =
			schema;
	}
	prop_u64(&publish.properties, 2U, 1U);
	prop_u64(&publish.properties, 3U, 1U);

	blocks[0] = block;
	blocks[1] = publish;
	edges[0] = edge;
	edges[1] = (struct spaghetti_edge_config){
		.source_key = 20U,
		.source_port_or_field = 0U,
		.target_key = 21U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_BLOCK,
	};

	published_count = 0;
	zassert_ok(spaghetti_processing_configure(blocks, 2U, edges, 2U));
	record = make_record(1U, 1U, 10);
	zassert_ok(spaghetti_processing_on_record(&record, capture_publish, NULL));
	record = make_record(1U, 1U, 20);
	zassert_ok(spaghetti_processing_on_record(&record, capture_publish, NULL));
	zassert_equal(last_published.payload.values.fields[0].data.signed_integer,
		      15);

	spaghetti_processing_reset();
	published_count = 0;
	record = make_record(1U, 1U, 100);
	zassert_ok(spaghetti_processing_on_record(&record, capture_publish, NULL));
	zassert_equal(last_published.payload.values.fields[0].data.signed_integer,
		      100);
}

ZTEST(processing, test_overflow_rejected)
{
	struct spaghetti_block_config block = { 0 };
	struct spaghetti_edge_config edges[2];
	struct spaghetti_processing_stats stats;

	block.key = 30U;
	strcpy(block.type_id, "add");
	block.min_version = 1U;

	edges[0] = (struct spaghetti_edge_config){
		.source_key = 1U,
		.source_port_or_field = 1U,
		.target_key = 30U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_MODULE,
	};
	edges[1] = (struct spaghetti_edge_config){
		.source_key = 1U,
		.source_port_or_field = 2U,
		.target_key = 30U,
		.target_input = 1U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_MODULE,
	};

	zassert_ok(spaghetti_processing_configure(&block, 1U, edges, 2U));
	{
		struct spaghetti_record record;

		memset(&record, 0, sizeof(record));
		record.source_key = 1U;
		record.timestamp_ms = 1;
		record.sequence = 1U;
		record.payload.values.field_count = 2U;
		record.payload.values.fields[0] = make_i64(1U, INT64_MAX);
		record.payload.values.fields[1] = make_i64(2U, 1);
		zassert_ok(spaghetti_processing_on_record(&record, NULL, NULL));
	}
	zassert_ok(spaghetti_processing_get_stats(&stats));
	zassert_true(stats.block_errors >= 1U);
}

ZTEST(processing, test_cycle_missing_budget_rollback)
{
	struct spaghetti_block_config blocks[2] = { 0 };
	struct spaghetti_edge_config cycle_edges[2] = { 0 };
	struct spaghetti_edge_config good_edge = {
		.source_key = 1U,
		.source_port_or_field = 1U,
		.target_key = 40U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_MODULE,
	};
	struct spaghetti_block_config good = { 0 };
	struct spaghetti_block_config missing = { 0 };

	good.key = 40U;
	strcpy(good.type_id, "clamp");
	good.min_version = 1U;
	prop_i64(&good.properties, 3U, 0);
	prop_i64(&good.properties, 4U, 10);
	zassert_ok(spaghetti_processing_configure(&good, 1U, &good_edge, 1U));

	blocks[0].key = 50U;
	strcpy(blocks[0].type_id, "clamp");
	blocks[0].min_version = 1U;
	prop_i64(&blocks[0].properties, 3U, 0);
	prop_i64(&blocks[0].properties, 4U, 10);
	blocks[1].key = 51U;
	strcpy(blocks[1].type_id, "clamp");
	blocks[1].min_version = 1U;
	prop_i64(&blocks[1].properties, 3U, 0);
	prop_i64(&blocks[1].properties, 4U, 10);
	cycle_edges[0] = (struct spaghetti_edge_config){
		.source_key = 50U,
		.source_port_or_field = 0U,
		.target_key = 51U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_BLOCK,
	};
	cycle_edges[1] = (struct spaghetti_edge_config){
		.source_key = 51U,
		.source_port_or_field = 0U,
		.target_key = 50U,
		.target_input = 0U,
		.source_kind = SPAGHETTI_EDGE_SOURCE_BLOCK,
	};
	zassert_equal(spaghetti_processing_validate_graph(blocks, 2U, cycle_edges,
							  2U, NULL, 0U),
		      -ELOOP);

	missing.key = 60U;
	strcpy(missing.type_id, "does_not_exist");
	missing.min_version = 1U;
	{
		struct spaghetti_edge_config missing_edge = {
			.source_key = 1U,
			.source_port_or_field = 1U,
			.target_key = 60U,
			.target_input = 0U,
			.source_kind = SPAGHETTI_EDGE_SOURCE_MODULE,
		};

		zassert_equal(
			spaghetti_processing_configure(&missing, 1U, &missing_edge,
						       1U),
			-ENOTSUP);
	}

	/* Live plan must still be the previous good clamp plan. */
	{
		struct spaghetti_record record = make_record(1U, 1U, 100);
		struct spaghetti_block_config pub = { 0 };
		struct spaghetti_edge_config edges[2];
		struct spaghetti_block_config live[2];

		pub.key = 41U;
		strcpy(pub.type_id, "publish_field");
		pub.min_version = 1U;
		{
			struct spaghetti_value schema = {
				.field_id = 1U,
				.type = SPAGHETTI_VALUE_TEXT,
			};
			strcpy(schema.data.text.text, "clamp.out");
			schema.data.text.size = strlen(schema.data.text.text);
			pub.properties.fields[pub.properties.field_count++] =
				schema;
		}
		prop_u64(&pub.properties, 2U, 1U);
		prop_u64(&pub.properties, 3U, 1U);
		live[0] = good;
		live[1] = pub;
		edges[0] = good_edge;
		edges[1] = (struct spaghetti_edge_config){
			.source_key = 40U,
			.source_port_or_field = 0U,
			.target_key = 41U,
			.target_input = 0U,
			.source_kind = SPAGHETTI_EDGE_SOURCE_BLOCK,
		};
		/* Replacing with an extended good plan proves prior configure survived. */
		zassert_ok(spaghetti_processing_configure(live, 2U, edges, 2U));
		published_count = 0;
		zassert_ok(spaghetti_processing_on_record(&record, capture_publish,
							  NULL));
		zassert_equal(
			last_published.payload.values.fields[0].data.signed_integer,
			10);
	}

	/* Budget exceeded: absurd cost via many expensive blocks */
	{
		struct spaghetti_block_config heavy[CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS];
		size_t count = CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS;

		memset(heavy, 0, sizeof(heavy));
		for (size_t idx = 0U; idx < count; ++idx) {
			heavy[idx].key = 100U + (uint32_t)idx;
			strcpy(heavy[idx].type_id, "median");
			heavy[idx].min_version = 1U;
			prop_u64(&heavy[idx].properties, 1U, 3U);
		}
		zassert_equal(spaghetti_processing_configure(heavy, count, NULL, 0U),
			      -ENOSPC);
	}
}

ZTEST_SUITE(processing, NULL, processing_setup, NULL, NULL, NULL);
