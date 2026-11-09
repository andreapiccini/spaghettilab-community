# Current applied revision

Native schematic and PCB: 16 rows, 78 x57.2mm, magnetic connectors centred; no SW1/SW2 physical buttons. Row status apertures at45 degrees; MCU glyphs reduced20%; status LED columns compacted to3mm, maintaining2.54mm row pitch and independent row touch targets.

Two BS8116A-3 controllers: U90 uses internal I2C for16 row electrodes; U91 uses separate software I2C on GPIO21(SCL, historical UI_BANK_N net) and GPIO13(SDA), with4.7k pull-ups R921/R922 and100nF C921. Neither bus is the user I2C bus. U91 serves9 covered copper-frame electrodes: Play/Pause, Debug, Load, Save, Delete, slots1–4.

Touch firmware is not implemented. Intended interaction: tap Play/Pause; hold2s Stop/Hi-Z; select Load/Save then slot; Delete requires holding the chosen slot2s. Debug requests host/measurement mode; this backbone alone does not implement external measurement/DAC functions.

D523 separate STOP LED removed;65 IS31FL3731 channels populated,79 free. Four existing logo blue emitters retained; denser logo illumination is not qualified.

All new footprints and schematic nets are present, but full PCB routing, remaining DRC findings, touch sensitivity and optical qualification remain open. This is not manufacturing-ready. The measurement expansion connector proposal has not been added.
