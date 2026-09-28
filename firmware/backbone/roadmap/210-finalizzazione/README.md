# Fase 210 — Finalizzazione

**Stato:** 🟨 IN PROGRESS

[← Indice roadmap](../README.md)

## Obiettivo

Rimuovere tutti gli artefatti temporanei dei task, verificare il firmware completo e
dimostrare che un nuovo Module Driver non richiede modifiche ai livelli centrali.

## Dipende da

[Fase 200 — Engine completo](../200-engine/README.md)

## Risultato visibile

Il repository non contiene scorciatoie di bring-up attive; il Core avvia l’engine sia
senza moduli sia con Config runtime, e un fake driver di test attraversa Registry e
Manager senza modificare Core, Config, Runtime o Data.

## Task

1. 🟨 [TASK-210-01 — Ripulire e qualificare il firmware completo](TASK-210-01-ripulire-e-qualificare-il-firmware.md)

## Criteri di completamento della fase

- [x] Non rimangono wrapper, nodi, loop o valori temporanei di sviluppo.
- [x] Tutti i percorsi di boot, apply, rollback, remove e reboot sono verificati *(fake/native)*.
- [x] L’estensione con un nuovo driver non modifica i sottosistemi centrali.
- [ ] Matrice hardware INA219/Relay/fault/PCB — **OPEN** (fase 290 / PLATFORM_REPORT).
- [ ] La matrice include almeno due endpoint simultanei sulla stessa Port.
- [ ] Il repository è validato e costruisce da una directory build pulita.
