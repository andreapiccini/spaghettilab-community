> Current consolidated CAD status (2026-10-29): see [CURRENT-REVISION.md](CURRENT-REVISION.md). Earlier coordinates, J3 ordering, cost and placement statements below are historical and may be superseded. No mezzanine is implemented.

# AG32 branch supersedes the controller variants below

See [AG32 supervisor](AG32-SUPERVISOR.md) and [current report](bom/ag32-supervisor/index.html). Active part is AG32VF407VGT6 C5336269, 100 pins. Historical TI/Q32 pin maps and variant prices below do not describe this branch.

---

# Dedicated TI current acquisition — 2026-10-28

This revision supersedes older statements below about the INA on the shared ESP32 I2C bus, FPGA current-mux selection and the DAC monitor pin.

- INA226 U16 SDA4/SCL5 now connect only to U14 PA16/pin31 I2C1_SDA and PA17/pin32 I2C1_SCL, PF4. Dedicated nets INA_I2C_SDA / INA_I2C_SCL, pull-ups R79/R80=4.7k (0603WAF4701T5E, LCSC C23162). Both are Pro-only. Start firmware at 100kHz and qualify faster speeds against capacitance/rise time and the INA specification. TI is the only controller on this private bus; INA address remains 0x40. Its ALERT still goes to U14 pin5 PA31.
- ESP32 GPIO4/5, Qwiic/FPC, XL9535 Base and TI I2C0 PA0/PA1 wiring are unchanged. Do not enable TI as a competing controller on that bus. TI I2C0 can remain Hi-Z during acquisition and support a deliberately configured bootloader/slave use later. Programming/reset recovery is not implemented by this change.
- Free PA16 for I2C by moving DAC_RAW monitoring from U14 pin31 to PB19/pin38 ADC1_CH6. DAC_LIMITED monitoring stays PA26/pin46 ADC0_CH1. Raw and limited can still be scheduled on separate ADC units. No change to TI DAC output PA15/pin30, DAC bypass control PA23/pin43, resistor R77 or U13C wiring.
- TI now directly owns MEAS_SEL_0/1/2 on PA13/pin28, PA22/pin40 and PB20/pin41. These lines drive both U17 and U18. Removed these functions from FPGA pins20/21/31, which are now NC. TI already owns MEAS_INHIBIT on PA10/pin18. FPGA still owns the six GPIO switch enables, six Flow I/O and trigger generation.
- Measurement sequence for the future TI firmware: inhibit both current muxes; set selection; enable muxes; settle; start an INA shunt-only conversion (VBUS remains grounded); wait conversion-ready/ALERT; read and calibrate current; tag the port and timestamp; associate voltage samples with their own timestamps; send a framed packet via SPI to the ESP32. Do not report all six sequential current readings as simultaneous. ESP32 handles acquisition requests and result transport, not per-port INA I2C transactions or mux steps.
- The existing SPI1 interface is unchanged: ESP32 CS_TI GPIO13, SCLK GPIO14, MOSI GPIO43, MISO GPIO44. TI is the SPI target; deselected MISO must be high impedance because FPGA shares the bus. Queue acquisition results rather than blocking the TI sampling loop on every SPI request. Packet format, errors/overruns, calibration and firmware remain to be implemented and tested.

Manual and Base omit U14/U16 and R79/R80; their electrical functions and fitted component sets are unchanged. Pro adds two passive resistors only; no new IC. Root schematic, PCB bytes, all footprints/locks/tracks and A0–A5 remain unchanged in this revision. Current sheet is connectivity-checked; no new-sheet ERC violations. Main-sheet 10 existing errors remain. Placement/routing and firmware are still pending.

Current maps: bom/v3-variants/U14-pins-final.csv and U15-pins-final.csv. Updated variant BOM and cost model are in the same directory.

---

# Shared reference resistor / DAC bypass correction — 2026-10-28

This update supersedes the earlier statement that both spare U13 switches are disabled.

