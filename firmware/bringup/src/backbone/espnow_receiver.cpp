#include "espnow_receiver.h"

#include "crc32.h"
#include "espnow_ota.h"
#include "sk6812_rmt.h"

#include <Arduino.h>
#include <Update.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <string.h>

static const uint8_t kBroadcastMac[6] = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
static portMUX_TYPE s_rx_mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool s_rx_pending = false;
static EspNowOtaPacket s_rx_packet = {};
static uint8_t s_rx_mac[6] = {};
static uint32_t s_node_id = 0;
static uint32_t s_expected_size = 0;
static uint32_t s_expected_crc = 0;
static uint32_t s_written = 0;
static uint32_t s_crc = 0xFFFFFFFFu;
static bool s_updating = false;
static uint32_t s_last_packet_ms = 0;

static void receive_cb(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
    if (!info || !data || len < (int)kEspNowOtaHeaderSize ||
        len > (int)sizeof(EspNowOtaPacket)) return;
    EspNowOtaPacket packet = {};
    memcpy(&packet, data, (size_t)len);
    if (packet.magic != kEspNowOtaMagic || packet.version != kEspNowOtaVersion ||
        packet.node_id != s_node_id || packet.payload_len > kEspNowOtaPayloadMax ||
        kEspNowOtaHeaderSize + packet.payload_len != (size_t)len) return;
    portENTER_CRITICAL(&s_rx_mux);
    if (!s_rx_pending) {
        s_rx_packet = packet;
        memcpy(s_rx_mac, info->src_addr, sizeof(s_rx_mac));
        s_rx_pending = true;
    }
    portEXIT_CRITICAL(&s_rx_mux);
}

static void ensure_peer(const uint8_t mac[6]) {
    if (esp_now_is_peer_exist(mac)) return;
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, mac, 6);
    peer.channel = kEspNowOtaChannel;
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false;
    esp_now_add_peer(&peer);
}

static void send_ack(const uint8_t mac[6], const EspNowOtaPacket &request, uint8_t status) {
    ensure_peer(mac);
    EspNowOtaPacket ack = {};
    ack.magic = kEspNowOtaMagic;
    ack.version = kEspNowOtaVersion;
    ack.type = kEspNowOtaAck;
    ack.node_id = s_node_id;
    ack.offset = request.offset;
    ack.image_size = s_written;
    ack.status = status;
    ack.reserved[0] = request.type;
    esp_now_send(mac, reinterpret_cast<const uint8_t *>(&ack), kEspNowOtaHeaderSize);
}

bool backbone_espnow_start(uint32_t node_id) {
    s_node_id = node_id;
    WiFi.mode(WIFI_STA);
    esp_wifi_set_channel(kEspNowOtaChannel, WIFI_SECOND_CHAN_NONE);
    if (esp_now_init() != ESP_OK) return false;
    return esp_now_register_recv_cb(receive_cb) == ESP_OK;
}

bool backbone_espnow_ota_busy() { return s_updating; }

void backbone_espnow_poll() {
    if (!s_rx_pending) {
        if (s_updating && millis() - s_last_packet_ms > 15000U) {
            Update.abort();
            s_updating = false;
        }
        return;
    }
    EspNowOtaPacket packet = {};
    uint8_t source[6] = {};
    portENTER_CRITICAL(&s_rx_mux);
    packet = s_rx_packet;
    memcpy(source, s_rx_mac, sizeof(source));
    s_rx_pending = false;
    portEXIT_CRITICAL(&s_rx_mux);
    s_last_packet_ms = millis();

    if (packet.type == kEspNowOtaBegin) {
        if (s_updating && packet.image_size == s_expected_size &&
            packet.image_crc32 == s_expected_crc && s_written == 0) {
            send_ack(source, packet, 0);
            return;
        }
        if (s_updating) Update.abort();
        if (!packet.image_size || !Update.begin(packet.image_size, U_FLASH)) {
            s_updating = false;
            send_ack(source, packet, 1);
            return;
        }
        s_expected_size = packet.image_size;
        s_expected_crc = packet.image_crc32;
        s_written = 0;
        s_crc = 0xFFFFFFFFu;
        s_updating = true;
        sk6812_fill(32, 16, 0);
        sk6812_show();
        send_ack(source, packet, 0);
        return;
    }

    if (!s_updating) {
        send_ack(source, packet, 2);
        return;
    }
    if (packet.type == kEspNowOtaData) {
        if (packet.offset < s_written && packet.offset + packet.payload_len <= s_written) {
            send_ack(source, packet, 0);
            return;
        }
        if (!packet.payload_len || packet.offset != s_written ||
            s_written + packet.payload_len > s_expected_size ||
            Update.write(packet.payload, packet.payload_len) != packet.payload_len) {
            Update.abort();
            s_updating = false;
            send_ack(source, packet, 3);
            return;
        }
        s_crc = crc32_ieee(packet.payload, packet.payload_len, s_crc);
        s_written += packet.payload_len;
        const uint8_t level = (uint8_t)(8 + (s_written * 40U) / s_expected_size);
        sk6812_fill(level, level, 0);
        sk6812_show();
        send_ack(source, packet, 0);
        return;
    }
    if (packet.type == kEspNowOtaEnd) {
        const bool valid = s_written == s_expected_size &&
                           (!s_expected_crc || crc32_ieee_finish(s_crc) == s_expected_crc);
        if (!valid || !Update.end(true)) {
            Update.abort();
            s_updating = false;
            send_ack(source, packet, 4);
            return;
        }
        send_ack(source, packet, 0);
        delay(300);
        esp_restart();
    }
}
