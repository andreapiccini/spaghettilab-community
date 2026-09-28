#include "blocks_common.h"

#include <zephyr/sys/util.h>

#define SPAGHETTI_BLOCK_PROP_WINDOW 1U
#define SPAGHETTI_BLOCK_PROP_ALPHA 2U
#define SPAGHETTI_BLOCK_PROP_MEDIAN_WINDOW 1U
#define SPAGHETTI_BLOCK_MOVING_AVG_MAX 16U
#define SPAGHETTI_BLOCK_MEDIAN_MAX 9U

struct moving_average_state {
	uint8_t window;
	uint8_t count;
	uint8_t index;
	int64_t sum;
	int64_t samples[SPAGHETTI_BLOCK_MOVING_AVG_MAX];
};

struct low_pass_state {
	int64_t alpha_q16; /* 0..65536 */
	int64_t filtered;
	bool has_value;
};

struct median_state {
	uint8_t window;
	uint8_t count;
	uint8_t index;
	int64_t samples[SPAGHETTI_BLOCK_MEDIAN_MAX];
};

static const struct spaghetti_block_port_descriptor one_in[] = {
	{ .port_id = 0U, .name = "in", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
};
static const struct spaghetti_block_port_descriptor one_out[] = {
	{ .port_id = 0U, .name = "out", .accepted_types = SPAGHETTI_BLOCK_TYPE_INT64,
	  .required = false },
};

static const struct spaghetti_field_descriptor moving_avg_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_WINDOW, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 1U,
	  .unsigned_maximum = SPAGHETTI_BLOCK_MOVING_AVG_MAX, .name = "window", .description = "",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor moving_avg_schema = {
	.schema_id = "spaghetti.block.moving_average",
	.version = 1U,
	.fields = moving_avg_fields,
	.field_count = ARRAY_SIZE(moving_avg_fields),
};

static int moving_avg_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &moving_avg_schema);
}

static int moving_avg_init(const struct spaghetti_property_set *config,
			   void *state)
{
	struct moving_average_state *ctx = state;

	memset(ctx, 0, sizeof(*ctx));
	ctx->window = (uint8_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_WINDOW)
			      ->data.unsigned_integer;
	return 0;
}

static void moving_avg_reset(void *state)
{
	struct moving_average_state *ctx = state;

	if (ctx != NULL) {
		uint8_t window = ctx->window;

		memset(ctx, 0, sizeof(*ctx));
		ctx->window = window;
	}
}

static int moving_avg_process(void *state, void *workspace,
			      const struct spaghetti_value *inputs,
			      const bool *input_valid, size_t input_count,
			      struct spaghetti_value *outputs, bool *output_valid,
			      size_t output_count,
			      const struct spaghetti_record *source_record,
			      spaghetti_block_publish_cb_t publish,
			      void *publish_user_data)
{
	struct moving_average_state *ctx = state;
	int64_t sample;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (ctx->window == 0U) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	sample = spaghetti_block_as_i64(&inputs[0]);
	if (ctx->count < ctx->window) {
		ctx->samples[ctx->count++] = sample;
		ctx->sum += sample;
		ctx->index = ctx->count % ctx->window;
	} else {
		ctx->sum -= ctx->samples[ctx->index];
		ctx->samples[ctx->index] = sample;
		ctx->sum += sample;
		ctx->index = (uint8_t)((ctx->index + 1U) % ctx->window);
	}
	spaghetti_block_set_i64(&outputs[0], 0U, ctx->sum / (int64_t)ctx->count);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops moving_avg_ops = {
	.validate = moving_avg_validate,
	.init = moving_avg_init,
	.process = moving_avg_process,
	.reset = moving_avg_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_moving_average) = {
	.type_id = "moving_average",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &moving_avg_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = one_out,
	.output_count = 1U,
	.state_size = sizeof(struct moving_average_state),
	.state_align = __alignof__(struct moving_average_state),
	.workspace_size = 0U,
	.max_cost_per_record = 2U,
	.required_capabilities = 0U,
	.ops = &moving_avg_ops,
};

/* low_pass: y += alpha*(x-y) with alpha_q16 in 1..65536 */
static const struct spaghetti_field_descriptor low_pass_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_ALPHA, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 1U,
	  .unsigned_maximum = 65536U, .name = "alpha_q16",
	  .description = "Q16 coefficient", .unit = "" },
};
static const struct spaghetti_schema_descriptor low_pass_schema = {
	.schema_id = "spaghetti.block.low_pass",
	.version = 1U,
	.fields = low_pass_fields,
	.field_count = ARRAY_SIZE(low_pass_fields),
};

static int low_pass_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &low_pass_schema);
}

