# Backbone V3: reverse-mount RGB indicators

Updated 2026-10-27. User requested replacement with the SK6812MINI-E already stocked and used in previous projects.

## Implemented
- LED1–LED6: SK6812MINI-E, LCSC C5149201; library symbol retained, pin layout rearranged to preserve existing sheet wiring.
- Pin mapping: 1 GND, 2 DIN, 3 VAUX, 4 DOUT. The previous SK6805-EC15 numbering is not interchangeable.
- VAUX remains 3.3 V. ALED and the LED1 → LED6 chain are preserved. Full netlist comparison passed after mapping pin numbers by function.
- Six bottom footprints replaced and spaced at 3.3 mm pitch. Solid FR4 optical windows, without board cutouts. PCB remains unrouted.
- Added a dedicated reverse-mount footprint and STEP model from the installed official KiCad 10 LED_SMD library; original imported MINI-E footprint preserved. Source: https://gitlab.com/kicad/libraries/kicad-footprints and https://gitlab.com/kicad/libraries/kicad-packages3D (KiCad library license, CC-BY-SA-4.0 with exception). Model referenced by project-relative path.

## Qualification still open
- 3.3 V is below the documented 3.7 V minimum. User reports prior use of these LEDs; this is not a bench qualification of this board or lot.
- XIAO1key documents a MINI-E powered from 3.3 V: https://kurihara.hatenadiary.jp/entry/2022/09/11/190307 and https://kurihara.hatenadiary.jp/entry/2022/09/17/124146 . This is evidence of feasibility, not a supplier guarantee.
- Test blue/white, all six LEDs, startup, and ESP32 radio load on actual hardware.
- Schematic comparison: no changes to connected functions; ERC error count unchanged at 13 in the isolated before/after check.
- PCB is not production-ready: routing remains open and existing bottom artwork still intersects some pads/outline of the wider LED row (outside the optical windows). The former copper-to-cutout clearance issue is superseded: LED cutouts were removed. Check mechanical fit before fabrication.

## Alternatives considered
SK6812MINI-E selected by user because already available. WS2812C-2020 and SK6812D-EC3210R reverse mounting examples exist, but were not selected. Reference: https://github.com/skeletonkbd/reverse-mount-led-keyboard .

## 2026-10-27: solid FR4 optical windows (supersedes cutout mounting)
User explicitly wants light transmitted through intact FR4 and reports successful use of manually bent MINI-E leads on previous boards. All six LED cutouts removed. Dedicated `LED_SK6812MINI-E_FR4_Window_HandFormed` footprint selected in sheet/library/PCB, preserving the standard reverse-mount footprint.

Clear solder-mask window: 3.2 x 2.8 mm in library orientation, 2.8 x 3.2 mm on the current rotated PCB placements, on both F.Mask and B.Mask. Tracks, vias, pads and pours excluded from a slightly larger window (0.1 mm margin) on all four board copper layers. Current optical windows are clear of silkscreen; future artwork must also avoid them. Filled copper must be regenerated after subsequent layout changes.

Hand assembly required: bend leads to lift the LED body clear of FR4. Existing STEP model depicts the stock part, not bent leads or qualified standoff height. Optical output/colour and mechanical clearance remain to be tested on the actual board thickness. No change to LED pinout, chaining or VAUX supply. DRC parsed the revised PCB successfully; overall layout remains unfinished. No commit/push performed for this change.

## Row alignment update
LED row aligned at Y=110.825 mm, 3.3 mm pitch; current physical order preserved. Courtyard narrowed to 3.2 mm for hand assembly. Row shifted left 1.2 mm to clear J5 courtyard. No LED courtyard/clearance/short/keepout violations in targeted check.
