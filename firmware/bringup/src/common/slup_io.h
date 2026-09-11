#pragma once

#include <stddef.h>
#include <stdint.h>

#include <Stream.h>

bool slup_write_raw(Stream &s, const uint8_t *data, size_t n);
bool slup_write_raw_hd(Stream &s, const uint8_t *data, size_t n, uint32_t echo_timeout_ms);
bool slup_write_magic(Stream &s);
bool slup_write_ack(Stream &s);
bool slup_write_magic_hd(Stream &s, uint32_t echo_timeout_ms);
bool slup_write_ack_hd(Stream &s, uint32_t echo_timeout_ms);
bool slup_wait_bytes(Stream &s, const uint8_t *want, size_t n, uint32_t timeout_ms);
bool slup_send_cmd(Stream &s, uint8_t cmd, const uint8_t *payload, size_t payload_len);
bool slup_send_cmd_hd(Stream &s, uint8_t cmd, const uint8_t *payload, size_t payload_len,
                      uint32_t echo_timeout_ms);
bool slup_recv_cmd(Stream &s, uint8_t *cmd, uint8_t *payload, size_t cap, size_t *payload_len,
                   uint32_t timeout_ms);
