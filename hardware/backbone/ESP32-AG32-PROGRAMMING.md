# ESP32 → AG32 programming provision

Active target: AG32VF407VGT6, LQFP100. This change prepares the schematic, not the PCB routing or the ESP firmware.

| ESP32-S3 GPIO / module pad | Series part | AG32 physical pin | Purpose |
|---|---|---|---|
| GPIO47 / 24 (TX) | R85 1k | 69 UART0_RX | Host-to-ROM data |
| GPIO48 / 25 (RX) | R86 1k | 68 UART0_TX | ROM-to-host data |
| GPIO15 / 8 | R87 1k | 94 BOOT0 | Push-pull HIGH for ROM; LOW/Hi-Z for application |
| GPIO16 / 9 | R88 1k | 14 NRST | Open-drain LOW or Hi-Z only |

BOOT1 pin37 retains R84 10k to ground. BOOT0 retains R83 10k pulldown; NRST retains R72 10k pullup and C92 100nF. Thus a missing/reset ESP does not intentionally select the ROM. Verify reset defaults and timing on a prototype.

ROM programming UART is fixed: AG68 TX and AG69 RX. ISO_A4_N and ISO_A5_N therefore move to AG35/36, retaining existing R54/R55 bias and TP45/46 as control test points. The ADC functions of those two formerly spare pins must be disabled when used as GPIO. Update VE/RTL mapping accordingly. Configure application UART0 on the same two pins if used after boot; ROM operation does not depend on valid user logic.

SPI CS/SCLK/MOSI/MISO (AG86/87/88/91), IRQ/reset-to-ESP, all A0-A5 signals, six gate pairs, and JTAG TP23-27 are preserved. TP22 retains NRST. New TP47/48/49 expose AG UART RX/TX/BOOT0; existing ground and 3V3 points remain. External tools must leave ESP programming GPIOs Hi-Z or remove the ESP. Series resistors limit accidental contention but do not make opposing drivers valid. Use 3.3V serial logic.

USB default now uses the already existing ESP path: fit R17/R18; do not fit R81/R82. To select native AG USB instead, reverse the assembly option; never populate both paths. No automatic USB switch added. No physical PCB placement/routing changed by this schematic update.

## Firmware sequence to implement
1. Keep ESP GPIO16 open-drain released; establish GPIO15 LOW and GPIO47/48 as the programming UART.
2. Set BOOT0 HIGH, assert AG NRST LOW, then release NRST with BOOT0 held HIGH, respecting AG reset/boot timing.
3. Use AGM SDK `examples/uart_master` / `uart_smart.c` protocol: ROM autobaud probe 0x7F, ACK 0x79, query and programming commands. Port the actual SDK driver rather than assuming compatibility with another vendor's uploader.
4. Factory programming includes code, logic and optionFlash information. The vendor example supports code and logic updates, including compressed logic; it does not support encrypted binaries.
5. After success, set BOOT0 LOW, pulse NRST, release GPIO16, and resume SPI communications. Normal field updates over CAN need their own firmware and recovery plan; not implemented here.

The ROM route can recover an AG with invalid user firmware/logic. Keep JTAG and boot/reset access for independent hardware recovery. No firmware, FPGA build or physical upload test has been performed.

## Sources
- https://www.agmcn.com/doc/6819.html — programming from another MCU; SDK uart_master example and ROM protocol
- https://www.ag32mcu.com/dev-docs/doc_ag32_hardware_design_considerations/ — fixed UART0 and BOOT conditions
- AG32 MCU Reference Manual 1.2, LQFP100 table: UART TX68/RX69, NRST14, BOOT0 94, BOOT1 37
