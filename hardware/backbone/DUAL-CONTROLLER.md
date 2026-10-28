# Dual-controller peripheral control — 2026-10-29

Implemented in schematic and unrouted PCB; firmware still required.

| Assembly | Peripheral owner |
|---|---|
| ESP32 fitted, AG32 omitted | ESP32; AG_READY pulled low |
| AG32 fitted, ESP32 absent | AG32 asserts AG_READY after safe initialization |
| Both fitted | AG32 after explicit firmware handover; SPI stays dedicated |
| Neither fitted / initial reset | MOSFET gates biased off; ISO paths pulled disabled; CAN TX recessive, LED data low, termination command low |

## Connections

U26–U30 are TI SN74LVC1G3157DCKR (LCSC C38663), SC70-6. Datasheet pinout checked: 1=B2/AG, 2=GND, 3=B1/ESP, 4=common, 5=3V3, 6=select. LOW selects ESP; HIGH selects AG. Each has a 100 nF bypass capacitor C125–C129 (C1525). R103–R106 bias ownership, CAN TX, LED data and termination. Standard KiCad SC70 footprint and 3D model; custom local symbol verified against TI, not claimed to be downloaded from LCSC.

| Function | ESP32 GPIO / module pad | AG32 physical pin | Selector / output |
|---|---|---|---|
| CAN TX | GPIO17 / 10 | 92 | U26 / CAN_TX |
| CAN RX | GPIO18 / 11 | 93 | U2 RX fans out to both |
| RGB chain | GPIO21 / 23 | 7 | U27 / ALED |
| Port P5 isolation | GPIO39 / 32 | 35 | U28 / ISO_A4_N |
| Port P6 isolation | GPIO40 / 33 | 36 | U29 / ISO_A5_N |
| CAN automatic termination command | GPIO38 / 31 | 1 | U30 / TERM_CTRL |
| Ownership | input via existing SPI protocol; no extra ESP pin | 52 | AG_READY, R103 100k pulldown |
| MOSFET gates + P1–P4 isolation | GPIO4 SDA / GPIO5 SCL | 95 SDA / 96 SCL | U25 shared I2C, address 0x20 |

U25 and C124 are fitted in all automatic variants. AG32 pins53–67 no longer connect directly to expander outputs; they are unassigned and require device pin-mux validation before reuse. Removed R98–R102 old ESP-only bridges: do not refit them. A0–A5, J3, programming UART/boot/reset, SPI and measurement circuitry retained. FPC pins7/8/9/11/12/13 now explicitly share the six ESP control signals above; external modules must not drive them against the onboard functions.

## Firmware contract

1. At reset leave CPU pins inputs. U25 reset state is inputs; the existing gate resistors establish OFF. It must be initialized even in AG-only builds.
2. AG initializes CAN TX HIGH, LED LOW, ISO4/5 HIGH and the required termination state before asserting READY. ESP keeps its competing outputs quiet during discovery. No blind simultaneous I2C initialization: use request/acknowledge over SPI when both are fitted, or establish the known assembly mode.
3. Before changing owner, stop CAN transmission, set both sources recessive, disable port paths, stop LED transmission, put both I2C engines idle, and transfer expander state. Only then change AG_READY. Both sources use open-drain I2C with one active master. The expander has no watchdog and retains its last output latch on CPU reset; firmware must explicitly restore a safe state.
4. If AG resets READY returns LOW and ESP must reinitialize before use; transparent failover during active traffic is not guaranteed. A stuck READY high is not automatically detected by this circuit.

This supports omitted/absent controllers sharing the same powered 3V3 rail. A mounted but independently unpowered controller is NOT isolated by this design: CAN RX, I2C, SPI and other paths can back-power it. No hot removal, independent power-gating or glitch-free live switching claim. Neither firmware nor a powered prototype has been tested.

## Incremental BOM / space

Five C38663 selectors: LCSC snapshot $0.0742 each at5+, $0.0466 at500+, $0.0416 at3000+ (five per board; 1000 boards buy5000). Total selectors $0.371 for a small batch, $0.208 at1000boards. Nine small 0402 passives add approximately $0.02–0.05 per board as a budget, not a quoted basket. Budget ~US$0.40–0.43 small batch and ~US$0.23–0.26 per1000board, excluding assembly, tax, freight, MOQ overbuy. AG/Lab variants additionally now fit existing U25+C124; this incremental expander cost must be added to those historical variant totals. No unchanged whole-board cost claim.

Selectors occupy about21mm² of package envelopes (2.0×2.1mm each including leads), plus nine passives, courtyard/routing space. Board outline unchanged. New parts on top; locked footprints, LED positions and connectors unchanged. Some unlocked small parts repacked. No routing added.

Sources checked2026-10-29: [TI datasheet](https://www.ti.com/lit/ds/symlink/sn74lvc1g3157.pdf), [C38663 / LCSC](https://www.lcsc.com/product-image/C38663.html), [100nF C1525](https://www.lcsc.com/product-detail/C1525.html), [100k C25741](https://www.lcsc.com/product-detail/C25741.html), [47k C25792](https://www.lcsc.com/product-detail/C25792.html).

## Saved CAD verification

237 logical connectivity assertions and646 schematic-to-PCB pad matches passed. Locked footprints, all connectors and LED positions unchanged; 40 unlocked small footprints repositioned. Final ERC: zero errors,274 warnings. DRC:611 findings including existing FlexyPin annular, magnetic edge-copper and silkscreen issues; no pad clearance/short/courtyard overlap findings.499 unrouted connections, zero tracks/vias. See `bom/lab-v1/dual-controller-final-verification.json`; successful CAD checks do not qualify a production board.
