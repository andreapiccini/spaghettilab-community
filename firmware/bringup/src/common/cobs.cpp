#include "cobs.h"

size_t cobs_encode_frame(const uint8_t *in, size_t in_len, uint8_t *out, size_t out_cap) {
    if (!in || !out) {
        return 0;
    }
    const size_t need = in_len + in_len / 254 + 2;
    if (out_cap < need) {
        return 0;
    }
    size_t read_idx = 0;
    size_t write_idx = 1;
    size_t code_idx = 0;
    uint8_t code = 1;
    while (read_idx < in_len) {
        if (in[read_idx] == 0) {
            out[code_idx] = code;
            code = 1;
            code_idx = write_idx++;
            read_idx++;
        } else {
            out[write_idx++] = in[read_idx++];
            code++;
            if (code == 0xFF) {
                out[code_idx] = code;
                code = 1;
                code_idx = write_idx++;
            }
        }
    }
    out[code_idx] = code;
    out[write_idx++] = 0x00;
    return write_idx;
}

size_t cobs_decode_frame(const uint8_t *in, size_t in_len, uint8_t *out, size_t out_cap) {
    if (!in || !out || in_len == 0) {
        return 0;
    }
    if (in[in_len - 1] == 0x00) {
        in_len--;
    }
    if (in_len == 0) {
        return 0;
    }
    size_t read_idx = 0;
    size_t write_idx = 0;
    while (read_idx < in_len) {
        const uint8_t code = in[read_idx];
        if (code == 0 || read_idx + code > in_len + 1) {
            return 0;
        }
        read_idx++;
        for (uint8_t i = 1; i < code; i++) {
            if (read_idx >= in_len) {
                return 0;
            }
            if (write_idx >= out_cap) {
                return 0;
            }
            out[write_idx++] = in[read_idx++];
        }
        if (code != 0xFF && read_idx < in_len) {
            if (write_idx >= out_cap) {
                return 0;
            }
            out[write_idx++] = 0;
        }
    }
    return write_idx;
}
