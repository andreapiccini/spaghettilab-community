# Schematic organization — 2026-10-31

Carrier and Expansion schematics reorganized into17and11functional dashed blocks, with English explanations and current ownership/population notes. Local wires and power symbols retained; long empty wire runs shortened. Auxiliary fields hidden. MisleadingDNP wording removed from displayed resistor values; fitted/DNP attributes unchanged.

Sheet sizes: carrier720×620mm, Expansion720×505mm (previously1590×1100mm each).

Validation:532carrier and435Expansion pin/net associations identical before/after. Electrical primitive UUIDs preserved. ERC0errors;201carrier and77Expansion warnings, same category counts as before. Existing warnings include off-grid endpoints, pin types, label naming and library links; they remain open. PCB and project settings unchanged byte-for-byte. No routing or physical/firmware qualification.

Preview: [carrier](bom/mezzanine-v1/schematic-review/carrier.svg), [Expansion](bom/mezzanine-v1/schematic-review/expansion.svg).

## Follow-up polish after user edits
Based on the latest saved user schematics. Removed6duplicateISO labels with explicitT connections, rotated8crowded mux control arrows, repositioned44reference/value groups, and removed3empty wire stubs. Added a shortP1–P6/A0–A5reading guide. Netlist comparison:498carrier+435Expansion pin/net associations identical. PCB/project settings unchanged. ERC0errors;193carrier/75Expansion warnings remain. Temporary baselineERC project context differs; totalwarning counts should not be compared directly. No commit or push performed.

## InterfaceV2follow-up
Automatic global termination labels replaced by discreet local names; J10/J11captions above symbols.22future-module accesses added; see [pin contract](EXPANSION-INTERFACE-V2.md). LatestERC0errors,173/117warnings.

## Local decoupling follow-up
Bypass parts locally wired; six100nF0402RGBcapacitors added. See [decoupling report](LOCAL-DECOUPLING.md). ERC0errors;956existing pin/net associations preserved. Carrier11new LED courtyard findings remain for physical validation; module DRCunchanged.

## 0603manual-assembly follow-up
All109R/Care0603;25parts replaced. See [package policy and verification](PASSIVES-0603.md). Nominal values and968pin/net associations unchanged. ERC0errors, no new DRCfindings;11RGBcourtyard overlaps removed.