static int low_pass_init(const struct spaghetti_property_set *config, void *state)
{
	struct low_pass_state *ctx = state;

	memset(ctx, 0, sizeof(*ctx));
	ctx->alpha_q16 = (int64_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_ALPHA)
				 ->data.unsigned_integer;
	return 0;
}

static void low_pass_reset(void *state)
{
	struct low_pass_state *ctx = state;

	if (ctx != NULL) {
		ctx->filtered = 0;
		ctx->has_value = false;
	}
}

static int low_pass_process(void *state, void *workspace,
			    const struct spaghetti_value *inputs,
			    const bool *input_valid, size_t input_count,
			    struct spaghetti_value *outputs, bool *output_valid,
			    size_t output_count,
			    const struct spaghetti_record *source_record,
			    spaghetti_block_publish_cb_t publish,
			    void *publish_user_data)
{
	struct low_pass_state *ctx = state;
	int64_t sample;
	int64_t delta;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	sample = spaghetti_block_as_i64(&inputs[0]);
	if (!ctx->has_value) {
		ctx->filtered = sample;
		ctx->has_value = true;
	} else {
		delta = sample - ctx->filtered;
		ctx->filtered += (delta * ctx->alpha_q16) / 65536;
	}
	spaghetti_block_set_i64(&outputs[0], 0U, ctx->filtered);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops low_pass_ops = {
	.validate = low_pass_validate,
	.init = low_pass_init,
	.process = low_pass_process,
	.reset = low_pass_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_low_pass) = {
	.type_id = "low_pass",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &low_pass_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = one_out,
	.output_count = 1U,
	.state_size = sizeof(struct low_pass_state),
	.state_align = __alignof__(struct low_pass_state),
	.workspace_size = 0U,
	.max_cost_per_record = 2U,
	.required_capabilities = 0U,
	.ops = &low_pass_ops,
};

/* median */
static const struct spaghetti_field_descriptor median_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_MEDIAN_WINDOW, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 1U,
	  .unsigned_maximum = SPAGHETTI_BLOCK_MEDIAN_MAX, .name = "window", .description = "",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor median_schema = {
	.schema_id = "spaghetti.block.median",
	.version = 1U,
	.fields = median_fields,
	.field_count = ARRAY_SIZE(median_fields),
};

static int median_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &median_schema);
}

static int median_init(const struct spaghetti_property_set *config, void *state)
{
	struct median_state *ctx = state;

	memset(ctx, 0, sizeof(*ctx));
	ctx->window = (uint8_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_MEDIAN_WINDOW)
			      ->data.unsigned_integer;
	return 0;
}

static void median_reset(void *state)
{
	struct median_state *ctx = state;

	if (ctx != NULL) {
		uint8_t window = ctx->window;

		memset(ctx, 0, sizeof(*ctx));
		ctx->window = window;
	}
}

static int median_process(void *state, void *workspace,
			  const struct spaghetti_value *inputs,
			  const bool *input_valid, size_t input_count,
			  struct spaghetti_value *outputs, bool *output_valid,
			  size_t output_count,
			  const struct spaghetti_record *source_record,
			  spaghetti_block_publish_cb_t publish,
			  void *publish_user_data)
{
	struct median_state *ctx = state;
	int64_t sorted[SPAGHETTI_BLOCK_MEDIAN_MAX];
	uint8_t n;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	if (ctx->count < ctx->window) {
		ctx->samples[ctx->count++] = spaghetti_block_as_i64(&inputs[0]);
		ctx->index = ctx->count % ctx->window;
	} else {
		ctx->samples[ctx->index] = spaghetti_block_as_i64(&inputs[0]);
		ctx->index = (uint8_t)((ctx->index + 1U) % ctx->window);
	}
	n = ctx->count;
	memcpy(sorted, ctx->samples, n * sizeof(sorted[0]));
	for (uint8_t i = 1U; i < n; ++i) {
		int64_t key = sorted[i];
		int8_t j = (int8_t)i - 1;

		while ((j >= 0) && (sorted[j] > key)) {
			sorted[j + 1] = sorted[j];
			--j;
		}
		sorted[j + 1] = key;
	}
	spaghetti_block_set_i64(&outputs[0], 0U, sorted[n / 2U]);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops median_ops = {
	.validate = median_validate,
	.init = median_init,
	.process = median_process,
	.reset = median_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_median) = {
	.type_id = "median",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &median_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = one_out,
	.output_count = 1U,
	.state_size = sizeof(struct median_state),
	.state_align = __alignof__(struct median_state),
	.workspace_size = 0U,
	.max_cost_per_record = 4U,
	.required_capabilities = 0U,
	.ops = &median_ops,
};
