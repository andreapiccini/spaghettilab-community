# Fase 367 — Handover BLE verso Wi-Fi

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Permettere a un peer BLE autenticato di aprire per tempo limitato Wi-Fi,
manutenzione di rete oppure OTA Wi-Fi.

## Task

1. ✅ [TASK-367-01 — Attivare Wi-Fi da BLE](TASK-367-01-attivare-wifi-da-ble.md)

## Criteri di completamento della fase

- [x] Lease, manutenzione e OTA Wi-Fi sono operazioni separate con permessi distinti.
- [x] Wi-Fi generico non apre OTA o console.
- [x] Timeout ripristina LOW_ENERGY; ack precede l'eventuale disconnect BLE.
