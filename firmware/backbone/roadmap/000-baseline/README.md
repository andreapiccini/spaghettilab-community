# Fase 000 — Baseline

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Confermare che ambiente, build, flash e console funzionino prima di modificare il firmware.

## Dipende da

Nessuna fase precedente.

## Risultato visibile

Il firmware iniziale viene compilato, caricato e osservato sulla console seriale.

## Task

1. ✅ [TASK-000-01 — Verificare build, flash e console](TASK-000-01-verificare-la-baseline.md)

## Criteri di completamento della fase

- [x] La build produce `build/zephyr/zephyr.bin`.
- [x] Il firmware viene caricato sulla scheda corretta.
- [x] La console mostra avvio e uptime a 115200 baud.
