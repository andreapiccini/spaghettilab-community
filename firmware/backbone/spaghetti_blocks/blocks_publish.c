#include "blocks_common.h"

#include <zephyr/sys/util.h>

#define SPAGHETTI_BLOCK_PROP_SCHEMA_ID 1U
#define SPAGHETTI_BLOCK_PROP_SCHEMA_VERSION 2U
#define SPAGHETTI_BLOCK_PROP_FIELD_ID 3U
#define SPAGHETTI_BLOCK_PROP_SOURCE_KEY 4U

struct publish_field_state {
	char schema_id[SPAGHETTI_SCHEMA_ID_SIZE];
	uint16_t schema_version;
	uint16_t field_id;
	uint32_t source_key;
	uint32_t sequence;
};

static const struct spaghetti_block_port_descriptor one_in[] = {
	{ .port_id = 0U, .name = "in",
	  .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC |
			    SPAGHETTI_BLOCK_TYPE_BOOL,
	  .required = true },
};

static const struct spaghetti_field_descriptor publish_fields[] = {
	{ .field_id = SPAGHETTI_BLOCK_PROP_SCHEMA_ID, .type = SPAGHETTI_VALUE_TEXT,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .name = "schema_id",
	  .description = "Derived record schema", .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_SCHEMA_VERSION, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 1U,
	  .unsigned_maximum = UINT16_MAX, .name = "schema_version",
	  .description = "", .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_FIELD_ID, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_minimum = 1U,
	  .unsigned_maximum = UINT16_MAX, .name = "field_id", .description = "",
	  .unit = "" },
	{ .field_id = SPAGHETTI_BLOCK_PROP_SOURCE_KEY, .type = SPAGHETTI_VALUE_UINT64,
	  .flags = 0U, .unsigned_minimum = 0U, .unsigned_maximum = UINT32_MAX,
	  .name = "source_key", .description = "Optional derived source key",
	  .unit = "" },
};
static const struct spaghetti_schema_descriptor publish_schema = {
	.schema_id = "spaghetti.block.publish_field",
	.version = 1U,
	.fields = publish_fields,
	.field_count = ARRAY_SIZE(publish_fields),
};

static int publish_validate(const struct spaghetti_property_set *config)
{
	return spaghetti_property_validate(config, &publish_schema);
}

static int publish_init(const struct spaghetti_property_set *config, void *state)
{
	struct publish_field_state *ctx = state;
	const struct spaghetti_value *schema_id =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_SCHEMA_ID);
	const struct spaghetti_value *source_key =
		spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_SOURCE_KEY);

	memset(ctx, 0, sizeof(*ctx));
	if (schema_id->data.text.size >= sizeof(ctx->schema_id)) {
		return -EMSGSIZE;
	}
	memcpy(ctx->schema_id, schema_id->data.text.text,
	       schema_id->data.text.size);
	ctx->schema_id[schema_id->data.text.size] = '\0';
	ctx->schema_version =
		(uint16_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_SCHEMA_VERSION)
			->data.unsigned_integer;
	ctx->field_id = (uint16_t)spaghetti_block_prop(config, SPAGHETTI_BLOCK_PROP_FIELD_ID)
				->data.unsigned_integer;
	ctx->source_key = (source_key != NULL) ?
				  (uint32_t)source_key->data.unsigned_integer :
				  0U;
	return 0;
}

static void publish_reset(void *state)
{
	struct publish_field_state *ctx = state;

	if (ctx != NULL) {
		ctx->sequence = 0U;
	}
}

static int publish_process(void *state, void *workspace,
			   const struct spaghetti_value *inputs,
			   const bool *input_valid, size_t input_count,
			   struct spaghetti_value *outputs, bool *output_valid,
			   size_t output_count,
			   const struct spaghetti_record *source_record,
			   spaghetti_block_publish_cb_t publish,
			   void *publish_user_data)
{
	struct publish_field_state *ctx = state;
	struct spaghetti_record derived;
	int err;

	(void)workspace;
	(void)outputs;
	(void)output_valid;
	(void)output_count;
	if ((ctx == NULL) || (publish == NULL) || (source_record == NULL) ||
	    (spaghetti_block_require_inputs(input_valid, input_count, 1U) < 0)) {
		return -EINVAL;
	}

	memset(&derived, 0, sizeof(derived));
	derived.source_id = source_record->source_id;
	derived.source_key = (ctx->source_key != 0U) ? ctx->source_key :
						       source_record->source_key;
	derived.boot_id = source_record->boot_id;
	derived.timestamp_ms = source_record->timestamp_ms;
	if (ctx->sequence == UINT32_MAX) {
		ctx->sequence = 0U;
	}
	++ctx->sequence;
	derived.sequence = ctx->sequence;
	derived.payload.kind = SPAGHETTI_RECORD_SAMPLE;
	memcpy(derived.payload.schema_id, ctx->schema_id,
	       sizeof(derived.payload.schema_id));
	derived.payload.schema_version = ctx->schema_version;
	derived.payload.values.field_count = 1U;
	derived.payload.values.fields[0] = inputs[0];
	derived.payload.values.fields[0].field_id = ctx->field_id;

	err = publish(&derived, publish_user_data);
	return err;
}

static const struct spaghetti_block_driver_ops publish_ops = {
	.validate = publish_validate,
	.init = publish_init,
	.process = publish_process,
	.reset = publish_reset,
	.deinit = spaghetti_block_noop_deinit,
};

SPAGHETTI_BLOCK_DRIVER_DEFINE(spaghetti_block_publish_field) = {
	.type_id = "publish_field",
	.api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION,
	.algorithm_version = 1U,
	.config_schema = &publish_schema,
	.inputs = one_in,
	.input_count = 1U,
	.outputs = NULL,
	.output_count = 0U,
	.state_size = sizeof(struct publish_field_state),
	.state_align = __alignof__(struct publish_field_state),
	.workspace_size = 0U,
	.max_cost_per_record = 2U,
	.required_capabilities = 0U,
	.ops = &publish_ops,
};
