#include <Arduino.h>

#include "backbone_svc.h"
#include "nfc_svc.h"
#include "rgb_cycle.h"
#include "sk6812_rmt.h"

#ifndef BACKBONE_SAFE_RECOVERY
#define BACKBONE_SAFE_RECOVERY 0
#endif

// BACKBONE ESP32-C3-MINI-1-H4X (backbone.kicad_pcb):
//   GPIO8  LED_DATA/STRAP -> SN74AHCT1G14 -> 4x SK6812MINI-E daisy chain
//   GPIO20 RX / GPIO21 TX through CAN transceiver (UART0):
//     flash/update: UART serial on the CAN PHY (S3 drives; no TWAI)
//     runtime:      TWAI 500 kbit/s (ping/reboot/status)
// No USB console on the C3.

static const int kLedGpio = 8;
static const size_t kLedCount = 4;
static const bool kInvertOut = true;

void setup() {
    sk6812_begin(kLedGpio, kLedCount, kInvertOut);
    sk6812_fill(0, 32, 0);
    sk6812_show();
    // TWAI/UART first. NFC probe is after: RFAL attachInterrupt + a stuck
    // ST25 IRQ pin used to hang in the ISR and reset the C3 in a loop.
    backbone_start();
#if !BACKBONE_SAFE_RECOVERY
    nfc_start();
#endif
}

void loop() {
    static uint32_t last_tag_led_ms = 0;
    backbone_twai_poll();
    if (!backbone_ota_busy()) {
        const uint32_t now = millis();
#if BACKBONE_SAFE_RECOVERY
        // Recovery deliberately avoids automatic RFAL/IRQ initialization.
        // This leaves TWAI and SLUP reachable even with a faulty NFC circuit.
        rgb_cycle_tick(now, 500);
#else
        nfc_tick(now);
        const uint8_t antenna = nfc_detected_antenna(now);
        if (antenna == 1) {
            if (now - last_tag_led_ms < 30) return;
            last_tag_led_ms = now;
            // Logical LED map: first pair = ANT1, second pair = ANT2.
            sk6812_set_rgb(0, 0, 48, 32);
            sk6812_set_rgb(1, 0, 48, 32);
            sk6812_set_rgb(2, 0, 0, 0);
            sk6812_set_rgb(3, 0, 0, 0);
            sk6812_show();
        } else if (antenna == 2) {
            if (now - last_tag_led_ms < 30) return;
            last_tag_led_ms = now;
            sk6812_set_rgb(0, 0, 0, 0);
            sk6812_set_rgb(1, 0, 0, 0);
            sk6812_set_rgb(2, 32, 0, 48);
            sk6812_set_rgb(3, 32, 0, 48);
            sk6812_show();
        } else {
            rgb_cycle_tick(now, 500);
        }
#endif
    }
}
