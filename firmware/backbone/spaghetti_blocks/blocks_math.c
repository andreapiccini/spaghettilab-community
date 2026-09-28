#include "blocks_common.h"

#include <zephyr/sys/util.h>

/* Field IDs shared by simple numeric blocks. */
#define SPAGHETTI_BLOCK_PROP_SCALE 1U
#define SPAGHETTI_BLOCK_PROP_OFFSET 2U
#define SPAGHETTI_BLOCK_PROP_MIN 3U
#define SPAGHETTI_BLOCK_PROP_MAX 4U
#define SPAGHETTI_BLOCK_PROP_IN_MIN 5U
#define SPAGHETTI_BLOCK_PROP_IN_MAX 6U
#define SPAGHETTI_BLOCK_PROP_OUT_MIN 7U
#define SPAGHETTI_BLOCK_PROP_OUT_MAX 8U

struct scale_offset_state {
	int64_t scale;
	int64_t offset;
};

struct clamp_state {
	int64_t min;
	int64_t max;
};

struct map_range_state {
	int64_t in_min;
	int64_t in_max;
	int64_t out_min;
	int64_t out_max;
};

struct binary_op_state {
	int unused;
};

static const struct spaghetti_block_port_descriptor one_in[] = {
	{ .port_id = 0U, .name = "in", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
};
static const struct spaghetti_block_port_descriptor two_in[] = {
	{ .port_id = 0U, .name = "a", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
	{ .port_id = 1U, .name = "b", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
};
static const struct spaghetti_block_port_descriptor one_out[] = {
	{ .port_id = 0U, .name = "out", .accepted_types = SPAGHETTI_BLOCK_TYPE_INT64,
	  .required = false },
};

static int empty_validate(const struct spaghetti_property_set *config)
{
	(void)config;
	return 0;
}

static int empty_init(const struct spaghetti_property_set *config, void *state)
{
	(void)config;
	(void)state;
	return 0;
}

/* ---- scale_offset: out = in * scale + offset; overflow => -ERANGE ---- */

static const struct spaghetti_field_descriptor scale_offset_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_SCALE, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "scale", .description = "Multiplier",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_OFFSET, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "offset", .description = "Addend",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor scale_offset_schema = {
	.schema_id = "spaghetti.block.scale_offset",
	.version = 1U,
	.fields = scale_offset_fields,
	.field_count = ARRAY_SIZE(scale_offset_fields),
};

static int scale_offset_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &scale_offset_schema);
}

static int scale_offset_init(const struct spaghetti_property_set *config,
			     void *state)
{
	struct scale_offset_state *ctx = state;
	const struct spaghetti_value *scale =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_SCALE);
	const struct spaghetti_value *offset =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_OFFSET);

	if ((ctx == NULL) || (scale == NULL) || (offset == NULL)) {
		return -EINVAL;
	}
	ctx->scale = scale->data.signed_integer;
	ctx->offset = offset->data.signed_integer;
	return 0;
}

static int scale_offset_process(void *state, void *workspace,
				const struct spaghetti_value *inputs,
				const bool *input_valid, size_t input_count,
				struct spaghetti_value *outputs,
				bool *output_valid, size_t output_count,
				const struct spaghetti_record *source_record,
				spaghetti_block_publish_cb_t publish,
				void *publish_user_data)
{
	struct scale_offset_state *ctx = state;
	int64_t scaled;
	int64_t result;
	int err;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	err = spaghetti_block_mul_i64(spaghetti_block_as_i64(&inputs[0]),
				      ctx->scale, &scaled);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_add_i64(scaled, ctx->offset, &result);
	if (err < 0) {
		return err;
	}
	spaghetti_block_set_i64(&outputs[0], 0U, result);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops scale_offset_ops = {
	.validate = scale_offset_validate,
	.init = scale_offset_init,
	.process = scale_offset_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_scale_offset) = {
	.type_id = "scale_offset",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &scale_offset_schema,
	.inputs = one_in,
	.input_count = ARRAY_SIZE(one_in),
	.outputs = one_out,
	.output_count = ARRAY_SIZE(one_out),
	.state_size = sizeof(struct scale_offset_state),
	.state_align = __alignof__(struct scale_offset_state),
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &scale_offset_ops,
};

/* ---- clamp: saturate into [min,max] ---- */

static const struct spaghetti_field_descriptor clamp_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_MIN, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "min", .description = "Lower bound",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_MAX, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "max", .description = "Upper bound",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor clamp_schema = {
	.schema_id = "spaghetti.block.clamp",
	.version = 1U,
	.fields = clamp_fields,
	.field_count = ARRAY_SIZE(clamp_fields),
};

static int clamp_validate(const struct spaghetti_property_set *config)
{
	const struct spaghetti_value *min_v;
	const struct spaghetti_value *max_v;
	int err = spaghetti_property_validate(config, &clamp_schema);

	if (err < 0) {
		return err;
	}
	min_v = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_MIN);
	max_v = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_MAX);
	if ((min_v == NULL) || (max_v == NULL) ||
	    (min_v->data.signed_integer > max_v->data.signed_integer)) {
		return -EINVAL;
	}
	return 0;
}

