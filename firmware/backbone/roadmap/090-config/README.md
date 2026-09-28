# Fase 090 — Config interna

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Definire, validare e applicare la più piccola configurazione interna del prodotto.

## Dipende da

[Fase 080 — INA219 rimovibile a runtime](../080-runtime-removable-ina219/README.md)

## Risultato visibile

Una Config C assegna due key INA219 a Port 0 con address/calibrazioni distinte e
seleziona la sorgente Runtime per key.

## Task

1. ✅ [TASK-090-01 — Implementare Config](TASK-090-01-implementare-config.md)

## Criteri di completamento della fase

- [x] Proprietà e durata delle stringhe sono esplicite.
- [x] La validazione non modifica lo stato.
- [x] Port duplicate sono valide; key o endpoint duplicati sono rifiutati.
- [x] L’applicazione usa API pubbliche e gestisce rollback.
