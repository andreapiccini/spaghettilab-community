# Mezzanine CAD provenance —2026-10-31

LCSC/EasyEDA imported with easyeda2kicad1.0.1: C25469661082-061402LF, C46461061083-061402LF, C128396TS3USB221ARSER. Source conversion files retained in the task workspace outputs/mezzanine-layout/cad.

Footprints are local LCSC_Mezzanine.pretty; matching VRML models in LCSC_Mezzanine.3dshapes. Unnumbered peg holes corrected to NPTH. Plug61083 lands corrected to0.50×2.00mm per Amphenol drawing61083 sheet6; pitch0.8, row centers±2.2mm and pegs±14.1mm. USB pads adjusted to TI RSE0010A example0.25×0.55 and0.60×0.30mm, row span1.35/end span1.80mm. Pin numbers unchanged.

The raw BergStak STEP models had a different origin from their converted VRML in KiCad STEP substitution. They are deliberately NOT shipped beside the VRML, to avoid silently misaligned STEP exports; originals remain in the workspace CAD source folder. Use native VRML assembly preview and do not claim a validated STEP assembly.

Manufacturer references: https://cdn.amphenol-cs.com/media/wysiwyg/files/drawing/61083.pdf ; drawing61082 via https://www.rxelectronics.kr/datasheet/03/61082-202002.pdf ; https://www.ti.com/lit/ds/symlink/ts3usb221a.pdf . Local differences are engineering adaptations; physical connector/header fit remains unqualified.
