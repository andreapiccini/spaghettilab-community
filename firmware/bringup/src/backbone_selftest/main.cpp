#include <Arduino.h>
#include <SPI.h>
#include <string.h>
#include <WiFi.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <driver/gpio.h>
#include <driver/twai.h>
#include <esp_mac.h>

#include "nfc_svc.h"
#include <rfal_rfst25r200.h>

// Pin map from the open KiCad project hardware/backbone (U19 ESP32-S3-MINI-1).
// USB-C USB1 D+/D- -> R17/R18 -> GPIO20/19. STATUS LED D5 cathode = GPIO10 (active LOW).
// NFC ST25R100 U15: RST=GPIO1 CS=GPIO2 MOSI=GPIO3 SCK=GPIO4 IRQ=GPIO5 MISO=GPIO6.
// CAN SN65HVD230 U2: TX=GPIO48 RX=GPIO34. BOOT=GPIO0. Core headers: A0=38 A1=37 A2=36 A3=35.
// Terminator is analog (Q2 AO3401A + R8 120R + R4 470k), not an MCU GPIO.
// Last board: J9 TO NEXT empty → gate pulled low → 120R across CAN_H/CAN_L.

static const int kStatusLed = 10;
static const int kBoot = 0;
static const int kCanRx = 34;
static const int kCanTx = 48;
static const int kCoreGpios[] = {38, 37, 36, 35};  // A0 A1 A2 A3 on J8/J10
static const char *kCoreNames[] = {"A0 J8.2", "A1 J8.1", "A2 J10.3", "A3 J10.2"};
static const int kSpareGpios[] = {7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 21, 26, 33, 39, 40, 41, 42, 45, 46, 47};

static const uint32_t kCanPingId = 0x1A0;
static const uint32_t kCanPongId = 0x1A1;
static const uint8_t kCanPingTag = 0xA0;
static const uint8_t kCanPongTag = 0xA1;
static const uint8_t kFlagUsb = 0x01;
static const uint8_t kFlagExpectTerm = 0x02;

static bool s_ble_ok = false;
static bool s_twai_ok = false;
static bool s_usb_host = false;
static uint8_t s_mac[6] = {};
static uint8_t s_ping_seq = 0;
static uint32_t s_led_lock_until = 0;
static uint8_t s_burst_left = 0;
static uint32_t s_burst_next = 0;
static bool s_burst_on = false;
static bool s_peer_ok = false;
static uint8_t s_peer_mac[3] = {};
static uint8_t s_peer_flags = 0;

static void banner() {
    Serial.println();
    Serial.println("================================================");
    Serial.println("  SpaghettiLAB BACKBONE  ESP32-S3 self-test");
    Serial.println("  Schematic: hardware/backbone/backbone.kicad_sch");
    Serial.println("================================================");
    Serial.println("Commands:  i=ST25 chip  a=all  n=nfc/tag  l=led  c=can-ping  w=wifi  b=ble  g=gpio  h=help");
}

static void status_led(bool on) {
    digitalWrite(kStatusLed, on ? LOW : HIGH);
}

static bool usb_host_present() {
    return (bool)Serial;
}

static uint8_t local_flags() {
    uint8_t flags = 0;
    if (s_usb_host) flags |= kFlagUsb;
    // No GPIO on TERM_CTRL. On a 2-board chain the module without USB is
    // the far end: J9 TO NEXT empty → Q2 on → R8 120R across the pair.
    if (!s_usb_host) flags |= kFlagExpectTerm;
    return flags;
}

static void led_burst_start(uint8_t flashes) {
    s_burst_left = (uint8_t)(flashes * 2);
    s_burst_on = true;
    s_burst_next = millis();
    s_led_lock_until = millis() + (uint32_t)flashes * 160 + 80;
    status_led(true);
}

static void led_burst_tick(uint32_t now) {
    if (!s_burst_left || (int32_t)(now - s_burst_next) < 0) return;
    s_burst_on = !s_burst_on;
    status_led(s_burst_on);
    s_burst_next = now + 80;
    s_burst_left--;
}

static void twai_stop_bus() {
    if (!s_twai_ok) return;
    twai_stop();
    twai_driver_uninstall();
    s_twai_ok = false;
    gpio_reset_pin((gpio_num_t)kCanTx);
    gpio_reset_pin((gpio_num_t)kCanRx);
}