- R77: Yageo RT0603BRD074K7L, LCSC C513565, 4.7k ohm / 0.1% / 25ppm per degree C / 0603, fitted only in Pro. Connects DAC_RAW to DAC_LIMITED.
- U13C: existing spare channel, pin9=DAC_RAW, pin8=DAC_LIMITED. /OE pin10 now connects to TI U14 pin43 PA23, net DAC_BYPASS_N. U13D stays disabled.
- R78: 100k pull-up C25803 from /OE10 to 3V3, fitted in Base and Pro. Keeps bypass open at reset, including Base when TI is absent. Manual omits both new resistors and U13.
- TI pin30 PA15 drives DAC_RAW. TI pin31 PA16 ADC1_CH1 measures DAC_RAW and pin46 PA26 ADC0_CH1 measures DAC_LIMITED, so firmware can schedule the two ADCs synchronously. Pin44 remains unconnected. These assignments use previously spare pins; A0–A5 and all six dedicated port voltage inputs are unchanged. Do not enable OPA1 output on PA16 or the VREF+ function on PA23.
- U19 common pin3 connects to DAC_LIMITED. Both resistor terminals precede the DAC mux. In measurement mode /OE10=1, I=(V_RAW-V_LIMITED)/4700; port ADC readings measure actual DUT voltage independently of mux drop. In normal DAC mode /OE10=0 bypasses R77; the formula then does not measure total output current. Switch and DAC mux on-resistance remain. Firmware must disable U19 before changing modes or ports and coordinate S3, FPGA and rail drivers.
- Correction: exposed pad17 on U17/U18/U19 (74HC4051BQ) is now connected to VCORE=3.3V, not GND, per Nexperia datasheet rev12 page4 note. The exposed pad may float or connect to VCC; current design uses VCC. Imported symbol EP renamed EP_VCC. PCB has not been synced/routed and must use the updated netlist when that work is performed.

R77 limits approximately 0.70mA for a 3.3V source and a passive grounded load. This is a measurement-path resistor, not universal sensor/external-source protection. R/C measurement requires firmware, calibration and validation. No complete inductance/flyback-safe measurement function has been implemented. All modes stay within the 3.3V domain.

See bom/v3-variants/costo-1000.html for the whole-board 1,000-unit cost model and bom/v3-variants/bom-1000-costed.csv for quoted versus budget rows. The model assumes one 1,000-unit single-variant batch, includes S3 N8R8 PCB-antenna module, 40 original FlexyPin, current Harwin and magnetic connectors, all current fitted common components, and separate process allowances. It excludes development/certification/tooling and commercial costs; not a production quotation.

---

# Pro schematic and assembly variants — 2026-10-28

The current default schematic is Pro. The older port-only firmware table below applies to the Base assembly only. See [current variant report](bom/v3-variants/index.html), [assembly BOM](bom/backbone-v3-variants.csv) and the `ports-pro.kicad_sch` child sheet for the authoritative new connections.

- Manual: omit Q3–Q8, U11–U19 and X1, fit R62–R67 GPIO bypasses and 0-ohm R56–R61. Power and ground are wired manually from supply contacts. Do not use GPIO as a sensor power rail.
- Base: fit Q3–Q8/U11/U12/U13 and associated bias/bypass components; fit R68/R69; R56–R61 are 0 ohms. Omit TI/FPGA/INA/mux/clock and R62–R67.
- Pro: fit Q3–Q8, U12–U19, X1, 0.1-ohm R56–R61 and their passives. U11/C87, R62–R69 remain DNP. Never populate both Base and Pro control sets without redesigning the control ownership.

A0–A5 and J3 raw signal assignments are preserved. J1/J140 now connect after six shunts. TI reads PORT_A0–A5 independently of the S3 GPIO function; FPGA I/O and the MOSFET/DAC outputs attach before the shunts at N_A0–N_A5. FPGA digital input level may therefore differ from connector voltage by the shunt drop. In analog or S3 mode, all FPGA signal outputs must be high impedance.

The S3 controls INA226 on the existing GPIO4/5 I2C bus (0x40); leave TI PA0/PA1 input/high impedance unless deliberately configuring a separate I2C slave. SPI uses GPIO13=TI CS, GPIO14=SCLK, GPIO43=MOSI, GPIO44=MISO and GPIO3=FPGA CS. GPIO13/14 cannot simultaneously serve Base OE4/OE5: this is why R68/R69 are omitted in Pro. UART0 debug is unavailable in Pro; existing FPC UART links R32/R33 remain DNP. TI and FPGA MISO must tri-state when deselected.

