#include "blocks_common.h"

#include <zephyr/sys/util.h>

#define SPAGHETTI_BLOCK_PROP_TABLE 1U
#define SPAGHETTI_BLOCK_PROP_COUNT 2U
#define SPAGHETTI_BLOCK_PROP_C0 1U
#define SPAGHETTI_BLOCK_PROP_C1 2U
#define SPAGHETTI_BLOCK_PROP_C2 3U
#define SPAGHETTI_BLOCK_PROP_C3 4U
#define SPAGHETTI_BLOCK_PROP_SCALE 1U
#define SPAGHETTI_BLOCK_LOOKUP_MAX 16U

struct lookup_state {
	uint8_t count;
	int64_t values[SPAGHETTI_BLOCK_LOOKUP_MAX];
};

struct poly_state {
	int64_t c[4];
};

struct unit_convert_state {
	int64_t scale_q16;
};

static const struct spaghetti_block_port_descriptor one_in[] = {
	{ .port_id = 0U, .name = "in", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC,
	  .required = true },
};
static const struct spaghetti_block_port_descriptor one_out[] = {
	{ .port_id = 0U, .name = "out", .accepted_types = SPAGHETTI_BLOCK_TYPE_INT64,
	  .required = false },
};

/* lookup_table: index clamped into embedded INT64 list encoded as BYTES of i64 LE */
static const struct spaghetti_field_descriptor lookup_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_COUNT, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 1U,
	  .unsigned_maximum = SPAGHETTI_BLOCK_LOOKUP_MAX, .name = "count", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_TABLE, .type = SPAGHETTI_VALUE_BYTES,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .bytes_min_size = 8U,
	  .bytes_max_size = SPAGHETTI_VALUE_BYTES_MAX, .name = "table",
	  .description = "Little-endian int64 entries", .unit = "" },
};
static const struct spaghetti_schema_descriptor lookup_schema = {
	.schema_id = "spaghetti.block.lookup_table",
	.version = 1U,
	.fields = lookup_fields,
	.field_count = ARRAY_SIZE(lookup_fields),
};

static int lookup_validate(const struct spaghetti_property_set *config)
{
	const struct spaghetti_value *count;
	const struct spaghetti_value *table;
	int err = spaghetti_property_validate(config, &lookup_schema);

	if (err < 0) {
		return err;
	}
	count = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_COUNT);
	table = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_TABLE);
	if ((count == NULL) || (table == NULL) ||
	    (table->data.bytes.size <
	     (count->data.unsigned_integer * sizeof(int64_t)))) {
		return -EINVAL;
	}
	return 0;
}

static int lookup_init(const struct spaghetti_property_set *config, void *state)
{
	struct lookup_state *ctx = state;
	const struct spaghetti_value *table =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_TABLE);
	uint8_t count = (uint8_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_COUNT)
				->data.unsigned_integer;

	memset(ctx, 0, sizeof(*ctx));
	ctx->count = count;
	for (uint8_t idx = 0U; idx < count; ++idx) {
		int64_t value = 0;

		memcpy(&value, &table->data.bytes.bytes[idx * sizeof(int64_t)],
		       sizeof(value));
		ctx->values[idx] = value;
	}
	return 0;
}

static int lookup_process(void *state, void *workspace,
			  const struct spaghetti_value *inputs,
			  const bool *input_valid, size_t input_count,
			  struct spaghetti_value *outputs, bool *output_valid,
			  size_t output_count,
			  const struct spaghetti_record *source_record,
			  spaghetti_block_publish_cb_t publish,
			  void *publish_user_data)
{
	struct lookup_state *ctx = state;
	int64_t index;

	(void)workspace;
	(void)source_record;
	(void)publish;
	(void)publish_user_data;
	if ((ctx == NULL) || (ctx->count == 0U) || (output_count < 1U) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}
	index = spaghetti_block_as_i64(&inputs[0]);
	if (index < 0) {
		index = 0;
	}
	if (index >= (int64_t)ctx->count) {
		index = (int64_t)ctx->count - 1;
	}
	spaghetti_block_set_i64(&outputs[0], 0U, ctx->values[index]);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops lookup_ops = {
	.validate = lookup_validate,
	.init = lookup_init,
	.process = lookup_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_lookup_table) = {
	.type_id = "lookup_table",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &lookup_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = one_out,
	.output_count = 1U,
	.state_size = sizeof(struct lookup_state),
	.state_align = __alignof__(struct lookup_state),
	.workspace_size = 0U,
	.max_cost_per_record = 2U,
	.required_capabilities = 0U,
	.ops = &lookup_ops,
};

/* polynomial: c0 + c1*x + c2*x^2 + c3*x^3 ; overflow => -ERANGE */
static const struct spaghetti_field_descriptor poly_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_C0, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "c0", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_C1, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "c1", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_C2, .type = SPAGHETTI_VALUE_INT64,
	  .flags = 0U, .signed_minimum = INT64_MIN, .signed_maximum = INT64_MAX,
	  .name = "c2", .description = "", .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_C3, .type = SPAGHETTI_VALUE_INT64,
	  .flags = 0U, .signed_minimum = INT64_MIN, .signed_maximum = INT64_MAX,
	  .name = "c3", .description = "", .unit = "" },
};
static const struct spaghetti_schema_descriptor poly_schema = {
	.schema_id = "spaghetti.block.polynomial",
	.version = 1U,
	.fields = poly_fields,
	.field_count = ARRAY_SIZE(poly_fields),
};

