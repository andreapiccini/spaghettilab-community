# Fase 110 — Data / zbus

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Distribuire campioni immutabili a più consumer tramite zbus.

## Dipende da

[Fase 100 — Config persistente](../100-storage/README.md)

## Risultato visibile

Un campione bus voltage/current/power raggiunge logger e un secondo consumer.

Il messaggio contiene sia l’ID runtime sia la key stabile della sorgente, così due
Module sulla stessa Port restano distinguibili.

## Task

1. ✅ [TASK-110-01 — Distribuire i campioni con zbus](TASK-110-01-distribuire-i-campioni-con-zbus.md)

## Criteri di completamento della fase

- [x] Il messaggio contiene solo dati copiabili e con unità definite.
- [x] Canale e subscriber hanno capacità limitate.
- [x] Backpressure e code piene sono provate esplicitamente.
