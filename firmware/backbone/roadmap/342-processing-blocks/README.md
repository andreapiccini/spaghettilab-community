# Fase 342 — Blocchi di elaborazione dichiarativi

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Eseguire sul Core pipeline bounded composte da blocchi firmware catalogati, mentre il
Config descrive istanze e collegamenti senza introdurre codice nuovo.

## Task

1. ✅ [TASK-342-01 — Implementare blocchi di elaborazione dichiarativi](TASK-342-01-implementare-blocchi-elaborazione-dichiarativi.md)

## Criteri di completamento della fase

- [x] I blocchi si auto-registrano e dichiarano schema, costi e stato.
- [x] Config rappresenta un DAG validabile, non un grafo UI-specifico.
- [x] Pipeline aritmetiche e stateful elaborano record generici.
- [x] Un tipo di blocco assente è rifiutato prima dell'apply.
