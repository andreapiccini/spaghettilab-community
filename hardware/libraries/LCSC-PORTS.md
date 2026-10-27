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
