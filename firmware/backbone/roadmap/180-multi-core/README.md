# Fase 180 — Varianti Core multiple

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Spostare i dati fisici Port nelle board reali e mantenere indipendenti i livelli superiori.

## Dipende da

[Fase 170 — Discovery](../170-discovery/README.md)

## Risultato visibile

Lo stesso firmware applicativo viene compilato per due varianti Core.

Ogni catalogo descrive connessioni condivise; il numero di Port non limita il numero di
Module runtime.

## Task

1. ✅ [TASK-180-01 — Supportare più varianti Core](TASK-180-01-supportare-piu-varianti-core.md)

## Criteri di completamento della fase

- [x] Binding e board definition rispettano gli schemi Zephyr.
- [x] Il catalogo Port deriva dal Devicetree.
- [x] Il codice comune non contiene rami basati sul nome della board.
