# Fase 392 — Esporre flash headroom e RAM statica su `GET_RESOURCES`

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Far arrivare sul wire `GET_RESOURCES` (op 21) i campi di `struct
spaghetti_resources_snapshot` che oggi esistono solo lato C: `flash_slot_bytes`,
`flash_image_budget_bytes`, `flash_headroom_bytes`, `static_ram_budget_bytes`.

## Perché è una fase separata

Scoperto durante S093 (`software/roadmap/react-flow-v1/tasks/S093-status-health-resources.md`).
Estensione **append-only** delle chiavi CBOR 8–11: compatibile con V1.

## Task

1. ✅ [TASK-392-01 — Esporre flash headroom e RAM statica su GET_RESOURCES](TASK-392-01-esporre-flash-e-ram-su-get-resources.md)

## Criteri di completamento della fase

- [x] `GET_RESOURCES` espone flash headroom e RAM statica come campi distinti, separati
      dai `ResourcePool` esistenti.

Follow-up Software (non questo task): `@spaghettilab/core-status` legge i nuovi campi.
