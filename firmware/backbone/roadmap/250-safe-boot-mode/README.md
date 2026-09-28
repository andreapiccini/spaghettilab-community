# Fase 250 — Boot sicuro

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Separare boot senza Config, esecuzione normale e prova di una nuova immagine.

## Task

1. ✅ [TASK-250-01 — Definire il boot sicuro con e senza Config](TASK-250-01-definire-il-boot-sicuro.md)

## Criteri di completamento della fase

- [x] Config assente mantiene Communication locale, ma non rete, Runtime o upload.
- [x] Config valida avvia il normale Engine con Update chiuso.
- [x] Modalità operativa e stato trial dell'immagine restano indipendenti.
- [x] L'immagine di prova viene confermata solo dopo la health window.
- [x] Reset prima della conferma lascia a MCUboot la possibilità di rollback.
