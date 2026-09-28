# Fase 100 — Config persistente

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Salvare e ricaricare soltanto la Config interna già validata.

## Dipende da

[Fase 090 — Config interna](../090-config/README.md)

## Risultato visibile

La configurazione valida sopravvive a un riavvio reale.

Key e più elementi sulla stessa Port vengono ripristinati senza dipendere dai Module ID
runtime precedenti.

## Task

1. ✅ [TASK-100-01 — Rendere Config persistente](TASK-100-01-rendere-config-persistente.md)

## Criteri di completamento della fase

- [x] Il contratto storage è provato prima con backend RAM.
- [x] La partizione flash non si sovrappone ad altre regioni.
- [x] Record assente o corrotto ha un comportamento deterministico.
