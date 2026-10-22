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
#include <spaghetti/port.h>

static uint8_t physical_modes[4];
static int output_level;
static uint16_t output_duty;
const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id) { return id == 0U ? (const struct spaghetti_port *)physical_modes : NULL; }
int spaghetti_port_copy_user_map(spaghetti_port_id_t id, uint8_t modes[4], uint8_t *speed) { ARG_UNUSED(id); memcpy(modes, physical_modes, 4U); *speed = 0U; return 0; }
int spaghetti_port_acquire(const struct spaghetti_port *port, spaghetti_port_owner_t owner, enum spaghetti_port_transport transport) { ARG_UNUSED(port); ARG_UNUSED(owner); ARG_UNUSED(transport); return 0; }
int spaghetti_port_release(const struct spaghetti_port *port, spaghetti_port_owner_t owner) { ARG_UNUSED(port); ARG_UNUSED(owner); return 0; }
int spaghetti_port_digital_output_set(const struct spaghetti_port *port, uint8_t channel, bool high) { ARG_UNUSED(port); ARG_UNUSED(channel); output_level = high; return 0; }
int spaghetti_port_pwm_set(const struct spaghetti_port *port, uint8_t channel, uint16_t duty) { ARG_UNUSED(port); ARG_UNUSED(channel); output_duty = duty; return 0; }
int spaghetti_port_uart_read(const struct spaghetti_port *port, uint8_t *bytes, size_t size, k_timeout_t timeout) { ARG_UNUSED(port); ARG_UNUSED(bytes); ARG_UNUSED(size); ARG_UNUSED(timeout); return -ETIMEDOUT; }
int spaghetti_port_uart_write(const struct spaghetti_port *port, const uint8_t *bytes, size_t size, k_timeout_t timeout) { ARG_UNUSED(port); ARG_UNUSED(bytes); ARG_UNUSED(size); ARG_UNUSED(timeout); return 0; }
int spaghetti_port_spi_transceive(const struct spaghetti_port *port, const struct spaghetti_port_spi_request *request, k_timeout_t timeout) { ARG_UNUSED(port); ARG_UNUSED(request); ARG_UNUSED(timeout); return -ENOTSUP; }

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
	zassert_ok(spaghetti_block_registry_init());
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

ZTEST(processing, test_physical_outputs_follow_records_and_reject_stale_modes)
{
	const char *types[] = {"physical_gpio_out", "physical_pwm_out"};
	for (uint8_t index = 0U; index < 2U; ++index) {
		const struct spaghetti_block_driver *driver = spaghetti_block_registry_find(types[index]);
		zassert_not_null(driver);
		struct spaghetti_property_set config = {0}; prop_u64(&config, 1U, 0U); prop_u64(&config, 2U, 1U);
		uint64_t state[8] = {0}; physical_modes[1] = index ? 12U : 2U;
		zassert_ok(driver->ops->init(&config, state));
		struct spaghetti_value input = make_i64(0U, index ? 2500 : 1); bool valid = true;
		zassert_ok(driver->ops->process(state,NULL,&input,&valid,1U,NULL,NULL,0U,NULL,NULL,NULL));
		if (index) zassert_equal(output_duty,2500U); else zassert_equal(output_level,1);
		input.data.signed_integer = 0;
		zassert_ok(driver->ops->process(state,NULL,&input,&valid,1U,NULL,NULL,0U,NULL,NULL,NULL));
		if (index) zassert_equal(output_duty,0U); else zassert_equal(output_level,0);
		physical_modes[1] = 0U;
		zassert_equal(driver->ops->process(state,NULL,&input,&valid,1U,NULL,NULL,0U,NULL,NULL,NULL),-ESTALE);
		driver->ops->deinit(state);
	}
}

ZTEST_SUITE(processing, NULL, processing_setup, NULL, NULL, NULL);

static const void *test_led_owner;
static bool test_led_on;
int spaghetti_status_led_set(const void *owner, bool on) { if (test_led_owner && test_led_owner != owner) return -EBUSY; test_led_owner = owner; test_led_on = on; return 0; }
void spaghetti_status_led_release(const void *owner) { if (test_led_owner == owner) test_led_owner = NULL; }
ZTEST(processing, test_status_led_bool_threshold_invert_and_release)
{
 const struct spaghetti_block_driver *driver = spaghetti_block_registry_find("status_led"); zassert_not_null(driver);
 for (unsigned inverted = 0; inverted < 2; ++inverted) {
  struct spaghetti_property_set config = {0}; prop_u64(&config, 1U, 50U);
  config.fields[config.field_count++] = (struct spaghetti_value){ .field_id = 2U, .type = SPAGHETTI_VALUE_BOOL, .data.boolean = inverted != 0 };
  uint64_t state[8] = {0}; zassert_ok(driver->ops->init(&config, state));
  struct spaghetti_value value = { .type = SPAGHETTI_VALUE_BOOL, .data.boolean = true }; bool valid = true;
  zassert_ok(driver->ops->process(state,NULL,&value,&valid,1,NULL,NULL,0,NULL,NULL,NULL)); zassert_equal(test_led_on, !inverted);
  value = make_i64(0,49); zassert_ok(driver->ops->process(state,NULL,&value,&valid,1,NULL,NULL,0,NULL,NULL,NULL)); zassert_equal(test_led_on, inverted != 0);
  value = make_i64(0,50); zassert_ok(driver->ops->process(state,NULL,&value,&valid,1,NULL,NULL,0,NULL,NULL,NULL)); zassert_equal(test_led_on, !inverted);
  driver->ops->reset(state); zassert_false(test_led_on);
  driver->ops->deinit(state); zassert_is_null(test_led_owner);
 }
}

/* Reproduces the production runtime caller: records must fit a small worker
 * even when the graph is empty. The old all-block output array exceeded 8 KB. */
