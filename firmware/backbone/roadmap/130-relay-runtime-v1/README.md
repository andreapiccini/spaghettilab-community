# Fase 130 — Relay + Runtime V1

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Aggiungere un attuatore Relay e una regola di soglia deterministica.

## Dipende da

[Fase 120 — Runtime V0](../120-runtime-v0/README.md)

## Risultato visibile

Una corrente sopra 500 mA comanda il Relay; sotto 450 mA applica lo stato opposto.

## Task

1. ✅ [TASK-130-01 — Aggiungere Relay e la regola di soglia](TASK-130-01-aggiungere-relay-e-regola-di-soglia.md)

## Criteri di completamento della fase

- [x] Il Relay parte e termina nello stato sicuro.
- [x] I comandi passano dal Module Manager.
- [x] La regola usa isteresi o comportamento al limite documentato.
