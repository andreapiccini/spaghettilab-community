# Hardware sources

The Community repository tracks the editable KiCad projects required to study,
modify and build the public hardware: project, schematic, PCB, symbol, footprint
and related source assets.

Generated manufacturing outputs are intentionally not tracked. This includes
`production/` directories, Gerber and drill files, pick-and-place exports, BOMs,
netlists, fabrication ZIP archives and fabrication-toolkit local options. Generate
them from the reviewed KiCad sources when needed; official manufacturing releases
and production controls are maintained separately.

The ignore rules do not provide confidentiality for files already published in Git
history. They only prevent generated outputs from being added in future commits.

## Backbone V3

Open the [Backbone V3 KiCad project](backbone-v3/backbone-v3.kicad_pro) or the [interactive front panel preview](backbone-v3/anteprima-interattiva.html).

## KiCad library policy

Each public schematic embeds the symbols it uses and each public PCB embeds its
placed footprints, so the existing designs can be opened and edited without the
private Production repository. External 3D models are optional visualization assets:
missing models must not prevent schematic or PCB work.

Do not copy vendor 3D models or global workstation libraries into Community until
their origin and redistribution licence are recorded. New reusable public symbols or
footprints should be added as project-local, redistributable source assets rather
than relying on a developer's global KiCad configuration.
