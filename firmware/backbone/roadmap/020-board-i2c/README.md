# Fase 020 — Scheda attuale / I2C

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Descrivere e abilitare il controller I2C realmente collegato agli Spaghetti Port.

## Dipende da

[Fase 010 — Core](../010-core/README.md)

## Risultato visibile

Il Devicetree generato contiene il controller I2C reale, con pin e stato corretti.

## Task

1. ✅ [TASK-020-01 — Verificare e abilitare I2C](TASK-020-01-verificare-e-abilitare-i2c.md)

## Criteri di completamento della fase

- [x] Controller e pin sono verificati sullo schema reale.
- [x] L’overlay contiene soltanto dati hardware statici.
- [x] `CONFIG_I2C=y` e il nodo abilitato compaiono nei file generati.
