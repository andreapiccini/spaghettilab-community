# TASK-392-01 — Esporre flash headroom e RAM statica su GET_RESOURCES

**Stato:** ✅ DONE
**Fase:** 392 — Flash headroom e RAM statica su GET_RESOURCES

## Cosa devo fare

`struct spaghetti_resources_snapshot` contiene già `flash_slot_bytes`,
`flash_image_budget_bytes`, `flash_headroom_bytes` e `static_ram_budget_bytes`
(popolati da `spaghetti_image_manifest_get()`). `execute_get_resources` serializza
solo le chiavi 0–7 (hash, sei pool, `allocation_failures`). I campi flash/RAM
esistono in C ma non attraversano il wire.

1. In `subsys/communication/operations/resources_ops.c` aggiungi chiavi CBOR
   **append-only** (V1 lo consente):

   | Chiave | Campo |
   |---:|---|
   | 8 | `flash_slot_bytes` (uint32) |
   | 9 | `flash_image_budget_bytes` (uint32) |
   | 10 | `flash_headroom_bytes` (uint32) |
   | 11 | `static_ram_budget_bytes` (uint32) |

   Restano grandezze **distinte**: non sommarle ai pool né pubblicare `free_ram`.
2. Documenta le chiavi in `PROTOCOL_V1.md` § 9 e in un commento accanto a
   `SPAGHETTI_PROTOCOL_GET_RESOURCES` in `protocol.h`.
3. Test: `tests/communication` decodifica le chiavi 8–11 dallo stub snapshot;
   `tests/resources` continua a verificare i campi C (già presenti).
4. Host Software (`@spaghettilab/protocol-sdk` / `core-status`) **non** è in
   questo task: restano un follow-up Software (S093 già tratta i campi come
   assenti). Il contratto firmware è `PROTOCOL_V1.md`.

## Perché è fatto così

S093 deve mostrare flash/image headroom e RAM statica senza inventare un numero
aggregato. L'estensione è additiva: client vecchi ignorano chiavi sconosciute.

## Come si usa

`GET_RESOURCES` (op 21) restituisce i pool runtime **e** i budget di build
flash/RAM. Un host usa 8–11 per headroom OTA, non per "RAM libera istantanea".

## Checklist di completamento

- [x] Chiavi 8–11 serializzate da `execute_get_resources`.
- [x] Pool e flash/RAM restano campi distinti.
- [x] `PROTOCOL_V1.md` elenca le chiavi.
- [x] Test communication decodifica 8–11.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/resources -T tests/communication \
   -p native_sim/native/64 --inline-logs --clobber-output'
```
