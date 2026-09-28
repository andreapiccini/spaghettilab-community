# Fase 305 — Power topology e admission

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Estendere il Power Manager distinguendo rail passive, controllabili e misurabili.
Una base economica con jumper resta valida e segnala semplicemente che la
selezione non è verificabile dal firmware.

## Task

1. ✅ [TASK-305-01 — Generalizzare rail e Power admission](TASK-305-01-generalizzare-rail-e-power-admission.md)

## Criteri di completamento della fase

- [x] Rail unmanaged, switched e measured condividono lo stesso contratto.
- [x] Ogni Bay espone solo le rail fisicamente raggiungibili.
- [x] Zero nei limiti significa sconosciuto, non falsa sicurezza.
- [x] Attach/detach e rollback sono verificati con owner fake su native_sim.
