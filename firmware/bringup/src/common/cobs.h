#pragma once

#include <stddef.h>
#include <stdint.h>

// COBS encode: out must hold in_len + in_len/254 + 2 (code bytes + trailing 0x00).
// Returns encoded length including the 0x00 delimiter, or 0 on error.
size_t cobs_encode_frame(const uint8_t *in, size_t in_len, uint8_t *out, size_t out_cap);

// Decode a frame that still includes the trailing 0x00 (or not — both accepted).
size_t cobs_decode_frame(const uint8_t *in, size_t in_len, uint8_t *out, size_t out_cap);
