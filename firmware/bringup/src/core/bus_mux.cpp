#include "bus_mux.h"

#include "slup.h"

#include <Arduino.h>
#include <driver/gpio.h>
#include <driver/twai.h>
#include <driver/uart.h>
#include <string.h>

static const int kCanRxGpio = 4;
static const int kCanTxGpio = 5;

static HardwareSerial s_uart(1);
static BusMode s_mode = BusMode::Off;
static bool s_uart_invert = false;
static bool s_idf_uart = false;

static void delay_pins() { delay(20); }

void bus_off() {
    if (s_idf_uart) {
        uart_driver_delete(UART_NUM_1);
        s_idf_uart = false;
        s_mode = BusMode::Off;
        delay_pins();
        return;
    }
    if (s_mode == BusMode::Uart) {
        s_uart.end();
    } else if (s_mode == BusMode::Twai) {
        twai_stop();
        twai_driver_uninstall();
    }
    s_mode = BusMode::Off;
    delay_pins();
}

void bus_idle() {
    bus_off();
    gpio_reset_pin((gpio_num_t)kCanTxGpio);
    gpio_reset_pin((gpio_num_t)kCanRxGpio);
    pinMode(kCanTxGpio, OUTPUT);
    digitalWrite(kCanTxGpio, HIGH);  // UART idle / CAN recessive; SN65 D must stay high
    pinMode(kCanRxGpio, INPUT);
}

bool bus_to_uart_idf(bool invert) {
    bus_off();
    uart_config_t cfg = {};
    cfg.baud_rate = (int)kUartRomBaud;
    cfg.data_bits = UART_DATA_8_BITS;
    cfg.parity = UART_PARITY_DISABLE;
    cfg.stop_bits = UART_STOP_BITS_1;
    cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    cfg.source_clk = UART_SCLK_DEFAULT;
    if (uart_driver_install(UART_NUM_1, 1024, 256, 0, nullptr, 0) != ESP_OK) {
        return false;
    }
    uart_param_config(UART_NUM_1, &cfg);
    uart_set_pin(UART_NUM_1, kCanTxGpio, kCanRxGpio, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    uart_set_line_inverse(UART_NUM_1, invert ? (UART_SIGNAL_TXD_INV | UART_SIGNAL_RXD_INV)
                                             : UART_SIGNAL_INV_DISABLE);
    s_idf_uart = true;
    s_mode = BusMode::Uart;
    s_uart_invert = invert;
    delay(20);
    return true;
}

bool bus_to_uart(bool invert) {
    if (s_mode == BusMode::Uart) {
        bus_uart_set_invert(invert);
        return true;
    }
    bus_off();
    gpio_reset_pin((gpio_num_t)kCanRxGpio);
    gpio_reset_pin((gpio_num_t)kCanTxGpio);
    s_uart.setRxBufferSize(4096);
    s_uart.setTxBufferSize(4096);
    // HardwareSerial.begin(baud, cfg, rxPin, txPin)
    // Schematic: GPIO4 = CORE_CAN_RX <- R, GPIO5 = CORE_CAN_TX -> D.
    // Do not swap: that would drive two TXs onto the bus.
    s_uart.begin(kUartRomBaud, SERIAL_8N1, kCanRxGpio, kCanTxGpio);
    s_mode = BusMode::Uart;
    bus_uart_set_invert(invert);
    delay(50);
    while (s_uart.available()) {
        s_uart.read();
    }
    return true;
}

void bus_uart_set_invert(bool invert) {
    if (s_mode != BusMode::Uart) {
        s_uart_invert = invert;
        return;
    }
    s_uart.setRxInvert(invert);
    s_uart.setTxInvert(invert);
    s_uart_invert = invert;
}

bool bus_uart_inverted() { return s_uart_invert; }

bool bus_to_twai() {
    if (s_mode == BusMode::Twai) {
        return true;
    }
    bus_off();
    twai_general_config_t g =
        TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)kCanTxGpio, (gpio_num_t)kCanRxGpio, TWAI_MODE_NORMAL);
    g.rx_queue_len = 32;
    twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
    if (twai_driver_install(&g, &t, &f) != ESP_OK) {
        return false;
    }
    if (twai_start() != ESP_OK) {
        twai_driver_uninstall();
        return false;
    }
    s_mode = BusMode::Twai;
    delay_pins();
    return true;
}

BusMode bus_mode() { return s_mode; }

HardwareSerial &bus_uart() { return s_uart; }

void bus_uart_drain_tx() {
    if (s_mode != BusMode::Uart) {
        return;
    }
    (void)uart_wait_tx_done(UART_NUM_1, pdMS_TO_TICKS(30));
}

