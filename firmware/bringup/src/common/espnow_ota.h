#pragma once

#include <stddef.h>
#include <stdint.h>

static const uint32_t kEspNowOtaMagic = 0x574F4E42u;  // "BNOW" little-endian
static const uint8_t kEspNowOtaVersion = 1;
static const uint8_t kEspNowOtaChannel = 1;
static const size_t kEspNowOtaPayloadMax = 200;

enum EspNowOtaType : uint8_t {
    kEspNowOtaBegin = 1,
    kEspNowOtaData = 2,
    kEspNowOtaEnd = 3,
    kEspNowOtaAck = 0x80,
};

struct __attribute__((packed)) EspNowOtaPacket {
    uint32_t magic;
    uint8_t version;
    uint8_t type;
    uint16_t payload_len;
    uint32_t node_id;
    uint32_t offset;
    uint32_t image_size;
    uint32_t image_crc32;
    uint8_t status;
    uint8_t reserved[3];
    uint8_t payload[kEspNowOtaPayloadMax];
};

static const size_t kEspNowOtaHeaderSize = offsetof(EspNowOtaPacket, payload);