K_THREAD_STACK_DEFINE(record_worker_stack, 4096);
static struct k_thread record_worker;
static struct spaghetti_record worker_record;
static int worker_result;
static void process_record_on_worker(void *a, void *b, void *c)
{
	ARG_UNUSED(a); ARG_UNUSED(b); ARG_UNUSED(c);
	worker_result = spaghetti_processing_on_record(&worker_record, NULL, NULL);
}

ZTEST(processing, test_records_fit_runtime_worker_stack)
{
	struct spaghetti_block_config block = { .key = 10U, .min_version = 1U };
	struct spaghetti_edge_config edge = {
		.source_kind = SPAGHETTI_EDGE_SOURCE_MODULE,
		.source_key = 1U, .source_port_or_field = 1U,
		.target_key = 10U, .target_input = 0U,
	};
	strcpy(block.type_id, "fake_double");
	worker_record = make_record(1U, 1U, 7);
	for (unsigned active = 0U; active < 2U; ++active) {
		zassert_ok(spaghetti_processing_configure(active ? &block : NULL,
			active, active ? &edge : NULL, active));
		worker_result = -EINPROGRESS;
		k_thread_create(&record_worker, record_worker_stack,
			K_THREAD_STACK_SIZEOF(record_worker_stack), process_record_on_worker,
			NULL, NULL, NULL, K_PRIO_PREEMPT(5), 0, K_NO_WAIT);
		zassert_ok(k_thread_join(&record_worker, K_SECONDS(2)));
		zassert_ok(worker_result);
	}
	zassert_ok(spaghetti_processing_configure(NULL, 0U, NULL, 0U));
}

ZTEST(processing, test_logical_samples_and_discrete_types)
{
 for(int kind=0;kind<2;kind++) {
  const struct spaghetti_block_driver *d=spaghetti_block_registry_find(kind?"logic_or":"logic_and");zassert_not_null(d);
  struct spaghetti_property_set p={0}; uint64_t state[64]={0};zassert_true(d->state_size<=sizeof(state));zassert_ok(d->ops->init(&p,state));
  struct spaghetti_value in[2]={make_i64(0,-2),make_i64(1,0)},out[1];bool valid[2]={true,false},ov[1]={false};
  zassert_ok(d->ops->process(state,NULL,in,valid,2,out,ov,1,NULL,NULL,NULL));zassert_false(ov[0]);
  valid[0]=false;valid[1]=true;
  zassert_ok(d->ops->process(state,NULL,in,valid,2,out,ov,1,NULL,NULL,NULL));zassert_true(ov[0]);zassert_equal(out[0].data.boolean,kind==1);
  in[1].data.signed_integer=3;
  zassert_ok(d->ops->process(state,NULL,in,valid,2,out,ov,1,NULL,NULL,NULL));zassert_true(out[0].data.boolean);
  in[1].type=SPAGHETTI_VALUE_TEXT;
  zassert_equal(d->ops->process(state,NULL,in,valid,2,out,ov,1,NULL,NULL,NULL),-EINVAL);
  d->ops->reset(state);valid[1]=false;ov[0]=false;
  zassert_ok(d->ops->process(state,NULL,in,valid,2,out,ov,1,NULL,NULL,NULL));zassert_false(ov[0]);
 }
}
ZTEST(processing, test_if_and_while_compare_on_value_change)
{
 for(int kind=0;kind<2;kind++) {
  const struct spaghetti_block_driver *d=spaghetti_block_registry_find(kind?"logic_while":"logic_if");zassert_not_null(d);
  struct spaghetti_property_set p={0};prop_u64(&p,1,4);
  p.fields[p.field_count++]=make_i64(2,10);
  uint64_t state[64]={0};zassert_ok(d->ops->validate(&p));zassert_ok(d->ops->init(&p,state));
  struct spaghetti_value in[2]={make_i64(0,12),make_i64(1,1)},out[1];bool valid[2]={true,true},ov[1]={false};
  struct spaghetti_record record={.source_key=33};
  zassert_ok(d->ops->process(state,NULL,in,valid,2,out,ov,1,&record,NULL,NULL));zassert_true(ov[0]);
  record.source_key=77;ov[0]=false;
  zassert_ok(d->ops->process(state,NULL,in,valid,2,out,ov,1,&record,NULL,NULL));zassert_equal(ov[0],!kind);if(!kind)zassert_equal(out[0].data.unsigned_integer,1);
  ov[0]=false;
  zassert_ok(d->ops->process(state,NULL,in,valid,2,out,ov,1,&record,NULL,NULL));zassert_equal(ov[0],!kind);
  in[0].data.signed_integer=9;ov[0]=false;
  zassert_ok(d->ops->process(state,NULL,in,valid,2,out,ov,1,&record,NULL,NULL));zassert_equal(ov[0],!kind);if(!kind)zassert_equal(out[0].data.unsigned_integer,0);
  in[0].type=SPAGHETTI_VALUE_UINT64;in[0].data.unsigned_integer=UINT64_MAX;ov[0]=false;
  zassert_ok(d->ops->process(state,NULL,in,valid,2,out,ov,1,&record,NULL,NULL));zassert_true(ov[0]);zassert_true(out[0].data.boolean);
 }
}