static bool twai_start_bus(twai_mode_t mode = TWAI_MODE_NORMAL) {
    if (s_twai_ok) twai_stop_bus();
    gpio_reset_pin((gpio_num_t)kCanTx);
    gpio_reset_pin((gpio_num_t)kCanRx);
    twai_general_config_t g =
        TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)kCanTx, (gpio_num_t)kCanRx, mode);
    g.tx_queue_len = 8;
    g.rx_queue_len = 16;
    twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
    if (twai_driver_install(&g, &t, &f) != ESP_OK) {
        Serial.println("CAN  TWAI install FAIL");
        return false;
    }
    if (twai_start() != ESP_OK) {
        twai_driver_uninstall();
        Serial.println("CAN  TWAI start FAIL");
        return false;
    }
    s_twai_ok = true;
    return true;
}

static bool can_send(uint32_t id, const uint8_t *data, uint8_t n) {
    if (!s_twai_ok) return false;
    twai_message_t msg = {};
    msg.identifier = id;
    msg.extd = 0;
    msg.data_length_code = n;
    memcpy(msg.data, data, n);
    return twai_transmit(&msg, pdMS_TO_TICKS(40)) == ESP_OK;
}

static void can_send_ping() {
    uint8_t d[8] = {
        kCanPingTag, s_ping_seq, s_mac[3], s_mac[4], s_mac[5], local_flags(), 0, 0};
    can_send(kCanPingId, d, 8);
}

static void can_send_pong(uint8_t seq) {
    twai_status_info_t st = {};
    if (s_twai_ok) twai_get_status_info(&st);
    uint8_t d[8] = {
        kCanPongTag,
        seq,
        s_mac[3],
        s_mac[4],
        s_mac[5],
        local_flags(),
        (uint8_t)(st.tx_error_counter > 255 ? 255 : st.tx_error_counter),
        (uint8_t)(st.rx_error_counter > 255 ? 255 : st.rx_error_counter)};
    can_send(kCanPongId, d, 8);
}

static void print_term_report(uint8_t remote_flags, bool have_remote) {
    Serial.println("    TERM  Q2 AO3401A + R8 120R (analog, no MCU pin)");
    Serial.println("          last board = J9 TO NEXT empty → 120R ON");
    if (s_usb_host) {
        Serial.println("    THIS  USB host — terminator ON only if J9 TO NEXT is empty");
    } else {
        Serial.println("    THIS  no USB — treating as last of chain, expect 120R ON");
    }
    if (!have_remote) return;
    const bool remote_usb = (remote_flags & kFlagUsb) != 0;
    const bool remote_term = (remote_flags & kFlagExpectTerm) != 0;
    Serial.printf("    PEER  USB=%s  expect_term=%s  MAC %02X:%02X:%02X\n",
                  remote_usb ? "yes" : "no",
                  remote_term ? "ON (last)" : "OFF (not last)",
                  s_peer_mac[0], s_peer_mac[1], s_peer_mac[2]);
    if (remote_term) {
        Serial.println("    TERM  PASS  peer says it is last and Q2/R8 should be engaged");
    } else if (remote_usb && s_usb_host) {
        Serial.println("    TERM  WARN  both ends have USB — check which J9 is empty");
    } else {
        Serial.println("    TERM  WARN  peer does not claim last-of-chain");
    }
}

static void can_handle_rx() {
    if (!s_twai_ok) return;
    twai_message_t msg = {};
    while (twai_receive(&msg, 0) == ESP_OK) {
        if (msg.extd || msg.data_length_code < 6) continue;
        if (msg.identifier == kCanPingId && msg.data[0] == kCanPingTag) {
            s_peer_ok = true;
            can_send_pong(msg.data[1]);
            led_burst_start(6);
            if (s_usb_host) {
                Serial.printf("CAN  ping from %02X:%02X:%02X  replied + D5 burst\n",
                              msg.data[2], msg.data[3], msg.data[4]);
            }
        } else if (msg.identifier == kCanPongId && msg.data[0] == kCanPongTag) {
            s_peer_ok = true;
            s_peer_mac[0] = msg.data[2];
            s_peer_mac[1] = msg.data[3];
            s_peer_mac[2] = msg.data[4];
            s_peer_flags = msg.data[5];
            led_burst_start(6);
            if (s_usb_host) {
                Serial.printf("CAN  pong seq=%u  peer %02X:%02X:%02X  flags=0x%02X  err tx/rx=%u/%u\n",
                              msg.data[1], s_peer_mac[0], s_peer_mac[1], s_peer_mac[2],
                              s_peer_flags, msg.data[6], msg.data[7]);
            }
        }
    }
}

