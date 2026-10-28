# Current populated choices — available LCSC port components

Selected on 2026-10-27 to replace the previously selected AOS AO6604 and TI TCA9535RGER with readily stocked lower-cost parts.

| References | Selected component | LCSC | Stock shown when checked | Indicative USD unit price |
|---|---|---|---:|---:|
| Q3–Q8 | AO6604, TECH PUBLIC | C5182068 | 2,710 | 0.143 at 5+, 0.0868 at 500+ |
| U11 | XL9535QF24, XINLUDA | C5444301 | 6,170 | 0.5913 at 1+, 0.3302 at 100+ |

Stock/prices are snapshots, not reserved inventory; taxes/shipping excluded.

Sources:
- https://www.lcsc.com/product-detail/C5182068.html
- https://www.lcsc.com/product-detail/C5444301.html
- TECH PUBLIC datasheet: https://datasheet.lcsc.com/datasheet/pdf/2463a689701d1e3802bbeddc2f393b80.pdf
- XINLUDA datasheet: https://atta.szlcsc.com/upload/public/pdf/source/20240911/FFF826D97BDA33B4BE55BC4C2C305DC8.pdf

## Compatibility checked

TECH PUBLIC AO6604 has N-channel RDS(on) max 80 mOhm at VGS=+2.5V, and P-channel max 145 mOhm at VGS=-2.5V (25 C, datasheet pp.2–3). Therefore it is characterized below the intended +/-3.3V gate drive; this check is not based on threshold voltage. N G1=1,S1=5,D1=6; P G2=3,S2=2,D2=4, matching existing six port circuits. At 600mA and these 2.5V/25C maximum resistances, the estimated MOSFET-only drops are 48mV N / 87mV P; temperature, rails and connectors add to this. 600mA remains the board-wide budget.

XL9535QF24 operates at 2.3–5.5V, has push-pull port outputs and inputs at power-up (no weak pull-ups on XL9535; XL9555 is different). Its QFN-24 4x4mm pin numbers and EP connection match the preceding TCA9535RGER schematic. The required address 0x20, output registers 0x02/0x03 and configuration registers 0x06/0x07 are compatible with the documented default-off initialization. No new MCU pins or extra circuitry are required.

## CAD integration

Current split schematic symbols:
- SpaghettiLAB:AO6604_TP, P/N units, linked to LCSC_Ports:SOT-23-6_L2.9-W1.6-P0.95-LS2.8-BL.
- SpaghettiLAB:XL9535QF24_6Ports, paired-output units plus common unit, linked to LCSC_Ports:QFN-24_L4.0-W4.0-P0.50-BL-EP2.6.

Original converted vendor symbols AO6604_C5182068 and XL9535QF24 are also in LCSC_Ports. Vendor CAD pin 20 label DA on XL9535 was corrected to SDA; pin number 20 unchanged. New imported footprint orientations differ from older parts: do not assume identical pad XY, and do not swap into a routed PCB without checking. No target Q3–Q8/U11 packages were yet present on the live PCB when audited; this change updates schematic/library links only.

New STEP and VRML files are in hardware/libraries/LCSC_Ports.3dshapes. Footprint model paths are relative to the backbone project. Both new models were loaded and visually checked on a separate KiCad test board. Old AOS/TI original CAD entries are retained as archived library assets, not current BOM choices.

CAD source: JLCEDA/EasyEDA Official Library, https://lceda.cn/ and https://easyeda.com/ . Converted using easyeda2kicad 1.0.1. Source CAD caches and manufacturer datasheets are retained in the task workspace. The schematic netlist connected-pin sets were compared before and after substitution and are identical. No firmware or PCB routing changes.

## Bidirectional GPIO/ADC isolation, 2026-10-27

U12/U13 use TI SN74CBTLV3125PWR, LCSC C406866. Four individually enabled analog FET switches per TSSOP-14 package; active-low /OE. Two ICs cover the six port lines. Imported raw symbol SN74CBTLV3125PWR_C406866 is in LCSC_Ports; a datasheet-verified split symbol SN74CBTLV3125_4Switches is in SpaghettiLAB. Footprint TSSOP-14_L5.0-W4.4-P0.65-LS6.4-BL uses 0.65mm pitch and pins 1–14 checked against TI; STEP and VRML model TSSOP-14_L5.0-W4.4-H1.0-LS6.4-P0.65 are project-relative.