ZTEST(processing, test_if_configurable_true_and_false_levels)
{
 const struct spaghetti_block_driver *d=spaghetti_block_registry_find("logic_if");zassert_not_null(d);
 for(uint8_t high=0;high<2;high++)for(uint8_t low=0;low<2;low++) {
  struct spaghetti_property_set p={0};prop_u64(&p,1,1);prop_u64(&p,5,high);prop_u64(&p,6,low);
  uint64_t state[64]={0};zassert_ok(d->ops->validate(&p));zassert_ok(d->ops->init(&p,state));
  struct spaghetti_value input=make_i64(0,1),output;bool valid=true,ov=false;
  zassert_ok(d->ops->process(state,NULL,&input,&valid,1,&output,&ov,1,NULL,NULL,NULL));
  zassert_true(ov);zassert_equal(output.type,SPAGHETTI_VALUE_UINT64);zassert_equal(output.data.unsigned_integer,high);
  input.data.signed_integer=0;
  zassert_ok(d->ops->process(state,NULL,&input,&valid,1,&output,&ov,1,NULL,NULL,NULL));zassert_equal(output.data.unsigned_integer,low);
 }
}

ZTEST(processing, test_logical_decimal_and_numeric_text)
{
 const struct spaghetti_block_driver *d=spaghetti_block_registry_find("logic_if");zassert_not_null(d);
 struct spaghetti_property_set p={0};prop_u64(&p,1,2);prop_u64(&p,8,2);
 p.fields[p.field_count++]=(struct spaghetti_value){.field_id=7,.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="23.56",.size=5}};
 uint64_t state[64]={0};zassert_ok(d->ops->validate(&p));zassert_ok(d->ops->init(&p,state));
 struct spaghetti_value input={.type=SPAGHETTI_VALUE_FLOAT,.data.decimal=23.5625},out;bool valid=true,ov=false;
 zassert_ok(d->ops->process(state,NULL,&input,&valid,1,&out,&ov,1,NULL,NULL,NULL));zassert_true(ov);zassert_equal(out.data.unsigned_integer,1);
 input.data.decimal=23.57;
 zassert_ok(d->ops->process(state,NULL,&input,&valid,1,&out,&ov,1,NULL,NULL,NULL));zassert_equal(out.data.unsigned_integer,0);
 input=(struct spaghetti_value){.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="23,56",.size=5}};
 zassert_ok(d->ops->process(state,NULL,&input,&valid,1,&out,&ov,1,NULL,NULL,NULL));zassert_equal(out.data.unsigned_integer,1);
 const char *bad[]={"23 C","abc","NaN","Infinity",""};
 for(size_t i=0;i<ARRAY_SIZE(bad);i++) {
  strcpy(input.data.text.text,bad[i]);input.data.text.size=strlen(bad[i]);
  zassert_equal(d->ops->process(state,NULL,&input,&valid,1,&out,&ov,1,NULL,NULL,NULL),-EINVAL);
 }
}
ZTEST(processing, test_while_numeric_text_is_copied_and_compares_values)
{
 const struct spaghetti_block_driver *d=spaghetti_block_registry_find("logic_while");struct spaghetti_property_set p={0};prop_u64(&p,1,1);prop_u64(&p,8,255);
 uint64_t state[64]={0};zassert_ok(d->ops->init(&p,state));
 struct spaghetti_value input={.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="12.5",.size=4}},out;bool valid=true,ov=false;
 zassert_ok(d->ops->process(state,NULL,&input,&valid,1,&out,&ov,1,NULL,NULL,NULL));zassert_true(ov);
 ov=false;
 zassert_ok(d->ops->process(state,NULL,&input,&valid,1,&out,&ov,1,NULL,NULL,NULL));zassert_false(ov);
 input.data.text.text[3]='6';ov=false;
 zassert_ok(d->ops->process(state,NULL,&input,&valid,1,&out,&ov,1,NULL,NULL,NULL));zassert_true(ov);
}

static uint8_t test_led_intensity;
int spaghetti_status_led_set_intensity(const void *owner, uint8_t percent)
{
 int err = spaghetti_status_led_set(owner, percent > 0U);
 if (!err) test_led_intensity = percent;
 return err;
}
ZTEST(processing, test_white_led_pwm_initial_actions_and_numeric_input)
{
 const struct spaghetti_block_driver *driver = spaghetti_block_registry_find("status_led");
 struct spaghetti_property_set config = {0}; prop_u64(&config,1U,1U);
 config.fields[config.field_count++] = (struct spaghetti_value){.field_id=2U,.type=SPAGHETTI_VALUE_BOOL,.data.boolean=false};
 prop_u64(&config,3U,25U);
 struct spaghetti_value *steps=&config.fields[config.field_count++];steps->field_id=8U;steps->type=SPAGHETTI_VALUE_TEXT;steps->data.text.size=5U;memcpy(steps->data.text.text,"12,67",6U);
 uint64_t state[8]={0}; zassert_ok(driver->ops->init(&config,state)); zassert_equal(test_led_intensity,25U);
 struct spaghetti_value inputs[5]={0}, outputs[2]={0}; bool valid[5]={0}, output_valid[2]={0};
 inputs[4].type=SPAGHETTI_VALUE_FLOAT;inputs[4].data.decimal=37.4;valid[4]=true;
 zassert_ok(driver->ops->process(state,NULL,inputs,valid,5,outputs,output_valid,2,NULL,NULL,NULL));
 zassert_equal(test_led_intensity,37U);zassert_equal(outputs[1].data.unsigned_integer,37U);zassert_true(outputs[0].data.boolean);
 valid[4]=false;inputs[2].type=SPAGHETTI_VALUE_BOOL;inputs[2].data.boolean=true;valid[2]=true;
 zassert_ok(driver->ops->process(state,NULL,inputs,valid,5,outputs,output_valid,2,NULL,NULL,NULL));zassert_equal(test_led_intensity,0U);
 valid[4]=true;
 zassert_ok(driver->ops->process(state,NULL,inputs,valid,5,outputs,output_valid,2,NULL,NULL,NULL));zassert_equal(test_led_intensity,0U);
 valid[4]=false;
 valid[2]=false;inputs[1].type=SPAGHETTI_VALUE_BOOL;inputs[1].data.boolean=true;valid[1]=true;
 zassert_ok(driver->ops->process(state,NULL,inputs,valid,5,outputs,output_valid,2,NULL,NULL,NULL));zassert_equal(test_led_intensity,100U);
 valid[1]=false;inputs[3].type=SPAGHETTI_VALUE_BOOL;inputs[3].data.boolean=true;valid[3]=true;
 zassert_ok(driver->ops->process(state,NULL,inputs,valid,5,outputs,output_valid,2,NULL,NULL,NULL));zassert_equal(test_led_intensity,67U);
 valid[3]=false;inputs[4].data.decimal=101;valid[4]=true;
 zassert_equal(driver->ops->process(state,NULL,inputs,valid,5,outputs,output_valid,2,NULL,NULL,NULL),-ERANGE);zassert_equal(test_led_intensity,67U);
 driver->ops->reset(state);zassert_equal(test_led_intensity,0U);driver->ops->deinit(state);
}

