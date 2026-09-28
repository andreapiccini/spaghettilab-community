# Fase 190 — Power

> [!NOTE]
> Questa fase completata introduce ownership e rollback delle risorse condivise. La
> [fase 305](../305-power-topology/README.md) aggiungerà rail per Flow/Bay e distinguerà
> jumper passivi da controllo elettrico verificabile, senza invalidare questa base.

[← Indice del backlog](../README.md)

**Stato:** ✅ DONE

## Obiettivo

Gestire una risorsa di alimentazione condivisa con ownership e rollback espliciti,
senza inventare risorse hardware non presenti sulla board.

## Dipende da

[Fase 180 — Varianti Core multiple](../180-multi-core/README.md)

## Risultato visibile

Il backend fake dimostra first-acquire/final-release con Module owner distinti,
duplicati, limite fisso e fallimenti recuperabili. Core V1 non espone una rail
controllabile verificata: la build di produzione lascia correttamente Power disabilitato.

## Task

1. ✅ [TASK-190-01 — Gestire l’alimentazione condivisa](TASK-190-01-gestire-l-alimentazione-condivisa.md)

## Criteri di completamento della fase

- [x] L’hardware è stato verificato prima di scegliere un backend.
- [x] Reference counting e rollback sono provati con backend finto.
- [x] Nessun `power-gpios` o collegamento Manager è stato inventato per Core V1.
- [x] Il punto di integrazione futuro usa il Module ID, non la Port, come owner.
