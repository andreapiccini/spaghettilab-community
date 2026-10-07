#include "blocks_common.h"
#include <spaghetti/port.h>
#include <zephyr/kernel.h>

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
		if (err) return err; ctx->acquired = true;
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
