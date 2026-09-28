# Fase 365 — Protocollo Spaghetti su BLE

[← Indice del backlog](../README.md)

**Stato:** 🟨 IN PROGRESS

## Obiettivo

Trasportare lo stesso Protocol V1 su Bluetooth Low Energy con autenticazione
applicativa e risorse bounded.

Autenticazione, principal, replay e cursore dei record restano contratti comuni: BLE
non crea una seconda semantica rispetto a MQTT o USB.

## Task

1. ✅ [TASK-365-01 — Aggiungere il trasporto BLE](TASK-365-01-aggiungere-il-trasporto-ble.md)

## Criteri di completamento della fase

- [x] UUID, framing e auth applicativa sono congelati.
- [x] Capability BLE riflette `CONFIG_BT` / `bt_enable()` utilizzabile.
- [x] Record Delivery BLE ha cursore indipendente; nessuna replay cache locale.

Smoke radio fisico su Core V1: **N/A fino a flash di `make build-ble`**.
`CONFIG_BT` è acceso solo su quell'immagine; il default `make build` resta Wi-Fi.
I due stack non stanno nello stesso binario (overflow DRAM ~13–16 KiB). Lesson:
[diario SRAM C3](../../DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md).
