# Fase 390 — Finalizzazione piattaforma V1

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Dimostrare con fake, test e build che le estensioni non richiedono modifiche centrali e
congelare il contratto usato da Node-RED.

## Task

1. ✅ [TASK-390-01 — Chiudere e qualificare la piattaforma V1](TASK-390-01-chiudere-e-qualificare-la-piattaforma-v1.md)

## Criteri di completamento della fase

- [x] Driver, Device Profile, Block, regola e provider fake sono estensioni esterne.
- [x] Protocollo e compatibilità sono congelati come V1.
- [x] Il gate Node-RED MQTT e BLE/gateway del piano V1 è completamente superato.
- [x] SDK, golden vector, concorrenza Config e fuzzing chiudono il contratto host.
- [x] Health Supervisor e watchdog vengono qualificati per capability reale.
- [x] Ogni profilo supera budget RAM, lifecycle e failure test.
- [x] Build differenziali decidono con misure fra immagine universale e Capability Pack opzionali.

Gate hardware 1.0 / fase 290 restano **OPEN** (vedi `verification/v1/PLATFORM_REPORT.md`); `VERSION` non è 1.0.0.
