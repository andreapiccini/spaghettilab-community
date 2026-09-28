# Fase 080 — INA219 rimovibile a runtime

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Rimuovere il device INA219 statico e mantenere le misure tramite Port e I2C diretto.

## Dipende da

[Fase 070 — Module Manager](../070-module-manager/README.md)

## Risultato visibile

Due INA219 vengono creati a `0x40` e `0x41` sulla stessa Port, con context separati e
senza nodo sensore Devicetree.

## Task

1. ✅ [TASK-080-01 — Rendere INA219 configurabile a runtime](TASK-080-01-rendere-ina219-configurabile-a-runtime.md)

## Criteri di completamento della fase

- [x] Il driver usa `spaghetti_port_i2c_device(port)` e API I2C Zephyr dirette.
- [x] Configurazione, calibrazione, byte order, conversion-ready e overflow sono gestiti.
- [x] Non rimangono device o dipendenze Sensor specifiche di INA219.
- [x] Il driver usa uno slab statico tipizzato e non `SPAGHETTI_MODULE_CONTEXT_SIZE`.
