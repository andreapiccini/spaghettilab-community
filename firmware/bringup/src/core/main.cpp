#include <Arduino.h>

#include "bus_mux.h"
#include "c3_update.h"
#include "cobs.h"
#include "pb_lite.h"
#include "rgb_cycle.h"
#include "sk6812_rmt.h"
#include "slup.h"

// CORE ESP32-S3-MINI-1 (core.kicad_pcb):
//   GPIO5  CORE_CAN_TX -> SN65HVD230 D
//   GPIO4  CORE_CAN_RX <- SN65HVD230 R
//   GPIO34 LED_DATA    -> 74AHCT1G14 -> 1x SK6812
//   GPIO19/20 native USB CDC (protobuf + COBS) — PC <-> S3 only
// TO_NEXT: 5V, GND, CANH, CANL, TERM_CTRL — no EN/BOOT to BACKBONE.
// S3 <-> C3: UART on GPIO5 TX / GPIO4 RX during flash (TWAI uninstalled).
// Idle: GPIO5 held high, TWAI off — no periodic traffic (needed for C3 ROM UART).
// TWAI only for explicit ping/status/reboot; UART only during flash.

static const int kLedGpio = 34;
static const bool kInvertOut = true;

static uint8_t s_usb_rx[400];
static size_t s_usb_n = 0;
static uint32_t s_last_error = 0;
static bool s_flash_busy = false;
static uint32_t s_flash_mode_used = 0;
static bool s_rom_bridge_pending = false;
static bool s_rom_bridge_active = false;
static uint32_t s_flash_begin_nonce = 0;
static bool s_flash_begin_pending = false;

static void rom_bridge_start() {
    bus_to_uart(false);
    s_rom_bridge_active = true;
    sk6812_fill(0, 0, 48);
    sk6812_show();
}

static void rom_bridge_poll() {
    HardwareSerial &uart = bus_uart();
    uint8_t tx[256];
    size_t n = 0;
    while (Serial.available() && n < sizeof(tx)) {
        const int c = Serial.read();
        if (c >= 0) {
            tx[n++] = (uint8_t)c;
        }
    }
    if (n) {
        uart.write(tx, n);
        uart.flush();
    }
    uint8_t rx[256];
    size_t r = 0;
    while (uart.available() && r < sizeof(rx)) {
        const int c = uart.read();
        if (c >= 0) {
            rx[r++] = (uint8_t)c;
        }
    }
    if (r) {
        Serial.write(rx, r);
        Serial.flush();
    }
}

static void usb_send(const uint8_t *pb, size_t n) {
    uint8_t frame[400];
    const size_t flen = cobs_encode_frame(pb, n, frame, sizeof(frame));
    if (flen) {
        Serial.write(frame, flen);
        // Do not Serial.flush(): TinyUSB flush can block the Arduino loop
        // forever after the host already has the packet (flash_begin hang).
    }
}

static void reply_ack(uint32_t nonce, bool ok, const char *msg, uint32_t pct, uint32_t mode) {
    uint8_t pb[kPbMax];
    const size_t n = pb_encode_ack(pb, sizeof(pb), nonce, ok, msg, pct, mode);
    if (n) {
        usb_send(pb, n);
    }
}

// Intermediate flash_begin frames: ok=true, mode_used=0. Final success sets the transport mode.
static void flash_begin_progress(const char *msg) {
    reply_ack(s_flash_begin_nonce, true, msg ? msg : "working", 0, 0);
}

static void reply_nfc(uint32_t nonce, bool ok, uint32_t status, uint32_t command,
                      const uint8_t *data, size_t data_len, const char *detail) {
    uint8_t pb[kPbMax];
    const size_t n = pb_encode_nfc(pb, sizeof(pb), nonce, ok, status, command,
                                   data, data_len, detail);
    if (n) usb_send(pb, n);
}

static void reply_nodes(uint32_t nonce, const uint8_t *records, size_t records_len) {
    uint8_t pb[kPbMax];
    const size_t n = pb_encode_nodes(pb, sizeof(pb), nonce, records, records_len);
    if (n) usb_send(pb, n);
}

