# BKL 10122225 — dual-entry 2x8 fit test

Added 2026-11-01 to the **main carrier schematic and PCB** as J17/J18. These are disconnected samples, excluded from production BOM, DNP disabled for 3D visibility. Existing Harwin, tall CJT test pair, wiring, locked footprints, outline and routing preserved. Two new test parts are on B.Cu at (216,132) and (216,146)mm, outside the board outline; move them for mechanical comparisons. Not installed in the Harwin positions and not ready for fabrication.

## Identity and availability

- BKL **10122225**, 2 rows x8 contacts, dual entry, pitch2.54mm, socket row spacing2.54mm, height5mm.
- Manufacturer confirms16contacts; Reichelt has inconsistent selector fields (2x16) but title and manufacturer identify2x8. Do not substitute part10122230 (2x6).
- Reichelt listed0.59EUR each including19% German VAT, shipping excluded. Not a1000unitquote. No verified LCSC SKU found for this BKL part or an exact economical equivalent as of this search; do not assign a guessed LCSC code.
- User recognizes the construction as Tibbo's; identical manufacturer/MPN on Tibbo has NOT been independently verified.

## CAD status

No official BKL symbol, footprint or STEP was located. Custom passive16pin symbol and dimensional fit footprint prepared from the **10122225** drawing. Custom VRML mechanical envelope is clearly identified as generated, not manufacturer CAD. Body20.72x5x5mm (length0.4+2.54x8), with16through bores and simplified gold contacts/tails. Height and body size are useful for fit studies; the contact spring geometry is illustrative, not qualified for insertion simulation.

The2x8 drawing differs from the2x6: solder tails are at5.08mm across the rows, while insertion bores are2.54mm apart. Nominal1.0mm solder holes and1.0mm unplated pass-through holes are modeled. Oval1.8x1.3mm solder lands are **provisional**, not manufacturer-specified land sizes. Adjacent solder/pass-through centers are only1.27mm apart: copper-to-hole clearance, annular ring and fabricator rules require review/sample confirmation before production. Pin numbering uses the project's odd/even convention; no numbered manufacturer pin1 drawing was found. No manufacturing compatibility is implied merely by matching pitch.

- Symbol/footprint: SpaghettiLAB:BKL_10122225_2x08_DualEntry_FitTest.
- 3D file: hardware/libraries/SpaghettiLAB.3dshapes/BKL_10122225_Envelope_20.72x5x5mm.wrl.
- Source: https://cdn-reichelt.de/documents/datenblatt/C140/10122225_DB-EN.pdf
- Product: https://www.bkl-electronic.de/buchsenleiste-zweireihig-mit-dual-entry-2x8-polig-gerade-vergoldet-raster-2-54mm-bauhoehe-5-0mm-nicht-trennbar-10122225
- Retailer: https://www.reichelt.de/de/de/shop/produkt/buchsenleiste_zweireihig_mit_dual_entry_2x8-297863

## Verification

All preexisting schematic and PCB objects preserved; original net partitions unchanged. ERC0errors/184existingwarnings, no warning associated with J17/J18. Main project settings unchanged. Models opened and rendered in KiCad; explicit VRML mesh coordinates use2.54mm units, checked against the known-size CJT comparator. All existing R/C0603unchanged. No routing or production BOM change; no commit/push requested in this turn.
