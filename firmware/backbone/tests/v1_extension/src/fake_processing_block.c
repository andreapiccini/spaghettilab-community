/**
 * @file
 * @brief Fake processing block with bounded state (running sum).
 */

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/sys/util.h>

#include <spaghetti/block_driver.h>
#include <spaghetti/schema.h>

struct fake_block_state {
	int64_t sum;
	uint32_t count;
};

static const struct spaghetti_field_descriptor config_fields[1];
static const struct spaghetti_schema_descriptor config_schema = {
	.schema_id = "spaghetti.fake_proc.config",
	.version = 1U,
	.fields = config_fields,
	.field_count = 0U,
};

static const struct spaghetti_block_port_descriptor inputs[] = {
	{
		.port_id = 0U,
		.name = "in",
		.accepted_types = SPAGHETTI_BLOCK_TYPE_INT64,
		.required = true,
	},
};

static const struct spaghetti_block_port_descriptor outputs[] = {
	{
		.port_id = 0U,
		.name = "sum",
		.accepted_types = SPAGHETTI_BLOCK_TYPE_INT64,
		.required = false,
	},
};

static int validate(const struct spaghetti_property_set *config)
{
	ARG_UNUSED(config);
	return 0;
}

static int init_block(const struct spaghetti_property_set *config, void *state)
{
	struct fake_block_state *ctx = state;

	ARG_UNUSED(config);
	if (ctx == NULL) {
		return -EINVAL;
	}
	ctx->sum = 0;
	ctx->count = 0U;
	return 0;
}

static int process_block(void *state, void *workspace,
			 const struct spaghetti_value *inputs_v,
			 const bool *input_valid, size_t input_count,
			 struct spaghetti_value *outputs_v, bool *output_valid,
			 size_t output_count,
			 const struct spaghetti_record *source_record,
			 spaghetti_block_publish_cb_t publish,
			 void *publish_user_data)
{
	struct fake_block_state *ctx = state;

	ARG_UNUSED(workspace);
	ARG_UNUSED(source_record);
	ARG_UNUSED(publish);
	ARG_UNUSED(publish_user_data);

	if ((ctx == NULL) || (input_count < 1U) || !input_valid[0] ||
	    (output_count < 1U)) {
		return -EINVAL;
	}
	ctx->sum += inputs_v[0].data.signed_integer;
	++ctx->count;
	outputs_v[0].field_id = 0U;
	outputs_v[0].type = SPAGHETTI_VALUE_INT64;
	outputs_v[0].data.signed_integer = ctx->sum;
	output_valid[0] = true;
	return 0;
}

static void reset_block(void *state)
{
	struct fake_block_state *ctx = state;

	if (ctx != NULL) {
		ctx->sum = 0;
		ctx->count = 0U;
	}
}

static void deinit_block(void *state)
{
	reset_block(state);
}

static const struct spaghetti_block_driver_ops ops = {
	.validate = validate,
	.init = init_block,
	.process = process_block,
	.reset = reset_block,
	.deinit = deinit_block,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_fake_processing_block) = {
	.type_id = "fake_processing_block",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &config_schema,
	.inputs = inputs,
	.input_count = ARRAY_SIZE(inputs),
	.outputs = outputs,
	.output_count = ARRAY_SIZE(outputs),
	.state_size = sizeof(struct fake_block_state),
	.state_align = __alignof__(struct fake_block_state),
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &ops,
};
