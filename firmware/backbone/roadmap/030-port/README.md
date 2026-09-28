# Fase 030 — Port

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Creare l’astrazione Port 0 e associarla al device I2C pronto di Zephyr.

## Dipende da

[Fase 020 — Scheda attuale / I2C](../020-board-i2c/README.md)

## Risultato visibile

Port 0 espone capacità I2C e restituisce un device pronto.

Port 0 è un accesso condiviso: non possiede uno stato “occupato” e può essere
riferita contemporaneamente da più Module con endpoint diversi.

## Task

1. ✅ [TASK-030-01 — Implementare Port 0](TASK-030-01-implementare-port-zero.md)

## Criteri di completamento della fase

- [x] ID e capacità Port hanno tipi pubblici chiari.
- [x] Il descrittore hardware resta privato.
- [x] ID non validi e device non pronti producono errori precisi.
