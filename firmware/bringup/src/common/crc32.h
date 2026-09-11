#pragma once

#include <stddef.h>
#include <stdint.h>

uint32_t crc32_ieee(const uint8_t *data, size_t len, uint32_t acc = 0xFFFFFFFFu);
uint32_t crc32_ieee_finish(uint32_t acc);
