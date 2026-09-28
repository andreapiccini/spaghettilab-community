#include "blocks_common.h"

#include <zephyr/sys/util.h>

#define SPAGHETTI_BLOCK_PROP_LEVEL 1U
#define SPAGHETTI_BLOCK_PROP_LOW 1U
#define SPAGHETTI_BLOCK_PROP_HIGH 2U
#define SPAGHETTI_BLOCK_PROP_SAMPLES 1U

struct threshold_state {
	int64_t level;
};

struct hysteresis_state {
	int64_t low;
	int64_t high;
	bool above;
	bool has_state;
};

struct debounce_state {
	uint32_t required;
	uint32_t count;
	bool candidate;
	bool output;
	bool has_candidate;
};

static const struct spaghetti_block_port_descriptor one_in[] = {
	{ .port_id = 0U, .name = "in", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
};
static const struct spaghetti_block_port_descriptor bool_out[] = {
	{ .port_id = 0U, .name = "out", .accepted_types = SPAGHETTI_BLOCK_TYPE_BOOL,
	  .required = false },
};

static const struct spaghetti_field_descriptor threshold_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_LEVEL, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "level", .description = "",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor threshold_schema = {
	.schema_id = "spaghetti.block.threshold",
	.version = 1U,
	.fields = threshold_fields,
	.field_count = ARRAY_SIZE(threshold_fields),
};

static int threshold_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &threshold_schema);
}

static int threshold_init(const struct spaghetti_property_set *config,
			  void *state)
{
	struct threshold_state *ctx = state;

	ctx->level =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_LEVEL)->data.signed_integer;
	return 0;
}

static int threshold_process(void *state, void *workspace,
			     const struct spaghetti_value *inputs,
			     const bool *input_valid, size_t input_count,
			     struct spaghetti_value *outputs, bool *output_valid,
			     size_t output_count,
			     const struct spaghetti_record *source_record,
			     spaghetti_block_publish_cb_t publish,
			     void *publish_user_data)
{
	struct threshold_state *ctx = state;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	spaghetti_block_set_bool(&outputs[0], 0U,
				 spaghetti_block_as_i64(&inputs[0]) >=
					 ctx->level);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops threshold_ops = {
	.validate = threshold_validate,
	.init = threshold_init,
	.process = threshold_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_threshold) = {
	.type_id = "threshold",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &threshold_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = bool_out,
	.output_count = 1U,
	.state_size = sizeof(struct threshold_state),
	.state_align = __alignof__(struct threshold_state),
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &threshold_ops,
};

static const struct spaghetti_field_descriptor hysteresis_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_LOW, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "low", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_HIGH, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "high", .description = "",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor hysteresis_schema = {
	.schema_id = "spaghetti.block.hysteresis",
	.version = 1U,
	.fields = hysteresis_fields,
	.field_count = ARRAY_SIZE(hysteresis_fields),
};

static int hysteresis_validate(const struct spaghetti_property_set *config)
{
	const struct spaghetti_value *low;
	const struct spaghetti_value *high;
	int err = spaghetti_property_validate(config, &hysteresis_schema);

	if (err < 0) {
		return err;
	}
	low = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_LOW);
	high = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_HIGH);
	if ((low == NULL) || (high == NULL) ||
	    (low->data.signed_integer > high->data.signed_integer)) {
		return -EINVAL;
	}
	return 0;
}

static int hysteresis_init(const struct spaghetti_property_set *config,
			   void *state)
{
	struct hysteresis_state *ctx = state;

	memset(ctx, 0, sizeof(*ctx));
	ctx->low = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_LOW)->data.signed_integer;
	ctx->high =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_HIGH)->data.signed_integer;
	return 0;
}

static void hysteresis_reset(void *state)
{
	struct hysteresis_state *ctx = state;

	if (ctx != NULL) {
		ctx->above = false;
		ctx->has_state = false;
	}
}

static int hysteresis_process(void *state, void *workspace,
			      const struct spaghetti_value *inputs,
			      const bool *input_valid, size_t input_count,
			      struct spaghetti_value *outputs, bool *output_valid,
			      size_t output_count,
			      const struct spaghetti_record *source_record,
			      spaghetti_block_publish_cb_t publish,
			      void *publish_user_data)
{
	struct hysteresis_state *ctx = state;
	int64_t sample;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	sample = spaghetti_block_as_i64(&inputs[0]);
	if (!ctx->has_state) {
		ctx->above = sample >= ctx->high;
		ctx->has_state = true;
	} else if (ctx->above && (sample <= ctx->low)) {
		ctx->above = false;
	} else if (!ctx->above && (sample >= ctx->high)) {
		ctx->above = true;
	}
	spaghetti_block_set_bool(&outputs[0], 0U, ctx->above);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops hysteresis_ops = {
	.validate = hysteresis_validate,
	.init = hysteresis_init,
	.process = hysteresis_process,
	.reset = hysteresis_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_hysteresis) = {
	.type_id = "hysteresis",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &hysteresis_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = bool_out,
	.output_count = 1U,
	.state_size = sizeof(struct hysteresis_state),
	.state_align = __alignof__(struct hysteresis_state),
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &hysteresis_ops,
};

static const struct spaghetti_field_descriptor debounce_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_SAMPLES, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 1U,
	  .unsigned_maximum = 1000U, .name = "samples", .description = "",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor debounce_schema = {
	.schema_id = "spaghetti.block.debounce",
	.version = 1U,
	.fields = debounce_fields,
	.field_count = ARRAY_SIZE(debounce_fields),
};

static int debounce_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &debounce_schema);
}

static int debounce_init(const struct spaghetti_property_set *config, void *state)
{
	struct debounce_state *ctx = state;

	memset(ctx, 0, sizeof(*ctx));
	ctx->required = (uint32_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_SAMPLES)
				->data.unsigned_integer;
	return 0;
}

static void debounce_reset(void *state)
{
	struct debounce_state *ctx = state;

	if (ctx != NULL) {
		ctx->count = 0U;
		ctx->has_candidate = false;
		ctx->output = false;
	}
}

static int debounce_process(void *state, void *workspace,
			    const struct spaghetti_value *inputs,
			    const bool *input_valid, size_t input_count,
			    struct spaghetti_value *outputs, bool *output_valid,
			    size_t output_count,
			    const struct spaghetti_record *source_record,
			    spaghetti_block_publish_cb_t publish,
			    void *publish_user_data)
{
	struct debounce_state *ctx = state;
	bool sample;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	sample = spaghetti_block_as_i64(&inputs[0]) != 0;
	if (!ctx->has_candidate || (sample != ctx->candidate)) {
		ctx->candidate = sample;
		ctx->count = 1U;
		ctx->has_candidate = true;
	} else if (ctx->count < ctx->required) {
		++ctx->count;
	}
	if (ctx->count >= ctx->required) {
		ctx->output = ctx->candidate;
	}
	spaghetti_block_set_bool(&outputs[0], 0U, ctx->output);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops debounce_ops = {
	.validate = debounce_validate,
	.init = debounce_init,
	.process = debounce_process,
	.reset = debounce_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_debounce) = {
	.type_id = "debounce",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &debounce_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = bool_out,
	.output_count = 1U,
	.state_size = sizeof(struct debounce_state),
	.state_align = __alignof__(struct debounce_state),
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &debounce_ops,
};
