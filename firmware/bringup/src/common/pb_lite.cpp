#include "pb_lite.h"

#include <string.h>

static bool read_varint(const uint8_t *in, size_t len, size_t *off, uint32_t *out) {
    uint32_t v = 0;
    int shift = 0;
    while (*off < len && shift < 32) {
        const uint8_t b = in[(*off)++];
        v |= (uint32_t)(b & 0x7F) << shift;
        if ((b & 0x80) == 0) {
            *out = v;
            return true;
        }
        shift += 7;
    }
    return false;
}

static bool skip_field(const uint8_t *in, size_t len, size_t *off, uint8_t wire) {
    if (wire == 0) {
        uint32_t dummy;
        return read_varint(in, len, off, &dummy);
    }
    if (wire == 1) {
        if (*off + 8 > len) {
            return false;
        }
        *off += 8;
        return true;
    }
    if (wire == 2) {
        uint32_t n = 0;
        if (!read_varint(in, len, off, &n)) {
            return false;
        }
        if (*off + n > len) {
            return false;
        }
        *off += n;
        return true;
    }
    if (wire == 5) {
        if (*off + 4 > len) {
            return false;
        }
        *off += 4;
        return true;
    }
    return false;
}

static size_t write_varint(uint8_t *out, size_t cap, size_t off, uint32_t v) {
    do {
        if (off >= cap) {
            return (size_t)-1;
        }
        uint8_t b = (uint8_t)(v & 0x7F);
        v >>= 7;
        if (v) {
            b |= 0x80;
        }
        out[off++] = b;
    } while (v);
    return off;
}

static size_t write_key(uint8_t *out, size_t cap, size_t off, uint32_t field, uint8_t wire) {
    return write_varint(out, cap, off, (field << 3) | wire);
}

static size_t write_uint32_field(uint8_t *out, size_t cap, size_t off, uint32_t field, uint32_t v) {
    if (v == 0) {
        return off;
    }
    off = write_key(out, cap, off, field, 0);
    if (off == (size_t)-1) {
        return off;
    }
    return write_varint(out, cap, off, v);
}

static size_t write_bool_field(uint8_t *out, size_t cap, size_t off, uint32_t field, bool v) {
    return v ? write_uint32_field(out, cap, off, field, 1) : off;
}

static size_t write_bytes_field(uint8_t *out, size_t cap, size_t off, uint32_t field, const uint8_t *data,
                                size_t n) {
    off = write_key(out, cap, off, field, 2);
    if (off == (size_t)-1) {
        return off;
    }
    off = write_varint(out, cap, off, (uint32_t)n);
    if (off == (size_t)-1 || off + n > cap) {
        return (size_t)-1;
    }
    if (n && data) {
        memcpy(out + off, data, n);
    }
    return off + n;
}

static size_t write_string_field(uint8_t *out, size_t cap, size_t off, uint32_t field, const char *s) {
    if (!s || !s[0]) {
        return off;
    }
    return write_bytes_field(out, cap, off, field, (const uint8_t *)s, strlen(s));
}

static size_t write_submsg(uint8_t *out, size_t cap, size_t off, uint32_t field, const uint8_t *inner,
                           size_t inner_len) {
    return write_bytes_field(out, cap, off, field, inner, inner_len);
}

static bool parse_reboot(const uint8_t *in, size_t len, HostMsg *out) {
    size_t off = 0;
    while (off < len) {
        uint32_t key = 0;
        if (!read_varint(in, len, &off, &key)) {
            return false;
        }
        const uint32_t field = key >> 3;
        const uint8_t wire = (uint8_t)(key & 7);
        if (wire == 0) {
            uint32_t v = 0;
            if (!read_varint(in, len, &off, &v)) {
                return false;
            }
            if (field == 1) {
                out->reboot_update = v != 0;
            } else if (field == 2) {
                out->reboot_rom = v != 0;
            }
        } else if (!skip_field(in, len, &off, wire)) {
            return false;
        }
    }
    return true;
}

