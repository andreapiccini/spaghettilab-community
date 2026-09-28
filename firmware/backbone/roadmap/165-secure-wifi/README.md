# Fase 165 — Profili Wi-Fi persistenti

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Salvare più reti senza password nel repository e scegliere automaticamente la rete
preferita o, se assente, quella nota col segnale migliore.

## Dipende da

[Fase 160 — MQTT](../160-mqtt/README.md)

## Risultato visibile

La shell seriale salva, elenca, preferisce e rimuove profili; dopo il reboot il Core
si riconnette senza ricevere nuovamente la password.

## Task

1. ✅ [TASK-165-01 — Salvare e selezionare reti Wi-Fi](TASK-165-01-salvare-e-selezionare-reti-wifi.md)

## Criteri di completamento della fase

- [x] La password non compare in argomenti, history, log o API di elenco.
- [x] Profili e preferenza persistono in record cifrati e autenticati.
- [x] Preferita visibile e fallback per RSSI hanno priorità deterministica.
- [x] La shell e le funzionalità precedenti restano disponibili.