static void test_chip() {
    Serial.println();
    Serial.println("[1] Chip / flash / USB-C");
    Serial.printf("    model     %s  rev %d  cores %d\n", ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores());
    Serial.printf("    CPU       %u MHz\n", ESP.getCpuFreqMHz());
    Serial.printf("    flash     %u KB\n", ESP.getFlashChipSize() / 1024);
    Serial.printf("    heap      %u free / %u min\n", ESP.getFreeHeap(), ESP.getMinFreeHeap());
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    Serial.printf("    Wi-Fi MAC %02X:%02X:%02X:%02X:%02X:%02X\n", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    Serial.println("    USB CDC   PASS  (USB1 via R17/R18)");
}

static void test_status_led() {
    Serial.println();
    Serial.println("[2] STATUS LED D5 on GPIO10 (active LOW)");
    for (int i = 0; i < 3; ++i) {
        status_led(true);
        Serial.println("    ON");
        delay(250);
        status_led(false);
        Serial.println("    OFF");
        delay(250);
    }
    Serial.println("    PASS if D5 blinked three times");
}

static void test_boot() {
    pinMode(kBoot, INPUT_PULLUP);
    const int level = digitalRead(kBoot);
    Serial.println();
    Serial.println("[3] BOOT on GPIO0");
    Serial.printf("    GPIO0 = %s  (released = HIGH, held = LOW)\n", level ? "HIGH" : "LOW");
}

static const char *tag_type_name(uint8_t type) {
    if (type == 1) return "NFC-A Type 2";
    if (type == 2) return "NFC-A Type 4";
    if (type == 3) return "NFC-A";
    return "none";
}

static void print_uid(const uint8_t *uid, uint8_t uid_len) {
    for (uint8_t i = 0; i < uid_len; ++i) {
        if (i) Serial.print(':');
        if (uid[i] < 16) Serial.print('0');
        Serial.print(uid[i], HEX);
    }
}

static bool read_tag_on(uint8_t antenna, bool verbose) {
    uint8_t found = 0, type = 0, uid_len = 0, uid[10] = {};
    if (!nfc_scan(antenna, &found, &type, uid, &uid_len)) {
        if (verbose) {
            Serial.printf("    ANT%d  no tag  err=0x%02X stage=%u\n",
                          antenna, nfc_last_error(), nfc_scan_stage());
        }
        return false;
    }
    Serial.printf("    ANT%d  %s  UID ", found, tag_type_name(type));
    print_uid(uid, uid_len);
    Serial.println();
    if (type != 1) return true;
    for (uint8_t page = 0; page < 8; ++page) {
        uint8_t data[4] = {};
        if (!nfc_tag_read(antenna, page, data)) {
            Serial.printf("    page %u  read FAIL  err=0x%02X\n", page, nfc_last_error());
            break;
        }
        Serial.printf("    page %u  %02X %02X %02X %02X\n", page, data[0], data[1], data[2], data[3]);
    }
    return true;
}

static uint8_t spi_read_reg(uint8_t address, uint8_t mode) {
    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, mode));
    digitalWrite(NFC_PIN_CS, LOW);
    SPI.transfer((uint8_t)(address | 0x80));
    const uint8_t value = SPI.transfer(0);
    digitalWrite(NFC_PIN_CS, HIGH);
    SPI.endTransaction();
    return value;
}

