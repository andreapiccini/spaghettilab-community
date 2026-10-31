# Passives — 0603 assembly requirement

**Current user requirement,2026-10-31: all resistors and capacitors must use0603imperial/1608metric(1.6×0.8mm)for hand assembly. Do not select0402for space/cost. This supersedes the earlier0402selection and also applies to previous0805/1206parts.**

All109R/Cinstances now comply:70carrier+39Expansion.25parts converted; active schematic footprints, PCBfootprints,3Dmodels, LCSCmetadata and BOMs updated. Existing0603parts retained.

## Replacements

| Parts | Value / supplier |
|---|---|
| C125–C129,C132–C137 |100nF50VX7R0603YAGEOCC0603KRX7R9BB104,[C14663](https://www.lcsc.com/product-detail/C14663.html)|
| C5,C9,C86 |22uF10VX5R0603SamsungCL10A226MP8NUNE,[C86295](https://www.lcsc.com/product-detail/C86295.html)|
| R103,R105,R108 |100kΩ0603UNI-ROYAL0603WAF1003T5E,C25803|
| R104 |47kΩ0603UNI-ROYAL0603WAF4702T5E,[C25819](https://www.lcsc.com/product-detail/C25819.html)|
| R107 |10kΩ0603UNI-ROYAL0603WAF1002T5E,C25804|
| R56–R61 |0.1Ω0603YAGEOPE0603FRF070R1L,1%,100mW,100ppm/°C,[C1882650](https://www.lcsc.com/product-detail/Chip-Resistor-Surface-Mount_YAGEO-PE0603FRF070R1L_C1882650.html)|

Nominal values unchanged. Shunt dissipation at600mAis36mW; temperature derating and measurement calibration still require prototype qualification. MLCCeffective capacitance under DCbias must be checked in regulator validation; nominal-value equality is not a claim of identical ripple/transient response. No component prices or production availability guarantees are inferred. Sources checked2026-10-31.

## PCB and checks

Converted parts were placed as near their prior locations as available space permits; RGBcaps redistributed because six0603parts do not fit the previous0402row. C134is about13mmfromLED3; placement is provisional and routing/decoupling loop optimization remains necessary. LED/connector/locked positions and board outline/tracks unchanged. Components already outside the outline before this work remain at their prior unplaced locations; this is a package revision, not completed placement/routing.

968pin/net associations unchanged. ERC0errors,184carrier/107Expansion warnings. DRCno new findings. The11previous RGBcourtyard overlaps were eliminated. Existing carrier findings(571)and module findings(5)remain; no production sign-off. Project settings unchanged.

See updated bom/mezzanine-v1/bom-carrier.csv and bom-module.csv, PDFs, and schematic-review previews/verification.json. Changes local; no commit/push performed.