static int poly_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &poly_schema);
}

static int poly_init(const struct spaghetti_property_set *config, void *state)
{
	struct poly_state *ctx = state;
	const struct spaghetti_value *c2 = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_C2);
	const struct spaghetti_value *c3 = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_C3);

	ctx->c[0] = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_C0)->data.signed_integer;
	ctx->c[1] = spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_C1)->data.signed_integer;
	ctx->c[2] = (c2 != NULL) ? c2->data.signed_integer : 0;
	ctx->c[3] = (c3 != NULL) ? c3->data.signed_integer : 0;
	return 0;
}

static int poly_process(void *state, void *workspace,
			const struct spaghetti_value *inputs,
			const bool *input_valid, size_t input_count,
			struct spaghetti_value *outputs, bool *output_valid,
			size_t output_count,
			const struct spaghetti_record *source_record,
			spaghetti_block_publish_cb_t publish,
			void *publish_user_data)
{
	struct poly_state *ctx = state;
	int64_t x;
	int64_t x2;
	int64_t x3;
	int64_t term;
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
	x = spaghetti_block_as_i64(&inputs[0]);
	result = ctx->c[0];
	err = spaghetti_block_mul_i64(ctx->c[1], x, &term);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_add_i64(result, term, &result);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_mul_i64(x, x, &x2);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_mul_i64(ctx->c[2], x2, &term);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_add_i64(result, term, &result);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_mul_i64(x2, x, &x3);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_mul_i64(ctx->c[3], x3, &term);
	if (err < 0) {
		return err;
	}
	err = spaghetti_block_add_i64(result, term, &result);
	if (err < 0) {
		return err;
	}
	spaghetti_block_set_i64(&outputs[0], 0U, result);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops poly_ops = {
	.validate = poly_validate,
	.init = poly_init,
	.process = poly_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_polynomial) = {
	.type_id = "polynomial",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &poly_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = one_out,
	.output_count = 1U,
	.state_size = sizeof(struct poly_state),
	.state_align = __alignof__(struct poly_state),
	.workspace_size = 0U,
	.max_cost_per_record = 4U,
	.required_capabilities = 0U,
	.ops = &poly_ops,
};

/* unit_convert: out = in * scale_q16 / 65536 */
static const struct spaghetti_field_descriptor unit_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_SCALE, .type = SPAGHETTI_VALUE_INT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .signed_minimum = INT64_MIN,
	  .signed_maximum = INT64_MAX, .name = "scale_q16", .description = "",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor unit_schema = {
	.schema_id = "spaghetti.block.unit_convert",
	.version = 1U,
	.fields = unit_fields,
	.field_count = ARRAY_SIZE(unit_fields),
};

static int unit_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &unit_schema);
}

static int unit_init(const struct spaghetti_property_set *config, void *state)
{
	struct unit_convert_state *ctx = state;

	ctx->scale_q16 =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_SCALE)->data.signed_integer;
	return 0;
}

static int unit_process(void *state, void *workspace,
			const struct spaghetti_value *inputs,
			const bool *input_valid, size_t input_count,
			struct spaghetti_value *outputs, bool *output_valid,
			size_t output_count,
			const struct spaghetti_record *source_record,
			spaghetti_block_publish_cb_t publish,
			void *publish_user_data)
{
	struct unit_convert_state *ctx = state;
	int64_t scaled;
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
				      ctx->scale_q16, &scaled);
	if (err < 0) {
		return err;
	}
	spaghetti_block_set_i64(&outputs[0], 0U, scaled / 65536);
	output_valid[0] = true;
	return 0;
}

static const struct spaghetti_block_driver_ops unit_ops = {
	.validate = unit_validate,
	.init = unit_init,
	.process = unit_process,
	.reset = spaghetti_block_noop_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_unit_convert) = {
	.type_id = "unit_convert",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &unit_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = one_out,
	.output_count = 1U,
	.state_size = sizeof(struct unit_convert_state),
	.state_align = __alignof__(struct unit_convert_state),
	.workspace_size = 0U,
	.max_cost_per_record = 1U,
	.required_capabilities = 0U,
	.ops = &unit_ops,
};
