#pragma once

#include <stddef.h>
#include <stdint.h>

#include <HardwareSerial.h>

// Minimal ESP ROM UART bootloader client (esptool-style, no stub).
// Used by CORE to program BACKBONE over UART-through-CAN at 115200.
//
// SN65HVD230 echoes D onto R: GPIO4 always sees a copy of GPIO5 TX.
// The client skips that half-duplex echo and only accepts dir=1 replies.

struct EspSlipSyncDiag {
    uint32_t rx_bytes;
    uint32_t echo_frames;   // SLIP dir=0 (local TX copy)
    uint32_t other_frames;  // SLIP that is not echo and not SYNC OK
    uint32_t noise_bytes;   // RX bytes that were not 0xC0 / SLIP payload
    uint8_t last_dir;
    uint8_t last_cmd;
    bool got_sync;
};

typedef void (*EspSlipSyncTick)(const EspSlipSyncDiag *diag, uint32_t elapsed_ms);

// Sync C3 ROM. Aborts after ~2 s if RX is only half-duplex TX echo (dir=0).
bool esp_flasher_sync(HardwareSerial &uart, uint32_t timeout_ms, EspSlipSyncDiag *diag = nullptr,
                      EspSlipSyncTick tick = nullptr);
// One SYNC attempt (~400 ms). Used so USB/WDT can run between tries.
bool esp_flasher_sync_once(HardwareSerial &uart, EspSlipSyncDiag *diag);
bool esp_flasher_flash(HardwareSerial &uart, const uint8_t *image, size_t image_len,
                       uint32_t offset, void (*progress)(size_t done, size_t total));
void esp_flasher_reboot(HardwareSerial &uart);

bool esp_flasher_session_begin(HardwareSerial &uart, uint32_t size, uint32_t offset);
bool esp_flasher_session_write(HardwareSerial &uart, const uint8_t *data, size_t len);
bool esp_flasher_session_end(HardwareSerial &uart, bool reboot);
