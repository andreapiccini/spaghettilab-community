# Fase 150 — CBOR

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Decodificare un payload CBOR V0 rigoroso nel modello Config interno.

## Dipende da

[Fase 140 — Communication](../140-communication/README.md)

## Risultato visibile

Un payload CBOR con due key/indirizzi sulla stessa Port viene applicato; key o endpoint
duplicati e payload incompleti vengono rifiutati.

## Task

1. ✅ [TASK-150-01 — Decodificare Config con CBOR](TASK-150-01-decodificare-config-con-cbor.md)

## Criteri di completamento della fase

- [x] Lo schema V0 è documentato prima del decoder.
- [x] Il decoder non applica direttamente la configurazione.
- [x] Limiti, campi obbligatori e valori sconosciuti sono provati.
