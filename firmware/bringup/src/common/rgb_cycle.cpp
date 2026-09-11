#include "rgb_cycle.h"

#include "sk6812_rmt.h"

static void color_wheel(uint8_t p, uint8_t *r, uint8_t *g, uint8_t *b) {
    const uint8_t sector = p / 43;
    const uint8_t x = (uint8_t)((p % 43) * 6);
    switch (sector) {
        case 0: *r = 48; *g = x * 48 / 255; *b = 0; break;
        case 1: *r = (255 - x) * 48 / 255; *g = 48; *b = 0; break;
        case 2: *r = 0; *g = 48; *b = x * 48 / 255; break;
        case 3: *r = 0; *g = (255 - x) * 48 / 255; *b = 48; break;
        case 4: *r = x * 48 / 255; *g = 0; *b = 48; break;
        default: *r = 48; *g = 0; *b = (255 - x) * 48 / 255; break;
    }
}

// Smooth classic RGB fade. Fills every LED (CORE: 1, BACKBONE: 4).
void rgb_cycle_tick(uint32_t now_ms, uint32_t period_ms) {
    static uint32_t last_ms = 0;
    if (now_ms - last_ms < 20) return;
    last_ms = now_ms;
    uint8_t r = 0, g = 0, b = 0;
    const uint32_t full_cycle_ms = period_ms < 100 ? 100 : period_ms * 6U;
    color_wheel((uint8_t)((now_ms % full_cycle_ms) * 255U / full_cycle_ms), &r, &g, &b);
    sk6812_fill(r, g, b);
    sk6812_show();
}
