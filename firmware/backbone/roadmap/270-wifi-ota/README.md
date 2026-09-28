# Fase 270 — OTA Wi-Fi

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Caricare un'immagine firmata via Wi-Fi senza lasciare una porta di update sempre aperta.

## Task

1. ✅ [TASK-270-01 — Aggiungere OTA Wi-Fi autenticato](TASK-270-01-aggiungere-ota-wifi-autenticato.md)

## Criteri di completamento della fase

- [x] Il trasporto apre soltanto durante una finestra armata.
- [x] Il peer viene autenticato con DTLS-PSK e l'immagine resta firmata.
- [x] Disconnessione/timeout non toccano il firmware attivo.
- [x] La nuova immagine parte come trial e può fare rollback.
