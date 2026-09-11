#pragma once

#include <stdint.h>

// PC  <-> S3 : USB CDC, protobuf + COBS.
// S3  <-> C3 flash/update: UART 115200 on the CAN PHY (SN65HVD230).
//              TWAI is uninstalled for the whole transfer.
// S3  <-> C3 runtime (after app is up): TWAI frames (ping/reboot/status).
//
// UART pin map matches transceiver D/R (do not swap in software):
//   S3 TX GPIO5 = CORE_CAN_TX -> D ; S3 RX GPIO4 = CORE_CAN_RX <- R
//   C3 TX GPIO21 = CAN_TX -> D     ; C3 RX GPIO20 = CAN_RX <- R
// Crossover is the shared CANH/CANL pair, not a GPIO remap.

static const uint32_t kUartRomBaud = 115200;

static const uint32_t kRtcCmdUpdate = 0x55504454u;  // 'UPDT'
static const uint32_t kRtcCmdRom = 0x524F4D31u;     // 'ROM1'

static const uint32_t kTwaiCmdId = 0x10;
static const uint32_t kTwaiRspId = 0x11;
// Extended 29-bit IDs. The low 24 bits are the stable suffix of the C3
// factory MAC; bit 24 separates commands from responses.
static const uint32_t kTwaiNodeMask = 0x00FFFFFFu;
static const uint32_t kTwaiNodeCmdBase = 0x12000000u;
static const uint32_t kTwaiNodeRspBase = 0x13000000u;
static const uint32_t kTwaiLegacyNode = 0xFFFFFFFFu;

static const uint8_t kTwaiPing = 0x01;
static const uint8_t kTwaiReboot = 0x02;
static const uint8_t kTwaiEnterUpdate = 0x03;  // switch live app from TWAI to UART SLUP
static const uint8_t kTwaiRebootRom = 0x04;
static const uint8_t kTwaiStatus = 0x05;
static const uint8_t kTwaiDiscover = 0x06;
static const uint8_t kTwaiPrepareUpdate = 0x07;
static const uint8_t kTwaiPrepareRom = 0x08;
static const uint8_t kTwaiNfcInfo = 0x20;
static const uint8_t kTwaiNfcRegRead = 0x21;
static const uint8_t kTwaiNfcRegWrite = 0x22;
static const uint8_t kTwaiNfcScan = 0x23;
static const uint8_t kTwaiNfcTagRead = 0x24;
static const uint8_t kTwaiNfcTagWrite = 0x25;
static const uint8_t kTwaiNfcUidRead = 0x26;
static const uint8_t kTwaiPong = 0x81;
static const uint8_t kTwaiAck = 0x82;
static const uint8_t kTwaiStatusRsp = 0x85;
static const uint8_t kTwaiDiscoverRsp = 0x86;
static const uint8_t kTwaiNfcInfoRsp = 0xA0;
static const uint8_t kTwaiNfcRegReadRsp = 0xA1;
static const uint8_t kTwaiNfcRegWriteRsp = 0xA2;
static const uint8_t kTwaiNfcScanRsp = 0xA3;
static const uint8_t kTwaiNfcTagReadRsp = 0xA4;
static const uint8_t kTwaiNfcTagWriteRsp = 0xA5;
static const uint8_t kTwaiNfcUidReadRsp = 0xA6;

static const uint8_t kSlupMagic[] = {'S', 'L', 'U', 'P', 0x01};
static const uint8_t kSlupAck[] = {'S', 'L', 'O', 'K', 0x01};
static const uint32_t kSlupMagicLen = 5;
static const uint8_t kSlupCmdBegin = 0x10;
static const uint8_t kSlupCmdData = 0x11;
static const uint8_t kSlupCmdEnd = 0x12;
static const uint8_t kSlupCmdAck = 0x90;
static const uint32_t kSlupBaud = kUartRomBaud;
static const uint32_t kSlupListenMs = 1200;
static const uint32_t kSlupUpdateWaitMs = 15000;

enum FlashMode : uint32_t {
    kFlashModeAuto = 0,
    kFlashModeRom = 1,   // UART SLIP to C3 ROM
    kFlashModeSlup = 2,  // UART SLUP to C3 app
    kFlashModeEspNow = 3,  // application OTA over ESP-NOW
};

static const uint16_t kUsbChunkMax = 256;
static const uint16_t kPbMax = 320;
static const uint8_t kNodeProtocolVersion = 1;
static const char kCoreVersion[] = "bringup-0.19";
