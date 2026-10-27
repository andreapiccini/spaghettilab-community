# FlexyPin 3D model

Official Solder Party STEP model, downloaded on 2026-10-27:
https://github.com/solderparty/flexypin/blob/main/3d/flexypin.step

SHA-256: `54df960d09539f905216e34e2b8aee2a170d97580b5402172c693fd22a913530`.
The file is byte-identical to the upstream download and to the existing copy
under `flexypin/3d/`. No geometry, units or materials were modified.

## Shared library and Backbone
The shared model is `SpaghettiLAB.3dshapes/flexypin.step`.
The 40 placed FlexyPin contacts on the V3 Backbone reference it directly via
`${KIPRJMOD}/../libraries/SpaghettiLAB.3dshapes/flexypin.step`.
Offsets, rotations, scale, pads, tracks and electrical connectivity are unchanged.
The project-relative reference travels with the repository across Windows/macOS.

The separate FlexyPin footprint library retains its existing variable-based
references and original model copy for compatibility. Updating placed footprints
from that library may restore `${SPAGHETTILAB_FLEXYPIN_3D}` references. If this
happens, restore the explicit path above in the footprint 3D model settings,
retaining each contact placement. Other project depths require the corresponding
relative path to `hardware/libraries`.

## Attribution and licence status
Author/source: Solder Party, official FlexyPin repository. The upstream root and
README consulted do not declare a redistribution licence. This provenance note
does not assign the spaghettiLAB project licence to the third-party model or
assert a new licence grant. The model was already present in the V3 repository;
this change adds the requested shared-library location without changing it.

## ESP32-S3 module model
The socket also uses the existing `flexypin/3d/ESP32-S3-WROOM-1.step`.
The placed Backbone socket now resolves that model through
`${KIPRJMOD}/../libraries/flexypin/3d/ESP32-S3-WROOM-1.step`
instead of the custom path variable. Its offset (0, -5.26, 0), scale and
rotation are preserved. No replacement or download of module geometry was needed.
