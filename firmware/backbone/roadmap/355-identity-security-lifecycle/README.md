# Fase 355 — Identità, credenziali e reset

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Unificare l'identità del Core e rendere espliciti principal, ruoli, permessi,
provisioning, rotazione, revoca e reset.

## Task

1. ✅ [TASK-355-01 — Definire identità, credenziali e reset](TASK-355-01-definire-identita-credenziali-e-reset.md)

## Criteri di completamento della fase

- [x] Device ID, nome e credenziali sono concetti distinti.
- [x] Principal, ruoli e permessi autorizzano le operazioni sensibili.
- [x] Reset scoped non cancella MCUboot e gestisce errori parziali.
