# Fase 060 — Driver Registry

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Associare un nome di tipo stabile al descrittore del relativo Module Driver.

## Dipende da

[Fase 050 — Module + Module Driver](../050-module-driver/README.md)

## Risultato visibile

La ricerca di `ina219` riesce; un tipo sconosciuto viene rifiutato.

Lo stesso descrittore può servire più istanze contemporanee sulla stessa Port.

## Task

1. ✅ [TASK-060-01 — Implementare il Driver Registry](TASK-060-01-implementare-il-driver-registry.md)

## Criteri di completamento della fase

- [x] La tabella driver è fissa e validata all’avvio.
- [x] Nomi duplicati o descrittori incompleti vengono rifiutati.
- [x] Validate-config e describe-endpoint sono obbligatorie e pure.
- [x] Core inizializza il registry prima di usarlo.
