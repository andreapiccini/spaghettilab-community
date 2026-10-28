# Current backbone revision — 2026-10-29

This is the authoritative status summary for the main-branch CAD snapshot. Earlier placement, cost and external-converter reports are historical. The board is not routed or production-qualified.

## Dual-controller update

[Dual-controller control](DUAL-CONTROLLER.md): LED chain, MOSFET configuration and CAN/termination now have ESP-only, AG-only and combined assembly paths. U25 is mandatory in every automatic variant; U26–U30 select five signals using AG_READY. Firmware handshake and bench validation remain open. Six ESP FPC signals are now shared control lines; see the updated FPC table. No independently unpowered-chip isolation.

## Implemented

- AG32VF407VGT6 LQFP100 supervisor on the backbone, with internal ADC/DAC architecture and shared INA226/mux measurement circuitry. Optional ESP32-S3 WROOM on the retained FlexyPin socket; Qwiic, FPC, USB-C, CAN transceiver and termination retained. Mezzanine remains a proposal, not implemented.
- J1/J140 configurable lines are labelled P1–P6 on bottom; the four mating holes per line share a net. P labels do not imply a permanent ESP GPIO connection. The six RGB indicators map to these ports.
- All 36 J1/J140/J3 mating-hole centers share a 2.54 mm grid. Centerline X=167.75 mm. J3 center Y=90.205; J1=118.145; J140=128.305. Locating holes are not mating contacts. Physical header/perfboard fit remains to be tested.
- Magnetic contact arrays and side-relief median centered at Y=101.15 mm. Relief nominal transitions at Y=89.15/113.15; rounded maximum outline 41.5×77.7 mm. Internal FPC and ESP extraction openings retained.
- FPC J5 center (154.9,123.175) mm, matching slot Y=115.925–130.425 mm. Nearby unlocked components repacked; 0.65 mm reserved around FlexyPin pad envelopes. No mechanical qualification claimed.
- Bottom silkscreen uses rounded frames, curved LED guides, P1–P6 repeated between connectors, 0.30 mm common-net guide lines and 1.05 mm port text. Mounting-hole rings and FPC border added. LED optical B.Mask apertures rounded; no physical hole or copper added under the optical windows.
- Project contains 16 netclasses including Default, with 133 explicit net assignments; the intentionally unconnected INT net remains Default. Track, via and differential presets are in backbone.kicad_pro; custom rules in backbone.kicad_dru. USB geometry is preliminary pending fabrication stackup impedance calculation. CAN_H/L remain manually co-routed nets.

## J3 electrically updated pinout

Viewed from bottom, left to right:

| Row | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Upper | 3V3 | GND | IO7 | GND | 3V3 | IO8 |
| Lower | IO9 | IO10 | IO1 | IO2 | GND | 3V3 |

Schematic and PCB agree. This offers common three-pin permutations and a reverse-read four-pin 3V3/GND/IO2/IO1 group, not universal sensor compatibility. All six ESP GPIO remain present. See bom/lab-v1/J3-pinout.csv for pad numbers. GPIO capability and module pinout must be checked before direct insertion.

## Verification and remaining work

Final checks and previews: bom/lab-v1/placement-drc.json, schematic-erc.json, board-3d.png, board-bottom.png and routing-setup.html. CAD review includes existing findings; do not interpret successful checks as a clean production DRC. Known magnetic edge-copper and FlexyPin annular findings remain; 499 unrouted connections and zero tracks/vias. Final counts must be taken from the saved reports.

Before fabrication: complete routing, resolve/justify DRC findings, check fabricator stackup and edge copper, verify connector ratings/current paths, antenna clearance, FlexyPin and cable mechanical fit, LED light transmission and operation at 3.3 V. Measurement scan, FPGA emulation, boot programming and MCP features are not firmware/bank-qualified by this CAD work.

## Mezzanine research — not implemented

DF40 2×60 alternative investigated; 30 mating cycles are insufficient for frequent user swapping. Amphenol BergStak 0.80 mm candidate: two 61082-061402LF receptacles (LCSC C254696) on backbone and two 61083-061402LF plugs (C464610) on module. Series specifies 100 cycles; candidate costs approximately USD3.47 in small quantities and USD1.92 at cited volume tiers, connector set only. Larger footprint (~29.8 mm long receptacle) and ~5 mm mating height require a fresh placement study. User has not selected this interface or authorized a mezzanine CAD redesign.

120 connector contacts include power and distributed grounds; they are not 120 free GPIO. AG32 snapshot: 100 package pins, 13 power/ground, 81 other connected pads, 6 unassigned pads (not necessarily usable GPIO). Approximately 78 distinct signal nets would cross a naive interface with local oscillator retained. Future module should include clock, decoupling, device-specific supplies and optional local memory; high-current switching/sensing should remain near ports. Reset is not equivalent to power-off. All connector prices/stock and low-power behavior require reconfirmation.
