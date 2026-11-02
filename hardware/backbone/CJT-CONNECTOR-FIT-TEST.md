# CJT connector fit test — 2026-11-01

J15 and J16 are two **unconnected mechanical samples**, visible in 3D (DNP disabled) and excluded from the production BOM. They do not replace Harwin or the Expansion interface. Added to the bottom of the carrier schematic in a dedicated dashed block; page height extended to 660 mm without moving existing blocks. Both footprints are parked outside the carrier at (210,100) and (210,112) mm for manual fit experiments. They are not ready for fabrication in those positions.

- CJT A2541HWV-2x6P, LCSC C239346, female vertical through-hole socket, top insertion.
- 12 contacts, 2 rows of 6. Pitch and row spacing 2.54 mm.
- Nominal body 15.74 × 5.00 mm, height 8.50 mm; tail length 3.20 mm.
- Datasheet recommends Ø1.19 ±0.05 mm holes. Imported EasyEDA drill was 1.10 mm; corrected to 1.19 mm, copper lands enlarged to 1.90 mm. Manufacturing hole tolerance still requires fabricator review.
- Added exact nominal F.Fab body and a 0.50 mm courtyard margin. Supplier STEP/WRL retained for visual fitting; not a mechanically qualified substitute for the dimensional drawing.
- KiCad symbol pins corrected from imported input to passive. NC markers show intentional disconnection.
- Symbol: SpaghettiLAB:CJT_A2541HWV_2x6P.
- Footprint: SpaghettiLAB:CJT_A2541HWV-2x6P_P2.54mm_Vertical.
- CAD source: LCSC/EasyEDA C239346, retrieved with easyeda2kicad 1.0.1. Datasheet page 16 / printed A-227.

All existing electrical net partitions, schematic objects and PCB objects preserved. No routing, connector substitution or outline change. All R/C remain 0603.

Sources: https://www.lcsc.com/product-detail/C239346.html and https://www.lcsc.com/datasheet/C239346.pdf

## 3D visibility correction
DNP was hiding the trial bodies in the viewer. DNP disabled on schematic and PCB for J15/J16; production BOM exclusion and disconnected pins retained. STEP files already present with valid project-relative paths. Reload the PCB from disk before reopening the 3D viewer.
