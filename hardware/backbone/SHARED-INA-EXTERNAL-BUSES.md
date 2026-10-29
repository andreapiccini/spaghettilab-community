# Shared INA226 and external buses — 2026-10-29

## Implemented hardware

INA226 U16 SDA/SCL now connect to IO4/IO5: ESP32 GPIO4/5, AG32 pins95/96, U25, Qwiic J4 pins3/4 and FPC J5 pins17/18. INA226 address is 0x40 (A0=A1=GND); U25 is 0x20. External I2C modules must use non-conflicting addresses. Existing R24/R25 4.7k pull-ups retained; R79/R80 no longer load the I2C bus. AG82/83 are now disconnected, available only after device pin-mux validation. INA ALERT remains on AG84; ESP uses polling of registers/conversion-ready status, so no extra IRQ GPIO is consumed.

This gives either CPU register access, but does NOT permit unsynchronized simultaneous control. One firmware owner at a time, with the inactive CPU releasing SDA/SCL. Neither CPU may reset or recalibrate the INA while the other is acquiring.

## Current scan works without AG32

Sharing I2C alone was insufficient: U17/U18 would remain inhibited without AG32. Their four controls now also connect to ESP32:

| Control | ESP32 GPIO / module pad | AG32 physical pin | FPC J5 |
|---|---|---|---|
| S0 | 6 / 6 | 2 | 3 |
| S1 | 12 / 20 | 3 | 5 |
| S2 | 41 / 34 | 4 | 15 |
| INHIBIT | 42 / 35 | 5 | 16 |

Both CPUs MUST use open-drain outputs (or LOW/input emulation), never opposing push-pull outputs. Inactive owner leaves all four inputs/high-impedance. R79/R80 reused as 10k pull-ups on S0/S1; R107 10k added for S2; R70 changed to10k for inhibit. Default select111 and inhibit HIGH isolates current inputs. Firmware sequence: inhibit HIGH, set select, settle, inhibit LOW, allow analog settling, discard any in-progress INA conversion, trigger a new conversion and wait until conversion-ready before reading. An initial100us analog settling budget is only a firmware starting point and must be validated against real RC/INA configuration. Shared INA calibration, channel and conversion state must belong to the same owner; no concurrent scans.

No new ICs. Reused three existing resistors and added R107 (10k0402 C25744) plus R108 (100k0402 C25741) for external CS. Extra material is two resistors, a budget belowUS$0.01/board excluding MOQ/assembly, not a refreshed order quote. Current-shunt/mux/INA parts remain optional LAB population; Base BOMs still omit current sensing. A LAB assembly can omit AG32 and retain current sensing via ESP32; internal AG32 ADC/DAC and FPGA functions then remain unavailable. This change does not share all other AG32 functions automatically.

## External SPI retained

| SPI signal | ESP32 GPIO / module pad | FPC J5 |
|---|---|---|
| SCLK | 14 / 22 | 19 |
| MOSI | 43 / 37 | 20 |
| MISO | 44 / 36 | 21 |
| External CS_N | 11 / 19 | 4 |

SCLK/MOSI/MISO share the existing AG32 SPI bus. AG32 uses its separate GPIO13 CS; external device uses GPIO11, pulled HIGH by R108. ESP remains bus master; AG32 and external modules must tri-state MISO whenever their own CS is HIGH. The two slaves are scheduled, not simultaneous independent SPI buses; no spare controller or high-speed guarantee is claimed. Firmware must support different per-device SPI modes/clocks as needed. GPIO43/44 cannot simultaneously serve default UART0 logging. The former AG spare FPC pins19–21 are reassigned to SPI; AG17/33/34 remain reachable on TP42/43/44. A0–A5, J3, boot/programming paths and USB unchanged. Qwiic remains externally accessible at the board edge.

## Limits / checks

No mounted-but-independently-unpowered CPU isolation, hot-swap or automatic firmware handover implemented. Both CPUs and switches use the same powered3V3 rail. Multi-controller bus and mux ownership still require firmware and bench tests. Current sampling rate/precision are not improved by this wiring change. PCB remains unrouted; all existing footprint positions and locks preserved, only two new top resistors placed.

Sources: [TI INA226](https://www.ti.com/lit/ds/symlink/ina226.pdf), [Espressif SPI master / shared bus](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/spi_master.html), [R107 C25744](https://www.lcsc.com/product-detail/C25744.html), [R108 C25741](https://www.lcsc.com/product-detail/C25741.html). Pin mappings also checked against saved netlist and PCB pad nets. No powered test performed.

## Final saved verification

909 CAD assertions passed, including648 schema-to-PCB pad matches and preservation of every existing footprint position/lock. ERC: zero errors,262 warnings. DRC unchanged at611 findings; no pad clearance/short/courtyard-overlap findings.499 unrouted connections; zero tracks/vias.16 netclasses and127 explicit assignments. See `bom/lab-v1/shared-ina-verification.json`. These are static CAD checks, not a firmware or powered-board test.
