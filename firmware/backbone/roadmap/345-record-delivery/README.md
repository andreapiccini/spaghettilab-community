# Fase 345 — Consegna dei record e disconnessioni

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Definire cosa vede un client dopo un reboot o un periodo senza BLE/MQTT.
Ogni adapter ha un cursore indipendente: la conferma di un client non consuma i record
di un altro.

## Task

1. ✅ [TASK-345-01 — Gestire tempo, coda e perdite dei record](TASK-345-01-gestire-tempo-coda-e-perdite.md)

## Criteri di completamento della fase

- [x] Ring RAM bounded con cursori e ACK indipendenti per consumer.
- [x] Overflow e reboot sono discontinuità esplicite (`lost`, `boot_id`).
- [x] Capacità e consumer derivano dal profilo 291.