static bool parse_begin(const uint8_t *in, size_t len, HostMsg *out) {
    size_t off = 0;
    while (off < len) {
        uint32_t key = 0;
        if (!read_varint(in, len, &off, &key)) {
            return false;
        }
        const uint32_t field = key >> 3;
        const uint8_t wire = (uint8_t)(key & 7);
        if (wire == 0) {
            uint32_t v = 0;
            if (!read_varint(in, len, &off, &v)) {
                return false;
            }
            if (field == 1) {
                out->flash_size = v;
            } else if (field == 2) {
                out->flash_crc32 = v;
            } else if (field == 3) {
                out->flash_offset = v;
            } else if (field == 4) {
                out->flash_mode = v;
            } else if (field == 5) {
                out->uart_invert = v != 0;
            }
        } else if (!skip_field(in, len, &off, wire)) {
            return false;
        }
    }
    return true;
}

static bool parse_chunk(const uint8_t *in, size_t len, HostMsg *out) {
    size_t off = 0;
    while (off < len) {
        uint32_t key = 0;
        if (!read_varint(in, len, &off, &key)) {
            return false;
        }
        const uint32_t field = key >> 3;
        const uint8_t wire = (uint8_t)(key & 7);
        if (field == 1 && wire == 0) {
            if (!read_varint(in, len, &off, &out->chunk_offset)) {
                return false;
            }
        } else if (field == 2 && wire == 2) {
            uint32_t n = 0;
            if (!read_varint(in, len, &off, &n) || off + n > len || n > kUsbChunkMax) {
                return false;
            }
            memcpy(out->chunk, in + off, n);
            out->chunk_len = (uint16_t)n;
            off += n;
        } else if (!skip_field(in, len, &off, wire)) {
            return false;
        }
    }
    return true;
}

static bool parse_nfc(const uint8_t *in, size_t len, HostMsg *out) {
    size_t off = 0;
    while (off < len) {
        uint32_t key = 0;
        if (!read_varint(in, len, &off, &key)) return false;
        const uint32_t field = key >> 3;
        const uint8_t wire = (uint8_t)(key & 7);
        if (field == 1 && wire == 0) {
            if (!read_varint(in, len, &off, &out->nfc_cmd)) return false;
        } else if (field == 2 && wire == 2) {
            uint32_t n = 0;
            if (!read_varint(in, len, &off, &n) || n > sizeof(out->nfc_payload) || off + n > len) return false;
            memcpy(out->nfc_payload, in + off, n);
            out->nfc_payload_len = (uint8_t)n;
            off += n;
        } else if (!skip_field(in, len, &off, wire)) {
            return false;
        }
    }
    return out->nfc_cmd >= kTwaiNfcInfo && out->nfc_cmd <= kTwaiNfcUidRead;
}

bool pb_decode_host(const uint8_t *in, size_t in_len, HostMsg *out) {
    if (!in || !out) {
        return false;
    }
    memset(out, 0, sizeof(*out));
    out->op = HostOp::None;
    size_t off = 0;
    while (off < in_len) {
        uint32_t key = 0;
        if (!read_varint(in, in_len, &off, &key)) {
            return false;
        }
        const uint32_t field = key >> 3;
        const uint8_t wire = (uint8_t)(key & 7);
        if (field == 1 && wire == 0) {
            if (!read_varint(in, in_len, &off, &out->nonce)) {
                return false;
            }
            continue;
        }
        if ((field == 2 || field == 3) && wire == 0) {
            uint32_t v = 0;
            if (!read_varint(in, in_len, &off, &v)) return false;
            if (field == 2) out->node_id = v;
            else out->node_addressed = v != 0;
            continue;
        }
        if (wire != 2) {
            if (!skip_field(in, in_len, &off, wire)) {
                return false;
            }
            continue;
        }
        uint32_t n = 0;
        if (!read_varint(in, in_len, &off, &n) || off + n > in_len) {
            return false;
        }
        const uint8_t *sub = in + off;
        off += n;
        bool ok = true;
        switch (field) {
            case 10:
                out->op = HostOp::Ping;
                break;
            case 11:
                out->op = HostOp::GetStatus;
                break;
            case 12:
                out->op = HostOp::RebootC3;
                ok = parse_reboot(sub, n, out);
                break;
            case 13:
                out->op = HostOp::FlashBegin;
                ok = parse_begin(sub, n, out);
                break;
            case 14:
                out->op = HostOp::FlashChunk;
                ok = parse_chunk(sub, n, out);
                break;
            case 15:
                out->op = HostOp::FlashFinish;
                break;
            case 16:
                out->op = HostOp::Nfc;
                ok = parse_nfc(sub, n, out);
                break;
            case 17:
                out->op = HostOp::DiscoverNodes;
                break;
            default:
                break;
        }
        if (!ok) {
            return false;
        }
    }
    return out->op != HostOp::None;
}

