# Fase 348 — Capability Pack e osservabilità risorse

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Comporre immagini firmware con feature opzionali, renderne visibile il contenuto e
misurare flash/RAM/pool/stack in modo utile per decidere quali altre capability
possono essere compilate.

## Task

1. ✅ [TASK-348-01 — Introdurre Capability Pack, manifest e resource report](TASK-348-01-introdurre-capability-pack-e-resource-report.md)

## Criteri di completamento della fase

- [x] Ogni immagine dichiara pack, dipendenze, compatibilità e consumo misurato.
- [x] OTA rifiuta immagini incompatibili prima di richiedere il trial boot.
- [x] Il Core espone risorse statiche e runtime con high-water mark.
- [x] Config usa una feature installata senza altri aggiornamenti firmware.