static void probe_st25_spi() {
    Serial.printf("    pins  SCK=%d MOSI=%d MISO=%d CS=%d RST=%d IRQ=%d\n",
                  NFC_PIN_SCK, NFC_PIN_MOSI, NFC_PIN_MISO, NFC_PIN_CS, NFC_PIN_RESET, NFC_PIN_IRQ);
    pinMode(NFC_PIN_CS, OUTPUT);
    digitalWrite(NFC_PIN_CS, HIGH);
    pinMode(NFC_PIN_IRQ, INPUT_PULLDOWN);
    pinMode(NFC_PIN_MISO, INPUT_PULLDOWN);
    pinMode(NFC_PIN_RESET, OUTPUT);
    SPI.begin(NFC_PIN_SCK, NFC_PIN_MISO, NFC_PIN_MOSI, NFC_PIN_CS);

    const uint8_t rst_levels[] = {LOW, HIGH};
    const char *rst_names[] = {"LOW (run if active-high RST)", "HIGH (run if active-low RST)"};
    const uint8_t modes[] = {SPI_MODE1, SPI_MODE0};
    const char *mode_names[] = {"MODE1", "MODE0"};
    for (uint8_t r = 0; r < 2; ++r) {
        digitalWrite(NFC_PIN_RESET, rst_levels[1 - r]);  // assert
        delay(3);
        digitalWrite(NFC_PIN_RESET, rst_levels[r]);  // release
        delay(20);
        pinMode(NFC_PIN_MISO, INPUT_PULLDOWN);
        const int miso = digitalRead(NFC_PIN_MISO);
        const int irq = digitalRead(NFC_PIN_IRQ);
        Serial.printf("    RST %s  MISO=%s IRQ=%s\n", rst_names[r], miso ? "HIGH" : "LOW", irq ? "HIGH" : "LOW");
        for (uint8_t m = 0; m < 2; ++m) {
            const uint8_t ic = spi_read_reg(0x3F, modes[m]);
            const uint8_t general = spi_read_reg(0x00, modes[m]);
            Serial.printf("      %s  IC_ID=0x%02X  GENERAL=0x%02X%s\n",
                          mode_names[m], ic, general,
                          ((ic & 0xF8U) == 0xA8U) ? "  <-- ST25" : "");
        }
    }
}

static void talk_st25_only() {
    Serial.println();
    Serial.println("[ST25] chip-only  U15 ST25R100  no tag, no RF field");
    Serial.printf("    SPI  SCK=%d MOSI=%d MISO=%d CS=%d RST=%d IRQ=%d\n",
                  NFC_PIN_SCK, NFC_PIN_MOSI, NFC_PIN_MISO, NFC_PIN_CS, NFC_PIN_RESET, NFC_PIN_IRQ);

    pinMode(NFC_PIN_CS, OUTPUT);
    pinMode(NFC_PIN_RESET, OUTPUT);
    pinMode(NFC_PIN_IRQ, INPUT_PULLDOWN);
    digitalWrite(NFC_PIN_CS, HIGH);
    digitalWrite(NFC_PIN_RESET, HIGH);
    delay(5);
    SPI.begin(NFC_PIN_SCK, NFC_PIN_MISO, NFC_PIN_MOSI, NFC_PIN_CS);
    digitalWrite(NFC_PIN_RESET, LOW);
    delay(10);

    static RfalRfST25R200Class rf(&SPI, NFC_PIN_CS, NFC_PIN_IRQ, NFC_PIN_RESET, 1000000);
    uint8_t id = 0xFF, general = 0xFF, operation = 0xFF;
    rf.st25r200ReadRegister(ST25R200_REG_IC_ID, &id);
    rf.st25r200ReadRegister(ST25R200_REG_GENERAL, &general);
    rf.st25r200ReadRegister(ST25R200_REG_OPERATION, &operation);
    const int irq = digitalRead(NFC_PIN_IRQ);
    Serial.printf("    driver  IC_ID=0x%02X  GENERAL=0x%02X  OPERATION=0x%02X  IRQ=%s\n",
                  id, general, operation, irq ? "HIGH" : "LOW");

    const bool ok = nfc_start();
    Serial.printf("    nfc_start  IC_ID=0x%02X  %s\n", nfc_ic_id(), ok ? "PASS" : "FAIL");
    if (ok) {
        Serial.println("    ST25R100 answers on SPI. Tag not required.");
    } else {
        Serial.println("    no MISO from U15 — chip silent (solder / 3V3 / orientation).");
    }
}

static void test_nfc() {
    Serial.println();
    Serial.println("[4] NFC ST25R100 U15  nfc_svc  SPI GPIO4/3/6 CS2 RST1 IRQ5");
    probe_st25_spi();
    if (!nfc_start()) {
        Serial.printf("    FAIL  IC_ID=0x%02X err=0x%02X  (expect 0xA8..0xAF)\n",
                      nfc_ic_id(), nfc_last_error());
        return;
    }
    Serial.printf("    IC_ID = 0x%02X  PASS  ST25 answered\n", nfc_ic_id());
    Serial.println("    polling ANT1 then ANT2 — hold a Type 2 tag on the coil");
    if (!read_tag_on(1, true)) read_tag_on(2, true);
}

