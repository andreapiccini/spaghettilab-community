# Fase 280 — Console remota

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Usare lo stesso monitor gradevole via USB o rete senza esporre una Telnet non protetta.

## Task

1. ✅ [TASK-280-01 — Rendere make monitor multi-trasporto](TASK-280-01-rendere-monitor-multi-trasporto.md)

## Criteri di completamento della fase

- [x] `make monitor` seleziona USB oppure rete esplicitamente.
- [x] Il canale remoto è cifrato, autenticato e disabilitabile.
- [x] Comandi e log mantengono framing e formattazione.
- [x] Una sessione lenta non blocca Runtime o Communication.
