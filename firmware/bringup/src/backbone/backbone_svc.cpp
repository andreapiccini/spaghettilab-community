#include "backbone_svc.h"

#include "crc32.h"
#include "espnow_receiver.h"
#include "nfc_svc.h"
#include "sk6812_rmt.h"
#include "slup.h"
#include "slup_io.h"

#include <Arduino.h>
#include <Update.h>
#include <driver/gpio.h>
#include <driver/twai.h>
#include <esp_mac.h>
#include <esp_system.h>
#include <string.h>

#ifdef __has_include
#if __has_include("soc/rtc_cntl_reg.h")
#include "soc/rtc_cntl_reg.h"
#endif
#endif

static const int kUartRx = 20;  // GPIO20 RXD0 <- transceiver R
static const int kUartTx = 21;  // GPIO21 TXD0 -> transceiver D
static const uint32_t kSlupEchoTimeoutMs = 100;

RTC_DATA_ATTR uint32_t s_rtc_cmd = 0;
static bool s_uart_update = false;
static bool s_twai_installed = false;
static uint32_t s_quiet_until_ms = 0;
static uint32_t s_node_id = 0;
static uint8_t s_factory_mac[6] = {0};

static void backbone_twai_install();

static void put_leds(uint8_t r, uint8_t g, uint8_t b) {
    sk6812_fill(r, g, b);
    sk6812_show();
}

void backbone_jump_rom_download() {
#if defined(RTC_CNTL_OPTION1_REG) && defined(RTC_CNTL_FORCE_DOWNLOAD_BOOT)
    REG_WRITE(RTC_CNTL_OPTION1_REG, RTC_CNTL_FORCE_DOWNLOAD_BOOT);
#endif
    esp_restart();
}

static uint32_t read_u32le(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static bool slup_ack_ok() {
    const uint8_t st = 0;
    return slup_send_cmd_hd(Serial, kSlupCmdAck, &st, 1, kSlupEchoTimeoutMs);
}

static bool slup_ack_err() {
    const uint8_t st = 1;
    return slup_send_cmd_hd(Serial, kSlupCmdAck, &st, 1, kSlupEchoTimeoutMs);
}

static bool run_slup_update() {
    s_uart_update = true;
    put_leds(48, 32, 0);
    uint32_t expect_size = 0;
    uint32_t expect_crc = 0;
    uint32_t got = 0;
    uint32_t crc = 0xFFFFFFFFu;
    bool begun = false;
    uint32_t last_activity_ms = millis();

    // Limit inactivity, not total image transfer time. At 115200 baud a 1 MiB
    // SLUP image legitimately takes more than the old 120-second hard limit.
    while ((uint32_t)(millis() - last_activity_ms) < 30000U) {
        uint8_t cmd = 0;
        uint8_t pl[4 + 256];
        size_t n = 0;
        if (!slup_recv_cmd(Serial, &cmd, pl, sizeof(pl), &n, 20000)) {
            break;
        }
        if (cmd == kSlupCmdBegin) {
            if (n < 8) {
                slup_ack_err();
                continue;
            }
            expect_size = read_u32le(pl);
            expect_crc = read_u32le(pl + 4);
            if (expect_size == 0 || !Update.begin(expect_size, U_FLASH)) {
                slup_ack_err();
                continue;
            }
            begun = true;
            got = 0;
            crc = 0xFFFFFFFFu;
            last_activity_ms = millis();
            slup_ack_ok();
        } else if (cmd == kSlupCmdData) {
            if (!begun || n < 4) {
                slup_ack_err();
                continue;
            }
            const uint32_t offset = read_u32le(pl);
            uint8_t *data = pl + 4;
            const size_t dlen = n - 4;
            // Stop-and-wait retry support.  A repeated block means that the
            // previous ACK was lost; acknowledge it without writing twice.
            if (offset < got && offset + dlen <= got) {
                last_activity_ms = millis();
                slup_ack_ok();
                continue;
            }
            if (offset != got || got + dlen > expect_size) {
                slup_ack_err();
                continue;
            }
            if (Update.write(data, dlen) != dlen) {
                slup_ack_err();
                continue;
            }
            crc = crc32_ieee(data, dlen, crc);
            got += (uint32_t)dlen;
            last_activity_ms = millis();
            const uint32_t pct = expect_size ? (got * 100) / expect_size : 0;
            const uint8_t lvl = (uint8_t)(8 + (pct * 40) / 100);
            put_leds(lvl, lvl, 0);
            slup_ack_ok();
        } else if (cmd == kSlupCmdEnd) {
            if (!begun) {
                slup_ack_err();
                continue;
            }
            const uint32_t crc_got = crc32_ieee_finish(crc);
            if (expect_crc && crc_got != expect_crc) {
                Update.abort();
                slup_ack_err();
                continue;
            }
            if (!Update.end(true)) {
                slup_ack_err();
                continue;
            }
            slup_ack_ok();
            delay(50);
            put_leds(0, 48, 0);
            delay(200);
            esp_restart();
        } else {
            slup_ack_err();
        }
    }
    if (begun) {
        Update.abort();
    }
    s_uart_update = false;
    return false;
}

static bool uart_listen_and_maybe_update(bool force_wait = false) {
    const bool forced = force_wait || (s_rtc_cmd == kRtcCmdUpdate);
    if (s_rtc_cmd == kRtcCmdRom) {
        s_rtc_cmd = 0;
        backbone_jump_rom_download();
    }
    s_rtc_cmd = 0;

    gpio_reset_pin((gpio_num_t)kUartRx);
    gpio_reset_pin((gpio_num_t)kUartTx);
    Serial.setRxBufferSize(4096);
    Serial.setTxBufferSize(1024);
    Serial.begin(kSlupBaud, SERIAL_8N1, kUartRx, kUartTx);
    delay(20);

    put_leds(32, 16, 0);
    const uint32_t wait_ms = forced ? kSlupUpdateWaitMs : kSlupListenMs;
    if (slup_wait_bytes(Serial, kSlupMagic, kSlupMagicLen, wait_ms)) {
        if (!slup_write_ack_hd(Serial, kSlupEchoTimeoutMs)) {
            Serial.end();
            return false;
        }
        const bool updated = run_slup_update();
        Serial.end();
        delay(20);
        return updated;
    }
    Serial.end();
    delay(20);
    return false;
}

static void backbone_twai_install() {
    if (s_twai_installed) return;
    gpio_reset_pin((gpio_num_t)kUartRx);
    gpio_reset_pin((gpio_num_t)kUartTx);
    twai_general_config_t g =
        TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)kUartTx, (gpio_num_t)kUartRx, TWAI_MODE_NORMAL);
    g.rx_queue_len = 16;
    twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
    if (twai_driver_install(&g, &t, &f) != ESP_OK) {
        return;
    }
    if (twai_start() == ESP_OK) {
        s_twai_installed = true;
    } else {
        twai_driver_uninstall();
    }
}