static bool test_can_loopback() {
    Serial.println("    loopback  NO_ACK + self-rx (single board, message should return)");
    if (!twai_start_bus(TWAI_MODE_NO_ACK)) return false;
    s_ping_seq++;
    uint8_t d[8] = {
        kCanPingTag, s_ping_seq, s_mac[3], s_mac[4], s_mac[5], local_flags(), 0x5A, 0xA5};
    twai_message_t msg = {};
    msg.identifier = kCanPingId;
    msg.self = 1;
    msg.data_length_code = 8;
    memcpy(msg.data, d, 8);
    const bool sent = twai_transmit(&msg, pdMS_TO_TICKS(50)) == ESP_OK;
    bool got = false;
    const uint32_t start = millis();
    while ((uint32_t)(millis() - start) < 80) {
        twai_message_t rx = {};
        if (twai_receive(&rx, 0) == ESP_OK && rx.identifier == kCanPingId &&
            rx.data_length_code >= 8 && rx.data[1] == s_ping_seq) {
            got = true;
            break;
        }
        delay(2);
    }
    twai_status_info_t st = {};
    twai_get_status_info(&st);
    Serial.printf("    tx=%s  echo=%s  state=%u  tx_err=%lu  rx_err=%lu\n",
                  sent ? "ok" : "FAIL", got ? "YES" : "NO",
                  (unsigned)st.state,
                  (unsigned long)st.tx_error_counter, (unsigned long)st.rx_error_counter);
    if (got) {
        Serial.println("    PASS  frame left the PHY and came back — Q2/R8 120R is holding the bus");
        led_burst_start(3);
    } else {
        Serial.println("    FAIL  no echo. Check U2 / CAN_H / CAN_L / Q2 terminator");
    }
    twai_stop_bus();
    return got;
}

static bool test_can_phy_echo() {
    Serial.println("    PHY  GPIO48 TX -> U2 -> GPIO34 RX");
    twai_stop_bus();
    pinMode(kCanTx, OUTPUT);
    pinMode(kCanRx, INPUT);
    digitalWrite(kCanTx, HIGH);
    delay(3);
    const int rec = digitalRead(kCanRx);
    digitalWrite(kCanTx, LOW);
    delay(3);
    const int dom = digitalRead(kCanRx);
    digitalWrite(kCanTx, HIGH);
    delay(3);
    const int rec2 = digitalRead(kCanRx);
    Serial.printf("    rec=%s  dom=%s  rec=%s\n",
                  rec ? "HIGH" : "LOW", dom ? "HIGH" : "LOW", rec2 ? "HIGH" : "LOW");
    const bool echo = rec == HIGH && rec2 == HIGH && dom == LOW;
    if (echo) {
        Serial.println("    PASS  dominant came back on RX (transceiver + terminator load)");
    } else if (rec == HIGH && rec2 == HIGH) {
        Serial.println("    WARN  RX stays recessive — no terminator load or U2 not driving the pair");
    } else {
        Serial.println("    FAIL  RX idle not HIGH — check U2 / 3V3");
    }
    return echo;
}

static void test_can_ping() {
    Serial.println();
    Serial.println("[5] CAN  GPIO48 TX / GPIO34 RX  single-board term + optional peer");
    s_usb_host = usb_host_present();
    const bool phy = test_can_phy_echo();
    const bool loop = test_can_loopback();
    Serial.println("    TERM  only this board plugged → J9 TO NEXT empty → Q2 should enable R8 120R");
    if (phy && loop) {
        Serial.println("    TERM  PASS  local echo OK — terminator looks engaged");
    } else if (phy) {
        Serial.println("    TERM  WARN  PHY echo only — 120R uncertain");
    } else {
        Serial.println("    TERM  FAIL  nothing came back");
    }

    if (!twai_start_bus(TWAI_MODE_NORMAL)) {
        Serial.println("    FAIL  TWAI not up");
        return;
    }
    s_peer_ok = false;
    uint8_t hits = 0;
    for (int i = 0; i < 4; ++i) {
        s_ping_seq++;
        can_send_ping();
        const uint32_t start = millis();
        while ((uint32_t)(millis() - start) < 50) {
            can_handle_rx();
            if (s_peer_ok) break;
            delay(2);
        }
        if (s_peer_ok) {
            hits++;
            s_peer_ok = false;
        }
    }
    twai_status_info_t st = {};
    twai_get_status_info(&st);
    Serial.printf("    peer pong %u/4  (0 is normal with one board — no second ACK)\n", hits);
    if (hits) {
        Serial.println("    PASS  second backbone answered");
        print_term_report(s_peer_flags, true);
        led_burst_start(6);
    }
    s_peer_ok = hits > 0;
    // Stay in NORMAL so this node can ACK / pong if it becomes the chain slave.
}

