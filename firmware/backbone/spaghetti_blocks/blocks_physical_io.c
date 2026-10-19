#include "blocks_common.h"
#include <spaghetti/port.h>
#include <zephyr/kernel.h>
#include <stdlib.h>

struct physical_io_state { const struct spaghetti_port *port; uint8_t port_id; uint8_t channel; uint8_t kind; bool acquired; };
static const struct spaghetti_field_descriptor io_fields[] = {
	{ .field_id = 1U, .type = SPAGHETTI_VALUE_UINT64, .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_maximum = 255U, .name = "port", .description = "Physical backend Port", .unit = "" },
	{ .field_id = 2U, .type = SPAGHETTI_VALUE_UINT64, .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_maximum = 3U, .name = "channel", .description = "Function 2 signal index", .unit = "" },
};
static const struct spaghetti_schema_descriptor io_schema = { .schema_id = "spaghetti.physical.io", .version = 1U, .fields = io_fields, .field_count = ARRAY_SIZE(io_fields) };
static const struct spaghetti_block_port_descriptor io_in[] = { { .port_id = 0U, .name = "value", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC | SPAGHETTI_BLOCK_TYPE_BOOL | SPAGHETTI_BLOCK_TYPE_BYTES, .required = true } };
static const struct spaghetti_block_port_descriptor io_out[] = { { .port_id = 0U, .name = "value", .accepted_types = SPAGHETTI_BLOCK_TYPE_NUMERIC | SPAGHETTI_BLOCK_TYPE_BOOL | SPAGHETTI_BLOCK_TYPE_BYTES } };
static int io_validate(const struct spaghetti_property_set *config) { return spaghetti_property_validate(config, &io_schema); }
static int io_init_kind(const struct spaghetti_property_set *config, void *state, uint8_t kind)
{
	int err = io_validate(config); if (err) return err;
	struct physical_io_state *ctx = state; memset(ctx, 0, sizeof(*ctx));
	ctx->port = spaghetti_port_get(spaghetti_property_find(config, 1U)->data.unsigned_integer);
	ctx->port_id = spaghetti_property_find(config, 1U)->data.unsigned_integer;
	ctx->channel = spaghetti_property_find(config, 2U)->data.unsigned_integer; ctx->kind = kind;
	return ctx->port ? 0 : -ENODEV;
}
#define IO_INIT(name, kind) static int name(const struct spaghetti_property_set *config, void *state) { return io_init_kind(config, state, kind); }
IO_INIT(gpio_init, 0U) IO_INIT(pwm_init, 1U) IO_INIT(tx_init, 2U) IO_INIT(rx_init, 3U) IO_INIT(spi_init, 4U)
static int io_process(void *state, void *workspace, const struct spaghetti_value *inputs, const bool *input_valid, size_t input_count, struct spaghetti_value *outputs, bool *output_valid, size_t output_count, const struct spaghetti_record *source_record, spaghetti_block_publish_cb_t publish, void *publish_user_data)
{
	ARG_UNUSED(workspace); ARG_UNUSED(source_record); ARG_UNUSED(publish); ARG_UNUSED(publish_user_data);
	struct physical_io_state *ctx = state;
	if (!input_count || !input_valid[0]) return 0;
	uint8_t modes[4], speed; int err = spaghetti_port_copy_user_map(ctx->port_id, modes, &speed);
	if (err) return err;
	const uint8_t expected[] = {2U, 12U, 6U, 7U, 8U};
	if ((modes[ctx->channel] & 15U) != expected[ctx->kind] && !(ctx->kind == 0U && modes[ctx->channel] == 3U)) return -ESTALE;
	if (!ctx->acquired) {
		const enum spaghetti_port_transport transport = ctx->kind == 2U || ctx->kind == 3U ? SPAGHETTI_PORT_TRANSPORT_UART : ctx->kind == 4U ? SPAGHETTI_PORT_TRANSPORT_SPI : SPAGHETTI_PORT_TRANSPORT_GPIO;
		err = spaghetti_port_acquire(ctx->port, (spaghetti_port_owner_t)(uintptr_t)ctx, transport);
		if (err) {
			return err;
		}
		ctx->acquired = true;
	}
	if (inputs[0].type != SPAGHETTI_VALUE_BOOL && inputs[0].type != SPAGHETTI_VALUE_INT64 && inputs[0].type != SPAGHETTI_VALUE_UINT64 && inputs[0].type != SPAGHETTI_VALUE_BYTES) return -EINVAL;
	if (ctx->kind < 2U && inputs[0].type == SPAGHETTI_VALUE_BYTES) return -EINVAL;
	const int64_t value = inputs[0].type == SPAGHETTI_VALUE_BYTES ? 0 : inputs[0].type == SPAGHETTI_VALUE_BOOL ? inputs[0].data.boolean : spaghetti_block_as_i64(&inputs[0]);
	if (ctx->kind == 0U) return spaghetti_port_digital_output_set(ctx->port, ctx->channel, value != 0);
	if (ctx->kind == 1U) { if (value < 0 || value > 10000) return -ERANGE; return spaghetti_port_pwm_set(ctx->port, ctx->channel, value); }
	if (ctx->kind == 3U) {
		uint8_t byte; err = spaghetti_port_uart_read(ctx->port, &byte, 1U, K_MSEC(2));
		if (err == -ETIMEDOUT) return 0;
		if (!err && output_count) { spaghetti_block_set_u64(&outputs[0], 0U, byte); output_valid[0] = true; } return err;
	}
	uint8_t byte = (uint8_t)value;
	const uint8_t *bytes = inputs[0].type == SPAGHETTI_VALUE_BYTES ? inputs[0].data.bytes.bytes : &byte;
	const size_t length = inputs[0].type == SPAGHETTI_VALUE_BYTES ? inputs[0].data.bytes.size : 1U;
	if (!length || length > SPAGHETTI_VALUE_BYTES_MAX) return -EMSGSIZE;
	if (inputs[0].type != SPAGHETTI_VALUE_BYTES && (value < 0 || value > 255)) return -ERANGE;
	if (ctx->kind == 2U) return spaghetti_port_uart_write(ctx->port, bytes, length, K_MSEC(20));
	uint8_t received[SPAGHETTI_VALUE_BYTES_MAX];
	const struct spi_buf tx = { .buf = (void *)bytes, .len = length }, rx = { .buf = received, .len = length };
	const struct spi_buf_set tx_set = { .buffers = &tx, .count = 1U }, rx_set = { .buffers = &rx, .count = 1U };
	const struct spaghetti_port_spi_request request = { .frequency_hz = 1000000U, .operation = SPI_OP_MODE_MASTER | SPI_WORD_SET(8), .tx = &tx_set, .rx = &rx_set };
	err = spaghetti_port_spi_transceive(ctx->port, &request, K_MSEC(20));
	if (!err && output_count) {
		if (inputs[0].type == SPAGHETTI_VALUE_BYTES) { outputs[0].type = SPAGHETTI_VALUE_BYTES; outputs[0].data.bytes.size = length; memcpy(outputs[0].data.bytes.bytes, received, length); }
		else spaghetti_block_set_u64(&outputs[0], 0U, received[0]);
		output_valid[0] = true;
	}
	return err;
}
static void io_reset(void *state) { struct physical_io_state *ctx = state; if (!ctx->acquired) return; if (ctx->kind == 0U) (void)spaghetti_port_digital_output_set(ctx->port, ctx->channel, false); if (ctx->kind == 1U) (void)spaghetti_port_pwm_set(ctx->port, ctx->channel, 0U); }
static void io_deinit(void *state) { struct physical_io_state *ctx = state; io_reset(state); if (ctx->acquired) (void)spaghetti_port_release(ctx->port, (spaghetti_port_owner_t)(uintptr_t)ctx); memset(ctx, 0, sizeof(*ctx)); }
#define IO_DRIVER(symbol, type, init_fn, out_count) \
static const struct spaghetti_block_driver_ops symbol##_ops = { .validate = io_validate, .init = init_fn, .process = io_process, .reset = io_reset, .deinit = io_deinit }; \
SPAGHETTI_BLOCK_DRIVER_DEFINE(symbol) = { .type_id = type, .api_version = SPAGHETTI_BLOCK_DRIVER_API_VERSION, .algorithm_version = 1U, .config_schema = &io_schema, .inputs = io_in, .input_count = 1U, .outputs = out_count ? io_out : NULL, .output_count = out_count, .state_size = sizeof(struct physical_io_state), .state_align = __alignof__(struct physical_io_state), .max_cost_per_record = 32U, .ops = &symbol##_ops };
IO_DRIVER(physical_gpio_out, "physical_gpio_out", gpio_init, 0U)
IO_DRIVER(physical_pwm_out, "physical_pwm_out", pwm_init, 0U)
IO_DRIVER(physical_uart_tx, "physical_uart_tx", tx_init, 0U)
IO_DRIVER(physical_uart_rx, "physical_uart_rx", rx_init, 1U)
IO_DRIVER(physical_spi, "physical_spi", spi_init, 1U)

/* Board LED is separate from Function connector GPIO and uses DT polarity. */
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
#include <spaghetti/field_update.h>
#else
__weak int spaghetti_status_led_set(const void *owner, bool on) { ARG_UNUSED(owner); ARG_UNUSED(on); return -ENOTSUP; }
__weak int spaghetti_status_led_set_intensity(const void *owner, uint8_t percent) { return spaghetti_status_led_set(owner, percent > 0U); }
__weak void spaghetti_status_led_release(const void *owner) { ARG_UNUSED(owner); }
#endif
struct status_led_state { uint8_t threshold; bool negated; uint8_t intensity; bool levels[3]; uint8_t steps[3][8]; uint8_t lengths[3]; bool level_seen; bool last_level; bool intensity_seen; double last_intensity; };
static const struct spaghetti_field_descriptor status_fields[] = {
 { .field_id = 1U, .type = SPAGHETTI_VALUE_UINT64, .flags = SPAGHETTI_FIELD_REQUIRED, .unsigned_maximum = 100U, .name = "threshold", .description = "Board LED PWM", .unit = "" },
 { .field_id = 2U, .type = SPAGHETTI_VALUE_BOOL, .flags = SPAGHETTI_FIELD_REQUIRED, .name = "negated", .description = "Board LED PWM", .unit = "" },
 { .field_id = 3U, .type = SPAGHETTI_VALUE_UINT64, .unsigned_maximum = 100U, .name = "initial_intensity", .description = "Board LED PWM", .unit = "" },
 { .field_id = 6U, .type = SPAGHETTI_VALUE_TEXT, .name = "on_steps", .description = "Board LED PWM", .unit = "" },
 { .field_id = 7U, .type = SPAGHETTI_VALUE_TEXT, .name = "off_steps", .description = "Board LED PWM", .unit = "" },
 { .field_id = 8U, .type = SPAGHETTI_VALUE_TEXT, .name = "intensity_steps", .description = "Board LED PWM", .unit = "" },
};
static const struct spaghetti_schema_descriptor status_schema = { .schema_id = "spaghetti.status_led", .version = 1U, .fields = status_fields, .field_count = ARRAY_SIZE(status_fields) };
static const struct spaghetti_block_port_descriptor status_in[] = {
 { .port_id=0U,.name="level",.accepted_types=SPAGHETTI_BLOCK_TYPE_NUMERIC|SPAGHETTI_BLOCK_TYPE_BOOL },
 { .port_id=1U,.name="on",.accepted_types=SPAGHETTI_BLOCK_TYPE_NUMERIC|SPAGHETTI_BLOCK_TYPE_BOOL },
 { .port_id=2U,.name="off",.accepted_types=SPAGHETTI_BLOCK_TYPE_NUMERIC|SPAGHETTI_BLOCK_TYPE_BOOL },
 { .port_id=3U,.name="set_intensity",.accepted_types=SPAGHETTI_BLOCK_TYPE_NUMERIC|SPAGHETTI_BLOCK_TYPE_BOOL },
 { .port_id=4U,.name="intensity",.accepted_types=SPAGHETTI_BLOCK_TYPE_NUMERIC },
};
static const struct spaghetti_block_port_descriptor status_out[] = {
 { .port_id=0U,.name="on",.accepted_types=SPAGHETTI_BLOCK_TYPE_BOOL },
 { .port_id=1U,.name="intensity",.accepted_types=SPAGHETTI_BLOCK_TYPE_NUMERIC },
};
static int status_parse_steps(const struct spaghetti_value *v, uint8_t *steps, uint8_t *length) {
 const char *text=v->data.text.text;const char *end=text+v->data.text.size;*length=0;
 while(text<end){if(*length>=8U||*text<'0'||*text>'9')return -EINVAL;unsigned n=0;while(text<end&&*text>='0'&&*text<='9'){n=n*10U+(*text++-'0');if(n>100U)return -ERANGE;}steps[(*length)++]=n;if(text<end){if(*text++!=','||text==end)return -EINVAL;}}
 return *length?0:-EINVAL;
}
static int status_validate(const struct spaghetti_property_set *config) {
 int err=spaghetti_property_validate(config,&status_schema);if(err)return err;
 for(unsigned i=6;i<=8;i++){const struct spaghetti_value *v=spaghetti_property_find(config,i);if(v){uint8_t steps[8],length;err=status_parse_steps(v,steps,&length);if(err)return err;}}
 return 0;
}
static int status_init(const struct spaghetti_property_set *config, void *state)
{
 int err=status_validate(config);if(err)return err;struct status_led_state *ctx=state;memset(ctx,0,sizeof(*ctx));
 ctx->threshold=spaghetti_property_find(config,1U)->data.unsigned_integer;ctx->negated=spaghetti_property_find(config,2U)->data.boolean;
 const struct spaghetti_value *initial=spaghetti_property_find(config,3U);ctx->intensity=initial?initial->data.unsigned_integer:0U;
 for(unsigned i=0;i<3;i++){const struct spaghetti_value *v=spaghetti_property_find(config,6U+i);if(v)(void)status_parse_steps(v,ctx->steps[i],&ctx->lengths[i]);else {ctx->lengths[i]=1U;ctx->steps[i][0]=i==0?100U:i==1?0U:50U;}}
 return spaghetti_status_led_set_intensity(ctx,ctx->intensity);
}
static int status_process(void *state, void *workspace, const struct spaghetti_value *inputs, const bool *valid, size_t count, struct spaghetti_value *outputs, bool *out_valid, size_t out_count, const struct spaghetti_record *record, spaghetti_block_publish_cb_t publish, void *user)
{
 ARG_UNUSED(workspace);ARG_UNUSED(record);ARG_UNUSED(publish);ARG_UNUSED(user);struct status_led_state *ctx=state;bool changed=false;
 for(size_t i=0;i<MIN(count,5U);i++) {if(!valid[i])continue;const struct spaghetti_value *v=&inputs[i];
  if(v->type!=SPAGHETTI_VALUE_BOOL&&v->type!=SPAGHETTI_VALUE_UINT64&&v->type!=SPAGHETTI_VALUE_INT64&&v->type!=SPAGHETTI_VALUE_FLOAT)return -EINVAL;
  double n=v->type==SPAGHETTI_VALUE_BOOL?(v->data.boolean?1:0):v->type==SPAGHETTI_VALUE_FLOAT?v->data.decimal:v->type==SPAGHETTI_VALUE_INT64?(double)v->data.signed_integer:(double)v->data.unsigned_integer;
  if(i==4U){if(!(n>=0&&n<=100))return -ERANGE;if(ctx->intensity_seen&&ctx->last_intensity==n)continue;ctx->intensity_seen=true;ctx->last_intensity=n;ctx->intensity=(uint8_t)(n+0.5);changed=true;}
  else if(i==0U){bool on=v->type==SPAGHETTI_VALUE_BOOL?v->data.boolean:n>=ctx->threshold;if(ctx->level_seen&&ctx->last_level==on)continue;ctx->level_seen=true;ctx->last_level=on;ctx->intensity=(on!=ctx->negated)?100U:0U;changed=true;}
  else {bool high=n!=0;bool rising=high&&!ctx->levels[i-1];ctx->levels[i-1]=high;if(!rising)continue;for(unsigned j=0;j<ctx->lengths[i-1];j++){int err=spaghetti_status_led_set_intensity(ctx,ctx->steps[i-1][j]);if(err)return err;ctx->intensity=ctx->steps[i-1][j];}changed=true;}
 }
 if(!changed)return 0;
 int err=spaghetti_status_led_set_intensity(ctx,ctx->intensity);if(err)return err;
 if(out_count>0){outputs[0].type=SPAGHETTI_VALUE_BOOL;outputs[0].data.boolean=ctx->intensity>0;out_valid[0]=true;}
 if(out_count>1){spaghetti_block_set_u64(&outputs[1],1U,ctx->intensity);out_valid[1]=true;}
 return 0;
}
static void status_reset(void *state) { struct status_led_state *ctx=state;ctx->intensity=0;ctx->level_seen=false;ctx->intensity_seen=false;memset(ctx->levels,0,sizeof(ctx->levels));(void)spaghetti_status_led_set_intensity(ctx,0U); }
static void status_deinit(void *state) { spaghetti_status_led_release(state); }
static const struct spaghetti_block_driver_ops status_ops = { .validate=status_validate,.init=status_init,.process=status_process,.reset=status_reset,.deinit=status_deinit };
SPAGHETTI_BLOCK_DRIVER_DEFINE(board_status_led) = { .type_id="status_led",.api_version=SPAGHETTI_BLOCK_DRIVER_API_VERSION,.algorithm_version=1U,.config_schema=&status_schema,.inputs=status_in,.input_count=ARRAY_SIZE(status_in),.outputs=status_out,.output_count=ARRAY_SIZE(status_out),.state_size=sizeof(struct status_led_state),.state_align=__alignof__(struct status_led_state),.max_cost_per_record=40U,.ops=&status_ops };