static void backbone_twai_uninstall_after_tx() {
    if (!s_twai_installed) return;
    const uint32_t start = millis();
    twai_status_info_t status = {};
    while (millis() - start < 100) {
        if (twai_get_status_info(&status) == ESP_OK && status.msgs_to_tx == 0) {
            break;
        }
        delay(1);
    }
    delay(5);
    twai_stop();
    twai_driver_uninstall();
    s_twai_installed = false;
    // A quiet node must keep the transceiver input recessive while another
    // C3 owns the shared PHY as an UART link.
    gpio_reset_pin((gpio_num_t)kUartTx);
    gpio_reset_pin((gpio_num_t)kUartRx);
    pinMode(kUartTx, OUTPUT);
    digitalWrite(kUartTx, HIGH);
    pinMode(kUartRx, INPUT);
}

void backbone_start() {
    esp_read_mac(s_factory_mac, ESP_MAC_WIFI_STA);
    s_node_id = (((uint32_t)s_factory_mac[3] << 16) |
                 ((uint32_t)s_factory_mac[4] << 8) | s_factory_mac[5]) & kTwaiNodeMask;
    if (s_node_id == kTwaiNodeMask) s_node_id--;
    // ESP-NOW and TWAI use independent peripherals and remain available at
    // the same time. Either transport may start an OTA session.
    backbone_espnow_start(s_node_id);
    if (uart_listen_and_maybe_update()) {
        return;
    }
    backbone_twai_install();
}

bool backbone_ota_busy() { return s_uart_update || backbone_espnow_ota_busy(); }

