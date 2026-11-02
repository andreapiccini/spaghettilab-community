# Six-port configuration

Active headers J17/J18/J19: three Hanxia C42380984 1x6 SMD, experimental bottom access. Header centres X167.75; Y89.375,122.395,127.475mm. All hole centres share a 2.54mm lattice, with row separations33.02mm (13pitches) and5.08mm (2pitches). A standard perfboard can align geometrically; underside components/stack height remain to be checked.

J17: GND,3V3,A0,A1,A2,A3. J18/J19: P1-P6 configurable, same nets between corresponding contacts. A4/A5 remain on ESP/existing exports.

Removed LED7/8,C138/139,Q9/10,R116-R123,U32,C140 from carrier. Expansion U32 and R116 are unrelated functions and retained. LED6 output restored to LED_EXP_DATA. Spare U13 channels disabled: OE=3V3, inputs=GND, outputs unused. Expansion mux Y6/Y7 unused. J10.55 restored GND; J11.53/54/56 unused.

Six RGB lights centred below the headers. Top silk labels and rounded frame plus corresponding-port guides; bottom hole labels and column connections. Locked parts and outline unchanged.

Verification: zero ERC errors on both boards; 120 interface pins agree; connected pad nets agree with exported netlists. No header-related hole clearance or shorting errors. Whole-board DRC remains unresolved and board unrouted; bottom contact behavior and full expansion mating require sample validation.

## Direct ESP row extension
J20 added atX167.75,Y94.455,5.08mm fromJ17, same HanxiaC42380984. Pin1..6=A4,GND,3V3,A5,3V3,GND. J17unchanged GND,3V3,A0,A1,A2,A3. All six ESP nets A0-A5 now exposed in two rows with mixed rails. R114 andR103 moved, unlocked, to(165,117)and(171,117)mm to clearJ20. Other footprints unchanged. Bottom port silk now uses0.38mm continuous paths fromboth P1-P6 holes to the corresponding LED window. No new row/resistor copper or hole errors; general DRC still unresolved.
