# Fase 380 — Tool sviluppatore V1

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Nascondere CBOR, framing e dettagli di trasporto dietro un CLI che usa JSON leggibile,
interroga il catalogo e prepara il passaggio a Node-RED.

## Task

1. ✅ [TASK-380-01 — Creare il CLI Spaghetti V1](TASK-380-01-creare-il-cli-spaghetti-v1.md)

## Criteri di completamento della fase

- [x] Un JSON configura Module, schedule e regole.
- [x] Config get/validate/apply usa generazione, hash e conflict detection.
- [x] Catalogo, Discovery, stato e comandi sono accessibili dallo stesso CLI.
- [x] Upload UART, Wi-Fi e BLE condividono verifica e progress reporting.
- [x] Capability, lease e reset sono accessibili senza comandi Zephyr interni.