void backbone_twai_poll() {
    backbone_espnow_poll();
    if (s_quiet_until_ms) {
        if ((int32_t)(millis() - s_quiet_until_ms) < 0) return;
        s_quiet_until_ms = 0;
        backbone_twai_install();
    }
    if (!s_twai_installed) return;
    twai_message_t msg = {};
    if (twai_receive(&msg, 0) != ESP_OK) {
        return;
    }
    const bool legacy = !msg.extd && msg.identifier == kTwaiCmdId;
    const bool addressed = msg.extd &&
                           msg.identifier == (kTwaiNodeCmdBase | s_node_id);
    if ((!legacy && !addressed) || msg.data_length_code < 1) {
        return;
    }
    twai_message_t rsp = {};
    rsp.identifier = addressed ? (kTwaiNodeRspBase | s_node_id) : kTwaiRspId;
    rsp.extd = addressed ? 1 : 0;
    rsp.rtr = 0;
    rsp.data_length_code = 8;
    memset(rsp.data, 0, 8);

    const auto send_rsp = [&rsp]() { twai_transmit(&rsp, pdMS_TO_TICKS(50)); };

    switch (msg.data[0]) {
        case kTwaiDiscover:
            if (!legacy) break;
            rsp.identifier = kTwaiNodeRspBase | s_node_id;
            rsp.extd = 1;
            rsp.data[0] = kTwaiDiscoverRsp;
            rsp.data[1] = kNodeProtocolVersion;
            memcpy(rsp.data + 2, s_factory_mac, sizeof(s_factory_mac));
            send_rsp();
            break;
        case kTwaiPrepareUpdate: {
            if (!legacy || msg.data_length_code < 4) break;
            const uint32_t target = ((uint32_t)msg.data[1] |
                                     ((uint32_t)msg.data[2] << 8) |
                                     ((uint32_t)msg.data[3] << 16)) & kTwaiNodeMask;
            if (target != s_node_id) {
                // UART-over-CAN is not valid CAN framing. Other nodes must
                // release TWAI or their error flags would corrupt the update.
                backbone_twai_uninstall_after_tx();
                s_quiet_until_ms = millis() + 180000U;
                break;
            }
            rsp.identifier = kTwaiNodeRspBase | s_node_id;
            rsp.extd = 1;
            rsp.data[0] = kTwaiAck;
            if (twai_transmit(&rsp, pdMS_TO_TICKS(50)) != ESP_OK) break;
            backbone_twai_uninstall_after_tx();
            uart_listen_and_maybe_update(true);
            backbone_twai_install();
            break;
        }
        case kTwaiPrepareRom: {
            if (!legacy || msg.data_length_code < 4) break;
            const uint32_t target = ((uint32_t)msg.data[1] |
                                     ((uint32_t)msg.data[2] << 8) |
                                     ((uint32_t)msg.data[3] << 16)) & kTwaiNodeMask;
            if (target != s_node_id) {
                backbone_twai_uninstall_after_tx();
                s_quiet_until_ms = millis() + 180000U;
                break;
            }
            rsp.identifier = kTwaiNodeRspBase | s_node_id;
            rsp.extd = 1;
            rsp.data[0] = kTwaiAck;
            if (twai_transmit(&rsp, pdMS_TO_TICKS(50)) != ESP_OK) break;
            backbone_twai_uninstall_after_tx();
            gpio_reset_pin((gpio_num_t)kUartRx);
            gpio_reset_pin((gpio_num_t)kUartTx);
            delay(5);
            s_rtc_cmd = kRtcCmdRom;
            backbone_jump_rom_download();
            break;
        }
        case kTwaiPing:
            rsp.data[0] = kTwaiPong;
            rsp.data[1] = 0x02;
            twai_transmit(&rsp, pdMS_TO_TICKS(50));
            break;
        case kTwaiStatus:
            rsp.data[0] = kTwaiStatusRsp;
            rsp.data[1] = 1;
            twai_transmit(&rsp, pdMS_TO_TICKS(50));
            break;
        case kTwaiNfcInfo: {
            const uint16_t irq_count = nfc_wakeup_irq_count();
            rsp.data[0] = kTwaiNfcInfoRsp;
            rsp.data[1] = nfc_ready() ? 0 : 1;
            rsp.data[2] = nfc_ic_id();
            rsp.data[3] = nfc_last_error();
            rsp.data[4] = (nfc_irq_wakeup_enabled() ? 1 : 0) |
                          (irq_count ? 2 : 0);
            rsp.data[5] = nfc_wakeup_antenna();
            rsp.data[6] = (uint8_t)irq_count;
            rsp.data[7] = (uint8_t)(irq_count >> 8);
            send_rsp();
            break;
        }
        case kTwaiNfcRegRead: {
            uint8_t value = 0;
            const uint8_t ant = (msg.data_length_code >= 3 && msg.data[2] == 2) ? 2 : 1;
            const bool ok = msg.data_length_code >= 2 && nfc_reg_read(msg.data[1], &value, ant);
            rsp.data[0] = kTwaiNfcRegReadRsp;
            rsp.data[1] = ok ? 0 : (nfc_last_error() ? nfc_last_error() : 1);
            rsp.data[2] = msg.data[1];
            rsp.data[3] = value;
            send_rsp();
            break;
        }
        case kTwaiNfcRegWrite: {
            const bool ok = msg.data_length_code >= 3 && nfc_reg_write(msg.data[1], msg.data[2]);
            rsp.data[0] = kTwaiNfcRegWriteRsp;
            rsp.data[1] = ok ? 0 : (nfc_last_error() ? nfc_last_error() : 1);
            rsp.data[2] = msg.data[1];
            rsp.data[3] = msg.data[2];
            send_rsp();
            break;
        }
        case kTwaiNfcScan: {
            if (msg.data_length_code >= 4 && msg.data[2] == 0xD2) {
                rsp.data[0] = kTwaiNfcScanRsp;
                rsp.data[1] = 0;  // Diagnostic delivered; RFAL status is in payload.
                nfc_probe(msg.data[1], msg.data[3] != 0, &rsp.data[2]);
                send_rsp();
                break;
            }
            uint8_t ant = 0, type = 0, uid_len = 0, uid[10] = {0};
            const bool found = nfc_scan(msg.data_length_code >= 2 ? msg.data[1] : 0,
                                        &ant, &type, uid, &uid_len);
            rsp.data[0] = kTwaiNfcScanRsp;
            rsp.data[1] = found ? 0 : 1;
            rsp.data[2] = ant;
            rsp.data[3] = type;
            rsp.data[4] = uid_len;
            for (uint8_t i = 0; i < 3 && i < uid_len; ++i) rsp.data[5 + i] = uid[i];
            if (!found) {
                // Versioned failure payload; successful UID frames are unchanged.
                rsp.data[2] = nfc_scan_antenna();
                rsp.data[3] = nfc_last_error();
                rsp.data[4] = nfc_scan_stage();
                rsp.data[5] = 0xD1;
            }
            send_rsp();
            break;
        }
        case kTwaiNfcUidRead: {
            uint8_t uid[10] = {0};
            const uint8_t total = nfc_cached_uid(uid, sizeof(uid));
            const uint8_t offset = msg.data_length_code >= 2 ? msg.data[1] : 0;
            rsp.data[0] = kTwaiNfcUidReadRsp;
            rsp.data[1] = offset < total ? 0 : 1;
            rsp.data[2] = total;
            rsp.data[3] = offset;
            for (uint8_t i = 0; i < 4 && offset + i < total; ++i) rsp.data[4 + i] = uid[offset + i];
            send_rsp();
            break;
        }
        case kTwaiNfcTagRead: {
            uint8_t data[4] = {0};
            const bool ok = msg.data_length_code >= 3 && nfc_tag_read(msg.data[1], msg.data[2], data);
            rsp.data[0] = kTwaiNfcTagReadRsp;
            rsp.data[1] = ok ? 0 : (nfc_last_error() ? nfc_last_error() : 1);
            rsp.data[2] = msg.data[1];
            rsp.data[3] = msg.data[2];
            memcpy(rsp.data + 4, data, 4);
            send_rsp();
            break;
        }
        case kTwaiNfcTagWrite: {
            const bool ok = msg.data_length_code == 7 &&
                            nfc_tag_write(msg.data[1], msg.data[2], msg.data + 3);
            rsp.data[0] = kTwaiNfcTagWriteRsp;
            rsp.data[1] = ok ? 0 : (nfc_last_error() ? nfc_last_error() : 1);
            rsp.data[2] = msg.data[1];
            rsp.data[3] = msg.data[2];
            if (msg.data_length_code == 7) memcpy(rsp.data + 4, msg.data + 3, 4);
            send_rsp();
            break;
        }
        case kTwaiReboot:
            rsp.data[0] = kTwaiAck;
            twai_transmit(&rsp, pdMS_TO_TICKS(50));
            delay(20);
            esp_restart();
            break;
        case kTwaiEnterUpdate:
            rsp.data[0] = kTwaiAck;
            if (twai_transmit(&rsp, pdMS_TO_TICKS(50)) != ESP_OK) {
                break;
            }
            backbone_twai_uninstall_after_tx();
            // No reboot here: receive and write the OTA image from the running app.
            // A successful SLUP END reboots once, after selecting the new partition.
            uart_listen_and_maybe_update(true);
            // Timeout/protocol/write failure: return to the normal runtime bus.
            backbone_twai_install();
            break;
        case kTwaiRebootRom:
            rsp.data[0] = kTwaiAck;
            if (twai_transmit(&rsp, pdMS_TO_TICKS(50)) != ESP_OK) {
                break;
            }
            // A CPU-only reset preserves enough peripheral/GPIO state on C3
            // to leave UART0 unreachable after FORCE_DOWNLOAD_BOOT. Release
            // TWAI and its GPIO matrix routes before entering the first-stage ROM.
            backbone_twai_uninstall_after_tx();
            gpio_reset_pin((gpio_num_t)kUartRx);
            gpio_reset_pin((gpio_num_t)kUartTx);
            delay(5);
            s_rtc_cmd = kRtcCmdRom;
            backbone_jump_rom_download();
            break;
        default:
            break;
    }
}