TI VCORE pin48 is isolated as TI_VCORE and has only C92=470nF to ground. It must never connect to the project's VCORE 3.3V rail. INA VBUS is grounded; V and power are computed from TI ADC readings and INA shunt current, with timestamps. Multiplexer input bias/on-resistance errors and settling require calibration and bench verification; no INA-only precision guarantee is made through the muxes. The 600mA figure remains a shared supply budget, not a DAC/GPIO/mux rating. No current-limiter hardware was added.

TP22–30 provide SWD/JTAG/reset access. TP31–40 reserve six connector-side signals, clock, trigger, 3V3 and GND for a future USB HS module. They are schematic expansion pads, not a finalized daughterboard connector. The high-speed module must acquire directly; this SPI link cannot carry continuous 24MS/s bytes. Define mechanical and power interfaces before final routing if a plug-in module is required.

All newly selected active parts have imported LCSC symbols, footprints and STEP/VRML models. U14=C22452640, U15=C18208899, U16=C49851, U17–19=C128429, X1=C390499. Imported symbol electrical pin types and the active-high 4051 inhibit label were corrected. The exact AGM orderable target/package and EP33 ground connection from the LCSC CAD must be confirmed with AGM before fabrication. No HDL, TI SysConfig or acquisition firmware was compiled or tested.

The PCB is byte-identical to the pre-change backup: all locks, positions, tracks and outline are preserved. New footprints are not yet on the PCB. The main schematic netlist and all three review montage copies load with KiCad CLI. New sheet: zero ERC violations. Main sheet: 10 errors and 107 warnings remain; not fabrication-ready. See the output report for BOM price assumptions and footprint rectangle sums, not a completed layout.

---

# Backbone V3 — isolated universal ports

## Current hardware

Six sensor signals are all on ADC1. J3 is permanently connected to the microcontroller side. J1 and J140 share six separate port-side lines (PORT_A0–PORT_A5), each with its existing P/N MOSFET supply/ground switches. Two TI SN74CBTLV3125PWR packages, U12/U13, provide the six individually controlled bidirectional analog connections between the microcontroller side and the port side. They pass analog and digital signals; they are not digital buffers, voltage translators, or galvanic isolators.

| Signal | ESP32 GPIO | ADC channel | Module pad | Analog switch | J1/J140 contacts | Enable source |
|---|---:|---|---:|---|---|---|
| A0 | 7 | ADC1_CH6 | 7 | U12A, A2/B3, /OE1 | 1,2 | U11 P14, pad14 |
| A1 | 8 | ADC1_CH7 | 12 | U12B, A5/B6, /OE4 | 3,4 | U11 P15, pad15 |
| A2 | 9 | ADC1_CH8 | 17 | U12C, A9/B8, /OE10 | 5,6 | U11 P16, pad16 |
| A3 | 10 | ADC1_CH9 | 18 | U12D, A12/B11, /OE13 | 7,8 | U11 P17, pad17 |
| A4 | 1 | ADC1_CH0 | 39 | U13A, A2/B3, /OE1 | 9,10 | GPIO13, module pad21 |
| A5 | 2 | ADC1_CH1 | 38 | U13B, A5/B6, /OE4 | 11,12 | GPIO14, module pad22 |

Each J1 contact pair is tied to the corresponding J140 pair. Different port lines remain separate. The six A nets contain only the associated ESP32 pin, J3 contact and switch A terminal. The PORT_A nets contain only the respective J1/J140 contacts, MOSFET drains and switch B terminal. Inserting a circuit between J3 and J1/J140 requires the respective analog switches to be open to avoid bypassing that circuit. Grounds and supply rails remain common.

## J3 pinout

The 12 physical contacts form three repeated four-contact groups. Numbering is the footprint/schematic numbering, not an assumed cable viewing direction.

| Physical contact | Connection | Physical contact | Connection |
|---:|---|---:|---|
| 1 | 3V3 / VCORE | 2 | GND |
| 3 | A0 / GPIO7 | 4 | A1 / GPIO8 |
| 5 | 3V3 / VCORE | 6 | GND |
| 7 | A2 / GPIO9 | 8 | A3 / GPIO10 |
| 9 | 3V3 / VCORE | 10 | GND |
| 11 | A4 / GPIO1 | 12 | A5 / GPIO2 |

