# Fase 300 — Port e trasporti V1

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Rendere Port indipendente da I2C e capace di rappresentare trasporti differenti,
serializzando correttamente i controller condivisi senza dichiarare hardware fittizio.

## Task

1. ✅ [TASK-300-01 — Generalizzare Port, endpoint e trasporti](TASK-300-01-generalizzare-port-endpoint-e-trasporti.md)

## Criteri di completamento della fase

- [x] I2C corrente usa il nuovo confine Port e continua a leggere INA219.
- [x] SPI, UART, GPIO, ADC e 1-Wire hanno contratti bounded e test fake.
- [x] La board V1 dichiara ancora soltanto le capability realmente presenti.
