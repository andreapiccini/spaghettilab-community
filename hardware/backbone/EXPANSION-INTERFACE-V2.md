> **Revisione corrente, 5 novembre 2026:** il rilevatore TERM usa Q9/Q10 e D7, senza LM393. Vedere [rete a transistor](CAN-TERM-TRANSISTORS-20261105.md). Le descrizioni precedenti del comparatore sono storiche. Pin dei connettori invariati; serve la stessa revisione su tutte le schede.

> Current connector allocation: [Mezzanine interface V3](MEZZANINE-INTERFACE-V3.md), 2026-11-04. All 120 contacts assigned; dedicated shunt sense and reinforced power contacts. Earlier pin mappings below are historical.

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

Shared MOSFET gates and ISO lines: release the corresponding U25outputs before external drive. No hardware arbiter is added. VBUSis USB supply voltage; use conditioning before an ADC and do not backfeedUSB. TERM_CTRL_IN now exposes the LEFT analog presence contact; see the 2026-11-05 revision below. CAN_H/Larephysicalbuslines,notMCUGPIO. LED_EXP_DATAis downstream fromLED6.

Removed automatic global arrows in the termination circuit; small local names TERM_DRIVE/TERM_LED/TERM_R retain net identity. Connector captions moved above the symbols.

Validation: all933original pin/net partitions preserved;22newcontacts match1:1. PCBnetassignments synchronized without any geometry changes, including R104pin ordering from the user schematic. No new BOM components, no routing. ERC0errors,173carrier/117Expansion warnings; new unused module nets contribute warnings. No production qualification or push.


## TERM aggiornato — 2026-11-05

Supera le precedenti descrizioni del nodo NT1: NT1 rimosso. J11.48 TERM_CTRL_IN e J11.49 TERM_CTRL_OUT sono ora i contatti analogici di presenza sinistra/destra. Non pilotarli né caricarli con pull-up/pull-down sulla mezzanina. Nessun comando MCU/USB richiesto. Tutte le Backbone della catena devono adottare la nuova revisione. [Circuito, compatibilità e verifiche](CAN-TERMINATION-20261105.md).