ZTEST(processing, test_if_threshold_accepts_cbor_unsigned_zero_and_positive)
{
 const struct spaghetti_block_driver *driver=spaghetti_block_registry_find("logic_if");
 struct spaghetti_property_set config={0};prop_u64(&config,1U,5U);prop_u64(&config,2U,0U);
 zassert_ok(driver->ops->validate(&config));
 struct spaghetti_value *decimal=&config.fields[config.field_count++];decimal->field_id=7U;decimal->type=SPAGHETTI_VALUE_TEXT;decimal->data.text.size=4U;memcpy(decimal->data.text.text,"28.1",5U);
 zassert_ok(driver->ops->validate(&config));
 uint64_t state[128]={0};zassert_ok(driver->ops->init(&config,state));
 struct spaghetti_value value={.type=SPAGHETTI_VALUE_FLOAT,.data.decimal=28.2},out={0};bool valid=true,out_valid=false;
 zassert_ok(driver->ops->process(state,NULL,&value,&valid,1,&out,&out_valid,1,NULL,NULL,NULL));zassert_true(out_valid);zassert_equal(out.data.unsigned_integer,1U);
 config.field_count=2;config.fields[1].data.unsigned_integer=28U;zassert_ok(driver->ops->validate(&config));
 config.fields[1].data.unsigned_integer=UINT64_MAX;zassert_equal(driver->ops->validate(&config),-ERANGE);
 driver->ops->deinit(state);
}

ZTEST(processing, test_led_validation_does_not_touch_live_pwm)
{
 const struct spaghetti_block_driver *driver=spaghetti_block_registry_find("status_led");
 struct spaghetti_property_set config={0};prop_u64(&config,1U,1U);
 config.fields[config.field_count++]=(struct spaghetti_value){.field_id=2U,.type=SPAGHETTI_VALUE_BOOL,.data.boolean=false};
 prop_u64(&config,3U,60U);
 uint64_t state[8]={0};zassert_ok(driver->ops->init(&config,state));zassert_equal(test_led_intensity,60U);
 struct spaghetti_block_config block={.key=100U};strcpy(block.type_id,"status_led");block.properties=config;block.properties.fields[2].data.unsigned_integer=0U;
 zassert_ok(spaghetti_processing_validate_graph(&block,1U,NULL,0U,NULL,0U));
 zassert_equal(test_led_intensity,60U);zassert_equal_ptr(test_led_owner,state);zassert_false(spaghetti_processing_is_validating());
 driver->ops->deinit(state);
}

K_THREAD_STACK_DEFINE(publishing_worker_stack,3072);
static void process_publishing_on_worker(void *a,void *b,void *c) {
 ARG_UNUSED(a);ARG_UNUSED(b);ARG_UNUSED(c);
 worker_result=spaghetti_processing_on_record(&worker_record,capture_publish,NULL);
}
ZTEST(processing, test_observed_logic_fits_runtime_worker_stack)
{
 struct spaghetti_block_config *blocks=k_calloc(2,sizeof(*blocks));zassert_not_null(blocks);
 blocks[0].key=10;strcpy(blocks[0].type_id,"logic_if");prop_u64(&blocks[0].properties,1,1);
 blocks[1].key=11;strcpy(blocks[1].type_id,"publish_field");
 struct spaghetti_value *schema=&blocks[1].properties.fields[blocks[1].properties.field_count++];schema->field_id=1;schema->type=SPAGHETTI_VALUE_TEXT;schema->data.text.size=9;memcpy(schema->data.text.text,"flow.test",10);
 prop_u64(&blocks[1].properties,2,1);prop_u64(&blocks[1].properties,3,1);prop_u64(&blocks[1].properties,4,0x70000000);
 struct spaghetti_edge_config edges[2]={{.source_key=1,.source_port_or_field=1,.target_key=10,.target_input=0,.source_kind=SPAGHETTI_EDGE_SOURCE_MODULE},{.source_key=10,.source_port_or_field=0,.target_key=11,.target_input=0,.source_kind=SPAGHETTI_EDGE_SOURCE_BLOCK}};
 zassert_ok(spaghetti_processing_configure(blocks,2,edges,2));k_free(blocks);worker_record=make_record(1,1,0);published_count=0;worker_result=-EINPROGRESS;
 k_thread_create(&record_worker,publishing_worker_stack,K_THREAD_STACK_SIZEOF(publishing_worker_stack),process_publishing_on_worker,NULL,NULL,NULL,K_PRIO_PREEMPT(5),0,K_NO_WAIT);
 zassert_ok(k_thread_join(&record_worker,K_SECONDS(2)));zassert_ok(worker_result);zassert_equal(published_count,1);zassert_equal(last_published.payload.values.fields[0].data.unsigned_integer,0U);
 zassert_ok(spaghetti_processing_configure(NULL,0,NULL,0));
}

