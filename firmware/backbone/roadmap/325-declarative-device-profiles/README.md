# Fase 325 — Profili dispositivo dichiarativi

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Permettere di aggiungere dispositivi I2C, SPI, UART, GPIO e analogici descrivendo
transazioni, campi e conversioni in un profilo bounded, senza compilare un driver per
ogni modello di sensore.

## Task

1. ✅ [TASK-325-01 — Implementare profili dispositivo e acquisition plan](TASK-325-01-implementare-profili-dispositivo-dichiarativi.md)

## Criteri di completamento della fase

- [x] Un solo Module Driver generico esegue profili per più dispositivi e trasporti.
- [x] Profili e Config di installazione hanno identità, versione e ownership separate.
- [x] Ogni piano è validato e bounded prima di qualsiasi I/O.
- [x] Un nuovo profilo compatibile non richiede aggiornamento firmware.

## Trasporti

L'interprete copre I2C, SPI (mode 0..3), UART (`READ_UNTIL` e `READ`), GPIO
(`GET`/`SET`/`WAIT_GPIO`), ADC e 1-Wire (`W1_WRITE_READ`, ROM in Config).
CAN/USB/PWM non sono famiglie Port e restano fuori da questa via.
