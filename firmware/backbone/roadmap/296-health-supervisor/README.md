# Fase 296 — Health supervisor e watchdog

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Rilevare worker bloccati, usare il watchdog hardware quando la board lo espone e
rendere visibile la causa dell'ultimo riavvio senza permettere a un singolo thread di
nascondere un guasto globale.

## Task

1. ✅ [TASK-296-01 — Implementare health supervisor e watchdog](TASK-296-01-implementare-health-supervisor-e-watchdog.md)

## Criteri di completamento della fase

- [x] Solo il supervisor alimenta il watchdog hardware.
- [x] I componenti essenziali pubblicano heartbeat con deadline bounded.
- [x] Update e flash usano finestre temporanee, non disabilitano il controllo.
- [x] Reset cause e componente stale sono leggibili via `spaghetti_health_get_status()` (Protocol GET_STATUS in 360).
- [x] Una board senza watchdog dichiara l'assenza e mantiene health software.
