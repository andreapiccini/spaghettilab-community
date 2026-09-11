#include "esp_uart_flasher.h"

#include "bus_mux.h"

#include <Arduino.h>
#include <driver/uart.h>
#include <string.h>

static const uint8_t kSlipEnd = 0xC0;
static const uint8_t kSlipEsc = 0xDB;
static const uint8_t kSlipEscEnd = 0xDC;
static const uint8_t kSlipEscEsc = 0xDD;

static const uint8_t kDirReq = 0x00;
static const uint8_t kDirRsp = 0x01;
static const uint8_t kCmdFlashBegin = 0x02;
static const uint8_t kCmdFlashData = 0x03;
static const uint8_t kCmdFlashEnd = 0x04;
static const uint8_t kCmdSync = 0x08;
static const uint8_t kCmdSpiSetParams = 0x0B;
static const uint8_t kCmdSpiAttach = 0x0D;

static const uint32_t kBlockSize = 0x400;
// Shared CAN PHY: after S3 TX ends, wait before expecting C3 to drive the pair.
static const uint32_t kHdTurnaroundUs = 2000;
static const uint32_t kSyncReplyMs = 400;
// Half-duplex CAN: GPIO4 always sees our own SYNC. If nothing else arrives,
// the C3 ROM is silent — fail fast instead of sitting on USB for 15 s.
static const uint32_t kEchoOnlyAbortMs = 2200;

static EspSlipSyncDiag *s_sync_diag = nullptr;

static void note_rx_byte() {
    if (s_sync_diag) {
        s_sync_diag->rx_bytes++;
    }
}

static uint32_t checksum_bytes(const uint8_t *data, uint32_t len) {
    uint8_t cs = 0xEF;
    for (uint32_t i = 0; i < len; i++) {
        cs ^= data[i];
    }
    return cs;
}

static void slip_write_byte(HardwareSerial &uart, uint8_t b) {
    if (b == kSlipEnd) {
        uart.write(kSlipEsc);
        uart.write(kSlipEscEnd);
    } else if (b == kSlipEsc) {
        uart.write(kSlipEsc);
        uart.write(kSlipEscEsc);
    } else {
        uart.write(b);
    }
}

static bool read_byte_timeout(HardwareSerial &uart, uint8_t *out, uint32_t timeout_ms) {
    const uint32_t start = millis();
    while (millis() - start < timeout_ms) {
        yield();
        int c = uart.read();
        if (c >= 0) {
            *out = (uint8_t)c;
            note_rx_byte();
            return true;
        }
        delay(0);
    }
    return false;
}

static bool slip_read_packet(HardwareSerial &uart, uint8_t *buf, size_t buf_len, size_t *out_len,
                             uint32_t timeout_ms) {
    const uint32_t start = millis();
    bool in_packet = false;
    bool escaped = false;
    size_t n = 0;

    while (millis() - start < timeout_ms) {
        uint8_t b;
        uint32_t remaining = timeout_ms - (millis() - start);
        if (remaining < 1) {
            remaining = 1;
        }
        if (!read_byte_timeout(uart, &b, remaining > 50 ? 50 : remaining)) {
            continue;
        }
        if (!in_packet) {
            if (b == kSlipEnd) {
                in_packet = true;
                n = 0;
                escaped = false;
            } else if (s_sync_diag) {
                s_sync_diag->noise_bytes++;
            }
            continue;
        }
        if (b == kSlipEnd) {
            if (n == 0) {
                continue;  // consecutive 0xC0
            }
            *out_len = n;
            return true;
        }
        if (escaped) {
            if (b == kSlipEscEnd) {
                b = kSlipEnd;
            } else if (b == kSlipEscEsc) {
                b = kSlipEsc;
            }
            escaped = false;
        } else if (b == kSlipEsc) {
            escaped = true;
            continue;
        }
        if (n < buf_len) {
            buf[n++] = b;
        }
    }
    return false;
}