J3 no longer exposes 5V, GPIO13 or GPIO14. GPIO13/14 are internal isolation controls. The existing two FPC signals reassigned from GPIO1/2 remain on GPIO11/12 (J5 contacts 9/17), with ADC2 rather than ADC1 capability. Other FPC, I2C, USB, CAN and LED assignments are unchanged.

## Components and CAD

- U12/U13: Texas Instruments SN74CBTLV3125PWR, LCSC C406866, TSSOP-14. Six channels used, two spare channels on U13 permanently disabled (/OE10 and /OE13 tied to VCORE); their four analog terminals are marked unconnected.
- R50–R55: 100k pull-ups, one per active /OE, keeping all six switches open while their controllers are high impedance. These are enable bias resistors, not signal-path resistors.
- C88/C89: 100nF bypass capacitors for U12/U13. VCC=pad14, GND=pad7.
- Q3–Q8: TECH PUBLIC AO6604 C5182068, complementary MOSFETs; P(G3,S2,D4), N(G1,S5,D6). R38–R49 provide their original 100k default-off gate pulls.
- U11: XINLUDA XL9535QF24 C5444301, I2C address 0x20. Existing GPIO4/5 and pull-ups are reused.
- Imported LCSC symbol, footprint and STEP/VRML model are in the project LCSC_Ports libraries. The schematic uses a verified split four-switch-plus-power symbol in SpaghettiLAB for readability.

The ten new footprints (two ICs, six resistors, two capacitors) are placed on the front side with the other electronics, inside the current outline. Unlocked front-side components have been repacked to make room; all 12 locked footprint positions, orientations and layers are preserved. The new circuitry leaves the breadboard side free. Placement is preliminary: signal-airwire crossings increased from 755 to 881 when moving everything to one side; routing still needs optimization. Existing tracks/vias are preserved; ground-net naming is now GND. Routing of the new circuits is not implemented. All existing fabrication diagnostics still require review; new LCSC CAD also requires final silkscreen/courtyard cleanup.

## Firmware contract — implementation still pending

/ISO_Ax_N is active low: 1=open, 0=connected. At startup keep GPIO13 and GPIO14 high or high impedance with the external pulls; drive them high before enabling outputs. Initialize U11 Output Port 0 (register 0x02) to 0x55 and Output Port 1 (0x03) to 0xF5 BEFORE writing Configuration registers 0x06/0x07 to 0x00. The new 0xF5 value supersedes the old 0x05: P14–P17 must start HIGH so U12 remains disconnected.

| Port mode | Analog /OE | P MOS gate | N MOS gate |
|---|---:|---:|---:|
| Micro GPIO/ADC connected to port | 0 | 1 (off) | 0 (off) |
| Supply 3V3 to port | 1 | 0 (on) | 0 (off) |
| Ground port | 1 | 1 (off) | 1 (on) |
| Port high impedance | 1 | 1 (off) | 0 (off) |

For transitions: open the analog switch first; switch both MOSFETs off; then select the requested rail or reconnect the analog path. Never connect the analog path while either MOSFET is intentionally on. Never enable both MOSFETs together. Use masked register updates to preserve other port states. With the switch open, the raw J3 micro pin remains available for the external circuit, within ESP32 voltage/current limits; it is not forced to be unused merely because the corresponding port supplies power.

The existing 600mA sensor figure is a shared supply design budget, not a permitted current through the analog switches or microcontroller pins. There is no added hardware current limiter or interlock. Signals must remain within the permitted 3.3V system range. ADC source impedance and settling still require validation for the selected sampling rate. Voltage/current monitoring, INA, shunts, DAC and a separate fast measurement path are deferred.

## Verification

KiCad exported connectivity checked for all six isolated paths, six enables, six default-off pull-ups, two bypass capacitors, unused switch terminals and all twelve J3 contacts. Unrelated connected-pin partitions are unchanged. PCB pad nets match exported schematic nets; existing footprint transforms/locks and tracks/vias are preserved. Candidate DRC adds no shorting-items, copper-clearance, hole-clearance, courtyard-overlap or edge-clearance findings compared with the starting board. This is a preliminary hardware revision, not fabrication approval.

Sources: https://www.ti.com/lit/ds/symlink/sn74cbtlv3125.pdf ; https://www.lcsc.com/product-detail/C406866.html ; https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/schematic-checklist.html
