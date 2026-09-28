# Fase 040 — Sezione verticale INA219

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Leggere un INA219 reale con il driver Sensor incluso in Zephyr 4.4.

## Dipende da

[Fase 030 — Port](../030-port/README.md)

## Risultato visibile

`ESP32-C3 -> Port 0 -> I2C -> INA219 -> bus voltage/current/power -> LOG_INF`.

La singola istanza statica è soltanto una prova verticale; non definisce un limite di
un Module per Port.

## Task

1. ✅ [TASK-040-01 — Leggere il sensore INA219](TASK-040-01-leggere-il-sensore-ina219.md)

## Criteri di completamento della fase

- [x] Il nodo temporaneo usa il binding Zephyr 4.4 `ti,ina219`.
- [x] Bus voltage e current reali compaiono nei log; power è letto nello stesso sample.
- [x] La scorciatoia Devicetree è collegata alla sua rimozione nella fase 080.
