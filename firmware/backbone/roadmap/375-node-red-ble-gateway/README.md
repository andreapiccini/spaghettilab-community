# Fase 375 — Gateway BLE per Node-RED

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Dimostrare che Node-RED può usare il Protocol V1 senza obbligare ogni Core a
mantenere MQTT e Wi-Fi.

Il gateway conserva il Protocol V1, inclusi principal, replay, errori e concorrenza
Config; non introduce un'API alternativa per Node-RED.

## Task

1. ✅ [TASK-375-01 — Collegare BLE a Node-RED](TASK-375-01-collegare-ble-a-node-red.md)

## Criteri di completamento della fase

- [x] Gateway espone envelope V1 su WebSocket senza seconda API.
- [x] Segreti fuori da repo/argv; retry dipende dalla replay cache del Core.
- [x] Flow BLE con Config Coordinator CAS e schemi multipli.