// UART-over-CAN is half-duplex: SN65HVD230 copies D onto R, so the first SLIP
// frame after TX is our own request (dir=0). Skip it; wait for dir=1 from ROM.
static bool send_command(HardwareSerial &uart, uint8_t cmd, const uint8_t *data, uint16_t data_len,
                         uint32_t checksum, uint8_t *resp, size_t resp_max, size_t *resp_len,
                         uint32_t timeout_ms) {
    uart.write(kSlipEnd);  // extra SLIP wake, like esptool
    uart.write(kSlipEnd);
    slip_write_byte(uart, kDirReq);
    slip_write_byte(uart, cmd);
    slip_write_byte(uart, (uint8_t)(data_len & 0xFF));
    slip_write_byte(uart, (uint8_t)((data_len >> 8) & 0xFF));
    for (int i = 0; i < 4; i++) {
        slip_write_byte(uart, (uint8_t)((checksum >> (8 * i)) & 0xFF));
    }
    for (uint16_t i = 0; i < data_len; i++) {
        slip_write_byte(uart, data[i]);
    }
    uart.write(kSlipEnd);
    bus_uart_drain_tx();
    delayMicroseconds(kHdTurnaroundUs);

    const uint32_t start = millis();
    uint8_t pkt[256];
    size_t pkt_len = 0;

    while (millis() - start < timeout_ms) {
        uint32_t remaining = timeout_ms - (millis() - start);
        if (remaining < 1) {
            remaining = 1;
        }
        if (!slip_read_packet(uart, pkt, sizeof(pkt), &pkt_len, remaining > 80 ? 80 : remaining)) {
            continue;
        }
        if (pkt_len < 2) {
            if (s_sync_diag) {
                s_sync_diag->other_frames++;
            }
            continue;
        }
        if (pkt[0] == kDirReq && pkt[1] == cmd) {
            if (s_sync_diag) {
                s_sync_diag->echo_frames++;
                s_sync_diag->last_dir = pkt[0];
                s_sync_diag->last_cmd = pkt[1];
            }
            delayMicroseconds(kHdTurnaroundUs);
            continue;
        }
        // dir=1 may arrive in the same FIFO as echo, or slightly early. Accept it.
        if (s_sync_diag) {
            s_sync_diag->last_dir = pkt[0];
            s_sync_diag->last_cmd = pkt[1];
        }
        if (pkt_len >= 10 && pkt[0] == kDirRsp && pkt[1] == cmd) {
            const uint8_t status = pkt[pkt_len - 2];
            if (status != 0) {
                if (s_sync_diag) {
                    s_sync_diag->other_frames++;
                }
                continue;
            }
            if (resp && resp_len) {
                const size_t copy = pkt_len < resp_max ? pkt_len : resp_max;
                memcpy(resp, pkt, copy);
                *resp_len = copy;
            }
            return true;
        }
        if (s_sync_diag) {
            s_sync_diag->other_frames++;
        }
    }
    return false;
}

bool esp_flasher_sync(HardwareSerial &uart, uint32_t timeout_ms, EspSlipSyncDiag *diag,
                      EspSlipSyncTick tick) {
    EspSlipSyncDiag local = {};
    if (diag) {
        *diag = local;
        s_sync_diag = diag;
    } else {
        s_sync_diag = &local;
    }

    // esptool SYNC: cmd 0x08, payload 07 07 12 20 + 32 x 0x55 (ESP32-C3 ROM UART0 115200)
    uint8_t sync_data[36];
    sync_data[0] = 0x07;
    sync_data[1] = 0x07;
    sync_data[2] = 0x12;
    sync_data[3] = 0x20;
    memset(sync_data + 4, 0x55, 32);

    const uint32_t start = millis();
    bool ok = false;
    while (millis() - start < timeout_ms) {
        // Do not flush RX: a late dir=1 from the previous attempt must stay.
        size_t resp_len = 0;
        uint8_t resp[64];
        if (send_command(uart, kCmdSync, sync_data, sizeof(sync_data), 0, resp, sizeof(resp),
                         &resp_len, kSyncReplyMs)) {
            delay(20);
            while (uart.available()) {
                uart.read();
                note_rx_byte();
            }
            ok = true;
            break;
        }
        const uint32_t elapsed = millis() - start;
        if (tick) {
            tick(s_sync_diag, elapsed);
        }
        if (elapsed >= kEchoOnlyAbortMs && s_sync_diag->echo_frames > 0 &&
            s_sync_diag->other_frames == 0) {
            break;
        }
        delay(80);
    }
    s_sync_diag->got_sync = ok;
    s_sync_diag = nullptr;
    return ok;
}

static size_t slip_put(uint8_t *out, size_t n, size_t cap, uint8_t b) {
    if (b == kSlipEnd) {
        if (n + 2 > cap) {
            return n;
        }
        out[n++] = kSlipEsc;
        out[n++] = kSlipEscEnd;
        return n;
    }
    if (b == kSlipEsc) {
        if (n + 2 > cap) {
            return n;
        }
        out[n++] = kSlipEsc;
        out[n++] = kSlipEscEsc;
        return n;
    }
    if (n < cap) {
        out[n++] = b;
    }
    return n;
}

