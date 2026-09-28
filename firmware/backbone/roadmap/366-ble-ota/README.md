# Fase 366 — OTA tramite BLE

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Collegare il trasporto BLE al coordinatore Update e agli slot A/B già
esistenti, senza duplicare la scrittura flash.

## Task

1. ✅ [TASK-366-01 — Aggiornare il Core via BLE](TASK-366-01-aggiornare-il-core-via-ble.md)

## Criteri di completamento della fase

- [x] BLE usa Update Coordinator senza secondo writer flash.
- [x] Un solo trasporto possiede la sessione.
- [x] Resume/cancel/timeout sono bounded e non toccano l'immagine confermata.