static void handle_host(const HostMsg &msg) {
    char err[200] = {0};
    switch (msg.op) {
        case HostOp::Ping: {
            uint8_t pb[kPbMax];
            const size_t n = pb_encode_pong(pb, sizeof(pb), msg.nonce, kCoreVersion);
            if (n) {
                usb_send(pb, n);
            }
            break;
        }
        case HostOp::GetStatus: {
            bool alive = false;
            const char *detail = "no-c3";
            if (s_flash_busy) {
                detail = "flash in progress (TWAI mux unavailable)";
            } else {
                alive = c3_twai_alive(msg.node_id, msg.node_addressed, 250);
                detail = alive ? "twai" : "no-c3";
                bus_idle();
            }
            uint8_t pb[kPbMax];
            const size_t n = pb_encode_status(pb, sizeof(pb), msg.nonce, alive, s_flash_busy,
                                              s_last_error, detail);
            if (n) {
                usb_send(pb, n);
            }
            break;
        }
        case HostOp::RebootC3: {
            // Both flags mean local bridge-only mode. The C3 may already be in
            // ROM and therefore cannot acknowledge another TWAI command.
            if (msg.reboot_update && msg.reboot_rom) {
                bus_idle();
                reply_ack(msg.nonce, true, "raw ROM bridge ready", 0, 0);
                s_rom_bridge_pending = true;
                break;
            }
            const bool ok = c3_reboot(msg.reboot_update, msg.reboot_rom,
                                      msg.node_id, msg.node_addressed, err, sizeof(err));
            s_last_error = ok ? 0 : 1;
            bus_idle();
            reply_ack(msg.nonce, ok, err, 0, 0);
            break;
        }
        case HostOp::FlashBegin: {
            s_flash_busy = true;
            s_flash_begin_pending = false;
            s_flash_begin_nonce = msg.nonce;
            sk6812_fill(48, 32, 0);
            sk6812_show();
            const int st = c3_flash_begin_start(msg, err, sizeof(err), flash_begin_progress);
            if (st == 0) {
                flash_begin_progress("SLIP sync… (USB stays alive)");
                s_flash_begin_pending = true;
                break;
            }
            const bool ok = st > 0;
            s_flash_mode_used = ok ? msg.flash_mode : 0;
            s_last_error = ok ? 0 : 2;
            if (!ok) {
                s_flash_busy = false;
                bus_idle();
            }
            reply_ack(msg.nonce, ok, err, 0, s_flash_mode_used);
            break;
        }
        case HostOp::FlashChunk: {
            uint32_t pct = 0;
            const bool ok = c3_flash_chunk(msg, &pct, err, sizeof(err));
            s_last_error = ok ? 0 : 3;
            if (ok) {
                const uint8_t level = (uint8_t)(8 + (pct * 40) / 100);
                sk6812_fill(level, level, 0);
                sk6812_show();
            } else {
                s_flash_busy = false;
                bus_idle();
            }
            reply_ack(msg.nonce, ok, err, pct, s_flash_mode_used);
            break;
        }
        case HostOp::FlashFinish: {
            const bool ok = c3_flash_finish(err, sizeof(err));
            s_flash_busy = false;
            bus_idle();
            s_last_error = ok ? 0 : 4;
            sk6812_fill(ok ? 0 : 48, ok ? 48 : 0, 0);
            sk6812_show();
            reply_ack(msg.nonce, ok, err, 100, s_flash_mode_used);
            break;
        }
        case HostOp::Nfc: {
            uint8_t rsp_cmd = 0;
            uint8_t rsp_payload[7] = {0};
            bool ok = bus_to_twai();
            if (ok) {
                twai_flush_rx();
                ok = msg.node_addressed
                         ? twai_send_node(msg.node_id, (uint8_t)msg.nfc_cmd,
                                          msg.nfc_payload, msg.nfc_payload_len, 100)
                         : twai_send((uint8_t)msg.nfc_cmd, msg.nfc_payload,
                                     msg.nfc_payload_len, 100);
            }
            if (ok) {
                const uint32_t nfc_timeout_ms =
                    (msg.nfc_cmd == kTwaiNfcScan ||
                     msg.nfc_cmd == kTwaiNfcTagRead ||
                     msg.nfc_cmd == kTwaiNfcTagWrite)
                        ? 8000U
                        : 3000U;
                ok = msg.node_addressed
                         ? twai_recv_node(msg.node_id, &rsp_cmd, rsp_payload, nfc_timeout_ms)
                         : twai_recv_rsp(&rsp_cmd, rsp_payload, nfc_timeout_ms);
            }
            bus_idle();
            if (!ok) {
                reply_nfc(msg.nonce, false, 255, msg.nfc_cmd, nullptr, 0,
                          "no NFC response from C3");
                break;
            }
            const uint32_t status = rsp_payload[0];
            reply_nfc(msg.nonce, status == 0, status, rsp_cmd,
                      rsp_payload + 1, 6, status == 0 ? "ok" : "NFC operation failed");
            break;
        }
        case HostOp::DiscoverNodes: {
            uint8_t records[200] = {0};
            size_t records_len = 0;
            if (bus_to_twai()) records_len = twai_discover_nodes(records, sizeof(records), 600);
            bus_idle();
            reply_nodes(msg.nonce, records, records_len);
            break;
        }
        default:
            reply_ack(msg.nonce, false, "unknown operation", 0, 0);
            break;
    }
}

static void poll_usb() {
    while (Serial.available()) {
        const int c = Serial.read();
        if (c < 0) {
            break;
        }
        if (s_usb_n < sizeof(s_usb_rx)) {
            s_usb_rx[s_usb_n++] = (uint8_t)c;
        } else {
            s_usb_n = 0;
        }
        if ((uint8_t)c != 0x00) {
            continue;
        }
        uint8_t decoded[kPbMax];
        const size_t dlen = cobs_decode_frame(s_usb_rx, s_usb_n, decoded, sizeof(decoded));
        s_usb_n = 0;
        HostMsg msg;
        if (dlen == 0 || !pb_decode_host(decoded, dlen, &msg)) {
            reply_ack(0, false, "invalid COBS/protobuf frame", 0, 0);
            continue;
        }
        handle_host(msg);
    }
}

void setup() {
    Serial.begin(115200);
    delay(300);
    sk6812_begin(kLedGpio, 1, kInvertOut);
    sk6812_fill(0, 0, 32);
    sk6812_show();
    bus_idle();
}

void loop() {
    if (s_rom_bridge_active) {
        rom_bridge_poll();
        return;
    }
    poll_usb();
    if (s_rom_bridge_pending) {
        s_rom_bridge_pending = false;
        delay(100);
        rom_bridge_start();
        return;
    }
    if (s_flash_begin_pending) {
        char err[200] = {0};
        uint32_t mode = 0;
        bool ok = false;
        if (c3_flash_begin_poll(&mode, err, sizeof(err), &ok)) {
            s_flash_begin_pending = false;
            s_flash_mode_used = mode;
            s_last_error = ok ? 0 : 2;
            if (!ok) {
                s_flash_busy = false;
                bus_idle();
            }
            reply_ack(s_flash_begin_nonce, ok, err, 0, mode);
        }
    }
    if (!s_flash_busy) {
        rgb_cycle_tick(millis(), 500);
    }
}
