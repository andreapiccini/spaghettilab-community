# TASK-391-01 — Validare i Device Profile sul wire

**Stato:** ✅ DONE
**Fase:** 391 — Validazione remota reale dei Device Profile

## Cosa devo fare

`execute_validate_device_profile` in
`subsys/communication/operations/device_profile_ops.c` è uno stub: decodifica il
`bstr` in ingresso, controlla che non sia vuoto, e risponde sempre `valid: 1`
(uint). Non chiama `spaghetti_device_profile_validate`. Un profilo con opcode
sconosciuto, WAIT non bounded o schema incoerente risulta "valido" a questa
operazione anche quando `INSTALL_DEVICE_PROFILE` lo rifiuterà.

1. Esponi `spaghetti_device_profile_validate_cbor()` in
   `include/spaghetti/device_profile.h`: decode CBOR (`decode_profile_cbor`) +
   `spaghetti_device_profile_validate`, **senza** installare né mutare il catalogo.
   Compila un `spaghetti_device_profile_failure` nello stesso spirito di
   `spaghetti_config_failure` (`field` / `index` / `reason`).
2. `execute_validate_device_profile` chiama quella funzione e serializza la
   risposta come `VALIDATE_CONFIG`:
   - chiave `0` = `bool valid`;
   - se non valido, chiavi `1`/`2`/`3` = `failureField` / `failureIndex` /
     `failureReason` (uint32).
   Payload vuoto o assente resta `-EINVAL` (errore di protocollo), non
   `valid: false`.
3. Documenta il payload in `PROTOCOL_V1.md`. L'operazione resta ID `24`; è un
   completamento semantico, non un nuovo opcode.
4. Test in `tests/device_profiles`: profilo CBOR valido → `valid`; opcode
   sconosciuto, WAIT a zero tentativi, budget superato → stesso errno di
   `INSTALL_DEVICE_PROFILE` e catalogo invariato. Test in `tests/communication`
   per l'envelope (stub della nuova API).

Non riaprire la fase 360: l'operazione esiste sul wire; questo task la rende
affidabile.

## Perché è fatto così

Install e validate devono condividere lo stesso decoder e lo stesso validatore.
Un client host (S063) deve poter rifiutare un profilo **prima** di
`INSTALL_DEVICE_PROFILE`.

## Come si usa

Il client invia `VALIDATE_DEVICE_PROFILE` con il CBOR profilo. Status protocollo
`OK` con `valid=false` significa "profilo rifiutato con motivo"; status non-OK
significa richiesta malformata.

## Checklist di completamento

- [x] `VALIDATE_DEVICE_PROFILE` chiama decode + validatore reale.
- [x] Un profilo malformato riceve `valid=false` con field/index/reason.
- [x] Lo stesso profilo fallisce `INSTALL_DEVICE_PROFILE` con lo stesso errno di
      `validate_cbor`.
- [x] Catalogo invariato dopo validate.
- [x] `PROTOCOL_V1.md` documenta il payload.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/device_profiles -T tests/communication \
   -p native_sim/native/64 --inline-logs --clobber-output'
```
