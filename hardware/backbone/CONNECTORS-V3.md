# Backbone V3 — dual-face chain contacts

## 3 A requirement — local interlayer reinforcement (2026-10-27)

User specified 3 A on connector 5 V. Replaced each single 0.8/0.4 mm via for 5V or GND at J2/J9 with two parallel 1.0/0.6 mm vias (copper diameter/drill), at +/-0.55 mm along the row from the original via center. Applies to J2 pins 1,4,5 and J9 pins 1,5; signal vias unchanged. Independent short 1.2 mm wide branches on both external layers connect the pad to each via; no 0.6 mm common neck retained. Pad positions/shapes/nets and 3D unchanged. Installed DRC unchanged: 152 violations, 132 unconnected.

First-order barrel estimate at 20 C: PCB thickness 1.6 mm, assumed hole-wall copper 20 um, approximate area per via pi*0.6*0.020 = 0.0377 mm2. Copper resistivity 0.01724 ohm*mm2/m gives about 0.73 milliohm per via, 0.37 milliohm per pair, 1.1 mV and 3.3 mW at 3 A with equal sharing. This estimates barrel resistance only, not thermal qualification; verify actual plating, current distribution, copper pours and completed routing. Source for plating relevance: https://jlcpcb.com/blog/pcb-plating-thickness . Remaining board power routing is incomplete and must be sized for total upstream/downstream chain current including local consumption.

Blocking connector rating: LCSC lists SAMZO PR5L5015-5P-C-H at 2 A (https://item.szlcsc.com/43105444.html); therefore the existing connector cannot be declared suitable for 3 A continuous on this evidence. Reinforcing vias does not raise its rating. No assumption of sharing between J2 pins 1 and 4: J9 pin 4 is TERM_CTRL_OUT and GND remains a single contact. Select/qualify a connector rated at least 3 A for both supply and return before claiming 3 A chain capability. Pinout not modified. User confirmed the 3 A PCB design target, without intending to draw 3 A through the current 2 A connector, and authorized commit/push. This is not a claim of whole-board or connector 3 A compliance.


## Current revision — edge-reaching contacts and horizontal 3D (2026-10-27)

This revision supersedes the earlier 1.8 mm pad length below. Explicit user request: extend the pads to the PCB edge for adjustable connector insertion/overhang. J2 pads are 2.56 x 1.6 mm and reach X=183.25 mm; J9 pads are 2.45 x 1.6 mm and reach X=151.90 mm. Inner pad ends, row pitch, numbering and nets preserved; identical physical XY on both faces. Contact surfaces remain solid and oval, with offset interlayer vias retained. Width increased to 1.6 mm on user request for centering adjustment, leaving 0.94 mm between adjacent copper lands at 2.54 mm pitch.

Footprints: SpaghettiLAB:Magnetic_J2_Edge_DualFace and SpaghettiLAB:Magnetic_J9_Edge_DualFace. Existing library VRML geometry reused: PR5L4015-5P-C-F female on J2 and PR5L5015-5P-C-H male on J9. Derived horizontal VRML files are stored in SpaghettiLAB.3dshapes and referenced through ${KIPRJMOD}; original STEP/VRML files retained. Proper rigid rotation preserves source geometry. Preview shows top mounting, body rear face at the PCB edge and pin lower surface at the board top. Terminal length in source model is approximately 1.5 mm, consistent with user measurement. Model geometry is illustrative, not a tolerance or mechanical-retention qualification. Bottom pads are available, but no duplicate bottom connector is rendered.

Source identification: https://item.szlcsc.com/43105443.html and https://item.szlcsc.com/43105444.html identify the mating pair; model files were already in the local library. No substitute model downloaded.

Validation: actual KiCad 3D render checked; all other footprint instances and pad nets unchanged. Installed DRC 152 violations / 132 unconnected: exactly 20 additional copper_edge_clearance reports (10 pads per face across both connectors), no other category changed. General 0.5 mm board-edge clearance retained, no global rule relaxation or hidden exclusions. Edge copper must be agreed with the PCB fabricator before fabrication; this layout does not specify plated board edges or castellations. No commit/push.

## Earlier revisions (historical)


Implemented locally on 2026-10-27 following explicit confirmation: J2 and J9 use solid contact pads on both PCB faces. Pin numbers and nets occupy the same physical XY on top and bottom, without reversal. Original connector centers, rotation and 2.54 mm pitch are preserved. Following the user measurement of terminal length 1.5 +/- 0.1 mm, all contacts are solid oval lands 1.8 x 1.2 mm, long axis inward/outward across the PCB edge. The 1.2 mm width remains provisional until terminal width is known.

| Pin | J2 FROM_PREVIOUS | J9 TO NEXT |
| --- | --- | --- |
| 1 | 5V | 5V |
| 2 | CAN_H | CAN_H |
| 3 | CAN_L | CAN_L |
| 4 | 5V | TERM_CTRL_OUT |
| 5 | GND | GND |

The pin 4 asymmetry is inherited and intentional to preserve the current circuit. Do not normalize or reverse it when mounting on the other face.

Local footprint: `SpaghettiLAB:Contact_1x05_P2.54mm_DualFace_Oval1.8x1.2mm`. Ten SMD lands per connector, exposed copper/mask openings on F/B, no paste stencil opening, no hole through the contact land. One offset 0.8 mm via with 0.4 mm drill per pin connects both faces through short tracks; vias are 1.65 mm inward from contact centers. Track width is 0.6 mm for 5V/GND and 0.3 mm for signals. These are PCB contact lands, not a qualified footprint for a specified magnetic connector. Mechanical retention, connector mating geometry, finish and current capability still require verification with the selected hardware.

Validation: schematic netlist unchanged; all other footprint instances unchanged; both faces preserve original pad coordinates, numbers and nets; oval shape and dimensions match on both faces. Installed-project DRC: 132 violations and 132 unconnected items, versus previous 145 and 132. No reported violations involving J2/J9 or added tracks/vias. General pre-existing board issues remain; this does not qualify the board for fabrication.

## Optional 5 V output — proposal only

User requested an optional compact, distinctive connector for powering external devices. Proposed a guided magnetic clip on four symmetrical contacts GND / 5V / 5V / GND, or a commercial magnetic connector with its cable. Choice and mechanical dimensions remain open. No output connector or protection circuit has been added. Assess the input 5 V path, available USB supply current and output current limiting/reverse-current protection before implementation.


Oval revision: final installed DRC still 132 violations / 132 unconnected, none involving J2/J9. Original label positions retained. The earlier 3 mm pad-length proposal was superseded by the measured terminal length; not installed in the final PCB. No commit/push.

Final pad-width check: 1.6 mm, DRC unchanged at 152 violations / 132 unconnected; no added violations from widening.
