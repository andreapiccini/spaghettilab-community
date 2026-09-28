# Fase 120 — Runtime V0

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Spostare il campionamento periodico da `main` a un servizio Runtime dedicato.

## Dipende da

[Fase 110 — Data / zbus](../110-data-zbus/README.md)

## Risultato visibile

Runtime campiona ogni 1000 ms mentre `main` esegue soltanto il boot.

Config seleziona la sorgente per key; Runtime conserva l’ID risolto, mai la sola Port.

## Task

1. ✅ [TASK-120-01 — Implementare Runtime V0](TASK-120-01-implementare-runtime-v0.md)

## Criteri di completamento della fase

- [x] Il timer non esegue I/O.
- [x] Il thread possiede il campionamento e pubblica tramite Data.
- [x] Start, stop e nuova configurazione hanno semantica definita.