static size_t finish_core(uint8_t *out, size_t cap, uint32_t nonce, uint32_t field, const uint8_t *inner,
                          size_t inner_len) {
    size_t off = 0;
    off = write_uint32_field(out, cap, off, 1, nonce);
    if (off == (size_t)-1) {
        return 0;
    }
    off = write_submsg(out, cap, off, field, inner, inner_len);
    return off == (size_t)-1 ? 0 : off;
}

size_t pb_encode_pong(uint8_t *out, size_t cap, uint32_t nonce, const char *version) {
    uint8_t inner[96];
    size_t n = write_string_field(inner, sizeof(inner), 0, 1, version);
    if (n == (size_t)-1) {
        return 0;
    }
    return finish_core(out, cap, nonce, 10, inner, n);
}

size_t pb_encode_ack(uint8_t *out, size_t cap, uint32_t nonce, bool ok, const char *msg,
                     uint32_t progress_pct, uint32_t mode_used) {
    uint8_t inner[280];
    size_t n = 0;
    n = write_bool_field(inner, sizeof(inner), n, 1, ok);
    n = write_string_field(inner, sizeof(inner), n, 2, msg);
    n = write_uint32_field(inner, sizeof(inner), n, 3, progress_pct);
    n = write_uint32_field(inner, sizeof(inner), n, 4, mode_used);
    if (n == (size_t)-1) {
        return 0;
    }
    return finish_core(out, cap, nonce, 11, inner, n);
}

size_t pb_encode_status(uint8_t *out, size_t cap, uint32_t nonce, bool c3_alive, bool uart_busy,
                        uint32_t last_error, const char *detail) {
    uint8_t inner[160];
    size_t n = 0;
    n = write_bool_field(inner, sizeof(inner), n, 1, c3_alive);
    n = write_bool_field(inner, sizeof(inner), n, 2, uart_busy);
    n = write_uint32_field(inner, sizeof(inner), n, 3, last_error);
    n = write_string_field(inner, sizeof(inner), n, 4, detail);
    if (n == (size_t)-1) {
        return 0;
    }
    return finish_core(out, cap, nonce, 12, inner, n);
}

size_t pb_encode_nfc(uint8_t *out, size_t cap, uint32_t nonce, bool ok, uint32_t status,
                     uint32_t command, const uint8_t *data, size_t data_len, const char *detail) {
    uint8_t inner[128];
    size_t n = 0;
    n = write_bool_field(inner, sizeof(inner), n, 1, ok);
    n = write_uint32_field(inner, sizeof(inner), n, 2, status);
    n = write_uint32_field(inner, sizeof(inner), n, 3, command);
    n = write_bytes_field(inner, sizeof(inner), n, 4, data, data_len);
    n = write_string_field(inner, sizeof(inner), n, 5, detail);
    if (n == (size_t)-1) return 0;
    return finish_core(out, cap, nonce, 13, inner, n);
}

size_t pb_encode_nodes(uint8_t *out, size_t cap, uint32_t nonce, const uint8_t *records,
                       size_t records_len) {
    uint8_t inner[240];
    size_t n = write_bytes_field(inner, sizeof(inner), 0, 1, records, records_len);
    if (n == (size_t)-1) return 0;
    return finish_core(out, cap, nonce, 14, inner, n);
}