/* Match the hardware driver's ownership transfer when installing a new plan. */
int spaghetti_status_led_init(const void *owner, uint8_t percent)
{
 test_led_owner=owner;test_led_intensity=percent;test_led_on=percent>0U;return 0;
}
ZTEST(processing, test_deployed_if_drives_led_after_plan_install_and_reload)
{
 struct spaghetti_block_config *blocks=k_calloc(2,sizeof(*blocks));zassert_not_null(blocks);
 blocks[0].key=10;strcpy(blocks[0].type_id,"logic_if");
 prop_u64(&blocks[0].properties,1,5);prop_u64(&blocks[0].properties,2,28);
 blocks[1].key=11;strcpy(blocks[1].type_id,"status_led");
 prop_u64(&blocks[1].properties,1,1);
 blocks[1].properties.fields[blocks[1].properties.field_count++]=(struct spaghetti_value){.field_id=2,.type=SPAGHETTI_VALUE_BOOL,.data.boolean=false};
 struct spaghetti_edge_config edges[2]={
 {.source_key=1,.source_port_or_field=1,.target_key=10,.target_input=0,.source_kind=SPAGHETTI_EDGE_SOURCE_MODULE},
 {.source_key=10,.source_port_or_field=0,.target_key=11,.target_input=0,.source_kind=SPAGHETTI_EDGE_SOURCE_BLOCK}};
 for(int reload=0;reload<3;reload++) {
  zassert_ok(spaghetti_processing_configure(blocks,2,edges,2));
  const void *owner=test_led_owner;zassert_not_null(owner);
  struct spaghetti_record record=make_record(1,1,39);
  zassert_ok(spaghetti_processing_on_record(&record,NULL,NULL));zassert_true(test_led_on,"39 >= 28 must turn on the deployed LED");
  zassert_ok(spaghetti_processing_validate_graph(blocks,2,edges,2,NULL,0));
  zassert_equal_ptr(test_led_owner,owner);zassert_true(test_led_on);
  record=make_record(1,1,27);
  zassert_ok(spaghetti_processing_on_record(&record,NULL,NULL));zassert_false(test_led_on);
 }
 zassert_ok(spaghetti_processing_configure(NULL,0,NULL,0));zassert_is_null(test_led_owner);k_free(blocks);
}

ZTEST(processing, test_led_driver_presets_follow_high_and_low)
{
 const struct spaghetti_block_driver *d=spaghetti_block_registry_find("led_driver");zassert_not_null(d);
 struct spaghetti_property_set p={0};for(uint8_t i=1;i<=10;i++)prop_u64(&p,i,i==1?0xFF0000:i==2?0x0000FF:i>=5&&i<=8?1:i==9?3:0);
 zassert_ok(d->ops->validate(&p));uint64_t state[8]={0};zassert_ok(d->ops->init(&p,state));
 struct spaghetti_value inputs[4]={{.type=SPAGHETTI_VALUE_BOOL,.data.boolean=true}},out;bool valid[4]={true,false,false,false},ov=false;
 zassert_ok(d->ops->process(state,NULL,inputs,valid,4,&out,&ov,1,NULL,NULL,NULL));zassert_true(ov);zassert_equal(out.data.unsigned_integer,0xFF0000);
 ov=false;zassert_ok(d->ops->process(state,NULL,inputs,valid,4,&out,&ov,1,NULL,NULL,NULL));zassert_false(ov);
 inputs[0].data.boolean=false;ov=false;zassert_ok(d->ops->process(state,NULL,inputs,valid,4,&out,&ov,1,NULL,NULL,NULL));zassert_true(ov);zassert_equal(out.data.unsigned_integer,0);
 valid[0]=false;valid[1]=true;inputs[1].type=SPAGHETTI_VALUE_UINT64;inputs[1].data.unsigned_integer=1;
 zassert_ok(d->ops->process(state,NULL,inputs,valid,4,&out,&ov,1,NULL,NULL,NULL));zassert_true(ov);zassert_equal(out.data.unsigned_integer,0x0000FF);
}
ZTEST(processing, test_led_driver_low_and_repeatable_event_triggers)
{
 const struct spaghetti_block_driver *d=spaghetti_block_registry_find("led_driver");struct spaghetti_property_set p={0};
 for(uint8_t i=1;i<=10;i++)prop_u64(&p,i,i==1?0x00FF00:i==9||i==10?1:0);
 zassert_ok(d->ops->validate(&p));uint64_t state[8]={0};zassert_ok(d->ops->init(&p,state));
 struct spaghetti_value in={.type=SPAGHETTI_VALUE_BOOL,.data.boolean=false},out;bool valid=true,ov=false;
 zassert_ok(d->ops->process(state,NULL,&in,&valid,1,&out,&ov,1,NULL,NULL,NULL));zassert_true(ov);zassert_equal(out.data.unsigned_integer,0);
 in.data.boolean=true;
 for(uint8_t i=0;i<2;i++){ov=false;zassert_ok(d->ops->process(state,NULL,&in,&valid,1,&out,&ov,1,NULL,NULL,NULL));zassert_true(ov);zassert_equal(out.data.unsigned_integer,0x00FF00);}
 in.type=SPAGHETTI_VALUE_TEXT;ov=false;zassert_equal(d->ops->process(state,NULL,&in,&valid,1,&out,&ov,1,NULL,NULL,NULL),-EINVAL);
}

