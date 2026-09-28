# Fase 360 — Communication Protocol V1

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Definire un unico envelope CBOR versionato per catalogo, stato, capability, risorse,
Device Profile, Config, Discovery, connettività, reset e comandi, riusabile da trasporti locali e remoti con
principal, permessi espliciti, errori pubblici stabili e replay protection centrale.

## Task

1. ✅ [TASK-360-01 — Implementare il protocollo macchina V1](TASK-360-01-implementare-il-protocollo-macchina-v1.md)

## Criteri di completamento della fase

- [x] Correlation ID, replay ed errori pubblici sono identici su ogni trasporto.
- [x] Catalogo e schema permettono a un client di non conoscere il firmware a priori.
- [x] GET/VALIDATE/APPLY Config supportano merge host e compare-and-swap.
- [x] Operazioni lunghe usano job bounded senza bloccare i callback di rete.
- [x] Policy locale/remota impediscono operazioni non autorizzate.
- [x] Capability, diagnostica e stato connettività sono leggibili senza segreti.
- [x] Feature Pack, Device Profile e resource report sono enumerabili e autorizzati.
