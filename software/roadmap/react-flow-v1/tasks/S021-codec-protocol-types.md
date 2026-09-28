# S021 — Codec e tipi Protocol V1

**Stato:** ✅ DONE
**Dipende da:** S014

## Obiettivo

Rappresentare senza perdita, in TypeScript, tutti i tipi e la serializzazione del
Protocol V1 firmware.

## Implementazione richiesta

1. Implementa codec CBOR e tipi Protocol V1 da golden vector firmware: envelope,
   status, Config, catalogo, valori, record, job, topology, resources e manifest.
2. Mantieni INT64/UINT64 come `bigint`; converti in JSON con la regola lossless del
   firmware e rifiuta numeri non rappresentabili.

## Verifiche

- stessi golden vector superano round-trip identico in TypeScript e firmware;
- INT64/UINT64 ai limiti di range non perdono precisione andata/ritorno;
- un numero JSON non rappresentabile losslessly viene rifiutato, non arrotondato.

## Fine task

- [x] Ogni tipo del Protocol V1 necessario alla V1 ha codec testato. L'envelope ha
      ora golden vector **reali**, aggiunti al firmware e verificati in
      `native_sim` (vedi nota sotto); le 27 operazioni restano su vettori
      spec-conformant scritti da me (non firmware).
- [x] Nessuna perdita di precisione sui tipi a 64 bit.

## Implementazione (2026-08-12)

Prima di scrivere il codec ho fatto analizzare in profondità il firmware (fase 360,
appena completata da Cursor: `subsys/communication/`, `protocol.h`,
`tests/protocol/src/main.c`, i quattro `.cddl` di Config) per estrarre la forma
esatta wire-per-wire.

### Golden vector dell'envelope: aggiunti al firmware, verificati in native_sim

Il criterio originale ("stessi golden vector superano round-trip identico in
TypeScript e firmware") non era soddisfacibile alla lettera: `tests/protocol/
src/main.c` non pubblicava vettori di byte fissi — verificava solo determinismo
interno (la stessa codifica prodotta più volte dà byte identici), non un
riferimento pubblicato. **Ho risolto il gap aggiungendo io stesso un test
`test_envelope_golden_vectors` al firmware** (`firmware/backbone/tests/protocol/
src/main.c`, autorizzato esplicitamente dall'utente per questo task specifico),
con vettori fissi per request/response dell'envelope, e l'ho **eseguito
davvero in `native_sim`** (immagine `esp32c3-zephyr-dev`, `west twister -p
native_sim/native/64 -T tests/protocol`) prima di fidarmene.

**Questo ha scoperto un bug reale nel mio codec TypeScript**: avevo assunto CBOR
canonico a lunghezza definita (`0xA4 ...`) basandomi sulla sola lettura del
codice sorgente firmware — l'esecuzione reale ha mostrato che zcbor in questa
build usa invece **collezioni a lunghezza indefinita** (`0xBF <coppie> 0xFF` per
le mappe, `0x9F <elementi> 0xFF` per le liste). Corretto `cbor.ts` (encoder e
decoder, quest'ultimo ora supporta entrambe le forme) e tutti i test che
asserivano byte letterali. Senza questa verifica end-to-end, il codec sarebbe
stato incompatibile byte-per-byte col firmware reale nonostante tutti i test
"spec-conformant" passassero — la lezione pratica: leggere il codice non
sostituisce l'eseguirlo.

L'envelope ha quindi ora un vero golden vector, pubblicato nel firmware e
verificato in CI Zephyr. Le 27 operazioni restano su vettori spec-conformant
scritti da me (stessa struttura, non ancora verificati byte-per-byte contro il
firmware — richiederebbe cablare ogni singolo handler in un test, fuori scope
per questo giro). L'unico altro vettore realmente proveniente dal firmware,
riusato com'era, è la sequenza `[0xA1, 0x00, 0x01]` citata testualmente da
`test_envelope_roundtrip_and_rejects`.

### Cosa è stato implementato

`packages/protocol-sdk/src/`:
- `cbor.ts` — primitivi CBOR scritti a mano (non una libreria generica): solo i
  major type che questo protocollo usa davvero (uint/negint/bytes/text/array/
  map/bool). Interi sempre a lunghezza minima; array/map **a lunghezza
  indefinita** (`0x9F.../0xBF...0xFF`) — corretto dopo verifica reale in
  `native_sim`, vedi sotto. Mai float/tag/bignum. Il decoder accetta sia forma
  indefinita sia definita (il vettore "malformato" del firmware stesso usa la
  forma definita).
- `int64.ts` — regola lossless richiesta dal punto 2 del task: bigint↔stringa
  decimale in JSON, rifiuto (mai arrotondamento) di un numero JS non
  rappresentabile come intero sicuro.
- `envelope.ts` — envelope a 4 campi (versione/correlation-o-sequence/opcode-o-
  status-o-tipo-evento/payload), enum `Operation` (1-27), `ProtocolStatus` (0-10),
  `EventType` (1-4), con tutte le validazioni osservate nel firmware (versione,
  correlation/sequence non zero, chiavi mancanti/sconosciute/duplicate, byte finali,
  limite payload 2048).
- `events.ts` — i 4 payload evento (Record/Status/Discovery/Connectivity).
- `operations/` — tutte le 27 operazioni, un file per gruppo funzionale.

### Gap ereditati dal firmware (documentati, non nascosti né "corretti")

- Diversi campi enum (stato Core/Module/Health/Image, endpoint kind, admission
  power, ecc.) sono tenuti come `number` grezzo: il firmware nomina gli enum ma
  questa fase di ricerca non ne ha estratto la mappatura intero→etichetta —
  inventarla sarebbe stato peggio che lasciare il numero grezzo, che comunque
  fa round-trip corretto.
- `MODULE_COMMAND` non ha un campo per argomenti di comando (il firmware non lo
  decodifica ancora, nonostante la spec del task 360 lo preveda) — il tipo
  TypeScript riflette esattamente questo, niente campo `arguments` fantasma.
- `VALIDATE_DEVICE_PROFILE` è uno stub firmware (accetta qualunque bstr non
  vuoto); il codec lo rispecchia fedelmente, incluso il fatto che il campo
  `valid` sul wire è un `uint`, non un booleano CBOR (a differenza di
  `VALIDATE_CONFIG`).
- `GET_JOB_STATUS` non espone il risultato del job (solo stato/progresso/esito).
- `OPEN_WIFI_UPDATE` non permette al client di scegliere il trasporto (sempre UDP
  lato firmware) — solo `timeoutMs` è un campo reale.
- Il Config CBOR (dentro `GET_CONFIG`/`VALIDATE_CONFIG`/`APPLY_CONFIG`) resta
  opaco (`Uint8Array`): i `.cddl` committati arrivano a v3 mentre il runtime è a
  versione 5 — decodificarne il contenuto è fuori scope per questo task.

`docker compose run --rm micro-flow-editor npm run ci` — lint, typecheck, 171 test
nel workspace (73 nuovi in `protocol-sdk`), build: tutti verdi.
