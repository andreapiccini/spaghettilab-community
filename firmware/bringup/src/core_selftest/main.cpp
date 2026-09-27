#include <Arduino.h>
#include <WiFi.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <esp_chip_info.h>
#include <esp_flash.h>
#include <esp_mac.h>

#include "sk6812_rmt.h"

// Pin map from hardware/core/core.kicad_sch + core.kicad_pcb (U19 ESP32-S3-MINI-1).
// USB_D+/D- = GPIO20/19 (native CDC). LED_DATA = GPIO34 via SN74AHCT1G14 (invert!).
// CAN: GPIO5 = CORE_CAN_TX -> SN65HVD230 D, GPIO4 = CORE_CAN_RX <- R (local echo).
// SW2 BOOT = GPIO0. PROG J17 = GPIO43 TX / GPIO44 RX. Link Bay J8 = GPIO35..42,45..48.

static const int kLedGpio = 34;
static const int kCanRx = 4;
static const int kCanTx = 5;
static const int kBoot = 0;
static const int kBayGpios[] = {35, 36, 37, 38, 39, 40, 41, 42, 45, 46, 47, 48};

static bool s_ble_ok = false;

static void banner() {
    Serial.println();
    Serial.println("================================================");
    Serial.println("  SpaghettiLAB CORE  ESP32-S3 self-test");
    Serial.println("  Schematic: hardware/core/core.kicad_sch");
    Serial.println("================================================");
    Serial.println("Commands:  a=all  r=rgb  c=can  w=wifi  b=ble  g=gpio  h=help");
}

static void test_chip() {
    Serial.println();
    Serial.println("[1] Chip / flash / USB");
    Serial.printf("    model     %s  rev %d  cores %d\n", ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores());
    Serial.printf("    CPU       %u MHz\n", ESP.getCpuFreqMHz());
    Serial.printf("    flash     %u KB\n", ESP.getFlashChipSize() / 1024);
    Serial.printf("    PSRAM     %u KB\n", ESP.getPsramSize() / 1024);
    Serial.printf("    heap      %u free / %u min\n", ESP.getFreeHeap(), ESP.getMinFreeHeap());
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    Serial.printf("    Wi-Fi MAC %02X:%02X:%02X:%02X:%02X:%02X\n", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    Serial.println("    USB CDC   PASS  (you are reading this)");
}

static void test_rgb() {
    Serial.println();
    Serial.println("[2] SK6812 on GPIO34 (inverter U10 — look at the CORE LED)");
    const uint8_t colors[][3] = {{48, 0, 0}, {0, 48, 0}, {0, 0, 48}, {48, 48, 48}, {0, 0, 0}};
    const char *names[] = {"RED", "GREEN", "BLUE", "WHITE", "OFF"};
    for (int i = 0; i < 5; ++i) {
        sk6812_fill(colors[i][0], colors[i][1], colors[i][2]);
        sk6812_show();
        Serial.printf("    %s\n", names[i]);
        delay(400);
    }
    Serial.println("    PASS if the on-board ARGB stepped through those colors");
}

static void test_boot() {
    pinMode(kBoot, INPUT_PULLUP);
    const int level = digitalRead(kBoot);
    Serial.println();
    Serial.println("[3] BOOT SW2 on GPIO0");
    Serial.printf("    GPIO0 = %s  (released = HIGH, held = LOW)\n", level ? "HIGH" : "LOW");
}

static void test_can_echo() {
    Serial.println();
    Serial.println("[4] CAN PHY echo  GPIO5 TX -> SN65HVD230 -> GPIO4 RX");
    gpio_reset_pin((gpio_num_t)kCanTx);
    gpio_reset_pin((gpio_num_t)kCanRx);
    pinMode(kCanTx, OUTPUT);
    pinMode(kCanRx, INPUT);
    digitalWrite(kCanTx, HIGH);
    delay(5);
    const int rec = digitalRead(kCanRx);
    digitalWrite(kCanTx, LOW);
    delay(5);
    const int dom = digitalRead(kCanRx);
    digitalWrite(kCanTx, HIGH);
    delay(5);
    const int rec2 = digitalRead(kCanRx);
    const bool ok = rec == HIGH && rec2 == HIGH;
    Serial.printf("    TX recessive HIGH -> RX=%s\n", rec ? "HIGH" : "LOW");
    Serial.printf("    TX dominant  LOW  -> RX=%s  (local echo often stays HIGH if bus is open)\n",
                  dom ? "HIGH" : "LOW");
    Serial.printf("    TX recessive HIGH -> RX=%s\n", rec2 ? "HIGH" : "LOW");
    if (ok) {
        Serial.println("    PASS  transceiver is driving RX (idle/recessive seen)");
    } else {
        Serial.println("    FAIL  GPIO4 did not follow recessive HIGH — check U21 / 3V3 / CAN wiring");
    }
    if (dom == LOW) {
        Serial.println("    note: dominant echoed — bus or terminator is loading the pair");
    }
}

static void test_wifi() {
    Serial.println();
    Serial.println("[5] Wi-Fi scan");
    WiFi.mode(WIFI_STA);
    WiFi.disconnect(true, true);
    delay(80);
    const int n = WiFi.scanNetworks(/*async=*/false, /*hidden=*/true);
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
    Serial.println("[6] BLE advertise  'SL-CORE-TEST'");
    if (!s_ble_ok) {
        BLEDevice::init("SL-CORE-TEST");
        BLEServer *server = BLEDevice::createServer();
        (void)server;
        BLEAdvertising *adv = BLEDevice::getAdvertising();
        adv->setScanResponse(true);
        adv->start();
        s_ble_ok = true;
    }
    Serial.println("    PASS  advertising (scan with a phone)");
}

static void test_bay_gpio() {
    Serial.println();
    Serial.println("[7] Link Bay J8 GPIOs (INPUT_PULLUP)");
    for (int gpio : kBayGpios) {
        pinMode(gpio, INPUT_PULLUP);
        delayMicroseconds(50);
        const int v = digitalRead(gpio);
        Serial.printf("    GPIO%02d  %s\n", gpio, v ? "HIGH" : "LOW ");
    }
    Serial.println("    floating pins should read HIGH; a short to GND reads LOW");
}

static void run_all() {
    test_chip();
    test_rgb();
    test_boot();
    test_can_echo();
    test_wifi();
    test_ble();
    test_bay_gpio();
    Serial.println();
    Serial.println("Done. RGB returns to slow cycle. Type h for commands.");
}

void setup() {
    Serial.begin(115200);
    delay(400);
    sk6812_begin(kLedGpio, 1, /*invert_out=*/true);
    sk6812_fill(0, 0, 24);
    sk6812_show();
    banner();
    run_all();
}

void loop() {
    while (Serial.available()) {
        const int c = Serial.read();
        if (c == 'a' || c == 'A') run_all();
        else if (c == 'r' || c == 'R') test_rgb();
        else if (c == 'c' || c == 'C') test_can_echo();
        else if (c == 'w' || c == 'W') test_wifi();
        else if (c == 'b' || c == 'B') test_ble();
        else if (c == 'g' || c == 'G') test_bay_gpio();
        else if (c == 'h' || c == 'H' || c == '?') banner();
    }

    static uint32_t last = 0;
    const uint32_t now = millis();
    if (now - last >= 800) {
        last = now;
        const uint8_t phase = (now / 800) % 3;
        if (phase == 0) sk6812_fill(32, 0, 0);
        else if (phase == 1) sk6812_fill(0, 32, 0);
        else sk6812_fill(0, 0, 32);
        sk6812_show();
    }
}
