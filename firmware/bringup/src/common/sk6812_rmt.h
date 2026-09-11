#pragma once

#include <stddef.h>
#include <stdint.h>

// SK6812 / WS2812-compatible driver using ESP-IDF RMT.
// invert_out compensates the SN74AHCT1G14 hardware inverter on the LED data line.
// Do not invert RGB color values: that does not fix bitstream polarity.

bool sk6812_begin(int gpio, size_t led_count, bool invert_out);
void sk6812_set_rgb(size_t index, uint8_t r, uint8_t g, uint8_t b);
void sk6812_fill(uint8_t r, uint8_t g, uint8_t b);
void sk6812_show();
void sk6812_clear();
size_t sk6812_count();
