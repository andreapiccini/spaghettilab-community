# Six-position Hanxia fit trial — current primary PCB

J17/J18/J19: C42380984, HX PM2.54-1x6P TP-YQ. Imported supplier CAD with custom experimental bottom access: 6 NPTH diameter1.1mm per header, SMD lands2.2mm long shifted to local y±2mm. NOT an unchanged manufacturer land pattern; sample validation required. Same centres/orientation, other components and outline unchanged.

J17 pins1..6 GND,VCORE,A0,A1,A2,A3. A4/A5 remain on ESP and other existing exports; not on J17. J18/J19 pins1..6 PORT_A0..PORT_A5. P7/P8 circuitry and eight LEDs retained, but P7/P8 not exposed here. LED silk mapping still requires revision for six-position geometry.

No header-related hole clearance or shorting_items reported in candidate DRC. Courtyard overlaps between J19 and LED footprints remain; whole board DRC not clean and board unrouted. Body15.74mm nominal against16.5mm window; full assembly height and mating not qualified. Bottom entry not specified by supplier: sample test required.

Before-change backup: outputs/hanxia-six-fit/before-backbone.kicad_pcb/.kicad_sch in task workspace.