ZTEST(processing, test_color_generator_exclusive_encodings)
{
 const struct spaghetti_block_driver *d=spaghetti_block_registry_find("led_driver");
 for(unsigned mode=0;mode<2;mode++){
 struct spaghetti_property_set p={0};for(uint8_t i=1;i<=11;i++)prop_u64(&p,i,i==1?0xFF8000:i>=5&&i<=9?1:i==11?mode:0);
 zassert_ok(d->ops->validate(&p));uint64_t state[8]={0};zassert_ok(d->ops->init(&p,state));
 struct spaghetti_value in={.type=SPAGHETTI_VALUE_BOOL,.data.boolean=true},out[4];bool valid=true,ov[4];
 zassert_ok(d->ops->process(state,NULL,&in,&valid,1,out,ov,4,NULL,NULL,NULL));
 if(mode==0){zassert_true(ov[0]);zassert_false(ov[1]);zassert_equal(out[0].type,SPAGHETTI_VALUE_TEXT);zassert_equal(out[0].data.text.size,7);zassert_mem_equal(out[0].data.text.text,"#FF8000",7);}
 else{zassert_false(ov[0]);zassert_true(ov[1]&&ov[2]&&ov[3]);zassert_equal(out[1].data.unsigned_integer,100);zassert_equal(out[2].data.unsigned_integer,50);zassert_equal(out[3].data.unsigned_integer,0);}
 in.data.boolean=false;
 zassert_ok(d->ops->process(state,NULL,&in,&valid,1,out,ov,4,NULL,NULL,NULL));
 if(mode==0){zassert_true(ov[0]);zassert_false(ov[1]);zassert_mem_equal(out[0].data.text.text,"#000000",7);}
 else{zassert_false(ov[0]);for(unsigned channel=1;channel<4;channel++){zassert_true(ov[channel]);zassert_equal(out[channel].data.unsigned_integer,0);}}
 zassert_ok(d->ops->process(state,NULL,&in,&valid,1,out,ov,4,NULL,NULL,NULL));
 for(unsigned channel=0;channel<4;channel++)zassert_false(ov[channel]);
 }
}

ZTEST(processing, test_publish_preserves_color_text_decimal_and_bytes)
{
 struct spaghetti_block_config block={.key=21,.min_version=1};
 strcpy(block.type_id,"publish_field");
 struct spaghetti_value schema={.field_id=1,.type=SPAGHETTI_VALUE_TEXT};
 strcpy(schema.data.text.text,"typed.sample");schema.data.text.size=strlen(schema.data.text.text);
 block.properties.fields[block.properties.field_count++]=schema;
 prop_u64(&block.properties,2,1);prop_u64(&block.properties,3,1);
 struct spaghetti_edge_config edge={.source_key=1,.source_port_or_field=1,.target_key=21,.target_input=0,.source_kind=SPAGHETTI_EDGE_SOURCE_MODULE};
 zassert_ok(spaghetti_processing_configure(&block,1,&edge,1));published_count=0;
 struct spaghetti_record record=make_record(1,1,0);
 struct spaghetti_value *value=&record.payload.values.fields[0];
 value->type=SPAGHETTI_VALUE_TEXT;value->data.text.size=7;strcpy(value->data.text.text,"#204060");
 zassert_ok(spaghetti_processing_on_record(&record,capture_publish,NULL));
 zassert_equal(published_count,1);zassert_equal(last_published.payload.values.fields[0].type,SPAGHETTI_VALUE_TEXT);
 zassert_str_equal(last_published.payload.values.fields[0].data.text.text,"#204060");
 value->type=SPAGHETTI_VALUE_FLOAT;value->data.decimal=28.12;
 zassert_ok(spaghetti_processing_on_record(&record,capture_publish,NULL));
 zassert_equal(published_count,2);zassert_equal(last_published.payload.values.fields[0].type,SPAGHETTI_VALUE_FLOAT);
 zassert_equal(last_published.payload.values.fields[0].data.decimal,28.12);
 value->type=SPAGHETTI_VALUE_BYTES;value->data.bytes.size=3;memcpy(value->data.bytes.bytes,"rgb",3);
 zassert_ok(spaghetti_processing_on_record(&record,capture_publish,NULL));
 zassert_equal(published_count,3);zassert_equal(last_published.payload.values.fields[0].type,SPAGHETTI_VALUE_BYTES);
 zassert_mem_equal(last_published.payload.values.fields[0].data.bytes.bytes,"rgb",3);
}

/* A contained manual button and its clock are independent activation paths. */
ZTEST(processing, test_color_preset_accepts_manual_and_clock_sources)
{
 struct spaghetti_block_config blocks[2]={{.key=10,.min_version=1},{.key=11,.min_version=1}};
 strcpy(blocks[0].type_id,"led_driver");
 for(uint16_t field=1;field<=10;field++)prop_u64(&blocks[0].properties,field,field==1?0x204060:field>=5?1:0);
 prop_u64(&blocks[0].properties,11,0);
 strcpy(blocks[1].type_id,"publish_field");
 struct spaghetti_value schema={.field_id=1,.type=SPAGHETTI_VALUE_TEXT};
 strcpy(schema.data.text.text,"color.test");schema.data.text.size=10;
 blocks[1].properties.fields[blocks[1].properties.field_count++]=schema;
 prop_u64(&blocks[1].properties,2,1);prop_u64(&blocks[1].properties,3,1);
 struct spaghetti_edge_config edges[]={
  {.source_kind=SPAGHETTI_EDGE_SOURCE_MODULE,.source_key=1,.source_port_or_field=1,.target_key=10,.target_input=0},
  {.source_kind=SPAGHETTI_EDGE_SOURCE_MODULE,.source_key=2,.source_port_or_field=1,.target_key=10,.target_input=0},
  {.source_kind=SPAGHETTI_EDGE_SOURCE_BLOCK,.source_key=10,.source_port_or_field=0,.target_key=11,.target_input=0},
 };
 zassert_ok(spaghetti_processing_configure(blocks,2,edges,3));published_count=0;
 struct spaghetti_record record=make_record(1,1,1);
 zassert_ok(spaghetti_processing_on_record(&record,capture_publish,NULL));zassert_equal(published_count,1);
 record=make_record(2,1,1);
 zassert_ok(spaghetti_processing_on_record(&record,capture_publish,NULL));zassert_equal(published_count,2);
 record=make_record(1,1,0);
 zassert_ok(spaghetti_processing_on_record(&record,capture_publish,NULL));zassert_equal(published_count,3);
 record=make_record(1,1,1);
 zassert_ok(spaghetti_processing_on_record(&record,capture_publish,NULL));zassert_equal(published_count,4);
 /* The same fan-in remains invalid for a data sink. */
 edges[0].target_key=11;edges[1].target_key=11;
 zassert_equal(spaghetti_processing_configure(blocks+1,1,edges,2),-EEXIST);
}

