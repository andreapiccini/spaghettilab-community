# Expansion universal interface — 2026-10-31

J11 now exports22additional carrier nets for future modules. These are not assigned to extra AG32pins. The current Expansion exposes them at the connector only. Three contacts remain reserved:53,54,56. Existing grounds and power contacts retained.

| J11 contact | Net |
|---|---|
| 26 | P_GATE_0 |
| 27 | N_GATE_0 |
| 28 | P_GATE_1 |
| 29 | N_GATE_1 |
| 31 | P_GATE_2 |
| 32 | N_GATE_2 |
| 33 | P_GATE_3 |
| 34 | N_GATE_3 |
| 36 | P_GATE_4 |
| 37 | N_GATE_4 |
| 38 | P_GATE_5 |
| 39 | N_GATE_5 |
| 41 | ISO_A0_N |
| 42 | ISO_A1_N |
| 43 | ISO_A2_N |
| 44 | ISO_A3_N |
| 46 | CAN_H |
| 47 | CAN_L |
| 48 | TERM_CTRL_IN |
| 49 | TERM_CTRL_OUT |
| 51 | VBUS |
| 52 | LED_EXP_DATA |

Shared MOSFET gates and ISO lines: release the corresponding U25outputs before external drive. No hardware arbiter is added. VBUSis USB supply voltage; use conditioning before an ADC and do not backfeedUSB. TERM_CTRL_IN exposes the existing NT1node; this does not establish a qualified board-presence detector. CAN_H/Larephysicalbuslines,notMCUGPIO. LED_EXP_DATAis downstream fromLED6.

Removed automatic global arrows in the termination circuit; small local names TERM_DRIVE/TERM_LED/TERM_R retain net identity. Connector captions moved above the symbols.

Validation: all933original pin/net partitions preserved;22newcontacts match1:1. PCBnetassignments synchronized without any geometry changes, including R104pin ordering from the user schematic. No new BOM components, no routing. ERC0errors,173carrier/117Expansion warnings; new unused module nets contribute warnings. No production qualification or push.