TI pin map: /OE=1/4/10/13, A=2/5/9/12, B=3/6/8/11, VCC14, GND7. The high enable state disables the channel; the wording in the pin-function table of TI Rev.K is inconsistent with its functional description, so the functional truth table and existing TI product behavior govern the active-low /OE labeling.

Source: https://www.ti.com/lit/ds/symlink/sn74cbtlv3125.pdf and https://www.lcsc.com/product-detail/C406866.html . CAD downloaded using easyeda2kicad from the LCSC/EasyEDA record. No sensor supply current is routed through these signal switches.

## Pro / Manual / Base assemblies — 2026-10-28

Imported new types into LCSC_Ports with project-relative STEP/VRML references: MSPM0G3507SRGZR C22452640, AGRV2KQ32 C18208899, INA226AIDGSR C49851, 74HC4051BQ,115 C128429 and SG-8018CE 20 MHz TJHPA C390499. Numbered pins compared against imported footprint pads. Symbol electrical types normalized for ERC; 4051 E is active high inhibit, not active low enable. These are vendor CAD imports with those corrections, not manufacturer-certified KiCad libraries. AGM exact package/ordering and EP33 grounding still need manufacturer confirmation before fabrication.

R56–R61 default Pro shunts use Milliohm HoLRTX1206-1W-100mR-1% C5123673, 1206, 0.1 ohm, 1%, 1W. Manual/Base replace them with 1206 zero-ohm C17888. See hardware/backbone/bom/backbone-v3-variants.csv for assembly-specific values and DNP selection. Manual GPIO bypasses R62–67 and Base-only enable links R68/69 are 0603 zero-ohm C21189. Other new passives use LCSC codes in the BOM and standard KiCad 0603/1206 footprints.

## Reference resistor / bypass and 4051 EP correction — 2026-10-28

R77 Yageo RT0603BRD074K7L C513565 (4.7k, 0.1%, 25ppm/C, 0603) uses standard KiCad R_0603 footprint. R78 100k C25803 uses the same footprint. R77 is Pro-only; R78 Base/Pro. Existing U13C provides the bypass; no additional active package.

U17–U19 74HC4051BQ exposed pad17 has been corrected from GND to VCORE 3.3V in the schematic. The manufacturer permits floating or VCC, never GND (Nexperia 74HC_HCT4051 datasheet rev12 page4). Imported pin name updated to EP_VCC; physical footprint and 3D geometry unchanged. PCB sync and routing remain pending.

## Dedicated TI–INA I2C — 2026-10-28

R79/R80: 0603WAF4701T5E 4.7k 1% 100mW, UNI-ROYAL, LCSC C23162, standard KiCad R_0603_1608Metric footprint. Pro only. Pull up INA_I2C_SDA/SCL to VCORE 3.3V. INA bus moved to TI I2C1 PA16/PA17 PF4; current-mux address selection moved directly to TI. Existing Qwiic/ESP32 I2C unaffected. No new active component or imported CAD package.

## AG32 supervisor import — 2026-10-28
- Active device: AG32VF407VGT6, LCSC C5336269. Source symbol, LQFP100 footprint and STEP/VRML imported from EasyEDA/LCSC. Original part symbol kept; AG32VF407VGT6_Functional groups the same100physicalpins into7units for wiring readability. Check VE/HDL pin functions before fabrication.
- AG32VF407RGT6 C5336267 LQFP64 assets also imported as a comparison option; it is NOT the active schematic part.
- Models use project-relative paths. The100pin body is14x14mm; leads span about16mm. No placement/fit claim.
- INA226,4051 and clock assets imported in the preceding Pro work remain active. 4051 exposedpad17 remains VCC.
- See ../backbone/AG32-SUPERVISOR.md for electrical ownership, USB assembly selection and limitations.
