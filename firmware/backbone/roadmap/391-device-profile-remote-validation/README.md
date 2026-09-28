# Fase 391 — Validazione remota reale dei Device Profile

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Fare in modo che `VALIDATE_DEVICE_PROFILE` esegua davvero
`spaghetti_device_profile_validate` sul profilo ricevuto, invece di limitarsi a
controllare che il payload non sia vuoto.

## Perché è una fase separata

Scoperto durante l'implementazione lato Software di S063
(`software/roadmap/react-flow-v1/tasks/S063-profile-install-catalog-sources.md`):
`execute_validate_device_profile` è uno stub. Non blocca il freeze 390: l'operazione
esiste sul wire. Completarla non richiede Protocol V2.

## Task

1. ✅ [TASK-391-01 — Validare i Device Profile sul wire](TASK-391-01-validare-device-profile-sul-wire.md)

## Criteri di completamento della fase

- [x] `VALIDATE_DEVICE_PROFILE` chiama il validatore reale, non un controllo di
      non-vuotezza.
- [x] Un profilo malformato viene rifiutato da `VALIDATE_DEVICE_PROFILE` con lo stesso
      esito che avrebbe da `INSTALL_DEVICE_PROFILE`.

Follow-up Software (non questo task): README di `device-profile-install` toglie la nota
"known stub".