static int clamp_init(const struct spaghetti_property_set *config, void *state)
{
	struct clamp_state *ctx = state;

	ctx->min = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_MIN)->data.signed_integer;
	ctx->max = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_MAX)->data.signed_integer;
	return 0;
}

static int clamp_process(void *state, void *workspace,
			 const struct spaghetti_value *inputs,
			 const bool *input_valid, size_t input_count,
			 struct spaghetti_value *outputs, bool *output_valid,
			 size_t output_count,
			 const struct spaghetti_record *source_record,
			 spaghetti_block_publish_cb_t publish,
			 void *publish_user_data)
{
	struct clamp_state *ctx = state;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	spaghetti_block_set_i64(
		&outputs[0], 0U,
		spaghetti_block_sat_i64(spaghetti_block_as_i64(&inputs[0]),
					ctx->min, ctx->max));
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops clamp_ops = {
	.validate = clamp_validate,
	.init = clamp_init,
	.process = clamp_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_clamp) = {
	.type_id = "clamp",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &clamp_schema,
	.inputs = one_in,
	.input_count = ARRAY_SIZE(one_in),
	.outputs = one_out,
	.output_count = ARRAY_SIZE(one_out),
	.state_size = sizeof(struct clamp_state),
	.state_align = __alignof__(struct clamp_state),
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &clamp_ops,
};

/* ---- map_range ---- */

static const struct spaghetti_field_descriptor map_range_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_IN_MIN, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "in_min", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_IN_MAX, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "in_max", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_OUT_MIN, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "out_min", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_OUT_MAX, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "out_max", .description = "",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor map_range_schema = {
	.schema_id = "spaghetti.block.map_range",
	.version = 1U,
	.fields = map_range_fields,
	.field_count = ARRAY_SIZE(map_range_fields),
};

static int map_range_validate(const struct spaghetti_property_set *config)
{
	const struct spaghetti_value *in_min;
	const struct spaghetti_value *in_max;
	int err = spaghetti_property_validate(config, &map_range_schema);

	if (err < 0) {
		return err;
	}
	in_min = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_IN_MIN);
	in_max = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_IN_MAX);
	if ((in_min == NULL) || (in_max == NULL) ||
	    (in_min->data.signed_integer == in_max->data.signed_integer)) {
		return -EINVAL;
	}
	return 0;
}

static int map_range_init(const struct spaghetti_property_set *config,
			  void *state)
{
	struct map_range_state *ctx = state;

	ctx->in_min =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_IN_MIN)->data.signed_integer;
	ctx->in_max =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_IN_MAX)->data.signed_integer;
	ctx->out_min =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_OUT_MIN)->data.signed_integer;
	ctx->out_max =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_OUT_MAX)->data.signed_integer;
	return 0;
}

static int map_range_process(void *state, void *workspace,
			     const struct spaghetti_value *inputs,
			     const bool *input_valid, size_t input_count,
			     struct spaghetti_value *outputs, bool *output_valid,
			     size_t output_count,
			     const struct spaghetti_record *source_record,
			     spaghetti_block_publish_cb_t publish,
			     void *publish_user_data)
{
	struct map_range_state *ctx = state;
	int64_t in;
	int64_t in_span;
	int64_t out_span;
	int64_t num;
	int64_t mapped;
	int err;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	in = spaghetti_block_sat_i64(spaghetti_block_as_i64(&inputs[0]),
				     ctx->in_min, ctx->in_max);
	err = spaghetti_block_sub_i64(ctx->in_max, ctx->in_min, &in_span);
	if ((err < 0) || (in_span == 0)) {
		return -EDOM;
	}
	err = spaghetti_block_sub_i64(ctx->out_max, ctx->out_min, &out_span);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_sub_i64(in, ctx->in_min, &num);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_mul_i64(num, out_span, &num);
	if (err < 0) {
		return err;
	}
	mapped = (num / in_span) + ctx->out_min;
	spaghetti_block_set_i64(&outputs[0], 0U, mapped);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops map_range_ops = {
	.validate = map_range_validate,
	.init = map_range_init,
	.process = map_range_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_map_range) = {
	.type_id = "map_range",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &map_range_schema,
	.inputs = one_in,
	.input_count = ARRAY_SIZE(one_in),
	.outputs = one_out,
	.output_count = ARRAY_SIZE(one_out),
	.state_size = sizeof(struct map_range_state),
	.state_align = __alignof__(struct map_range_state),
	.workspace_size = 0U,
	.max_cost_per_record = 2U,
	.required_capabilities = 0U,
	.ops = &map_range_ops,
};

/* ---- binary arithmetic ---- */

typedef int (*binary_op_fn)(int64_t a, int64_t b, int64_t *out);

static int binary_process(binary_op_fn op, const struct spaghetti_value *inputs,
			  const bool *input_valid, size_t input_count,
			  struct spaghetti_value *outputs, bool *output_valid,
			  size_t output_count)
{
	int64_t result;
	int err;

	if ((op == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 2U) < 0)) {
		return -EINVAL;
	}
	err = op(spaghetti_block_as_i64(&inputs[0]),
		 spaghetti_block_as_i64(&inputs[1]), &result);
	if (err < 0) {
		return err;
	}
	spaghetti_block_set_i64(&outputs[0], 0U, result);
	output_valid[0] = true;
	return 0;
}

