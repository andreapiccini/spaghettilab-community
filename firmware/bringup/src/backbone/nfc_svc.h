#pragma once

#include <stddef.h>
#include <stdint.h>

// ST25R100 on SPI: SCK=10, MOSI=18, MISO=19, CS=6, IRQ=5, RESET=7.
// PCB routing: physical antenna 1 uses RFO2/RFI2; antenna 2 uses RFO1/RFI1.
bool nfc_start();
void nfc_tick(uint32_t now_ms);
bool nfc_ready();
uint8_t nfc_ic_id();
uint8_t nfc_last_error();
uint8_t nfc_scan_stage();
uint8_t nfc_scan_antenna();
// Raw 7-bit NFC-A probe: version, flags, RFAL status, RX bits, ATQA[2].
void nfc_probe(uint8_t antenna, bool wupa, uint8_t result[6]);
bool nfc_irq_wakeup_enabled();
uint8_t nfc_wakeup_antenna();
uint16_t nfc_wakeup_irq_count();

bool nfc_reg_read(uint8_t address, uint8_t *value);
bool nfc_reg_write(uint8_t address, uint8_t value);

// antenna: 0 or 1 = physical ANT1 (silkscreen ANT1 = ST25R100 RFO2/RFI2),
//          2 = physical ANT2 (RFO1/RFI1). Default is ANT1.
// tag_type: 0 = none, 1 = NFC-A T2T, 2 = NFC-A T4T, 3 = other NFC-A.
bool nfc_scan(uint8_t antenna, uint8_t *found_antenna, uint8_t *tag_type,
              uint8_t *uid, uint8_t *uid_len);
bool nfc_tag_read(uint8_t antenna, uint8_t page, uint8_t data[4]);
bool nfc_tag_write(uint8_t antenna, uint8_t page, const uint8_t data[4]);

uint8_t nfc_detected_antenna(uint32_t now_ms);
uint8_t nfc_cached_tag_type();
uint8_t nfc_cached_uid(uint8_t *uid, uint8_t cap);
