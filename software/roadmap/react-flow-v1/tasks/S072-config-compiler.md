# S072 — Compilatore Config deterministico

**Stato:** ✅ DONE
**Dipende da:** S071

## Obiettivo

Trasformare il grafo di processing validato nel modello Config canonico del Core, in
modo deterministico e senza alcun dettaglio React Flow.

## Implementazione richiesta

1. Calcola limiti Module/Schedule/Rule/Block/edge/property, state/workspace e costo
   dichiarato per record; segnala il proprietario che supera il budget.
2. Compila in ordine deterministico key stabili, array normalizzati e property set;
   coordinate, grouping e label restano nel Project.
3. Implementa canonical JSON debug, CBOR tramite SDK (S021) e hash riproducibile.

## Verifiche

- la stessa semantica con ordine o coordinate diversi produce lo stesso Config e lo
  stesso hash;
- una pipeline multi-stage con fan-out, filtro stateful e Rule→command compila
  correttamente;
- un grafo che supera un budget dichiarato fallisce con l'owner indicato, non con un
  errore generico.

## Fine task

- [x] Tutte le sezioni Config firmware previste dalla V1 sono producibili dal
      compilatore.
- [x] Compiler è puro, deterministico e indipendente dalla UI.
- [x] Nessun dettaglio React Flow (posizione, viewport, selezione) attraversa il wire.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/config-compiler`
(`software/micro-flow-editor/packages/config-compiler/`), che dipende da `domain`,
`protocol-sdk`, `physical-composition-model` (S050) e `device-processing-graph-model`
(S071). Ogni campo, chiave mappa e regola di codifica è preso direttamente da
`firmware/backbone/subsys/config/config_cbor.c`'s `spaghetti_config_encode_cbor` e
`config.c` — **non** dal commento ormai superato che viveva in `protocol-sdk` ("Config
CDDL non decodificato"): la fase 330 ha spedito un codec wire V2 reale e completo, la
versione wire è `4` (`SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V3`), distinta dalla
`SPAGHETTI_CONFIG_VERSION` in memoria (`5`).

**Assegnazione key** (`compile.ts`): il firmware non assegna mai le key da solo — `config.c`
verifica solo l'unicità dentro ciascun array (Module/Rule/Block hanno namespace
indipendenti; Schedule non ha una key propria, solo `source_key` verso un Module).
Questo compilatore assegna key deterministicamente: ordina gli ID nodo autore in
ordine crescente, numera 1..N. Riordinare gli stessi nodi in un ordine di authoring
diverso, o spostarli su canvas, non cambia mai la lista ID ordinata — quindi non
cambia mai le key assegnate, il Config compilato o il suo hash. Anche l'ordine degli
array in output è ordinato per key assegnata (o per gli edge, per
`(sourceKind, sourceKey, sourcePortOrField, targetKey, targetInput)`), mai
per l'ordine di inserimento del grafo autore.

**Proprietà** (`properties.ts`): la mappa `properties` del firmware è indicizzata per
`field_id` numerico reale — le node data di questo progetto (S050/S071) non hanno
ancora uno schema dietro, quindi `toPropertySet()` richiede che ogni chiave proprietà
sia già il field_id numerico come stringa, rifiutando esplicitamente il resto.
`PropertyValue` esclude i `number` JS semplici apposta: il CBOR firmware rifiuta
float ovunque sul wire Config, quindi solo `bigint`/`boolean`/`string` sono accettati.

**Compilazione**: `ScheduleNodeData` compila in `CanonicalSchedule`;
`EventSourceNodeData` compila in **niente** — `spaghetti_runtime_schedule_config` è
specificamente periodico, un Module a pubblicazione asincrona non ha alcuna
rappresentazione wire Schedule-shaped, e questo compilatore non ne inventa una. Il
command target di una Rule (`RuleNodeData.commandTarget`) viene incorporato come due
campi proprietà sulla Rule compilata, rispecchiando come il firmware incorpora
`spaghetti_rule_action` nel comportamento della rule stessa — quali due field_id
dipende dallo schema del tipo Rule, quindi `resolveRuleActionFieldIds` è fornito dal
chiamante.

**Ownership dei budget** (§ Verifiche: "un grafo che supera un budget dichiarato
fallisce con l'owner indicato, non con un errore generico"): il vero
`spaghetti_config_validate` firmware **non può** farlo per i fallimenti a livello
grafo (Block/Edge) — inoltra il codice di ritorno di
`spaghetti_processing_validate_graph` con `index` fissato a `0` (letto direttamente in
`config.c`) — un limite firmware reale e confermato, non supposto. Questo compilatore
riderivare l'ownership in locale invece di affidarsi a una risposta remota
`VALIDATE_CONFIG` per sapere quale nodo è responsabile: budget di costo (itera i
Block in ordine di key assegnata, accumula, attribuisce al primo Block che supera il
cap), fan-out (attribuito al nodo sorgente), depth (percorso più lungo, attribuito al
nodo oltre il cap), capacità per categoria (attribuito al primo nodo che supererebbe
il cap).

**Wire CBOR + hash**: `encodeConfigCbor()` produce byte esatti wire-V3;
`canonicalConfigJson()` è un rendering JSON solo debug (`bigint` come stringhe
`"123n"`); `sha256()` rispecchia `compute_config_hash`/`compute_sha256` (`config.c`) —
SHA-256 sui byte codificati esatti, via Web Crypto, stesso pattern già usato in
`device-profile-install`.

**Test**: 6 nuovi test coprono direttamente le tre Verifiche (stesso Config/hash con
ordine diverso, pipeline multi-stage con fan-out/filtro stateful/Rule→command,
fallimento budget con owner indicato). CI completa verde via Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto): nessun
decoder CBOR (S073); nessuna simulazione dell'arena RAM state/workspace per Block
(solo costo/fan-out/depth/capacità aggregati sono applicati); `mqtt`/`connectivity`/
`energy` non derivano da alcun grafo, sono impostazioni Core-level fornite dal
chiamante; risoluzione field-id proprietà e field-id azione Rule sono entrambe
fornite dal chiamante, nessuno schema Block/Rule esiste ancora sul wire.
