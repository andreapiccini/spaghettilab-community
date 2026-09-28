#include "blocks_common.h"

#include <zephyr/sys/util.h>

#if defined(CONFIG_SPAGHETTI_BLOCK_KALMAN)

#define SPAGHETTI_BLOCK_PROP_Q 1U
#define SPAGHETTI_BLOCK_PROP_R 2U

struct kalman_state {
	int64_t q_q16;
	int64_t r_q16;
	int64_t x;
	int64_t p_q16;
	bool has_value;
};

static const struct spaghetti_block_port_descriptor one_in[] = {
	{ .port_id = 0U, .name = "in", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
};
static const struct spaghetti_block_port_descriptor one_out[] = {
	{ .port_id = 0U, .name = "out", .accepted_types = SPAGHETTI_BLOCK_TYPE_INT64,
	  .required = false },
};

static const struct spaghetti_field_descriptor kalman_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_Q, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 1U,
	  .unsigned_maximum = UINT32_MAX, .name = "process_var_q16",
	  .description = "", .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_R, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 1U,
	  .unsigned_maximum = UINT32_MAX, .name = "measure_var_q16",
	  .description = "", .unit = "" },
};
static const struct spaghetti_schema_descriptor kalman_schema = {
	.schema_id = "spaghetti.block.kalman",
	.version = 1U,
	.fields = kalman_fields,
	.field_count = ARRAY_SIZE(kalman_fields),
};

static int kalman_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &kalman_schema);
}

static int kalman_init(const struct spaghetti_property_set *config, void *state)
{
	struct kalman_state *ctx = state;

	memset(ctx, 0, sizeof(*ctx));
	ctx->q_q16 = (int64_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_Q)
			     ->data.unsigned_integer;
	ctx->r_q16 = (int64_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_R)
			     ->data.unsigned_integer;
	ctx->p_q16 = 65536;
	return 0;
}

static void kalman_reset(void *state)
{
	struct kalman_state *ctx = state;

	if (ctx != NULL) {
		ctx->x = 0;
		ctx->p_q16 = 65536;
		ctx->has_value = false;
	}
}

static int kalman_process(void *state, void *workspace,
			  const struct spaghetti_value *inputs,
			  const bool *input_valid, size_t input_count,
			  struct spaghetti_value *outputs, bool *output_valid,
			  size_t output_count,
			  const struct spaghetti_record *source_record,
			  spaghetti_block_publish_cb_t publish,
			  void *publish_user_data)
{
	struct kalman_state *ctx = state;
	int64_t z;
	int64_t k_q16;
	int64_t denom;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	z = spaghetti_block_as_i64(&inputs[0]);
	if (!ctx->has_value) {
		ctx->x = z;
		ctx->has_value = true;
	} else {
		ctx->p_q16 += ctx->q_q16;
		denom = ctx->p_q16 + ctx->r_q16;
		if (denom == 0) {
			return -EDOM;
		}
		k_q16 = (ctx->p_q16 * 65536) / denom;
		ctx->x += ((z - ctx->x) * k_q16) / 65536;
		ctx->p_q16 = ((65536 - k_q16) * ctx->p_q16) / 65536;
	}
	spaghetti_block_set_i64(&outputs[0], 0U, ctx->x);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops kalman_ops = {
	.validate = kalman_validate,
	.init = kalman_init,
	.process = kalman_process,
	.reset = kalman_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_kalman) = {
	.type_id = "kalman",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &kalman_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = one_out,
	.output_count = 1U,
	.state_size = sizeof(struct kalman_state),
	.state_align = __alignof__(struct kalman_state),
	.workspace_size = 0U,
	.max_cost_per_record = 4U,
	.required_capabilities = 0U,
	.ops = &kalman_ops,
};

#endif /* CONFIG_SPAGHETTI_BLOCK_KALMAN */