int spaghetti_port_pwm_write(const struct spaghetti_port *port,uint8_t channel,uint32_t frequency,uint16_t duty) { ARG_UNUSED(frequency);return spaghetti_port_pwm_set(port,channel,duty); }

ZTEST(processing, test_compiled_temperature_if_color_can_graph) {
 struct spaghetti_block_config *blocks=k_calloc(6,sizeof(*blocks)); zassert_not_null(blocks);
 blocks[0].key=1; strcpy(blocks[0].type_id,"led_driver");
 prop_u64(&blocks[0].properties,1,16724838ULL);
 prop_u64(&blocks[0].properties,2,3377407ULL);
 prop_u64(&blocks[0].properties,3,0ULL);
 prop_u64(&blocks[0].properties,4,0ULL);
 prop_u64(&blocks[0].properties,5,1ULL);
 prop_u64(&blocks[0].properties,6,1ULL);
 prop_u64(&blocks[0].properties,7,1ULL);
 prop_u64(&blocks[0].properties,8,1ULL);
 prop_u64(&blocks[0].properties,9,3ULL);
 prop_u64(&blocks[0].properties,10,0ULL);
 prop_u64(&blocks[0].properties,11,0ULL);
 blocks[1].key=2; strcpy(blocks[1].type_id,"publish_field");
 blocks[1].properties.fields[blocks[1].properties.field_count++]=(struct spaghetti_value){.field_id=1,.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="flow.60d006223c5e3302",.size=21}};
 prop_u64(&blocks[1].properties,2,1ULL);
 prop_u64(&blocks[1].properties,3,1ULL);
 prop_u64(&blocks[1].properties,4,1879048192ULL);
 blocks[2].key=3; strcpy(blocks[2].type_id,"publish_field");
 blocks[2].properties.fields[blocks[2].properties.field_count++]=(struct spaghetti_value){.field_id=1,.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="flow.6f2af903c0149e44",.size=21}};
 prop_u64(&blocks[2].properties,2,1ULL);
 prop_u64(&blocks[2].properties,3,1ULL);
 prop_u64(&blocks[2].properties,4,1879048194ULL);
 blocks[3].key=4; strcpy(blocks[3].type_id,"publish_field");
 blocks[3].properties.fields[blocks[3].properties.field_count++]=(struct spaghetti_value){.field_id=1,.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="flow.38dcb5e2cc88aa19",.size=21}};
 prop_u64(&blocks[3].properties,2,1ULL);
 prop_u64(&blocks[3].properties,3,1ULL);
 prop_u64(&blocks[3].properties,4,1879048193ULL);
 blocks[4].key=5; strcpy(blocks[4].type_id,"logic_if");
 prop_u64(&blocks[4].properties,1,4ULL);
 prop_u64(&blocks[4].properties,2,0ULL);
 prop_u64(&blocks[4].properties,5,1ULL);
 prop_u64(&blocks[4].properties,6,0ULL);
 blocks[4].properties.fields[blocks[4].properties.field_count++]=(struct spaghetti_value){.field_id=7,.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="30",.size=2}};
 prop_u64(&blocks[4].properties,8,2ULL);
 blocks[5].key=6; strcpy(blocks[5].type_id,"status_led");
 prop_u64(&blocks[5].properties,1,1ULL);
 blocks[5].properties.fields[blocks[5].properties.field_count++]=(struct spaghetti_value){.field_id=2,.type=SPAGHETTI_VALUE_BOOL,.data.boolean=false};
 prop_u64(&blocks[5].properties,3,0ULL);
 blocks[5].properties.fields[blocks[5].properties.field_count++]=(struct spaghetti_value){.field_id=6,.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="100",.size=3}};
 blocks[5].properties.fields[blocks[5].properties.field_count++]=(struct spaghetti_value){.field_id=7,.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="0",.size=1}};
 blocks[5].properties.fields[blocks[5].properties.field_count++]=(struct spaghetti_value){.field_id=8,.type=SPAGHETTI_VALUE_TEXT,.data.text={.text="50",.size=2}};
 struct spaghetti_module_config modules[3]={{.key=1},{.key=2},{.key=3}};
 struct spaghetti_edge_config edges[]={
{.source_key=3,.source_port_or_field=1,.target_key=5,.target_input=0,.source_kind=0},
{.source_key=1,.source_port_or_field=0,.target_key=2,.target_input=0,.source_kind=1},
{.source_key=5,.source_port_or_field=0,.target_key=1,.target_input=1,.source_kind=1},
{.source_key=5,.source_port_or_field=0,.target_key=3,.target_input=0,.source_kind=1},
{.source_key=5,.source_port_or_field=0,.target_key=4,.target_input=0,.source_kind=1},
{.source_key=5,.source_port_or_field=0,.target_key=6,.target_input=0,.source_kind=1},
};
 zassert_ok(spaghetti_processing_validate_graph(blocks,6,edges,6,modules,3)); k_free(blocks);
}

