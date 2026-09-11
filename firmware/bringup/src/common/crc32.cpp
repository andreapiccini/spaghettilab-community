#include "crc32.h"

uint32_t crc32_ieee(const uint8_t *data, size_t len, uint32_t acc) {
    for (size_t i = 0; i < len; i++) {
        acc ^= data[i];
        for (int b = 0; b < 8; b++) {
            const uint32_t mask = (uint32_t)-(int32_t)(acc & 1u);
            acc = (acc >> 1) ^ (0xEDB88320u & mask);
        }
    }
    return acc;
}

uint32_t crc32_ieee_finish(uint32_t acc) { return acc ^ 0xFFFFFFFFu; }
