#include "slup_io.h"

#include "cobs.h"
#include "slup.h"

#include <Arduino.h>
#include <string.h>

bool slup_write_raw(Stream &s, const uint8_t *data, size_t n) {
    return s.write(data, n) == n;
}

static bool slup_consume_echo(Stream &s, const uint8_t *expected, size_t n,
                              uint32_t timeout_ms) {
    const uint32_t start = millis();
    size_t matched = 0;
    while (matched < n && millis() - start < timeout_ms) {
        if (!s.available()) {
            delay(1);
            continue;
        }
        const int c = s.read();
        if (c < 0 || (uint8_t)c != expected[matched]) {
            return false;
        }
        matched++;
    }
    return matched == n;
}

bool slup_write_raw_hd(Stream &s, const uint8_t *data, size_t n, uint32_t echo_timeout_ms) {
    if (!slup_write_raw(s, data, n)) {
        return false;
    }
    delay(1);
    return slup_consume_echo(s, data, n, echo_timeout_ms);
}

bool slup_write_magic(Stream &s) { return slup_write_raw(s, kSlupMagic, kSlupMagicLen); }

bool slup_write_ack(Stream &s) { return slup_write_raw(s, kSlupAck, kSlupMagicLen); }

bool slup_write_magic_hd(Stream &s, uint32_t echo_timeout_ms) {
    return slup_write_raw_hd(s, kSlupMagic, kSlupMagicLen, echo_timeout_ms);
}

bool slup_write_ack_hd(Stream &s, uint32_t echo_timeout_ms) {
    return slup_write_raw_hd(s, kSlupAck, kSlupMagicLen, echo_timeout_ms);
}

bool slup_wait_bytes(Stream &s, const uint8_t *want, size_t n, uint32_t timeout_ms) {
    size_t matched = 0;
    const uint32_t start = millis();
    while (millis() - start < timeout_ms) {
        if (!s.available()) {
            delay(1);
            continue;
        }
        const int c = s.read();
        if (c < 0) {
            continue;
        }
        if ((uint8_t)c == want[matched]) {
            matched++;
            if (matched == n) {
                return true;
            }
        } else {
            matched = ((uint8_t)c == want[0]) ? 1 : 0;
        }
    }
    return false;
}

static size_t slup_encode_cmd(uint8_t cmd, const uint8_t *payload, size_t payload_len,
                              uint8_t *frame, size_t frame_cap) {
    uint8_t raw[1 + 280];
    if (payload_len > sizeof(raw) - 1) {
        return 0;
    }
    raw[0] = cmd;
    if (payload_len && payload) {
        memcpy(raw + 1, payload, payload_len);
    }
    return cobs_encode_frame(raw, 1 + payload_len, frame, frame_cap);
}

bool slup_send_cmd(Stream &s, uint8_t cmd, const uint8_t *payload, size_t payload_len) {
    uint8_t frame[1 + 280 + 16];
    const size_t n = slup_encode_cmd(cmd, payload, payload_len, frame, sizeof(frame));
    if (n == 0) {
        return false;
    }
    return s.write(frame, n) == n;
}

bool slup_send_cmd_hd(Stream &s, uint8_t cmd, const uint8_t *payload, size_t payload_len,
                      uint32_t echo_timeout_ms) {
    uint8_t frame[1 + 280 + 16];
    const size_t n = slup_encode_cmd(cmd, payload, payload_len, frame, sizeof(frame));
    if (n == 0 || s.write(frame, n) != n) {
        return false;
    }
    delay(1);
    return slup_consume_echo(s, frame, n, echo_timeout_ms);
}

bool slup_recv_cmd(Stream &s, uint8_t *cmd, uint8_t *payload, size_t cap, size_t *payload_len,
                   uint32_t timeout_ms) {
    uint8_t encoded[320];
    size_t n = 0;
    const uint32_t start = millis();
    while (millis() - start < timeout_ms) {
        if (!s.available()) {
            delay(1);
            continue;
        }
        const int c = s.read();
        if (c < 0) {
            continue;
        }
        if (n < sizeof(encoded)) {
            encoded[n++] = (uint8_t)c;
        }
        if ((uint8_t)c == 0x00) {
            uint8_t decoded[300];
            const size_t dlen = cobs_decode_frame(encoded, n, decoded, sizeof(decoded));
            if (dlen < 1) {
                return false;
            }
            *cmd = decoded[0];
            const size_t pl = dlen - 1;
            if (pl > cap) {
                return false;
            }
            if (payload && pl) {
                memcpy(payload, decoded + 1, pl);
            }
            if (payload_len) {
                *payload_len = pl;
            }
            return true;
        }
    }
    return false;
}
