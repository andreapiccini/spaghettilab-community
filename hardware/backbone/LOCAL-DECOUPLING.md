> **Package update2026-10-31:** all R/Care now0603. Earlier0402selections and the initial RGBcap placement below are superseded by [PASSIVES-0603.md](PASSIVES-0603.md). The11RGBcourtyard overlaps were resolved.

# Local decoupling and RGB capacitors — 2026-10-31

Bypass capacitors are now connected by local wires to their associated chip supply pins. GND uses normal power symbols. Existing directly wired bypasses and reset/bootstrap capacitors were retained. No functional labels were added between bypass parts and their loads.

Carrier: C125–C128 for U26–U29; C130 for U31; C119/C124/C129 wired to U25. U12/U13/CAN/ESP bypasses already directly wired were preserved.
Expansion: C121/U17, C122/U18, C101/U19, C123/U16, C131/U32, C100/X1. Eight100nFcapacitors C90/C91/C93–C98 and C99=1uFbulk are directly wired to the AG32 power-pin bus.

## Added RGB parts

C132–C137: six100nF0402capacitors, LCSCC1525, COMMON/fitted, one each forLED1–6. Connected between existing VCORE and GND. Active carrier BOM updated by6parts. No other new BOM items.

The actual [LCSC C5149201 datasheet](https://www.lcsc.com/datasheet/C5149201.pdf), SK6812MINI-E-012B/1,13pages, requires decoupling between LEDs.100nFis the design selection. The pinout in this exact datasheet matches the project:1GND,2DIN,3VDD,4DOUT. Other published revisions have different numbering and were not used to remap this board. Existing3.3Vsupply was retained; the datasheet specifies3.7–5.5V, so operation at3.3Vremains a prototype qualification item. Capacitors do not change that rating.

## Placement and validation

Six new0402parts on F.Cu at y133.3mm, between the upper hand-formed LED terminals. Existing carrier footprints, connector/LED positions, locked components, outlines, tracks and project settings unchanged. C100andC101are the only existing module footprints relocated, both on B.Cu near X1andU19. No routing performed.

All956preexisting pin/net associations preserved;12new capacitor pins verified VCORE/GND. ERC:0errors,184carrier/107Expansion warnings. DRCmodule unchanged:3library mismatches+2preexisting NPTH/courtyard items. Carrier gains11courtyard overlaps only; no new copper, mask, edge or silk findings.

The rectangular LED courtyards enclose unused space between hand-formed leads. Placement was checked separately against actual pads and F.Fabbody bounds; nevertheless the11courtyard findings are not suppressed. Physical lead bend/height and assembly clearance must be verified before manufacture. This is a placement proposal, not a production sign-off.

See bom/mezzanine-v1/schematic-review for updated vector/PNG previews and verification.json. Changes remain local; no commit/push.