bool twai_send(uint8_t cmd, const uint8_t *payload, uint8_t payload_len, uint32_t timeout_ms) {
    return twai_send_node(kTwaiLegacyNode, cmd, payload, payload_len, timeout_ms);
}

bool twai_send_node(uint32_t node_id, uint8_t cmd, const uint8_t *payload,
                    uint8_t payload_len, uint32_t timeout_ms) {
    if (s_mode != BusMode::Twai || payload_len > 7) {
        return false;
    }
    twai_message_t msg = {};
    const bool addressed = node_id != kTwaiLegacyNode;
    msg.identifier = addressed ? (kTwaiNodeCmdBase | (node_id & kTwaiNodeMask)) : kTwaiCmdId;
    msg.extd = addressed ? 1 : 0;
    msg.rtr = 0;
    msg.data_length_code = (uint8_t)(1 + payload_len);
    msg.data[0] = cmd;
    if (payload && payload_len) {
        memcpy(msg.data + 1, payload, payload_len);
    }
    return twai_transmit(&msg, pdMS_TO_TICKS(timeout_ms)) == ESP_OK;
}

bool twai_send_cmd(uint8_t cmd, uint32_t timeout_ms) {
    uint8_t z[7] = {0};
    return twai_send(cmd, z, 7, timeout_ms);
}

void twai_flush_rx() {
    if (s_mode != BusMode::Twai) {
        return;
    }
    twai_message_t msg = {};
    while (twai_receive(&msg, 0) == ESP_OK) {
    }
}

bool twai_recv_rsp(uint8_t *cmd, uint8_t payload[7], uint32_t timeout_ms) {
    return twai_recv_node(kTwaiLegacyNode, cmd, payload, timeout_ms);
}

bool twai_recv_node(uint32_t node_id, uint8_t *cmd, uint8_t payload[7], uint32_t timeout_ms) {
    if (s_mode != BusMode::Twai) {
        return false;
    }
    const bool addressed = node_id != kTwaiLegacyNode;
    const uint32_t expected = addressed ? (kTwaiNodeRspBase | (node_id & kTwaiNodeMask)) : kTwaiRspId;
    const uint32_t start = millis();
    do {
        twai_message_t msg = {};
        const uint32_t elapsed = millis() - start;
        const uint32_t remaining = elapsed < timeout_ms ? timeout_ms - elapsed : 0;
        if (twai_receive(&msg, pdMS_TO_TICKS(remaining)) != ESP_OK) {
            return false;
        }
        if (msg.identifier != expected || msg.extd != (addressed ? 1U : 0U) ||
            msg.data_length_code < 1) {
            // A shared bus may contain replies from other nodes. Ignore them
            // and keep waiting for the selected C3 until the original timeout.
            continue;
        }
        if (cmd) {
            *cmd = msg.data[0];
        }
        if (payload) {
            memset(payload, 0, 7);
            const size_t n = msg.data_length_code > 1 ? (size_t)(msg.data_length_code - 1) : 0;
            memcpy(payload, msg.data + 1, n > 7 ? 7 : n);
        }
        return true;
    } while (millis() - start < timeout_ms);
    return false;
}

size_t twai_discover_nodes(uint8_t *records, size_t records_cap, uint32_t timeout_ms) {
    if (s_mode != BusMode::Twai || !records || records_cap < 10) return 0;
    twai_flush_rx();
    if (!twai_send(kTwaiDiscover, nullptr, 0, 100)) return 0;
    size_t used = 0;
    const uint32_t start = millis();
    while (millis() - start < timeout_ms) {
        twai_message_t msg = {};
        if (twai_receive(&msg, pdMS_TO_TICKS(20)) != ESP_OK) continue;
        if (!msg.extd || (msg.identifier & ~kTwaiNodeMask) != kTwaiNodeRspBase ||
            msg.data_length_code != 8 || msg.data[0] != kTwaiDiscoverRsp) continue;
        const uint32_t node_id = msg.identifier & kTwaiNodeMask;
        bool duplicate = false;
        for (size_t off = 0; off + 10 <= used; off += 10) {
            const uint32_t seen = (uint32_t)records[off] | ((uint32_t)records[off + 1] << 8) |
                                  ((uint32_t)records[off + 2] << 16) | ((uint32_t)records[off + 3] << 24);
            if (seen == node_id) { duplicate = true; break; }
        }
        if (duplicate || used + 10 > records_cap) continue;
        records[used++] = (uint8_t)node_id;
        records[used++] = (uint8_t)(node_id >> 8);
        records[used++] = (uint8_t)(node_id >> 16);
        records[used++] = (uint8_t)(node_id >> 24);
        memcpy(records + used, msg.data + 2, 6);
        used += 6;
    }
    return used;
}
