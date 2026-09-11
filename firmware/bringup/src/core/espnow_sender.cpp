#include "espnow_sender.h"

#include "espnow_ota.h"

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <stdio.h>
#include <string.h>

static const uint8_t kBroadcastMac[6] = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
static portMUX_TYPE s_ack_mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool s_ack_pending = false;
static EspNowOtaPacket s_ack = {};
static uint32_t s_node_id = 0;
static uint32_t s_image_size = 0;
static uint32_t s_image_crc = 0;
static bool s_started = false;

static void set_error(char *error, size_t cap, const char *text) {
    if (!error || !cap) return;
    strncpy(error, text, cap - 1);
    error[cap - 1] = 0;
}

static void receive_cb(const esp_now_recv_info_t *, const uint8_t *data, int len) {
    if (!data || len != (int)kEspNowOtaHeaderSize) return;
    EspNowOtaPacket packet = {};
    memcpy(&packet, data, kEspNowOtaHeaderSize);
    if (packet.magic != kEspNowOtaMagic || packet.version != kEspNowOtaVersion ||
        packet.type != kEspNowOtaAck || packet.node_id != s_node_id) return;
    portENTER_CRITICAL(&s_ack_mux);
    s_ack = packet;
    s_ack_pending = true;
    portEXIT_CRITICAL(&s_ack_mux);
}

static bool initialize() {
    if (s_started) return true;
    WiFi.mode(WIFI_STA);
    esp_wifi_set_channel(kEspNowOtaChannel, WIFI_SECOND_CHAN_NONE);
    if (esp_now_init() != ESP_OK) return false;
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, kBroadcastMac, 6);
    peer.channel = kEspNowOtaChannel;
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false;
    if (esp_now_add_peer(&peer) != ESP_OK && !esp_now_is_peer_exist(kBroadcastMac)) return false;
    if (esp_now_register_recv_cb(receive_cb) != ESP_OK) return false;
    s_started = true;
    return true;
}

static bool exchange(EspNowOtaPacket &packet, char *error, size_t error_cap) {
    const size_t wire_size = kEspNowOtaHeaderSize + packet.payload_len;
    for (uint8_t attempt = 0; attempt < 8; ++attempt) {
        s_ack_pending = false;
        if (esp_now_send(kBroadcastMac, reinterpret_cast<const uint8_t *>(&packet), wire_size) != ESP_OK) {
            delay(30);
            continue;
        }
        const uint32_t start = millis();
        while (millis() - start < 500) {
            if (s_ack_pending) {
                EspNowOtaPacket ack = {};
                portENTER_CRITICAL(&s_ack_mux);
                ack = s_ack;
                s_ack_pending = false;
                portEXIT_CRITICAL(&s_ack_mux);
                if (ack.reserved[0] == packet.type && ack.offset == packet.offset) {
                    if (ack.status == 0) return true;
                    snprintf(error, error_cap, "ESP-NOW receiver error %u", ack.status);
                    return false;
                }
            }
            delay(1);
        }
    }
    set_error(error, error_cap, "ESP-NOW ACK timeout");
    return false;
}

bool core_espnow_begin(uint32_t node_id, uint32_t image_size, uint32_t image_crc32,
                       char *error, size_t error_cap) {
    if (!initialize()) {
        set_error(error, error_cap, "ESP-NOW initialization failed");
        return false;
    }
    s_node_id = node_id;
    s_image_size = image_size;
    s_image_crc = image_crc32;
    EspNowOtaPacket packet = {};
    packet.magic = kEspNowOtaMagic;
    packet.version = kEspNowOtaVersion;
    packet.type = kEspNowOtaBegin;
    packet.node_id = node_id;
    packet.image_size = image_size;
    packet.image_crc32 = image_crc32;
    return exchange(packet, error, error_cap);
}

bool core_espnow_write(uint32_t offset, const uint8_t *data, size_t length,
                       char *error, size_t error_cap) {
    if (!data || !length || length > kEspNowOtaPayloadMax) {
        set_error(error, error_cap, "invalid ESP-NOW update block");
        return false;
    }
    EspNowOtaPacket packet = {};
    packet.magic = kEspNowOtaMagic;
    packet.version = kEspNowOtaVersion;
    packet.type = kEspNowOtaData;
    packet.node_id = s_node_id;
    packet.offset = offset;
    packet.image_size = s_image_size;
    packet.image_crc32 = s_image_crc;
    packet.payload_len = (uint16_t)length;
    memcpy(packet.payload, data, length);
    return exchange(packet, error, error_cap);
}

bool core_espnow_finish(char *error, size_t error_cap) {
    EspNowOtaPacket packet = {};
    packet.magic = kEspNowOtaMagic;
    packet.version = kEspNowOtaVersion;
    packet.type = kEspNowOtaEnd;
    packet.node_id = s_node_id;
    packet.offset = s_image_size;
    packet.image_size = s_image_size;
    packet.image_crc32 = s_image_crc;
    return exchange(packet, error, error_cap);
}

