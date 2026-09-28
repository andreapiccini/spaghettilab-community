# Fase 370 — MQTT per Node-RED V1

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Usare MQTT come adapter bidirezionale del protocollo V1, con topic stabili, risposte
correlate e TLS configurabile per rendere Node-RED il livello di automazione esterno.

## Task

1. ✅ [TASK-370-01 — Collegare MQTT e Node-RED](TASK-370-01-collegare-mqtt-e-node-red.md)

## Criteri di completamento della fase

- [x] Record, stato e candidati sono pubblicati in forma generica.
- [x] Config e comandi entrano attraverso Communication.
- [x] Node-RED riceve una risposta correlata per ogni richiesta accettata.
- [x] Un Config Coordinator esegue read/merge/validate/apply senza lost update.
- [x] MQTT è opzionale per profilo e rilascia lifecycle/workspace quando viene fermato.
