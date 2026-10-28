# AG32 universal backbone — branch hardware/ag32-supervisor

## Scope
AG32VF407VGT6 (LCSC C5336269, LQFP100) replaces MSPM0G3507 U14, standalone FPGA U15 and XL9535 U11. U14 is now the combined MCU/programmable-logic/ADC/DAC supervisor. The six A0–A5 native ESP32 nets and J3/J1/J140 assignments are preserved. The optional ESP32 remains on the existing FlexyPin socket. No firmware or HDL has been built by this schematic change.

**Package decision:** the 64-pin C5336267 was imported for comparison but is not the active part. All requested functions require six ESP-side FPGA inputs, six pre-shunt FPGA I/O, six post-shunt ADC inputs, twelve gate controls, six analog bypass enables, USB, CAN, SPI, I2C, mux controls and programming. The 100-pin part keeps these functions without adding another GPIO expander. Its 14x14mm body / roughly 16mm leads is larger: no PCB fit or area saving is claimed. If 64 pins are mandatory, reduce functions or reconsider external expansion before layout.

## Connections and ownership
- Root schematic: existing MOSFETs, connectors and analog bypass. Child `ports-ag32.kicad_sch`: U14A..G grouped by function, local INA/current mux wiring, DAC mux/reference, power/reset/boot/clock/programming.
- A0–A5 -> AG32 pins38–43 (monitor ESP-side signals); FPGA drivers pins44/45/46/47/48/51 -> N_A0–5, BEFORE six shunts; ADC pins23/24/25/26/31/32 -> PORT_A0–5 AFTER shunts. All three points stay distinct.
- U12/U13 stay fitted: they provide real analog bidirectional ESP bypass and U13C also bypasses R77. A digital FPGA cannot replace an analog ADC path. The six bypasses are controlled individually by U14 pins64–69. In FPGA mode they are open; ESP and AG outputs must not contend. Six wire-compatible digital bridges are intended, not a generic analog matrix.
- Twelve P/N gate commands now come exclusively from U14 pins52–63; original gate bias resistors remain. P gate HIGH=off, N gate LOW=off. Safe initial latch levels and dead time are firmware requirements.
- CAN: U14 pin92 TX -> U2 pin1; U14 pin93 RX <- U2 pin4. ESP CAN GPIO47/48 are NC on this branch. Termination control from U14 pin1; LED chain from pin7. Thus CAN/termination/LEDs do not require ESP.
- ESP coprocessor link: U14 pin86 CS <- ESP GPIO13; pin87 SCLK <- GPIO14; pin88 MOSI <- GPIO43; pin91 MISO -> GPIO44. Pin97 -> ESP GPIO3 as open-drain IRQ; pin98 -> ESP EN as open-drain reset only. Do not actively drive EN high. ESP remains bus controller in this proposed link; autonomous USB/CAN mode does not require it.
- External Qwiic/FPC I2C: U14 pin95 SDA and pin96 SCL share IO4/IO5 with the optional ESP. Elect one bus controller; the other stays Hi-Z/slave as explicitly configured. It is not automatically multi-controller-safe firmware.
- INA226 kept at address0x40, VBUS grounded, private AG32 I2C on pins82/83, ALERT84. U17/U18 share select pins2/3/4 and inhibit5. Mux common high/low to INA VIN+/VIN-. Firmware must inhibit, select, settle and acquire. Calibration and timestamps needed.
- DAC0 pin29 -> R77 4.7k0.1% -> U19 common. U14 pin15 reads raw, pin16 reads limited. U13C bypass /OE from pin85, R78 pulls high. U19 selects78/79/80 and inhibit81. DAC is10bit, not TI12bit. DAC1 pin30 is a spare test pad. No complete LCR or high-current analog generator is implied.
- USB default: U14 fixed pins70 DM /71 DP -> R81/R82 22ohm -> existing USB connector. ESP USB R17/R18 are DNP. To use direct ESP USB, omit R81/R82 and populate R17/R18: never fit both pairs. USB VBUS is not connected to a non-5V-tolerant AG GPIO. TinyUSB/clock/attach behavior requires firmware qualification.
- AG32 pins6/11/28/50/75/100/22/21 to VCORE3V3; ground10/20/27/74/99. Existing power architecture unchanged. BOOT0 and BOOT1 have separate10k pulldowns, NRST10k pullup/100nF, JTAG pads and JNTRST pullup. CLK20M from existing X1 to OSC_IN12 and proposed fabric input18. Confirm global-clock routing and PLL/USB clock configuration in VE/HDL; no timing claim.
- 4051 exposed pad17 remains VCC. It must not be assumed GND.

## CAD provenance
Symbol, footprint and STEP/VRML source: LCSC/EasyEDA C5336269 imported with easyeda2kicad. The functional symbol is a regrouping of that100-pin symbol; every physical pin is preserved exactly once and checked against the AGM manual LQFP100 table. Signal names describe this board's intended VE/RTL configuration, not power-on/default alternate functions. Original vendor symbols are also retained for traceability. Imported CAD is not a substitute for physical validation. New footprint/model paths are project-relative.

## Variants and limitations
This branch supersedes the old Manual/Base/Pro controller assignment. The universal supervisor is always fitted; ESP is an optional module. The current default schematic includes the measurement set. A lower-cost assembly omitting INA/mux/reference requires an explicit DNP/bias review before production; do not reuse the old TI variant BOM as authoritative.

The PCB is byte-identical to the snapshot taken before this change, including all locked positions, tracks and outline. It has NOT been updated from this new schematic. Existing U11 footprint and old connectivity on the board need deliberate update, placement and routing; do not fabricate the board from this branch yet. No front-side fit has been demonstrated.

KiCad netlist and ERC verified; child has zero ERC violations. Root retains10 pre-existing dangling-wire errors and109 warnings in this snapshot. HDL/VE pin mapping, MCU peripheral multiplexing, toolchain licensing, safe reset/power-up, programming, USB enumeration, CAN, analog accuracy, SPI timing and firmware port remain untested.

## Files
- `ports-ag32.kicad_sch`: active child sheet; obsolete TI/Q32 child removed from hierarchy.
- `bom/ag32-supervisor/AG32-pins.csv`: all100 actual netlist pin connections.
- `bom/ag32-supervisor/bom-ag32.csv`: populated component list with historical batch1000 prices/allowances.
- `bom/ag32-supervisor/verification.json`: connectivity and preservation checks.
- `bom/ag32-supervisor/review.pdf`: review-only schematic export.

## Primary references
- https://www.lcsc.com/zh-CN/product-detail/C5336269.html
- https://www.agm-micro.com/products.aspx?id=3117&p=37
- https://www.agm-micro.com/upload/userfiles/files/AG32_DATASHEET_202303.pdf
- https://www.agm-micro.com/upload/userfiles/files/AGRV2K_Rev_3_0.pdf
- https://www.ag32mcu.com/dev-docs/doc_ag32_fpga_cpld_start/
