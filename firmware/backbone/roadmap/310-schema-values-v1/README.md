# Fase 310 — Schemi e valori V1

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Definire proprietà, record e descrittori tipizzati comuni a Config, driver, Data,
Runtime, Communication e Node-RED.

## Task

1. ✅ [TASK-310-01 — Introdurre schemi e valori tipizzati](TASK-310-01-introdurre-schemi-e-valori-tipizzati.md)

## Criteri di completamento della fase

- [x] Nessun valore wire dipende dal layout di una struct C.
- [x] Tipi, field ID, unità e limiti sono validabili e descrivibili.
- [x] Testo UTF-8, enum, default e interi a 64 bit hanno un mapping Node-RED lossless.
- [x] Capacità e dimensioni restano statiche.
- [x] Boot ID, uptime e sequence distinguono correttamente reboot e rollover.
