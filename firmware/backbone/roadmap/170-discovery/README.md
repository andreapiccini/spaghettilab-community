# Fase 170 — Discovery

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Tradurre zero o più risultati per Port in eventi per key accettati dal Module Manager.

## Dipende da

[Fase 165 — Profili Wi-Fi persistenti](../165-secure-wifi/README.md)

## Risultato visibile

Un provider manuale configura due Module distinti sulla stessa Port senza possederli.

## Task

1. ✅ [TASK-170-01 — Implementare Discovery](TASK-170-01-implementare-discovery.md)

## Criteri di completamento della fase

- [x] Tipi risultato e ownership sono espliciti.
- [x] Il provider non modifica direttamente lo stato del Manager.
- [x] Risultati invalidi o duplicati vengono rifiutati.
- [x] Generazione e invalidazione sono per key, non per Port.
