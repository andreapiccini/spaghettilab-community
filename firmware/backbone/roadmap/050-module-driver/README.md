# Fase 050 — Module + Module Driver

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Separare key stabile, ID runtime, Port condivisa ed endpoint dalle operazioni INA219 e
normalizzare bus voltage, current e power in un campione copiabile.

## Dipende da

[Fase 040 — Sezione verticale INA219](../040-ina219/README.md)

## Risultato visibile

INA219 viene usato soltanto tramite una tabella di operazioni.

## Task

1. ✅ [TASK-050-01 — Introdurre Module e Module Driver](TASK-050-01-introdurre-module-e-driver.md)

## Criteri di completamento della fase

- [x] Instance, sample e tabella operazioni hanno contratti espliciti.
- [x] Il descrittore INA219 è immutabile.
- [x] L’endpoint distingue più istanze dello stesso driver sulla stessa Port.
- [x] Il chiamante non dipende più direttamente dal wrapper.
