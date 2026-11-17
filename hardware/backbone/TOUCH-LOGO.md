> Revisione corrente: vedere V3-OPTICAL-STYLE.md per simboli copiati dalla V3, touch anulari e quattro LED aggiunti; le descrizioni precedenti qui sotto sono storiche.

# Four touch controls and illuminated wordmark

Board dimensions, antenna keepouts, removable ESP32 socket, pogo alignment, user Qwiic and dedicated SPI are preserved. All mounted additions are on F.Cu. The four touch electrodes are covered copper on B.Cu, with no solder-mask opening and no assembly required.

## Touch hardware

- U76: HOLTEK BS8116A-3, SSOP-20 3.9 x 8.7 mm, LCSC **C89208**. Do not substitute C115090 (larger SOP package).
- 3.3 V VCORE supply, C414 100 nF and C415 1 uF decoupling.
- Existing internal I2C: SDA GPIO47 and SCL GPIO48, 7-bit address **0x50**. Polling does not consume an ESP GPIO or boot pin. Start at 100 kHz; support clock stretching.
- TE1 PLUS: KEY1/pad19. TE2 MOD: KEY2/pad20. TE3 PLAY_PAUSE: KEY3/pad1. TE4 LOAD_SAVE: KEY4/pad2.
- KEY5–16 left floating per Holtek datasheet. Disable unused channels and IRQ; configure individual sensitivity and debounce in firmware. Playback, mode and load/save semantics require firmware implementation.
- Four 5 mm electrodes with copper-pour exclusion on both outside layers and routing/plane exclusion on the inner layers. Existing front-side components remain; assess parasitic coupling and sensitivity with the real PCB, USB power and intended enclosure. Route the sensor traces short and away from switching nodes in the final routing pass.

## Four-row indicators and complete illuminated logo

The 64 port LEDs D700–D763 are arranged in four separate horizontal rows per group: **VCC, ground, MCU, X/Hi-Z**. Both upper and lower groups have eight columns, one per port. Rear symbols are tilted 45 degrees and enlarged by about 70% in linear size relative to the previous compact 2 x 2 layout. VCC uses separate vector letters with a nominal 0.8 mm letter height and 0.12 mm strokes. These are mask apertures, not printed silk text.

The front LEDs are all tilted uniformly (135 degrees in PCB coordinates, a 45-degree tilt relative to vertical). The previous 0603 packages and all electrical mappings are retained:

| State | LED | LCSC | Color |
| --- | --- | --- | --- |
| VCC | XL-1608UYC-04 | C965803 | Yellow |
| GND | XL-1608UBC-04 | C965807 | Blue |
| MCU | XL-1608UGC-04 | C965804 | Green |
| Hi-Z | XL-1608UWC-04 | C965808 | White |

Each source has a front lens entrance with an all-layer copper exclusion. The enlarged rear symbol area is clear of copper on B.Cu and both inner layers. Front pours are excluded; the LEDs retain their front solder lands and routing access. This permits a symbol larger than the source LED without placing a copper plane directly behind the rear aperture. Keep the optical exclusions during routing.

The six connector rows are shifted another 1.6 mm toward the antenna relative to the previous 2 x 2 version. The central DIP spacing remains 7.62 mm; same-group row pitch remains 4.3 mm. Pogo and touch positions, antenna keepouts, removable ESP32 socket, dedicated SPI, user Qwiic and PCB outline remain unchanged. The board is still approximately 41.5 x 85.5 mm.

The complete supplied logo is traced directly, including its original **SPAGHETTI / LAB** lettering. To preserve the outline and larger four-row indicators, the complete logo is reduced to about **10.9 x 9.4 mm**. `logo-mark.svg` is the corresponding editable vector. Its 51 filled polygons form the actual rear mask apertures; it is not a separate substitute text label.

D780–D795 form a **regular 4 x 4 grid**, at **3.0 mm horizontal and 2.3 mm vertical pitch**, all with the same orientation. The sixteen existing white LEDs and CB matrix assignments are unchanged: no extra driver, LED or ESP GPIO is added. The entire rear and inner logo rectangle is free of copper, front pours are excluded, and each LED has a clear front lens entrance. Front lands and traces may occupy the front logo region; the internal FR4 light path and rear aperture remain clear.

`logo-led-map.json` retains [reference, cathode CB number, anode CB number, schematic UUID]. `logo-led-placement.json` gives the ordered grid coordinates. `port-indicators-map.csv` and `optical-placement.json` describe state and position for the CA bank. The IS31FL3731 manufacturer's LED mapping must be used when generating firmware register addresses.

All 80 LEDs retain the local dimensional 3D models in `OpticalLED.3dshapes`, showing a 1.6 x 0.8 x 0.4 mm package with lens toward FR4. These are simplified visualization models, not vendor-qualified mechanical models.

The optical footprints remain **prototype hand-assembly footprints**, lens toward FR4. Validate solderability, brightness, legibility at the intended viewing distance, crosstalk and illumination uniformity on a physical sample. FR4 transmission depends on stackup, resin and solder mask; the 3D preview verifies geometry and placement, not illuminated performance.

## Checks and fabrication status

Every existing schematic pin/net was compared and preserved. Four touch channels, power, internal I2C and all 16 unique CB pairs were checked. No new ERC, DRC or schematic-parity violations relative to the saved baseline. The board still has pre-existing violations and unrouted connections; this is an updated placement, not a fabrication-ready or hardware-tested design.

References:
- https://www.holtek.com/webapi/116711/BS81xA-xv170.pdf
- https://www.lcsc.com/product-detail/C89208.html
- https://www.lcsc.com/product-detail/C965808.html

Historical indicative catalog pricing consulted 2026-11-17: C89208 about USD 0.69 each, MOQ 1; C965808 about USD 0.0049 each at MOQ 100 (about USD 0.49 for the lot; 16 LEDs about USD 0.08 per board). Prices exclude shipping, tax, PCB and assembly. Verify availability and checkout price before ordering.
