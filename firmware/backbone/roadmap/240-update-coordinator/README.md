# Fase 240 — Coordinatore aggiornamenti

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Possedere stato, timeout e policy dell'aggiornamento indipendentemente dal trasporto.

## Task

1. ✅ [TASK-240-01 — Implementare il coordinatore sicuro degli aggiornamenti](TASK-240-01-implementare-il-coordinatore-update.md)

## Criteri di completamento della fase

- [x] Un solo aggiornamento può essere attivo.
- [x] Un timeout scarta soltanto l'immagine secondaria.
- [x] Il vecchio firmware resta avviabile.
- [x] Nessuna Config persistente forza uno stato transitorio.
