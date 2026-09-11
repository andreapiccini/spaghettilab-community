#include "c3_update.h"

#include "bus_mux.h"
#include "crc32.h"
#include "esp_uart_flasher.h"
#include "espnow_sender.h"
#include "slup.h"
#include "slup_io.h"

#include <Arduino.h>
#include <stdio.h>
#include <string.h>

enum class FlashKind : uint8_t { None, Rom, Slup, EspNow };

static FlashKind s_kind = FlashKind::None;
static uint32_t s_size = 0;
static uint32_t s_crc_expect = 0;
static uint32_t s_written = 0;
static uint32_t s_crc_acc = 0xFFFFFFFFu;
static const uint32_t kSlupEchoTimeoutMs = 100;
static const uint32_t kSlipEchoFailMs = 2500;
static const uint32_t kSlipMaybeTalkingMs = 8000;
static C3FlashProgressFn s_progress = nullptr;

static void note_progress(const char *msg) {
    if (s_progress && msg) {
        s_progress(msg);
    }
}


static void set_err(char *err, size_t cap, const char *msg) {
    if (err && cap) {
        strncpy(err, msg, cap - 1);
        err[cap - 1] = 0;
    }
}

static void put_u32le(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

static bool slup_wait_ok(uint32_t timeout_ms) {
    uint8_t cmd = 0;
    uint8_t pl[8];
    size_t n = 0;
    if (!slup_recv_cmd(bus_uart(), &cmd, pl, sizeof(pl), &n, timeout_ms)) {
        return false;
    }
    return cmd == kSlupCmdAck && n >= 1 && pl[0] == 0;
}

static bool try_twai_reboot(uint8_t cmd, uint32_t node_id, bool addressed) {
    if (!bus_to_twai()) {
        return false;
    }
    twai_flush_rx();
    bool sent = false;
    if (addressed && (cmd == kTwaiEnterUpdate || cmd == kTwaiRebootRom)) {
        uint8_t target[3] = {(uint8_t)node_id, (uint8_t)(node_id >> 8), (uint8_t)(node_id >> 16)};
        sent = twai_send(cmd == kTwaiEnterUpdate ? kTwaiPrepareUpdate : kTwaiPrepareRom,
                         target, sizeof(target), 200);
    } else if (addressed) {
        sent = twai_send_node(node_id, cmd, nullptr, 0, 200);
    } else {
        sent = twai_send_cmd(cmd, 200);
    }
    if (!sent) {
        return false;
    }
    uint8_t rsp = 0;
    uint8_t payload[7];
    if (addressed ? !twai_recv_node(node_id, &rsp, payload, 400)
                  : !twai_recv_rsp(&rsp, payload, 200)) {
        return false;
    }
    return rsp == kTwaiAck;
}

static bool send_magic_burst(uint32_t window_ms) {
    const uint32_t start = millis();
    while (bus_uart().available()) {
        bus_uart().read();
    }
    while (millis() - start < window_ms) {
        yield();
        if (!slup_write_magic_hd(bus_uart(), kSlupEchoTimeoutMs)) {
            continue;
        }
        if (slup_wait_bytes(bus_uart(), kSlupAck, kSlupMagicLen, 80)) {
            return true;
        }
    }
    return false;
}

static void enter_uart_flash(bool invert) {
    bus_to_uart(invert);
    delay(30);
    while (bus_uart().available()) {
        bus_uart().read();
    }
}

static void format_sync_fail(char *buf, size_t cap, const EspSlipSyncDiag &d, bool tried_invert) {
    const char *reset = " IO9=0, pulse RESET (EN=3.3 V). First flash: J15 USB-UART.";
    if (d.rx_bytes == 0) {
        snprintf(buf, cap, "RX empty: 0 bytes on GPIO4.%s", reset);
        return;
    }
    if (d.echo_frames > 0 && d.other_frames == 0) {
        snprintf(buf, cap,
                 "TX echo only (%lu frames/%lu B extra=%lu)%s. C3 ROM silent (no dir=1). "
                 "Not hung. J15: pin1 GPIO21 TX, pin2 GPIO20 RX + GND.%s",
                 (unsigned long)d.echo_frames, (unsigned long)d.rx_bytes,
                 (unsigned long)d.noise_bytes, tried_invert ? " +invert" : "", reset);
        return;
    }
    snprintf(buf, cap,
             "SLIP did not synchronize (dir=0x%02X cmd=0x%02X echo=%lu other=%lu extra=%lu).%s",
             d.last_dir, d.last_cmd, (unsigned long)d.echo_frames, (unsigned long)d.other_frames,
             (unsigned long)d.noise_bytes, reset);
}

bool c3_twai_alive(uint32_t node_id, bool addressed, uint32_t timeout_ms) {
    if (!bus_to_twai()) {
        return false;
    }
    twai_flush_rx();
    const bool sent = addressed ? twai_send_node(node_id, kTwaiPing, nullptr, 0, 100)
                                : twai_send_cmd(kTwaiPing, 100);
    if (!sent) {
        return false;
    }
    uint8_t cmd = 0;
    uint8_t payload[7];
    if (addressed ? !twai_recv_node(node_id, &cmd, payload, timeout_ms)
                  : !twai_recv_rsp(&cmd, payload, timeout_ms)) {
        return false;
    }
    return cmd == kTwaiPong;
}

bool c3_reboot(bool enter_update, bool rom_download, uint32_t node_id, bool addressed,
               char *err, size_t err_cap) {
    uint8_t cmd = kTwaiReboot;
    if (rom_download) {
        cmd = kTwaiRebootRom;
    } else if (enter_update) {
        cmd = kTwaiEnterUpdate;
    }
    if (!try_twai_reboot(cmd, node_id, addressed)) {
        set_err(err, err_cap, "C3 did not respond over TWAI (not programmed yet?)");
        return false;
    }
    set_err(err, err_cap, rom_download
                              ? "ROM_DOWNLOAD sent over TWAI"
                              : (enter_update ? "ENTER_UPDATE sent over TWAI"
                                              : "reboot sent over TWAI"));
    return true;
}

static bool s_rom_job = false;
static uint32_t s_rom_start_ms = 0;
static uint32_t s_flash_offset = 0;
static bool s_used_invert = false;
static EspSlipSyncDiag s_rom_diag = {};

static int finish_slup_ok(char *err, size_t err_cap, bool entered) {
    s_kind = FlashKind::Slup;
    set_err(err, err_cap, entered
                              ? "S3: SLUP UART GPIO5 TX / GPIO4 RX after ENTER_UPDATE"
                              : "S3: SLUP UART GPIO5 TX / GPIO4 RX (no TWAI handshake)");
    s_progress = nullptr;
    return 1;
}

int c3_flash_begin_start(const HostMsg &msg, char *err, size_t err_cap,
                         C3FlashProgressFn progress) {
    s_progress = progress;
    s_rom_job = false;
    s_kind = FlashKind::None;
    s_size = msg.flash_size;
    s_crc_expect = msg.flash_crc32;
    s_flash_offset = msg.flash_offset;
    s_written = 0;
    s_crc_acc = 0xFFFFFFFFu;
    s_used_invert = msg.uart_invert;
    if (s_size == 0) {
        s_progress = nullptr;
        set_err(err, err_cap, "size=0");
        return -1;
    }

    const uint32_t want = msg.flash_mode;
    if (want == kFlashModeEspNow) {
        if (!msg.node_addressed) {
            s_progress = nullptr;
            set_err(err, err_cap, "ESP-NOW update requires --node");
            return -1;
        }
        note_progress("ESP-NOW targeted OTA handshake");
        if (!core_espnow_begin(msg.node_id, s_size, s_crc_expect, err, err_cap)) {
            s_progress = nullptr;
            return -1;
        }
        s_kind = FlashKind::EspNow;
        set_err(err, err_cap, "S3: ESP-NOW OTA ready on Wi-Fi channel 1");
        s_progress = nullptr;
        return 1;
    }
    if (want != kFlashModeRom) {
        // Runtime C3 (bringup-0.15+): ENTER_UPDATE ACK on TWAI, then UART SLUP.
        // Older / boot-window C3: no TWAI ACK. Still try UART magic — the image
        // is never sent as CAN frames. Do not fail --slup only because TWAI missed.
        note_progress("SLUP handshake… TWAI ping then UART magic (not a hang)");
        const bool ping = c3_twai_alive(msg.node_id, msg.node_addressed, 150);
        const bool entered = try_twai_reboot(kTwaiEnterUpdate, msg.node_id, msg.node_addressed);
        if (entered) {
            delay(250);
        } else if (ping) {
            (void)try_twai_reboot(kTwaiReboot, msg.node_id, msg.node_addressed);
            delay(350);
        }
        enter_uart_flash(msg.uart_invert);
        note_progress(entered ? "SLUP UART magic after ENTER_UPDATE"
                              : "SLUP UART magic (no TWAI handshake)");
        if (send_magic_burst(want == kFlashModeSlup ? 4000 : 2000)) {
            uint8_t pl[8];
            put_u32le(pl, s_size);
            put_u32le(pl + 4, s_crc_expect);
            if (!slup_send_cmd_hd(bus_uart(), kSlupCmdBegin, pl, 8, kSlupEchoTimeoutMs) ||
                !slup_wait_ok(3000)) {
                s_progress = nullptr;
                set_err(err, err_cap, "SLUP BEGIN failed (UART-over-CAN, TWAI off)");
                return -1;
            }
            return finish_slup_ok(err, err_cap, entered);
        }
        if (want == kFlashModeSlup) {
            if (!ping) {
                set_err(err, err_cap,
                        "C3 did not respond over TWAI and no UART SLUP ACK was received. "
                        "The app is missing or not listening. Use --rom: hold IO9 low and pulse RESET.");
            } else {
                set_err(err, err_cap,
                        "ENTER_UPDATE was sent over TWAI but no UART SLUP ACK arrived. "
                        "Retry --slup within 1 s of a C3 RESET, or use --rom.");
            }
            s_progress = nullptr;
            return -1;
        }
    }

    if (want == kFlashModeRom && msg.node_addressed) {
        (void)try_twai_reboot(kTwaiRebootRom, msg.node_id, true);
        delay(250);
    }

    // CAN-UART SLIP has never gotten a C3 dir=1 ACK on this hardware (TX echo
    // only). Opening UART1 / HardwareSerial.flush() also stalled USB. Fail
    // immediately; J15 USB-UART is the first-program path.
    s_progress = nullptr;
    set_err(err, err_cap,
            "TX echo only. C3 ROM silent on CAN-UART. Use J15 USB-UART "
            "(pin1 GPIO21 TX, pin2 GPIO20 RX + GND). IO9=0, pulse RESET.");
    return -1;
}

bool c3_flash_begin_poll(uint32_t *mode_used, char *err, size_t err_cap, bool *ok) {
    if (ok) {
        *ok = false;
    }
    if (!s_rom_job) {
        if (s_kind == FlashKind::Slup || s_kind == FlashKind::EspNow) {
            if (mode_used) {
                *mode_used = s_kind == FlashKind::EspNow ? kFlashModeEspNow : kFlashModeSlup;
            }
            if (ok) {
                *ok = true;
            }
            return true;
        }
        set_err(err, err_cap, "flash session not started");
        return true;
    }

    const uint32_t elapsed = millis() - s_rom_start_ms;
    const uint32_t limit =
        (s_rom_diag.other_frames > 0) ? kSlipMaybeTalkingMs : kSlipEchoFailMs;
    if (esp_flasher_sync_once(bus_uart(), &s_rom_diag)) {
        s_rom_job = false;
        s_progress = nullptr;
        if (!esp_flasher_session_begin(bus_uart(), s_size, s_flash_offset)) {
            set_err(err, err_cap, "S3: ROM FLASH_BEGIN failed (UART-over-CAN, not USB)");
            return true;
        }
        s_kind = FlashKind::Rom;
        if (mode_used) {
            *mode_used = kFlashModeRom;
        }
        set_err(err, err_cap,
                s_used_invert
                    ? "S3: ROM C3 synchronized on inverted UART GPIO5/4 (CANH/CANL swapped?). TWAI off"
                    : "S3: ROM C3 synchronized on UART GPIO5 TX / GPIO4 RX (CAN PHY, no TWAI)");
        if (ok) {
            *ok = true;
        }
        return true;
    }

    const bool echo_only =
        s_rom_diag.echo_frames > 0 && s_rom_diag.other_frames == 0;
    if (echo_only || elapsed >= limit) {
        s_rom_job = false;
        s_progress = nullptr;
        char buf[200];
        format_sync_fail(buf, sizeof(buf), s_rom_diag, s_used_invert);
        set_err(err, err_cap, buf);
        return true;
    }

    if ((elapsed / 400) != ((elapsed - 1) / 400)) {
        char buf[96];
        snprintf(buf, sizeof(buf), "SLIP sync %lu.%lus · echo=%lu other=%lu",
                 (unsigned long)(elapsed / 1000), (unsigned long)((elapsed / 100) % 10),
                 (unsigned long)s_rom_diag.echo_frames, (unsigned long)s_rom_diag.other_frames);
        note_progress(buf);
    }
    return false;
}

bool c3_flash_chunk(const HostMsg &msg, uint32_t *progress_pct, char *err, size_t err_cap) {
    if (s_kind == FlashKind::None) {
        set_err(err, err_cap, "flash session not started");
        return false;
    }
    if (msg.chunk_len == 0) {
        set_err(err, err_cap, "empty chunk");
        return false;
    }

    // USB CDC can occasionally lose the small ACK sent back to the Mac.  The
    // host then repeats the same request.  Do not forward that block to the C3
    // twice: make FlashChunk idempotent using its absolute image offset.
    if (msg.chunk_offset < s_written &&
        msg.chunk_offset + msg.chunk_len <= s_written) {
        if (progress_pct) {
            *progress_pct = s_size ? (s_written * 100u) / s_size : 100;
        }
        set_err(err, err_cap, "chunk already written; ACK repeated");
        return true;
    }
    if (msg.chunk_offset != s_written) {
        snprintf(err, err_cap, "unexpected offset: received %lu, expected %lu",
                 (unsigned long)msg.chunk_offset, (unsigned long)s_written);
        return false;
    }

    s_crc_acc = crc32_ieee(msg.chunk, msg.chunk_len, s_crc_acc);
    if (s_kind == FlashKind::Rom) {
        if (!esp_flasher_session_write(bus_uart(), msg.chunk, msg.chunk_len)) {
            set_err(err, err_cap, "ROM FLASH_DATA failed");
            s_kind = FlashKind::None;
            return false;
        }
    } else if (s_kind == FlashKind::Slup) {
        uint8_t pl[4 + kUsbChunkMax];
        put_u32le(pl, msg.chunk_offset);
        memcpy(pl + 4, msg.chunk, msg.chunk_len);
        if (!slup_send_cmd_hd(bus_uart(), kSlupCmdData, pl, 4 + msg.chunk_len,
                              kSlupEchoTimeoutMs) ||
            !slup_wait_ok(3000)) {
            set_err(err, err_cap, "SLUP DATA failed (UART, not TWAI)");
            s_kind = FlashKind::None;
            return false;
        }
    } else if (!core_espnow_write(msg.chunk_offset, msg.chunk, msg.chunk_len,
                                  err, err_cap)) {
        s_kind = FlashKind::None;
        return false;
    }
    s_written += msg.chunk_len;
    if (progress_pct) {
        *progress_pct = s_size ? (s_written * 100u) / s_size : 100;
        if (*progress_pct > 100) {
            *progress_pct = 100;
        }
    }
    return true;
}

bool c3_flash_finish(char *err, size_t err_cap) {
    if (s_kind == FlashKind::None) {
        set_err(err, err_cap, "flash session not started");
        return false;
    }
    const uint32_t got = crc32_ieee_finish(s_crc_acc);
    if (s_crc_expect && got != s_crc_expect) {
        set_err(err, err_cap, "CRC32 mismatch on CORE");
        s_kind = FlashKind::None;
        return false;
    }
    bool ok = false;
    if (s_kind == FlashKind::Rom) {
        ok = esp_flasher_session_end(bus_uart(), true);
    } else if (s_kind == FlashKind::Slup) {
        ok = slup_send_cmd_hd(bus_uart(), kSlupCmdEnd, nullptr, 0, kSlupEchoTimeoutMs) &&
             slup_wait_ok(8000);
    } else {
        ok = core_espnow_finish(err, err_cap);
    }
    s_kind = FlashKind::None;
    if (!ok) {
        if (!err || !err[0]) set_err(err, err_cap, "flash finalization failed");
        return false;
    }
    delay(200);
    bus_idle();
    set_err(err, err_cap, "flash OK");
    return true;
}
