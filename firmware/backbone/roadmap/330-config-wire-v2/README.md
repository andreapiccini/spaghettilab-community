# Fase 330 — Config e wire V2

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Rendere Config indipendente dai driver concreti, aggiungere encoder CBOR e salvare un
record canonico versionato invece di una struct C grezza.

## Task

1. ✅ [TASK-330-01 — Generalizzare Config, CBOR e Storage](TASK-330-01-generalizzare-config-cbor-e-storage.md)

## Criteri di completamento della fase

- [x] Il codec V2 non contiene confronti con `ina219` o `relay`.
- [x] Più schedule e proprietà driver vengono validate tramite schema.
- [x] Storage salva byte canonici con lunghezza e CRC.
- [x] Snapshot espone generazione/hash e apply compare-and-swap evita conflitti.
- [x] Config identica non causa scritture flash né una nuova generazione.
- [x] Policy connettività/energia è persistente, mentre lease e deadline non lo sono.
