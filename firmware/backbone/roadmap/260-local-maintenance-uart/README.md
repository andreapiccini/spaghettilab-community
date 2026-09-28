# Fase 260 — Manutenzione locale dalla base

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Usare la base per provisioning e recovery senza USB, con un ingresso fisico non
attivabile da un sensore.

## Task

1. ✅ [TASK-260-01 — Aggiungere provisioning e update UART dalla base](TASK-260-01-aggiungere-la-manutenzione-uart.md)

## Criteri di completamento della fase

- [x] Il pinmux è scelto dal backend board, non dai servizi comuni.
- [x] Config assente abilita direttamente UART; Config valida usa probe o reboot one-shot.
- [x] Runtime e Module sono fermi prima di lasciare I2C.
- [x] Config/Wi-Fi e firmware usano frame bounded e versionati.
- [x] Il timeout Update scarta upload incompleti senza toccare l'immagine attiva.