static int add_process(void *state, void *workspace,
		       const struct spaghetti_value *inputs,
		       const bool *input_valid, size_t input_count,
		       struct spaghetti_value *outputs, bool *output_valid,
		       size_t output_count,
		       const struct spaghetti_record *source_record,
		       spaghetti_block_publish_cb_t publish,
		       void *publish_user_data)
{
	(void)state;
	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	return binary_process(spaghetti_block_add_i64, inputs, input_valid,
			      input_count, outputs, output_valid, output_count);
}

static int sub_process(void *state, void *workspace,
		       const struct spaghetti_value *inputs,
		       const bool *input_valid, size_t input_count,
		       struct spaghetti_value *outputs, bool *output_valid,
		       size_t output_count,
		       const struct spaghetti_record *source_record,
		       spaghetti_block_publish_cb_t publish,
		       void *publish_user_data)
{
	(void)state;
	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	return binary_process(spaghetti_block_sub_i64, inputs, input_valid,
			      input_count, outputs, output_valid, output_count);
}

static int mul_process(void *state, void *workspace,
		       const struct spaghetti_value *inputs,
		       const bool *input_valid, size_t input_count,
		       struct spaghetti_value *outputs, bool *output_valid,
		       size_t output_count,
		       const struct spaghetti_record *source_record,
		       spaghetti_block_publish_cb_t publish,
		       void *publish_user_data)
{
	(void)state;
	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	return binary_process(spaghetti_block_mul_i64, inputs, input_valid,
			      input_count, outputs, output_valid, output_count);
}

static int div_i64(int64_t a, int64_t b, int64_t *out)
{
	if (b == 0) {
		return -EDOM;
	}
	if ((a == INT64_MIN) && (b == -1)) {
		return -ERANGE;
	}
	*out = a / b;
	return 0;
}

static int div_process(void *state, void *workspace,
		       const struct spaghetti_value *inputs,
		       const bool *input_valid, size_t input_count,
		       struct spaghetti_value *outputs, bool *output_valid,
		       size_t output_count,
		       const struct spaghetti_record *source_record,
		       spaghetti_block_publish_cb_t publish,
		       void *publish_user_data)
{
	(void)state;
	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	return binary_process(div_i64, inputs, input_valid, input_count, outputs,
			      output_valid, output_count);
}

static const struct spaghetti_field_descriptor empty_fields[1];
static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.block.empty",
	.version = 1U,
	.fields = empty_fields,
	.field_count = 0U,
};

static const struct spaghetti_block_driver_ops add_ops = {
	.validate = empty_validate,
	.init = empty_init,
	.process = add_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};
static const struct spaghetti_block_driver_ops sub_ops = {
	.validate = empty_validate,
	.init = empty_init,
	.process = sub_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};
static const struct spaghetti_block_driver_ops mul_ops = {
	.validate = empty_validate,
	.init = empty_init,
	.process = mul_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};
static const struct spaghetti_block_driver_ops div_ops = {
	.validate = empty_validate,
	.init = empty_init,
	.process = div_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_add) = {
	.type_id = "add",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &empty_schema,
	.inputs = two_in,
	.input_count = ARRAY_SIZE(two_in),
	.outputs = one_out,
	.output_count = ARRAY_SIZE(one_out),
	.state_size = 0U,
	.state_align = 1U,
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &add_ops,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_subtract) = {
	.type_id = "subtract",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &empty_schema,
	.inputs = two_in,
	.input_count = ARRAY_SIZE(two_in),
	.outputs = one_out,
	.output_count = ARRAY_SIZE(one_out),
	.state_size = 0U,
	.state_align = 1U,
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &sub_ops,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_multiply) = {
	.type_id = "multiply",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &empty_schema,
	.inputs = two_in,
	.input_count = ARRAY_SIZE(two_in),
	.outputs = one_out,
	.output_count = ARRAY_SIZE(one_out),
	.state_size = 0U,
	.state_align = 1U,
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &mul_ops,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_divide) = {
	.type_id = "divide",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &empty_schema,
	.inputs = two_in,
	.input_count = ARRAY_SIZE(two_in),
	.outputs = one_out,
	.output_count = ARRAY_SIZE(one_out),
	.state_size = 0U,
	.state_align = 1U,
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &div_ops,
};