bool esp_flasher_sync_once(HardwareSerial &uart, EspSlipSyncDiag *diag) {
    (void)uart;
    EspSlipSyncDiag local = {};
    if (!diag) {
        diag = &local;
    }
    s_sync_diag = diag;

    uint8_t sync_data[36];
    sync_data[0] = 0x07;
    sync_data[1] = 0x07;
    sync_data[2] = 0x12;
    sync_data[3] = 0x20;
    memset(sync_data + 4, 0x55, 32);

    uint8_t slip[128];
    size_t n = 0;
    if (n + 2 <= sizeof(slip)) {
        slip[n++] = kSlipEnd;
        slip[n++] = kSlipEnd;
    }
    n = slip_put(slip, n, sizeof(slip), kDirReq);
    n = slip_put(slip, n, sizeof(slip), kCmdSync);
    n = slip_put(slip, n, sizeof(slip), 36);
    n = slip_put(slip, n, sizeof(slip), 0);
    for (int i = 0; i < 4; i++) {
        n = slip_put(slip, n, sizeof(slip), 0);
    }
    for (size_t i = 0; i < sizeof(sync_data); i++) {
        n = slip_put(slip, n, sizeof(slip), sync_data[i]);
    }
    if (n < sizeof(slip)) {
        slip[n++] = kSlipEnd;
    }

    if (uart_write_bytes(UART_NUM_1, slip, n) < 0 ||
        uart_wait_tx_done(UART_NUM_1, pdMS_TO_TICKS(30)) != ESP_OK) {
        s_sync_diag = nullptr;
        return false;
    }

    uint8_t rx[256];
    const int got = uart_read_bytes(UART_NUM_1, rx, sizeof(rx), pdMS_TO_TICKS(80));
    bool ok = false;
    if (got > 0) {
        diag->rx_bytes += (uint32_t)got;
        bool in_pkt = false;
        uint8_t pkt[80];
        size_t pn = 0;
        bool esc = false;
        for (int i = 0; i < got; i++) {
            uint8_t b = rx[i];
            if (b == kSlipEnd) {
                if (in_pkt && pn >= 2) {
                    diag->last_dir = pkt[0];
                    diag->last_cmd = pkt[1];
                    if (pkt[0] == kDirReq && pkt[1] == kCmdSync) {
                        diag->echo_frames++;
                    } else if (pn >= 10 && pkt[0] == kDirRsp && pkt[1] == kCmdSync &&
                               pkt[pn - 2] == 0) {
                        ok = true;
                    } else {
                        diag->other_frames++;
                    }
                }
                in_pkt = true;
                pn = 0;
                esc = false;
                continue;
            }
            if (!in_pkt) {
                diag->noise_bytes++;
                continue;
            }
            if (esc) {
                if (b == kSlipEscEnd) {
                    b = kSlipEnd;
                } else if (b == kSlipEscEsc) {
                    b = kSlipEsc;
                }
                esc = false;
            } else if (b == kSlipEsc) {
                esc = true;
                continue;
            }
            if (pn < sizeof(pkt)) {
                pkt[pn++] = b;
            }
        }
    }
    diag->got_sync = diag->got_sync || ok;
    s_sync_diag = nullptr;
    return ok;
}

static bool spi_attach(HardwareSerial &uart) {
    uint8_t data[8] = {0};
    size_t resp_len = 0;
    uint8_t resp[32];
    return send_command(uart, kCmdSpiAttach, data, sizeof(data), 0, resp, sizeof(resp), &resp_len,
                        300);
}

static bool spi_set_params(HardwareSerial &uart, uint32_t flash_size) {
    uint8_t data[24];
    auto put32 = [&](int off, uint32_t v) {
        data[off + 0] = (uint8_t)(v);
        data[off + 1] = (uint8_t)(v >> 8);
        data[off + 2] = (uint8_t)(v >> 16);
        data[off + 3] = (uint8_t)(v >> 24);
    };
    put32(0, 0);           // id
    put32(4, flash_size);  // total size
    put32(8, 64 * 1024);   // block size
    put32(12, 4 * 1024);   // sector size
    put32(16, 256);        // page size
    put32(20, 0xFFFF);     // status mask
    size_t resp_len = 0;
    uint8_t resp[32];
    return send_command(uart, kCmdSpiSetParams, data, sizeof(data), 0, resp, sizeof(resp),
                        &resp_len, 300);
}

static bool flash_begin(HardwareSerial &uart, uint32_t size, uint32_t offset) {
    const uint32_t num_blocks = (size + kBlockSize - 1) / kBlockSize;
    uint8_t data[20];
    auto put32 = [&](int off, uint32_t v) {
        data[off + 0] = (uint8_t)(v);
        data[off + 1] = (uint8_t)(v >> 8);
        data[off + 2] = (uint8_t)(v >> 16);
        data[off + 3] = (uint8_t)(v >> 24);
    };
    put32(0, size);
    put32(4, num_blocks);
    put32(8, kBlockSize);
    put32(12, offset);
    put32(16, 0);  // not encrypted (ESP32-C3)
    size_t resp_len = 0;
    uint8_t resp[32];
    return send_command(uart, kCmdFlashBegin, data, sizeof(data), 0, resp, sizeof(resp), &resp_len,
                        15000);
}