static void test_wifi() {
    Serial.println();
    Serial.println("[6] Wi-Fi scan");
    WiFi.mode(WIFI_STA);
    WiFi.disconnect(true, true);
    delay(80);
    const int n = WiFi.scanNetworks(false, true);
    if (n < 0) {
        Serial.println("    FAIL  scan error");
        return;
    }
    Serial.printf("    found %d AP(s)\n", n);
    for (int i = 0; i < n && i < 8; ++i) {
        Serial.printf("      %s  ch %d  %d dBm\n", WiFi.SSID(i).c_str(), WiFi.channel(i), WiFi.RSSI(i));
    }
    Serial.println(n > 0 ? "    PASS" : "    WARN  no APs (radio may still be OK)");
    WiFi.scanDelete();
    WiFi.mode(WIFI_OFF);
}

static void test_ble() {
    Serial.println();
    Serial.println("[7] BLE advertise  'SL-BB-TEST'");
    if (!s_ble_ok) {
        BLEDevice::init("SL-BB-TEST");
        BLEDevice::createServer();
        BLEAdvertising *adv = BLEDevice::getAdvertising();
        adv->setScanResponse(true);
        adv->start();
        s_ble_ok = true;
    }
    Serial.println("    PASS  advertising (scan with a phone)");
}

static void test_gpio() {
    Serial.println();
    Serial.println("[8] Core headers J8/J10 (INPUT_PULLUP)");
    for (size_t i = 0; i < sizeof(kCoreGpios) / sizeof(kCoreGpios[0]); ++i) {
        pinMode(kCoreGpios[i], INPUT_PULLUP);
        delayMicroseconds(50);
        Serial.printf("    GPIO%02d  %s  %s\n", kCoreGpios[i], digitalRead(kCoreGpios[i]) ? "HIGH" : "LOW ",
                      kCoreNames[i]);
    }
    Serial.println("    unused S3 pads (INPUT_PULLUP, expect HIGH if floating)");
    for (int gpio : kSpareGpios) {
        pinMode(gpio, INPUT_PULLUP);
        delayMicroseconds(50);
        Serial.printf("    GPIO%02d  %s\n", gpio, digitalRead(gpio) ? "HIGH" : "LOW ");
    }
}

static void run_all() {
    test_chip();
    test_status_led();
    test_boot();
    test_nfc();
    test_can_ping();
    test_wifi();
    test_ble();
    test_gpio();
    Serial.println();
    Serial.println("Done. Place a tag on ANT1. D5 stays on while a tag is present.");
}

static void report_tag(uint8_t antenna, uint8_t type, const uint8_t *uid, uint8_t uid_len) {
    Serial.printf("TAG ANT%d %s UID ", antenna, tag_type_name(type));
    print_uid(uid, uid_len);
    Serial.println();
}

static bool s_seen_ant1 = false;
static bool s_seen_ant2 = false;

static void note_antenna(uint8_t antenna, uint8_t type, const uint8_t *uid, uint8_t uid_len) {
    if (antenna == 1 && !s_seen_ant1) {
        s_seen_ant1 = true;
        report_tag(1, type, uid, uid_len);
    } else if (antenna == 2 && !s_seen_ant2) {
        s_seen_ant2 = true;
        report_tag(2, type, uid, uid_len);
    } else if (antenna == 1 || antenna == 2) {
        report_tag(antenna, type, uid, uid_len);
    }
    if (s_seen_ant1 && s_seen_ant2) {
        Serial.println("BOTH_ANTENNAS_OK");
    }
}

