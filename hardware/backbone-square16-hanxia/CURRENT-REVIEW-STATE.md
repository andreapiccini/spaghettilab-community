# Current applied revision

Native schematic and PCB: 16 rows, 78 x57.2mm, magnetic connectors centred; no SW1/SW2 physical buttons. Row status apertures at45 degrees; MCU glyphs reduced28%; status LED columns compacted to2.9mm with true rounded capsules and shorter dividers, maintaining2.54mm row pitch and independent row touch targets.

Two BS8116A-3 controllers: U90 uses internal I2C for16 row electrodes; U91 uses separate software I2C on GPIO21(SCL, historical UI_BANK_N net) and GPIO13(SDA), with4.7k pull-ups R921/R922 and100nF C921. Neither bus is the user I2C bus. U91 serves10 system command electrodes (including CLEAR ALL) and6 programmable user electrodes.

Touch firmware is not implemented. Intended interaction: tap Play/Pause; hold2s Stop/Hi-Z; select Load/Save then slot; Delete requires holding the chosen slot2s. Debug requests host/measurement mode; this backbone alone does not implement external measurement/DAC functions.

D523 separate STOP LED removed;77 IS31FL3731 channels populated,67 free. Sixteen blue logo emitters at45degrees: four retained and twelve added. Optical uniformity remains unqualified.

All new footprints and schematic nets are present, but full PCB routing, remaining DRC findings, touch sensitivity and optical qualification remain open. This is not manufacturing-ready. The measurement expansion connector proposal has not been added.

Row-indicator refinement preserves all components and pad nets. A2.7mm trial failed pad clearance;2.9mm passes the row LED pad clearance checks. Package courtyard overlaps and other existing DRC findings still require layout qualification.

## Six programmable user touch keys and CLEAR ALL

T1–T6 occupy the upper-left user-facing area in an aligned3x2 grid. CLEAR is grouped with LOAD/SAVE/DELETE at bottom right. Covered4.4mm copper electrodes,5.8mm pitch, no additional ICs or LEDs. U91 keys10–16 (pins8–14) are connected to TE30–TE36. All32 touch inputs across U90/U91 are occupied. No default actions are assigned to T1–T6; CLEAR ALL is reserved for clearing the working row configuration. Firmware must configure U91 key16 as touch rather than IRQ, using the documented complete configuration protocol.

See user-touch-verification.json: zero ERC errors, no DRC violations involving the seven new electrodes. Full board routing and touch sensitivity remain unqualified.

## Corrected logo and denser backlight

Logo geometry traced directly from logo_sfondo_bianco copia.png supplied by the user, preserving aspect ratio and original LED-ray placement.16 blue XL-3216UBC-FB (C3646941) emitters on the service side,4x4grid,3mm pitch,45degrees;12additional channels, no extra driver. Active logo schematic is sheet11, logo16.kicad_sch. All schematic/PCB nets match; no logo pad-clearance, keepout or courtyard errors. Service components repacked to preserve board dimensions. Uniformity and optical assembly must be qualified on the prototype.

## Dedicated CLEAR ALL

TE36 / U91 key16 pin14 is reserved for CLEAR ALL (net TOUCH_CLEAR_ALL), not user T7. The PCB is labelled CLEAR. Hold2seconds: stop execution, disable all row connections to Hi-Z, clear the working configuration; do not erase stored slots. The earlier long Play/Pause gesture only stops/disconnects while retaining the working configuration. IRQ must be disabled on key16 during initialization as already documented. Firmware remains to be implemented.

Browser simulation verified: short Clear does not clear; held Clear disarms all16 rows and preserves a populated saved slot. See clear-all-verification.json for native schematic/PCB checks; these checks are not physical hardware qualification.

## Configuration-control grouping

LOAD, SAVE, DELETE and CLEAR share the same row at native y112mm. Slots1–4 are directly beneath their columns at y117mm; x positions173.4/167.6/161.8/156mm. User T1–T6 form an aligned3x2 grid; the USER caption is centred. No circuit, GPIO, component count, board dimensions or gesture behavior changed. Schema/PCB net parity verified; moved controls have no clearance/shorting/courtyard conflicts. Routing and firmware remain incomplete.