ZTEST(processing, test_color_split_channels_and_invalid_input)
{
 const struct spaghetti_block_driver *d = spaghetti_block_registry_find("color_split");
 zassert_not_null(d);
 struct spaghetti_property_set p = {0};
 zassert_ok(d->ops->validate(&p));
 uint8_t state = 0;
 zassert_ok(d->ops->init(&p, &state));
 struct spaghetti_value in = {.type=SPAGHETTI_VALUE_TEXT}, out[3];
 bool valid = true, ov[3];
 memcpy(in.data.text.text, "#ff8000", 7); in.data.text.size=7;
 zassert_ok(d->ops->process(&state,NULL,&in,&valid,1,out,ov,3,NULL,NULL,NULL));
 zassert_equal(out[0].data.unsigned_integer,100);
 zassert_equal(out[1].data.unsigned_integer,50);
 zassert_equal(out[2].data.unsigned_integer,0);
 for (size_t i=0;i<3;i++) { zassert_true(ov[i]); zassert_equal(out[i].field_id,i+1); }
 in.type=SPAGHETTI_VALUE_UINT64; in.data.unsigned_integer=0x0000FF;
 zassert_ok(d->ops->process(&state,NULL,&in,&valid,1,out,ov,3,NULL,NULL,NULL));
 zassert_equal(out[0].data.unsigned_integer,0); zassert_equal(out[1].data.unsigned_integer,0); zassert_equal(out[2].data.unsigned_integer,100);
 in.data.unsigned_integer=0;
 zassert_ok(d->ops->process(&state,NULL,&in,&valid,1,out,ov,3,NULL,NULL,NULL));
 for(size_t i=0;i<3;i++)zassert_equal(out[i].data.unsigned_integer,0);
 in.type=SPAGHETTI_VALUE_TEXT; memcpy(in.data.text.text,"#ZZ0000",7);in.data.text.size=7;
 zassert_equal(d->ops->process(&state,NULL,&in,&valid,1,out,ov,3,NULL,NULL,NULL),-EINVAL);
 for(size_t i=0;i<3;i++)zassert_false(ov[i]);
 in.data.text.size=6;
 zassert_equal(d->ops->process(&state,NULL,&in,&valid,1,out,ov,3,NULL,NULL,NULL),-EINVAL);
 valid=false;
 zassert_ok(d->ops->process(&state,NULL,&in,&valid,1,out,ov,3,NULL,NULL,NULL));
}

ZTEST(processing, test_if_inclusive_range_and_inverse)
{
 const struct spaghetti_block_driver *d=spaghetti_block_registry_find("logic_if");
 for(unsigned operation=8;operation<=9;operation++) {
  struct spaghetti_property_set p={0};
  prop_u64(&p,1,operation);prop_u64(&p,2,20);
  struct spaghetti_value hi={.field_id=9,.type=SPAGHETTI_VALUE_TEXT};
  memcpy(hi.data.text.text,"30.5",4);hi.data.text.size=4;
  p.fields[p.field_count++]=hi;
  zassert_ok(d->ops->validate(&p));
  uint64_t state[(SPAGHETTI_BLOCK_STATE_MAX+7)/8]={0};
  zassert_ok(d->ops->init(&p,state));
  const double values[]={19.99,20,25,30.5,30.51};
  for(size_t i=0;i<ARRAY_SIZE(values);i++) {
   struct spaghetti_value in={.type=SPAGHETTI_VALUE_FLOAT,.data.decimal=values[i]},out;
   bool valid=true,ov=false;
   zassert_ok(d->ops->process(state,NULL,&in,&valid,1,&out,&ov,1,NULL,NULL,NULL));
   zassert_true(ov);
   bool inside=i>=1 && i<=3;
   zassert_equal(out.data.unsigned_integer,operation==8?inside:!inside);
  }
  p.field_count--;hi.data.text.size=2;memcpy(hi.data.text.text,"10",2);p.fields[p.field_count++]=hi;
  zassert_equal(d->ops->validate(&p),-EINVAL);
  p.field_count--;
  zassert_equal(d->ops->validate(&p),-EINVAL);
 }
}


ZTEST(processing, test_rgb_presets_restore_on_descending_temperature)
{
 const struct spaghetti_block_driver *d=spaghetti_block_registry_find("led_driver");
 struct spaghetti_property_set p={0};
 for(uint8_t i=1;i<=10;i++)prop_u64(&p,i,i==1?0xFF0000:i==2?0x0000FF:i>=5&&i<=8?1:i==9?3:0);
 uint64_t state[8]={0};zassert_ok(d->ops->init(&p,state));
 struct spaghetti_value in[2]={{.type=SPAGHETTI_VALUE_BOOL},{.type=SPAGHETTI_VALUE_BOOL}},out;
 bool valid[2],ov;
 const bool levels[][2]={{false,false},{true,false},{false,true},{true,false},{false,false}};
 for(unsigned step=0;step<ARRAY_SIZE(levels);step++) {
  for(unsigned input=0;input<2;input++) {
   valid[0]=input==0;valid[1]=input==1;in[input].data.boolean=levels[step][input];
   zassert_ok(d->ops->process(state,NULL,in,valid,2,&out,&ov,1,NULL,NULL,NULL));
  }
  uint32_t expected=levels[step][0]?0xFF0000:levels[step][1]?0x0000FF:0;
  zassert_equal(out.data.unsigned_integer,expected,"Wrong color after temperature transition %u",step);
 }
 memset(state,0,sizeof(state));zassert_ok(d->ops->init(&p,state));
 in[0].data.boolean=true;in[1].data.boolean=false;valid[0]=valid[1]=true;
 zassert_ok(d->ops->process(state,NULL,in,valid,2,&out,&ov,1,NULL,NULL,NULL));
 zassert_true(ov);zassert_equal(out.data.unsigned_integer,0xFF0000);
}