void setup() {
    pinMode(kStatusLed, OUTPUT);
    status_led(true);
    Serial.begin(115200);
    delay(400);
    s_usb_host = usb_host_present();
    esp_read_mac(s_mac, ESP_MAC_WIFI_STA);
    banner();
    Serial.printf("CAN  role %s  MAC %02X:%02X:%02X:%02X:%02X:%02X\n",
                  s_usb_host ? "USB leader (will ping)" : "follower (pong + D5 burst)",
                  s_mac[0], s_mac[1], s_mac[2], s_mac[3], s_mac[4], s_mac[5]);
    twai_start_bus(TWAI_MODE_NORMAL);
    talk_st25_only();
    if (nfc_ready() || nfc_start()) {
        nfc_listen_start();
        Serial.println("LISTEN  IRQ wakeup on ANT1/ANT2 — present a tag on each coil");
    }
}

void loop() {
    while (Serial.available()) {
        const int c = Serial.read();
        if (c == 'a' || c == 'A') run_all();
        else if (c == 'i' || c == 'I') talk_st25_only();
        else if (c == 'l' || c == 'L') test_status_led();
        else if (c == 'n' || c == 'N' || c == 't' || c == 'T') test_nfc();
        else if (c == 'c' || c == 'C') test_can_ping();
        else if (c == 'w' || c == 'W') test_wifi();
        else if (c == 'b' || c == 'B') test_ble();
        else if (c == 'g' || c == 'G') test_gpio();
        else if (c == 'h' || c == 'H' || c == '?') banner();
    }

    static uint32_t last_led = 0;
    static uint32_t last_poll = 0;
    static uint32_t last_auto_ping = 0;
    static bool auto_ping_done = false;
    static uint8_t last_ant = 0;
    static uint8_t last_uid[2][10] = {};
    static uint8_t last_uid_len[2] = {};
    const uint32_t now = millis();

    s_usb_host = usb_host_present();
    can_handle_rx();
    led_burst_tick(now);
    if (s_usb_host && s_twai_ok && !auto_ping_done && now > 1500) {
        auto_ping_done = true;
        last_auto_ping = now;
        Serial.println("CAN  auto ping to the other backbone…");
        test_can_ping();
    } else if (s_usb_host && s_twai_ok && s_peer_ok && now - last_auto_ping >= 2000) {
        last_auto_ping = now;
        s_ping_seq++;
        can_send_ping();
    }

    nfc_tick(now);
    const uint8_t irq_ant = nfc_detected_antenna(now);
    if (irq_ant == 1 || irq_ant == 2) {
        uint8_t uid[10] = {};
        const uint8_t uid_len = nfc_cached_uid(uid, sizeof(uid));
        const uint8_t type = nfc_cached_tag_type();
        const uint8_t slot = (uint8_t)(irq_ant - 1);
        bool same = last_ant == irq_ant && uid_len == last_uid_len[slot];
        for (uint8_t i = 0; same && i < uid_len; ++i) same = uid[i] == last_uid[slot][i];
        if (!same && uid_len) {
            memcpy(last_uid[slot], uid, uid_len);
            last_uid_len[slot] = uid_len;
            last_ant = irq_ant;
            note_antenna(irq_ant, type, uid, uid_len);
        }
    }

    if (nfc_ready() && now - last_poll >= 350) {
        last_poll = now;
        for (uint8_t ant = 1; ant <= 2; ++ant) {
            uint8_t found = 0, type = 0, uid_len = 0, uid[10] = {};
            if (!nfc_scan(ant, &found, &type, uid, &uid_len) || !uid_len) continue;
            const uint8_t slot = (uint8_t)(ant - 1);
            bool same = uid_len == last_uid_len[slot];
            for (uint8_t i = 0; same && i < uid_len; ++i) same = uid[i] == last_uid[slot][i];
            if (same && ((ant == 1 && s_seen_ant1) || (ant == 2 && s_seen_ant2))) continue;
            memcpy(last_uid[slot], uid, uid_len);
            last_uid_len[slot] = uid_len;
            last_ant = ant;
            note_antenna(ant, type, uid, uid_len);
        }
        nfc_listen_start();
    }

    if (s_burst_left || (int32_t)(now - s_led_lock_until) < 0) {
        return;
    }
    if (now - last_led >= 400) {
        last_led = now;
        if (s_seen_ant1 && s_seen_ant2 && !s_peer_ok) status_led(true);
        else status_led((now / 400) % 2 == 0);
    }
}
