#pragma once

#include <HardwareSerial.h>
#include <stddef.h>
#include <stdint.h>

enum class BusMode : uint8_t { Off = 0, Uart = 1, Twai = 2 };

bool bus_to_uart(bool invert = false);
// IDF UART1 with timed TX/RX. Avoids HardwareSerial.flush()/write() hangs.
bool bus_to_uart_idf(bool invert = false);
void bus_uart_set_invert(bool invert);  // both TX and RX (CANH/CANL swap)
bool bus_uart_inverted();
bool bus_to_twai();
void bus_off();
void bus_idle();  // no TWAI, TX GPIO5 held high (recessive). Quiet until a command.
BusMode bus_mode();
HardwareSerial &bus_uart();
void bus_uart_drain_tx();  // timed; HardwareSerial.flush() can block forever

bool twai_send_cmd(uint8_t cmd, uint32_t timeout_ms);
bool twai_send(uint8_t cmd, const uint8_t *payload, uint8_t payload_len, uint32_t timeout_ms);
bool twai_recv_rsp(uint8_t *cmd, uint8_t payload[7], uint32_t timeout_ms);
bool twai_send_node(uint32_t node_id, uint8_t cmd, const uint8_t *payload,
                    uint8_t payload_len, uint32_t timeout_ms);
bool twai_recv_node(uint32_t node_id, uint8_t *cmd, uint8_t payload[7], uint32_t timeout_ms);
size_t twai_discover_nodes(uint8_t *records, size_t records_cap, uint32_t timeout_ms);
void twai_flush_rx();
