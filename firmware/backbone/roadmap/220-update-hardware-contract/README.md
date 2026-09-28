# Fase 220 — Contratto astratto Maintenance Link

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Separare completamente Update e Core dai pin fisici, lasciando alla board/overlay la
mappatura tra collegamento normale e collegamento di manutenzione.

## Task

1. ✅ [TASK-220-01 — Definire il contratto astratto del Maintenance Link](TASK-220-01-congelare-il-contratto-hardware-update.md)

## Criteri di completamento della fase

- [x] Firmware comune e backend board-specific hanno responsabilità separate.
- [x] GPIO3/GPIO4 compaiono soltanto nella mappatura Core V1.
- [x] Config assente, payload di boot e reboot one-shot sono definiti.
- [x] Il Maintenance Link non coincide con lo stato di upload firmware.
