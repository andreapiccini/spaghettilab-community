# Current revision: internal ADC/DAC and assisted scan (2026-10-28)

This section supersedes the historical external-converter descriptions below.
- U20-U24 and their supply/reference/filter passives removed. Native ADC taps remain on the six post-shunt PORT_A0-A5 nets.
- U14 pad29 DAC0 -> DAC_RAW; pad15 ADC_IN10 -> DAC_RAW; pad16 ADC_IN11 -> DAC_LIMITED. R77 4.7k0.1% connects RAW to LIMITED, with U13C as normally-open bypass.
- U19 pad11/10/9 <- U14 pad78/79/80 independently; inhibit pad6 <- AG81 with R71 pull-up. R78 holds bypass disabled by default.
- INA226 VBUS8 -> SHUNT_LOW_SELECTED (U18 common), shared with INA IN-9. Private INA I2C unchanged.
- No new ICs. No dedicated occupancy detector. A known return path and weak excitation are necessary; high-impedance occupied contacts can look empty.
- During scan: all MOSFETs off, digital GPIOs high-impedance, ESP switches open, R77 bypass open. Disable stimulus during selector changes. Native DAC loading/ADC settling must be tested; no analog rate or accuracy guarantee yet.
- Main PCB synchronized and placed: 140 movable parts on F.Cu; J1/J140/J3, J2 and U1 locked poses retained, J9 magnetic position retained. USB faces right. Rear U1 remains B.Cu as locked. No tracks; 472 unconnected items. Prior Lab review is superseded. Placement is preliminary and must be routed and mechanically validated.
- Current BOM/report: bom/lab-v1/index.html. Three assemblies retained; scan/INA/mux fitted in LAB, not AG_BASE or ESP_BASE.

---

## Current Base / Lab revision — 2026-10-28

This section supersedes the historical controller, camera and instrument assignments below. The current schematic is the single-page backbone.kicad_sch. See [the Base/Lab report](bom/lab-v1/index.html), [assembly variants](bom/lab-v1/assembly-variants.csv), [current AG32 physical pin table](bom/lab-v1/AG32-pins.csv) and [verification](bom/lab-v1/verification.json).

- Camera FPC J5, U9/U10 and their dedicated passives removed. Qwiic, ESP FlexyPin socket, all six A0–A5 paths, CAN transceiver, magnetic connectors, automatic termination and six RGB LEDs retained. Harwin footprints remain the mechanical reference, per user instruction; no recovered breadboard contacts have been qualified or substituted.
- USB-C defaults directly to ESP32 through R17/R18. R81/R82 stay DNP. Never populate both USB paths.
- Lab voltage acquisition: U20 ADC128S102CIMTX/NOPB, C179666; U22/U23 TLV9064IPWR, C779410; U24 REF3033AIDBZR, C36658. Six buffered post-shunt inputs, ADC IN6 monitors the buffered DAC through R97, IN7 is grounded for converter offset checks. All input voltages are single ended and within 0–3.3 V. VA/VD share the reference rail; ADC supply has its own 1uF and 100nF bypass, plus a separate digital 100nF. Buffer amplifiers run on 5 V for headroom.
- Lab DAC: U21 DAC60501ZDGSR, C1852027, SPI mode with SPI2C grounded. Supply 5 V, internal 2.5 V reference with 1uF bypass. U23C gain 1 + 3.16k/10k = 1.316, nominal unloaded full scale about 3.29 V. U19 routes to one of six pre-shunt nodes; U13C bypasses R77 for normal mode. R77 remains available for later slow component experiments. The mux and bypass resistance remain in the output path: this is a signal stimulus, not a sensor power supply. U23D is terminated as a grounded follower, not left floating.
- Dedicated Lab SPI: physical AG pins17=SCLK,33=MOSI,34=MISO,15=ADC_CS_N,16=DAC_CS_N. R103/R104 pull CS high and R105 holds SCLK low. These are intended fabric/peripheral assignments, not a compiled HDL design. ESP-facing SPI remains pins86/87/88/91; ESP programming UART/boot/reset and JTAG recovery pads retained.
- INA226 U16 still has its private AG I2C82/83 and alert84. Two 4051 muxes select both shunt terminals. The Qwiic bus remains on AG95/96 and ESP GPIO4/5; firmware must establish one bus owner. 4051 exposed pad17 remains VCORE, never GND.
- Physical automatic termination is independent of AG: J9 contact4 senses the next board through Q2/R4. The old TERM_CTRL/R30/FPC_CLK chain did not operate the relay and was camera-only; R30 was removed. AG pin1 is spare.

### Assembly variants

ESP_BASE: U25 TCA9535PWR(UMW), C22396388, C119 and R98–R102 fitted; U14, its clock/start-up/programming passives and all Lab components DNP. U25 address0x20 controls twelve MOS gates and ISO0–3. ESP GPIO13/14 control ISO4/5 through R98/R99; GPIO43/44 become CAN TX/RX through R100/R101; GPIO47 drives the RGB chain through R102. ESP is required on every board. Use 0R C17888 in R56–R61.

