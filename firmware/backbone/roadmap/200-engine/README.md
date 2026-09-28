# Fase 200 — Engine completo

**Stato:** ✅ DONE

[← Indice roadmap](../README.md)

## Obiettivo

Comporre i sottosistemi già implementati in un unico firmware che esegue il boot,
carica la Config persistente, resta disponibile senza moduli e applica nuove Config a
runtime senza riavvio.

## Dipende da

[Fase 170 — Discovery](../170-discovery/README.md). Le fasi 180 e 190 si applicano
soltanto alle varianti Core e alle risorse di alimentazione realmente presenti.

## Risultato visibile

`main()` avvia Spaghetti LAB e termina il proprio lavoro; i thread Zephyr continuano a
gestire Shell/Communication, Runtime, Data e servizi. Da Shell si può aggiungere,
riconfigurare o rimuovere più Module sulla stessa Port tramite Config CBOR mentre il
firmware rimane acceso.

## Task

1. ✅ [TASK-200-01 — Comporre e avviare l’engine](TASK-200-01-comporre-e-avviare-engine.md)

## Criteri di completamento della fase

- [x] Il boot senza Config e senza moduli lascia Communication disponibile.
- [x] Una Config valida crea i Module, carica Runtime e viene persistita.
- [x] Rimuovere una key non interrompe i Module fratelli sulla stessa Port.
- [x] Una Config non valida o non applicabile non altera lo stato precedente.
- [x] Nessun polling finge di riconoscere automaticamente hardware non identificabile.
