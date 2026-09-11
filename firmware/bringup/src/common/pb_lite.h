#pragma once

#include <stddef.h>
#include <stdint.h>

#include "slup.h"

enum class HostOp : uint8_t {
    None = 0,
    Ping = 10,
    GetStatus = 11,
    RebootC3 = 12,
    FlashBegin = 13,
    FlashChunk = 14,
    FlashFinish = 15,
    Nfc = 16,
    DiscoverNodes = 17,
};

struct HostMsg {
    uint32_t nonce;
    HostOp op;
    bool reboot_update;
    bool reboot_rom;
    uint32_t flash_size;
    uint32_t flash_crc32;
    uint32_t flash_offset;
    uint32_t flash_mode;
    bool uart_invert;
    uint32_t chunk_offset;
    uint8_t chunk[kUsbChunkMax];
    uint16_t chunk_len;
    uint32_t nfc_cmd;
    uint8_t nfc_payload[7];
    uint8_t nfc_payload_len;
    uint32_t node_id;
    bool node_addressed;
};

bool pb_decode_host(const uint8_t *in, size_t in_len, HostMsg *out);

size_t pb_encode_pong(uint8_t *out, size_t cap, uint32_t nonce, const char *version);
size_t pb_encode_ack(uint8_t *out, size_t cap, uint32_t nonce, bool ok, const char *msg,
                     uint32_t progress_pct, uint32_t mode_used);
size_t pb_encode_status(uint8_t *out, size_t cap, uint32_t nonce, bool c3_alive, bool uart_busy,
                        uint32_t last_error, const char *detail);
size_t pb_encode_nfc(uint8_t *out, size_t cap, uint32_t nonce, bool ok, uint32_t status,
                     uint32_t command, const uint8_t *data, size_t data_len, const char *detail);
size_t pb_encode_nodes(uint8_t *out, size_t cap, uint32_t nonce, const uint8_t *records,
                       size_t records_len);