AG_BASE: U14 fitted; U25/C119/R98–R102 DNP; Lab components DNP. ESP optional. Use 0R C17888 in R56–R61. R78 remains FIT in every variant so the spare DAC bypass channel is held off. All six analog isolation enables retain their pullups.

LAB: U14 and Lab group fitted; U25/C119/R98–R102 DNP; six 0.1R 1% shunts C5123673 fitted. ESP optional for CAN slaves, required for the current USB/Wi-Fi path. ADC/DAC/INA/MUX parts and associated passives are omitted as a group in Base, not independently removed without a bias review.

### Firmware requirements before hardware use

1. Keep both MOSFETs off and the GPIO switches open before each mode change. Never enable both MOSFETs of one port. In ESP_BASE, keep GPIO13/14 high and write U25 output latches0x55/0xF5 before changing configuration registers to outputs.
2. Keep DAC mux inhibited and DAC bypass off during boot. Wait for DAC POR, configure GAIN for a 2.5 V DAC range (reference divide1, output buffer gain1), write a known safe code, verify the DAC monitor, then enable a selected destination. The default DAC gain is2 and must not be used blindly. At 5 V the default full scale would exceed the port domain after the external gain stage.
3. ADC128S102 uses 16 clock cycles per conversion; configure clocks within the datasheet range, validate the command/result pipeline and timestamp each channel. Six channels are sequential, not simultaneous. Characterize source impedance, settling, offset, noise and gain before advertising precision or bandwidth. Converter nominal 1 MS/s is not a validated USB/CAN streaming rate.
4. INA scan: inhibit muxes, select, enable, settle, trigger one shunt-only conversion, wait ready, read and timestamp, then change channel. Do not switch channels mid-conversion. Store per-port offset/gain calibration. Its 25uA nominal current LSB with0.1R is not system accuracy; shunt1%, mux errors, offset and temperature apply. Budget600mA is shared across the board, not available independently per port.
5. CAN slaves run locally; ESP communicates measurements/configuration over SPI. Coordinate Qwiic bus ownership before accessing external modules. No acquisition, protocol emulator, MCP server or HDL engine was implemented by this CAD revision.

### Validation and PCB status

151 connectivity checks pass and ERC has zero errors; remaining warnings are preserved in bom/lab-v1/erc.json and require library/drawing review. The update also repaired pre-existing opens in USB CC resistors, buck bootstrap/feedback and RGB chaining; original retained connected-net partitions were regression checked.

The user-saved main backbone.kicad_pcb is untouched. A separate backbone-lab-placement-review.kicad_pcb contains a preliminary top arrangement within the expanded47.9x78.3mm outer outline, side-access USB and a small3x2.5mm internal extraction opening under ESP. Locked J2/J1/J140/J3/U1 poses retained; locked U1 remains B.Cu, all movable electronics are F.Cu. Four unlocked mounting holes moved inside the outline. No tracks, routing, production approval or validated 3D mating clearances. Magnetic mating, FlexyPin spring geometry, custom LEDs, extraction access, analog layout, power and firmware still require physical validation. Historical reports below are not the current BOM.

---

# AG32 universal backbone — branch hardware/ag32-supervisor

## Single-page layout
The active schematic is now entirely in `backbone.kicad_sch`, on one custom-size page with 19 dashed functional blocks and plain-English captions. The former child `ports-ag32.kicad_sch` is retained only as an inactive historical source; it is no longer in the sheet hierarchy. The connections, references, values and footprints are unchanged. No tester components were added. PCB positions, routing and locks were not edited. The PDF at `bom/ag32-supervisor/review.pdf` reflects this layout. Earlier descriptions below of a root/child split refer to the previous layout.

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

## Readability update
The single-page layout now groups current measurement, adjustable test output and spare analog access into compact separate dashed blocks. Eighteen IC/clock sections have plain-English role captions, including an explicit note that U14A–U14G are parts of one AG32 package. Programming and spare local signals have explicit names. The page width is reduced from 1700 to 1590 mm. Electrical pin partitions were checked before/after; PCB unchanged. Removed one isolated, unconnected GND marker below the port block.

## ESP32 programming provision — current assignment
See `ESP32-AG32-PROGRAMMING.md`. ESP GPIO47/48 connect through R85/R86 to fixed AG UART0 RX69/TX68; GPIO15/16 command BOOT0/NRST through R87/R88. GPIO16 must be open-drain. ISO4/ISO5 move from AG68/69 to AG35/36. Existing SPI and JTAG are preserved. USB assembly now defaults to direct ESP (R17/R18 FIT; R81/R82 DNP), superseding the earlier AG-default description. Schematic and BOM updated; programming firmware and PCB routing are not implemented.
