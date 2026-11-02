# Low-profile bottom socket trial — 2026-11-01

Open `backbone-yxcon-bottom-trial.kicad_pcb` in KiCad and use the bottom 3D view. This is a **separate mechanical/layout experiment**, not the production schematic/BOM revision. `backbone.kicad_pcb` retains the existing Harwin arrangement and the user's edits.

J1, J3 and J140 use Yxcon F136-1206A0CMUB1, LCSC C52148832: 12 contacts, 2x6, 2.54mm pitch and row spacing, vertical SMD female socket. Supplier catalog lists 3.75mm height; verify the actual supplier drawing and mating pin engagement before adopting for production. Supplier STEP/WRL imported from EasyEDA. Nominal footprint plastic envelope approximately15.5x5mm, land envelope13.7x7.7mm; corrected courtyard16.2x8.2mm includes solder pads.

- B.Cu placement, insertion from the bottom side. These are not dual-entry sockets.
- Same centers as Harwin: J3(167.75,90.205), J1(167.75,118.145), J140(167.75,128.305)mm.
- Bottom orientation J1/J140=180°, J3=0°, maintaining the existing physical corner positions for pin1 and corresponding P1–P6 columns. Solder-tail centers change by0.06mm relative to old pads and are on the opposite copper side, so this is not a drop-in footprint substitution.
- All12pin/net associations per socket preserved; existing tracks, outline and other component placements preserved. Existing locks retained on the replacement connectors.
- No pass-through holes underneath these SMD sockets. Existing bottom decorative silk is provisional and still needs final production review against the socket body and pads; redundant new reference/value fields hidden for the fit view.
- J15/J16 tall disconnected CJT samples remain in the variant as DNP to keep the view focused; base board J15/J16 unchanged.
- Existing schematic, production BOM and original main PCB not changed to Yxcon. This trial PCB intentionally differs from the original schematic footprint assignments. Do not use Update PCB from Schematic on this trial: it would restore Harwin. No routing performed.
- Board DRC run for the trial: no courtyard_overlap or clearance findings; preexisting silkscreen, annular, edge, library/text issues and435unrouted items remain. Not fabrication-ready.

Height comparison:8.5→3.75mm saves4.75mm versus the tall CJT trial; existing Harwin is already about3.56mm, so it does not reduce the Harwin height. Low-cost SMD bottom insertion is the intended alternative.

Sources: https://www.lcsc.com/product-detail/C52148832.html and LCSC/EasyEDA CAD C52148832.
