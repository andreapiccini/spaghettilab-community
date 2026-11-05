# Mezzanine interface V3 — 2026-11-04

Current electrical contract for Backbone and the example Expansion module. V3 replaces the contact allocation in MEZZANINE-V1.md and EXPANSION-INTERFACE-V2.md. It is electrically incompatible with the old allocation: the reassigned contacts were grounded or unused. Do not mix V2 and V3 boards.

Both existing 60-contact BergStak connector pairs are retained. All 120 contacts are assigned: 17 GND, six 5V, six VCORE, twelve dedicated SHUNT_SENSE contacts, and all 79 existing other lines. No gate, isolation, USB, CAN, programming or GPIO service was removed. This is an electrical interface change, not a placement, mechanical-fit or power-capacity qualification.

## Changed contacts (same pin numbers on Backbone and Expansion)

| Connector | Pin | Previous | V3 |
|---|---:|---|---|
| J10 | 5 | GND | 5V |
| J10 | 10 | GND | VCORE |
| J11 | 5 | GND | 5V |
| J11 | 10 | GND | VCORE |
| J10 | 57 | GND | SHUNT_SENSE_H0 |
| J10 | 58 | GND | SHUNT_SENSE_L0 |
| J10 | 59 | GND | SHUNT_SENSE_H1 |
| J10 | 60 | GND | SHUNT_SENSE_L1 |
| J11 | 53 | NC | SHUNT_SENSE_H2 |
| J11 | 54 | NC | SHUNT_SENSE_L2 |
| J11 | 55 | GND | SHUNT_SENSE_H3 |
| J11 | 56 | NC | SHUNT_SENSE_L3 |
| J11 | 57 | GND | SHUNT_SENSE_H4 |
| J11 | 58 | GND | SHUNT_SENSE_L4 |
| J11 | 59 | GND | SHUNT_SENSE_H5 |
| J11 | 60 | GND | SHUNT_SENSE_L5 |

All unlisted contacts retain their previous assignment. The complete mapping is in `bom/interface-v3-20261104/pinout.csv`.

## Two-terminal shunts with separate PCB sense taps

R56–R61 retain the existing Yageo PE0603FRF070R1L, 0.1 ohm, 0603, LCSC C1882650. These are still two-terminal purchased resistors, not four-terminal replacements.

The new `SpaghettiLAB:R_2Terminal_Kelvin` symbol and `SpaghettiLAB:R_0603_2Terminal_Kelvin` footprint expose force terminals 1/2 and PCB sense anchors 3/4. Footprint net-tie groups are `1,3` and `2,4`. Small copper-only sense pads overlap the existing solder lands near their inner edges. Main solder lands, paste/mask geometry, component position and 3D body are preserved; no extra soldered component is added.

| Channel | Shunt | H source | L source | Connector H/L |
|---|---|---|---|---|
| 0 | R56 | pad 3 tied to 1 / N_A0 | pad 4 tied to 2 / PORT_A0 | J10 57/58 |
| 1 | R57 | pad 3 tied to 1 / N_A1 | pad 4 tied to 2 / PORT_A1 | J10 59/60 |
| 2 | R58 | pad 3 tied to 1 / N_A2 | pad 4 tied to 2 / PORT_A2 | J11 53/54 |
| 3 | R59 | pad 3 tied to 1 / N_A3 | pad 4 tied to 2 / PORT_A3 | J11 55/56 |
| 4 | R60 | pad 3 tied to 1 / N_A4 | pad 4 tied to 2 / PORT_A4 | J11 57/58 |
| 5 | R61 | pad 3 tied to 1 / N_A5 | pad 4 tied to 2 / PORT_A5 | J11 59/60 |

Route load current through force pads 1/2, entering from the outer ends of the lands. Route sense from anchors 3/4, avoiding shared force-track sections. Keep each H/L pair together over continuous GND, away from the buck switching node, clocks and high-current return paths. Do not bridge force and sense elsewhere. `KELVIN_SENSE` assigns 0.15 mm nominal trace width, 0.20 mm clearance and standard 0.60/0.30 mm vias. No complete routing has been added.

On the example Expansion, U17 channels Y0–Y5 now take SHUNT_SENSE_H0–H5, and U18 channels Y0–Y5 take SHUNT_SENSE_L0–L5. DAC U19 and other force/digital connections retain N_A/PORT_A. This avoids sharing the force connector contacts with the shunt input measurement. It does not remove mux leakage, input loading, INA offset, resistor tolerances, solder/terminal errors or external sensor wiring drops. H/L names define polarity relative to N_A/PORT_A, not a permanently higher/lower voltage under reverse current.

## Power and ground

The two new 5V contacts are J10.5/J11.5; the two new VCORE contacts are J10.10/J11.10. Existing four contacts for each rail remain. No voltage rails were joined and VBUS remains distinct.

Grounds remain at J10: 15,20,25,30,35,40,45,50,55 and J11: 15,20,25,30,35,40,45,50. USB neighboring returns at J11.20/.25 are retained. The tail contacts now carry adjacent H/L pairs. PCB planes, routing, combined return current and temperature rise still require verification.

Manufacturer rating is 0.8 A/contact for 61082-061402LF and 61083-061402LF. Six parallel rail contacts yield an arithmetic nominal sum of 4.8 A, NOT a qualified board current rating. Current sharing, simultaneous loading, copper, vias, regulator capability, protection and thermal derating must be validated. This change neither increases the VCORE regulator output capability nor adds reverse-current protection, source selection, USB-PD negotiation or permission to backfeed VCORE/USB.

Sources: https://www.amphenol-cs.com/product/61082061402lf.html and https://www.amphenol-cs.com/product/61083061402lf.html

## Validation and remaining work

Exported before/after netlists confirm exactly the intended connector and sense-endpoint changes, identical 120-pin mappings on both boards, and preservation of all other component pin/net assignments. All footprint positions and orientations are unchanged. No routed segments or vias existed in the source boards.

ERC: zero errors on both boards; existing warning totals remain 143 (Backbone) and 107 (Expansion). DRC: no additional physical violations; existing totals remain 155 and 5 respectively. No new short-circuit or clearance violations from the Kelvin footprint. Existing schematic-parity warnings remain outside this change. Boards remain unrouted, with 456 / 299 unconnected items reported after this change. No SI, power or thermal qualification was performed.

The previously identified connector-spacing mismatch and header-height interference of the example Expansion remain open mechanical work. V3 pin compatibility does not establish mechanical compatibility.