static bool flash_block(HardwareSerial &uart, uint32_t seq, const uint8_t *block, uint32_t len) {
    uint8_t data[16 + kBlockSize];
    auto put32 = [&](int off, uint32_t v) {
        data[off + 0] = (uint8_t)(v);
        data[off + 1] = (uint8_t)(v >> 8);
        data[off + 2] = (uint8_t)(v >> 16);
        data[off + 3] = (uint8_t)(v >> 24);
    };
    put32(0, len);
    put32(4, seq);
    put32(8, 0);
    put32(12, 0);
    memcpy(data + 16, block, len);
    if (len < kBlockSize) {
        memset(data + 16 + len, 0xFF, kBlockSize - len);
    }
    const uint32_t payload_len = 16 + kBlockSize;
    const uint32_t cs = checksum_bytes(data + 16, kBlockSize);
    size_t resp_len = 0;
    uint8_t resp[32];
    return send_command(uart, kCmdFlashData, data, (uint16_t)payload_len, cs, resp, sizeof(resp),
                        &resp_len, 3000);
}

void esp_flasher_reboot(HardwareSerial &uart) {
    uint8_t stay[4] = {0, 0, 0, 0};  // 0 = reboot
    size_t resp_len = 0;
    uint8_t resp[32];
    send_command(uart, kCmdFlashEnd, stay, sizeof(stay), 0, resp, sizeof(resp), &resp_len, 500);
}

struct FlashSession {
    bool active;
    HardwareSerial *uart;
    uint32_t total;
    uint32_t written;
    uint32_t seq;
    uint8_t buf[kBlockSize];
    uint32_t buf_len;
};

static FlashSession s_sess = {};

static bool flush_block(bool pad) {
    if (!s_sess.active || !s_sess.uart) {
        return false;
    }
    if (s_sess.buf_len == 0) {
        return true;
    }
    if (pad && s_sess.buf_len < kBlockSize) {
        memset(s_sess.buf + s_sess.buf_len, 0xFF, kBlockSize - s_sess.buf_len);
    }
    if (!flash_block(*s_sess.uart, s_sess.seq, s_sess.buf, kBlockSize)) {
        return false;
    }
    s_sess.seq++;
    s_sess.buf_len = 0;
    return true;
}

bool esp_flasher_session_begin(HardwareSerial &uart, uint32_t size, uint32_t offset) {
    memset(&s_sess, 0, sizeof(s_sess));
    if (!spi_attach(uart)) {
        return false;
    }
    spi_set_params(uart, 4 * 1024 * 1024);
    if (!flash_begin(uart, size, offset)) {
        return false;
    }
    s_sess.active = true;
    s_sess.uart = &uart;
    s_sess.total = size;
    return true;
}

bool esp_flasher_session_write(HardwareSerial &uart, const uint8_t *data, size_t len) {
    if (!s_sess.active || s_sess.uart != &uart || !data) {
        return false;
    }
    size_t off = 0;
    while (off < len) {
        const size_t room = kBlockSize - s_sess.buf_len;
        const size_t n = (len - off) < room ? (len - off) : room;
        memcpy(s_sess.buf + s_sess.buf_len, data + off, n);
        s_sess.buf_len += (uint32_t)n;
        s_sess.written += (uint32_t)n;
        off += n;
        if (s_sess.buf_len == kBlockSize) {
            if (!flush_block(false)) {
                s_sess.active = false;
                return false;
            }
        }
    }
    return true;
}

bool esp_flasher_session_end(HardwareSerial &uart, bool reboot) {
    if (!s_sess.active || s_sess.uart != &uart) {
        return false;
    }
    if (s_sess.buf_len > 0) {
        if (!flush_block(true)) {
            s_sess.active = false;
            return false;
        }
    }
    s_sess.active = false;
    if (reboot) {
        esp_flasher_reboot(uart);
    }
    return true;
}

bool esp_flasher_flash(HardwareSerial &uart, const uint8_t *image, size_t image_len,
                       uint32_t offset, void (*progress)(size_t done, size_t total)) {
    if (!image || image_len == 0) {
        return false;
    }
    if (!esp_flasher_session_begin(uart, (uint32_t)image_len, offset)) {
        return false;
    }
    size_t sent = 0;
    while (sent < image_len) {
        const size_t chunk = (image_len - sent) > kBlockSize ? kBlockSize : (image_len - sent);
        if (!esp_flasher_session_write(uart, image + sent, chunk)) {
            return false;
        }
        sent += chunk;
        if (progress) {
            progress(sent, image_len);
        }
    }
    return esp_flasher_session_end(uart, false);
}
