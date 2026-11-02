# Single-row top-entry headers

J17/J18/J19: hanxia HX PM2.54-1x8P TP-YQ, LCSC C42380985. Imported LCSC footprint and STEP/VRML models. Three connectors total, top mounted. Experimental bottom access now provided by 8 NPTH diameter1.1mm under each header. Mechanical collision J18/J10 pad46 remains: NOT FOR FABRICATION. Actual bottom-entry contact behavior needs sample verification.

J17 pins 1..8: GND, VCORE (3.3V), A0, A1, A2, A3, A4, A5. J18 and J19 pins 1..8: PORT_A0..PORT_A7, paired between the two connectors. Pin 1 remains at the right in top PCB view.

All other footprints, locked components, expansion and Edge.Cuts unchanged. Not routed. ERC: no errors; warnings remain. Imported courtyard extended to include staggered solder lands.

Mechanical limitation: 20.32mm-long connector bodies still extend beyond the 16.5mm expansion window, and interference with mezzanine connector housings has not been resolved. This is not an assembly release. Standard sensor mating depth and strength of SMD joints need sample verification. Old Harwin/CJT samples outside the board retained.
