#include "sk6812_rmt.h"

#include <stdlib.h>
#include <string.h>

#include "driver/rmt_tx.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static rmt_channel_handle_t s_chan = nullptr;
static rmt_encoder_handle_t s_encoder = nullptr;
static uint8_t *s_grb = nullptr;
static size_t s_count = 0;
static bool s_invert = false;

bool sk6812_begin(int gpio, size_t led_count, bool invert_out) {
    if (led_count == 0 || gpio < 0) {
        return false;
    }

    free(s_grb);
    s_grb = (uint8_t *)calloc(led_count, 3);
    if (!s_grb) {
        return false;
    }
    s_count = led_count;
    s_invert = invert_out;

    rmt_tx_channel_config_t tx_cfg = {};
    tx_cfg.gpio_num = (gpio_num_t)gpio;
    tx_cfg.clk_src = RMT_CLK_SRC_DEFAULT;
    tx_cfg.resolution_hz = 10 * 1000 * 1000;  // 100 ns ticks
    tx_cfg.mem_block_symbols = 128;
    tx_cfg.trans_queue_depth = 4;
    tx_cfg.flags.invert_out = invert_out ? 1 : 0;
    tx_cfg.flags.with_dma = 0;

    if (rmt_new_tx_channel(&tx_cfg, &s_chan) != ESP_OK) {
        return false;
    }

    // SK6812 timing (also accepted by WS2812B). Encoded as normal '1'=long high;
    // invert_out + the board inverter restore the polarity seen by DIN.
    rmt_bytes_encoder_config_t enc_cfg = {};
    enc_cfg.bit0.duration0 = 3;
    enc_cfg.bit0.level0 = 1;
    enc_cfg.bit0.duration1 = 9;
    enc_cfg.bit0.level1 = 0;
    enc_cfg.bit1.duration0 = 6;
    enc_cfg.bit1.level0 = 1;
    enc_cfg.bit1.duration1 = 6;
    enc_cfg.bit1.level1 = 0;
    enc_cfg.flags.msb_first = 1;

    if (rmt_new_bytes_encoder(&enc_cfg, &s_encoder) != ESP_OK) {
        return false;
    }
    if (rmt_enable(s_chan) != ESP_OK) {
        return false;
    }

    sk6812_clear();
    sk6812_show();
    return true;
}

void sk6812_set_rgb(size_t index, uint8_t r, uint8_t g, uint8_t b) {
    if (!s_grb || index >= s_count) {
        return;
    }
    s_grb[index * 3 + 0] = g;
    s_grb[index * 3 + 1] = r;
    s_grb[index * 3 + 2] = b;
}

void sk6812_fill(uint8_t r, uint8_t g, uint8_t b) {
    for (size_t i = 0; i < s_count; i++) {
        sk6812_set_rgb(i, r, g, b);
    }
}

void sk6812_clear() { sk6812_fill(0, 0, 0); }

size_t sk6812_count() { return s_count; }

void sk6812_show() {
    if (!s_chan || !s_encoder || !s_grb) {
        return;
    }

    rmt_transmit_config_t tx = {};
    tx.loop_count = 0;
    // Logical idle low. With invert_out the pad idles high, then the 74AHCT1G14
    // drives LED DIN low, which is the SK6812 reset/idle state.
    tx.flags.eot_level = 0;

    if (rmt_transmit(s_chan, s_encoder, s_grb, s_count * 3, &tx) != ESP_OK) {
        return;
    }
    rmt_tx_wait_all_done(s_chan, 100);
    (void)s_invert;
    vTaskDelay(pdMS_TO_TICKS(1));  // >80 us reset latch
}
