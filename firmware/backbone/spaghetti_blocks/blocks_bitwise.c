#include "blocks_common.h"

#include <zephyr/sys/util.h>

#define SPAGHETTI_BLOCK_PROP_MASK 1U
#define SPAGHETTI_BLOCK_PROP_SHIFT 2U
#define SPAGHETTI_BLOCK_PROP_SHIFT_A 1U
#define SPAGHETTI_BLOCK_PROP_SHIFT_B 2U

struct mask_shift_state {
	uint64_t mask;
	int32_t shift;
};

struct combine_state {
	uint8_t shift_a;
	uint8_t shift_b;
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
static const struct spaghetti_block_port_descriptor three_in[] = {
	{ .port_id = 0U, .name = "selector",
	  .accepted_types = SPAGHETTI_BLOCK_TYPE_BOOL | SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
	{ .port_id = 1U, .name = "a", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
	{ .port_id = 2U, .name = "b", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
};
static const struct spaghetti_block_port_descriptor one_out[] = {
	{ .port_id = 0U, .name = "out", .accepted_types = SPAGHETTI_BLOCK_TYPE_UINT64,
	  .required = false },
};
static const struct spaghetti_block_port_descriptor one_out_i64[] = {
	{ .port_id = 0U, .name = "out", .accepted_types = SPAGHETTI_BLOCK_TYPE_INT64,
	  .required = false },
};

static const struct spaghetti_field_descriptor empty_fields[1];
static const struct spaghetti_schema_descriptor empty_schema = {
	.schema_id = "spaghetti.block.bitwise_empty",
	.version = 1U,
	.fields = empty_fields,
	.field_count = 0U,
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

static uint64_t as_u64(const struct spaghetti_value *value)
{
	if (value->type == SPAGHETTI_VALUE_INT64) {
		return (uint64_t)value->data.signed_integer;
	}
	return value->data.unsigned_integer;
}

/* mask_shift */
static const struct spaghetti_field_descriptor mask_shift_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_MASK, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 0U,
	  .unsigned_maximum = UINT64_MAX, .name = "mask", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_SHIFT, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = -63,
	  .signed_maximum = 63, .name = "shift", .description = "Positive=left",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor mask_shift_schema = {
	.schema_id = "spaghetti.block.mask_shift",
	.version = 1U,
	.fields = mask_shift_fields,
	.field_count = ARRAY_SIZE(mask_shift_fields),
};

static int mask_shift_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &mask_shift_schema);
}

static int mask_shift_init(const struct spaghetti_property_set *config,
			   void *state)
{
	struct mask_shift_state *ctx = state;

	ctx->mask = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_MASK)
			    ->data.unsigned_integer;
	ctx->shift = (int32_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_SHIFT)
			     ->data.signed_integer;
	return 0;
}

static int mask_shift_process(void *state, void *workspace,
			      const struct spaghetti_value *inputs,
			      const bool *input_valid, size_t input_count,
			      struct spaghetti_value *outputs, bool *output_valid,
			      size_t output_count,
			      const struct spaghetti_record *source_record,
			      spaghetti_block_publish_cb_t publish,
			      void *publish_user_data)
{
	struct mask_shift_state *ctx = state;
	uint64_t value;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	value = as_u64(&inputs[0]) & ctx->mask;
	if (ctx->shift > 0) {
		value <<= (uint32_t)ctx->shift;
	} else if (ctx->shift < 0) {
		value >>= (uint32_t)(-ctx->shift);
	}
	spaghetti_block_set_u64(&outputs[0], 0U, value);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops mask_shift_ops = {
	.validate = mask_shift_validate,
	.init = mask_shift_init,
	.process = mask_shift_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_mask_shift) = {
	.type_id = "mask_shift",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &mask_shift_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = one_out,
	.output_count = 1U,
	.state_size = sizeof(struct mask_shift_state),
	.state_align = __alignof__(struct mask_shift_state),
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &mask_shift_ops,
};

/* combine_fields: (a << shift_a) | (b << shift_b) */
static const struct spaghetti_field_descriptor combine_fields_desc[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_SHIFT_A, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 0U,
	  .unsigned_maximum = 63U, .name = "shift_a", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_SHIFT_B, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 0U,
	  .unsigned_maximum = 63U, .name = "shift_b", .description = "",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor combine_schema = {
	.schema_id = "spaghetti.block.combine_fields",
	.version = 1U,
	.fields = combine_fields_desc,
	.field_count = ARRAY_SIZE(combine_fields_desc),
};

static int combine_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &combine_schema);
}

static int combine_init(const struct spaghetti_property_set *config, void *state)
{
	struct combine_state *ctx = state;

	ctx->shift_a = (uint8_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_SHIFT_A)
			       ->data.unsigned_integer;
	ctx->shift_b = (uint8_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_SHIFT_B)
			       ->data.unsigned_integer;
	return 0;
}

static int combine_process(void *state, void *workspace,
			   const struct spaghetti_value *inputs,
			   const bool *input_valid, size_t input_count,
			   struct spaghetti_value *outputs, bool *output_valid,
			   size_t output_count,
			   const struct spaghetti_record *source_record,
			   spaghetti_block_publish_cb_t publish,
			   void *publish_user_data)
{
	struct combine_state *ctx = state;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 2U) < 0)) {
		return -EINVAL;
	}
	spaghetti_block_set_u64(&outputs[0], 0U,
				(as_u64(&inputs[0]) << ctx->shift_a) |
					(as_u64(&inputs[1]) << ctx->shift_b));
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops combine_ops = {
	.validate = combine_validate,
	.init = combine_init,
	.process = combine_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_combine_fields) = {
	.type_id = "combine_fields",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &combine_schema,
	.inputs = two_in,
	.input_count = 2U,
	.outputs = one_out,
	.output_count = 1U,
	.state_size = sizeof(struct combine_state),
	.state_align = __alignof__(struct combine_state),
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &combine_ops,
};

/* select: selector ? a : b */
static int select_process(void *state, void *workspace,
			  const struct spaghetti_value *inputs,
			  const bool *input_valid, size_t input_count,
			  struct spaghetti_value *outputs, bool *output_valid,
			  size_t output_count,
			  const struct spaghetti_record *source_record,
			  spaghetti_block_publish_cb_t publish,
			  void *publish_user_data)
{
	bool choose_a;

	(void)state;
	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 3U) < 0)) {
		return -EINVAL;
	}
	if (inputs[0].type == SPAGHETTI_VALUE_BOOL) {
		choose_a = inputs[0].data.boolean;
	} else {
		choose_a = spaghetti_block_as_i64(&inputs[0]) != 0;
	}
	spaghetti_block_set_i64(&outputs[0], 0U,
				spaghetti_block_as_i64(choose_a ? &inputs[1] :
								  &inputs[2]));
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops select_ops = {
	.validate = empty_validate,
	.init = empty_init,
	.process = select_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_select) = {
	.type_id = "select",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &empty_schema,
	.inputs = three_in,
	.input_count = 3U,
	.outputs = one_out_i64,
	.output_count = 1U,
	.state_size = 0U,
	.state_align = 1U,
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &select_ops,
};
