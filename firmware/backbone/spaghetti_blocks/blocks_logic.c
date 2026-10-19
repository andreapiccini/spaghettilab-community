#include "blocks_common.h"

#include <zephyr/sys/util.h>
#include <math.h>
#include <stdlib.h>
#include <ctype.h>

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

/* High-level conditions retain scalar input samples, never pointers to records. */
struct logical_state {
 uint8_t kind, condition;
 bool when_true, when_false;
 int64_t threshold;
 double decimal_threshold;
 bool has_decimal_threshold;
 uint8_t precision;
 struct spaghetti_value samples[2];
 bool sampled[2];
};
#define LOGICAL_TYPES (SPAGHETTI_BLOCK_TYPE_BOOL | SPAGHETTI_BLOCK_TYPE_INT64 | SPAGHETTI_BLOCK_TYPE_UINT64 | BIT(SPAGHETTI_VALUE_FLOAT) | SPAGHETTI_BLOCK_TYPE_TEXT)
static const struct spaghetti_block_port_descriptor logical_pair[] = {
 { .port_id=0, .name="a", .accepted_types=LOGICAL_TYPES, .required=true },
 { .port_id=1, .name="b", .accepted_types=LOGICAL_TYPES, .required=true },
};
static const struct spaghetti_block_port_descriptor logical_if_out[] = {
 { .port_id=0, .name="level", .accepted_types=SPAGHETTI_BLOCK_TYPE_UINT64, .required=false },
};
static const struct spaghetti_field_descriptor logical_fields[] = {
 { .field_id=7, .type=SPAGHETTI_VALUE_TEXT, .name="numeric_threshold", .description="Finite decimal comparison value", .unit="" },
 { .field_id=8, .type=SPAGHETTI_VALUE_UINT64, .unsigned_minimum=0, .unsigned_maximum=255, .name="precision", .description="Decimal places; 255 keeps full precision", .unit="" },
 { .field_id=5, .type=SPAGHETTI_VALUE_UINT64, .unsigned_minimum=0, .unsigned_maximum=1, .name="when_true", .description="Output level when condition is true", .unit="" },
 { .field_id=6, .type=SPAGHETTI_VALUE_UINT64, .unsigned_minimum=0, .unsigned_maximum=1, .name="when_false", .description="Output level when condition is false", .unit="" },
 { .field_id=1, .type=SPAGHETTI_VALUE_UINT64, .unsigned_minimum=0, .unsigned_maximum=7, .name="condition", .description="Comparison", .unit="" },
 { .field_id=2, .type=SPAGHETTI_VALUE_INT64, .signed_minimum=INT64_MIN, .signed_maximum=INT64_MAX, .name="value", .description="Integer comparison value", .unit="" },
};
static const struct spaghetti_schema_descriptor logical_schema = {
 .schema_id="spaghetti.block.logical", .version=1, .fields=logical_fields, .field_count=ARRAY_SIZE(logical_fields),
};
static const struct spaghetti_field_descriptor logical_unsigned_fields[] = {
 { .field_id=7, .type=SPAGHETTI_VALUE_TEXT, .name="numeric_threshold", .description="Finite decimal comparison value", .unit="" },
 { .field_id=8, .type=SPAGHETTI_VALUE_UINT64, .unsigned_minimum=0, .unsigned_maximum=255, .name="precision", .description="Decimal places; 255 keeps full precision", .unit="" },
 { .field_id=5, .type=SPAGHETTI_VALUE_UINT64, .unsigned_minimum=0, .unsigned_maximum=1, .name="when_true", .description="Output level when condition is true", .unit="" },
 { .field_id=6, .type=SPAGHETTI_VALUE_UINT64, .unsigned_minimum=0, .unsigned_maximum=1, .name="when_false", .description="Output level when condition is false", .unit="" },
 { .field_id=1, .type=SPAGHETTI_VALUE_UINT64, .unsigned_minimum=0, .unsigned_maximum=7, .name="condition", .description="Comparison", .unit="" },
 { .field_id=2, .type=SPAGHETTI_VALUE_UINT64, .unsigned_minimum=0, .unsigned_maximum=INT64_MAX, .name="value", .description="Integer comparison value", .unit="" },
};
static const struct spaghetti_schema_descriptor logical_unsigned_schema = {
 .schema_id="spaghetti.block.logical", .version=1, .fields=logical_unsigned_fields, .field_count=ARRAY_SIZE(logical_unsigned_fields),
};
static int logical_parse_number(const char *text, size_t length, double *out) {
 char buffer[96];
 if (!text || !length || length>=sizeof(buffer))return -EINVAL;
 for(size_t i=0;i<length;i++) {
  char c=text[i];
  if(!((c>='0' && c<='9') || c=='+' || c=='-' || c=='.' || c==',' || c=='e' || c=='E' || isspace((unsigned char)c)))return -EINVAL;
  buffer[i]=c==','?'.':c;
 }
 buffer[length]=0;char *end;errno=0;
 double n=strtod(buffer,&end);
 if(end==buffer || errno==ERANGE || !isfinite(n))return -EINVAL;
 while(isspace((unsigned char)*end))end++;
 if(*end)return -EINVAL;
 *out=n;return 0;
}
static int logical_validate(const struct spaghetti_property_set *config) {
 /* CBOR encodes every nonnegative integer as UINT64, including zero. */
 const struct spaghetti_value *threshold=spaghetti_block_prop(config,2);
 const struct spaghetti_schema_descriptor *schema=threshold && threshold->type==SPAGHETTI_VALUE_UINT64 ? &logical_unsigned_schema : &logical_schema;
 int err=spaghetti_property_validate(config,schema);if(err)return err;
 const struct spaghetti_value *v=spaghetti_block_prop(config,7);double n;
 if(v && logical_parse_number(v->data.text.text,v->data.text.size,&n))return -EINVAL;
 v=spaghetti_block_prop(config,8);if(v && v->data.unsigned_integer>8 && v->data.unsigned_integer!=255)return -EINVAL;
 return 0;
}
static int logical_init_kind(const struct spaghetti_property_set *config, void *state, uint8_t kind) {
 struct logical_state *s=state; memset(s,0,sizeof(*s)); s->kind=kind; s->condition=1;s->when_true=true;s->precision=kind<2?255:2;
 const struct spaghetti_value *v=spaghetti_block_prop(config,1); if(v)s->condition=v->data.unsigned_integer;
 v=spaghetti_block_prop(config,2); if(v)s->threshold=v->type==SPAGHETTI_VALUE_UINT64?(int64_t)v->data.unsigned_integer:v->data.signed_integer;
 v=spaghetti_block_prop(config,5);if(v)s->when_true=v->data.unsigned_integer!=0;
 v=spaghetti_block_prop(config,6);if(v)s->when_false=v->data.unsigned_integer!=0;
 v=spaghetti_block_prop(config,7);if(v){int err=logical_parse_number(v->data.text.text,v->data.text.size,&s->decimal_threshold);if(err)return err;s->has_decimal_threshold=true;}
 v=spaghetti_block_prop(config,8);if(v)s->precision=v->data.unsigned_integer;
 return 0;
}
static bool logical_truth(const struct spaghetti_value *v) {
 return v->type==SPAGHETTI_VALUE_FLOAT ? v->data.decimal!=0 : v->type==SPAGHETTI_VALUE_BOOL ? v->data.boolean : v->type==SPAGHETTI_VALUE_INT64 ? v->data.signed_integer!=0 : v->data.unsigned_integer!=0;
}
static double logical_round(double value, uint8_t precision) {
 if(precision==255)return value;
 double factor=1;for(uint8_t i=0;i<precision;i++)factor*=10;
 return fabs(value)<1e15 ? round(value*factor)/factor : value;
}
static int logical_compare(const struct spaghetti_value *v, const struct logical_state *s) {
 int64_t threshold=s->threshold;
 if(v->type==SPAGHETTI_VALUE_FLOAT || s->has_decimal_threshold) {
  double a=v->type==SPAGHETTI_VALUE_FLOAT?v->data.decimal:v->type==SPAGHETTI_VALUE_BOOL?v->data.boolean:v->type==SPAGHETTI_VALUE_INT64?(double)v->data.signed_integer:(double)v->data.unsigned_integer;
  double b=s->has_decimal_threshold?s->decimal_threshold:(double)threshold;
  a=logical_round(a,s->precision);b=logical_round(b,s->precision);
  return (a>b)-(a<b);
 }
 if(v->type==SPAGHETTI_VALUE_UINT64) {
  if(threshold<0)return 1;
  uint64_t t=(uint64_t)threshold,n=v->data.unsigned_integer; return (n>t)-(n<t);
 }
 int64_t n=v->type==SPAGHETTI_VALUE_BOOL ? v->data.boolean : v->data.signed_integer;
 return (n>threshold)-(n<threshold);
}
static int logical_process(void *state, void *workspace, const struct spaghetti_value *inputs,
 const bool *valid, size_t count, struct spaghetti_value *outputs, bool *out_valid,
 size_t out_count, const struct spaghetti_record *record, spaghetti_block_publish_cb_t publish, void *user) {
 ARG_UNUSED(workspace);ARG_UNUSED(publish);ARG_UNUSED(user);ARG_UNUSED(record);
 struct logical_state *s=state;
 if(!s || !out_count || !count)return -EINVAL;
 size_t needed=s->kind<2?2:1;
 bool changed=!s->sampled[0];
 for(size_t i=0;i<MIN(count,needed);i++) if(valid[i]) {
  if(!(LOGICAL_TYPES & BIT(inputs[i].type)))return -EINVAL;
  struct spaghetti_value sample=inputs[i];
  if(sample.type==SPAGHETTI_VALUE_TEXT) {
   double n;int err=logical_parse_number(sample.data.text.text,sample.data.text.size,&n);
   if(err)return err;
   sample.type=SPAGHETTI_VALUE_FLOAT;sample.data.decimal=n;
  }
  if(sample.type==SPAGHETTI_VALUE_FLOAT) {
   if(!isfinite(sample.data.decimal))return -EINVAL;
   sample.data.decimal=logical_round(sample.data.decimal,s->precision);
  }
  if(i==0 && s->sampled[0]) {
   const struct spaghetti_value *old=&s->samples[0];
   changed=old->type!=sample.type || (sample.type==SPAGHETTI_VALUE_FLOAT ? old->data.decimal!=sample.data.decimal : sample.type==SPAGHETTI_VALUE_BOOL ? old->data.boolean!=sample.data.boolean : sample.type==SPAGHETTI_VALUE_INT64 ? old->data.signed_integer!=sample.data.signed_integer : old->data.unsigned_integer!=sample.data.unsigned_integer);
  }
  s->samples[i]=sample;s->sampled[i]=true;
 }
 for(size_t i=0;i<needed;i++)if(!s->sampled[i])return 0;
 bool value;
 if(s->kind<2) value=s->kind==0 ? logical_truth(&s->samples[0]) && logical_truth(&s->samples[1]) : logical_truth(&s->samples[0]) || logical_truth(&s->samples[1]);
 else {
  int c=logical_compare(&s->samples[0],s);
  switch(s->condition) {
   case 0:value=!logical_truth(&s->samples[0]);break;
   case 1:value=logical_truth(&s->samples[0]);break;
   case 2:value=c==0;break;case 3:value=c!=0;break;case 4:value=c>0;break;
   case 5:value=c>=0;break;case 6:value=c<0;break;default:value=c<=0;break;
  }
 }
 if(s->kind==3 && (!value || !changed || !valid[0]))return 0;
 if(s->kind==2) { spaghetti_block_set_u64(&outputs[0],0,value?s->when_true:s->when_false); }
 else { spaghetti_block_set_bool(&outputs[0],0,value); }
 out_valid[0]=true;return 0;
}
static void logical_reset(void *state) { struct logical_state *s=state; if(s){memset(s->sampled,0,sizeof(s->sampled));memset(s->samples,0,sizeof(s->samples));} }
#define DEFINE_LOGICAL(symbol, id, kind_id, ports, port_count) \
 static int symbol##_init(const struct spaghetti_property_set *c, void *s){return logical_init_kind(c,s,kind_id);} \
 static const struct spaghetti_block_driver_ops symbol##_ops={.validate=logical_validate,.init=symbol##_init,.process=logical_process,.reset=logical_reset,.deinit=spaghetti_block_noop_deinit}; \
 SPAGHETTI_BLOCK_DRIVER_DEFINE(symbol)={.type_id=id,.api_version=SPAGHETTI_BLOCK_DRIVER_API_VERSION,.algorithm_version=1,.config_schema=&logical_schema,.inputs=ports,.input_count=port_count,.outputs=kind_id==2?logical_if_out:bool_out,.output_count=1,.state_size=sizeof(struct logical_state),.state_align=__alignof__(struct logical_state),.workspace_size=0,.max_cost_per_record=1,.required_capabilities=0,.ops=&symbol##_ops}
DEFINE_LOGICAL(spaghetti_logic_and,"logic_and",0,logical_pair,2);
DEFINE_LOGICAL(spaghetti_logic_or,"logic_or",1,logical_pair,2);
DEFINE_LOGICAL(spaghetti_logic_if,"logic_if",2,logical_pair,1);
DEFINE_LOGICAL(spaghetti_logic_while,"logic_while",3,logical_pair,1);
