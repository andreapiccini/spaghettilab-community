# S071 — Authoring e validazione del processing graph

**Stato:** ✅ DONE
**Dipende da:** S043, S050; usa S063 quando presenti Device Profile

## Obiettivo

Comporre il comportamento locale bounded del Core come grafo autore, rifiutando ciò
che non può mai compilare in un Config valido.

## Implementazione richiesta

1. Implementa authoring di schedule, event source, Block, Rule, command target,
   publish output ed edge usando esclusivamente catalogo/schema.
2. Risolvi tipi, unità, reference group, source/target key, field ID, command ID e
   versioni. Inserimenti di conversione devono essere espliciti nel dominio.
3. Rifiuta cicli; feedback temporale usa Block stateful/delay catalogati. Controlla
   input required, fan-out, duplicati e riferimenti dangling.
4. Mantieni System Automation Graph escluso: edge fra Core differenti è errore e viene
   indirizzato alla fase S110.

## Verifiche

- un ciclo nel grafo è rifiutato con errore che punta al nodo/edge coinvolto;
- type/unit mismatch fra due Block collegati è rifiutato prima della compilazione;
- un edge cross-Core creato per errore è rifiutato, non silenziosamente ignorato.

## Fine task

- [x] Il grafo di processing autore rifiuta cicli, riferimenti dangling e duplicati.
- [x] Nessun edge cross-Core può entrare nel grafo locale.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/device-processing-graph-model`
(`software/micro-flow-editor/packages/device-processing-graph-model/`), che dipende da
`domain` ed `editor-model` (S042). Ogni tipo di nodo è preso direttamente dalle
struct Config reali (`firmware/backbone/include/spaghetti/config.h`, `block_driver.h`,
`rule_driver.h`), non dalla sola tassonomia UX a 5 categorie (che è più ricca di
quanto il firmware abbia davvero).

**Entità** (`entities.ts`): `ScheduleNodeData`/`EventSourceNodeData` rispecchiano
`struct spaghetti_runtime_schedule_config {enabled, source_key, period_ms}` — lo
"Schedule" reale è solo un interruttore di campionamento periodico legato
direttamente a un Module, nessun concetto cron/calendario esiste nel firmware.
Entrambi i nodi portano `moduleNodeId` direttamente, collassando le categorie UX
"Trigger" e "Read" in un solo nodo, dato che il firmware non ha un nodo/edge di
lettura separato. `BlockNodeData` rispecchia `spaghetti_block_config`. `RuleNodeData`
rispecchia `spaghetti_rule_config` più `spaghetti_rule_action{target_key, command}` —
il command target di una Rule è un campo della rule stessa (`commandTarget?`), non un
nodo separato. `moduleNodeId` è sempre un riferimento cross-graph (il Module vive nel
grafo `"physical-composition"`, un'istanza `Graph` diversa), validato contro un set di
ID nodo Module noti fornito dal chiamante.

**Porte** (`ports.ts`): dati di porta Block/Rule (tipi, unità, obbligatorietà) non
sono sul wire oggi (`GET_CATALOG` restituisce solo `{typeId, commandCount}`, stesso
gap già documentato per i Module Driver in `catalog-model`) — `ResolveProcessingNodeDescriptor`
è quindi fornito dal chiamante, stesso pattern di `installedCapabilities` in
`editor-model`.

**Validazione** (`validate-processing-graph.ts`): `validateDeviceProcessingGraph()`
raccoglie tutti i problemi invece di fermarsi al primo — cicli (DFS con path
completo nell'errore), riferimenti Module dangling, trigger duplicati sullo stesso
Module, mismatch type/unit (delegato interamente a `checkHandleCompatibility` di
`editor-model`, mai reimplementato — il suo messaggio UNIT_MISMATCH è esattamente
"inserimenti di conversione devono essere espliciti"), nodi Output come sorgente
(una Rule è sempre rifiutata come sorgente, incondizionatamente, dato che
`spaghetti_rule_driver` non dichiara porte; un Block con zero porte output, es.
`publish_field`, allo stesso modo una volta fornito un descriptor), input required
non connesso, fan-out oltre un cap opzionale fornito dal chiamante. Gli edge
cross-Core non hanno bisogno di codice: ogni Core ha la propria istanza `Graph`
(`project.deviceGraphs[i]`), quindi un ID nodo di un altro Core è strutturalmente
impossibile da referenziare — `Graph.addEdge` lo rifiuta già come endpoint dangling
prima che questo validatore giri, dimostrato direttamente nei test del pacchetto.

**Modifica al dominio per questo task**: `GraphEdge` (`domain`'s `graph.ts`) ha
guadagnato `sourceHandle`/`targetHandle` opzionali, rispecchiando i campi reali
`source_port_or_field`/`target_input` di `struct spaghetti_edge_config` — la forma
precedente `{layer, id, source, target}` non aveva modo di disambiguare quale porta
di un Block multi-porta un edge collega. Additiva e retrocompatibile: ogni altro
layer che collega solo nodi interi (Physical Composition, System Automation) non le
imposta mai. Propagate anche in `react-flow-adapter` (`toReactFlowEdges`,
`connectionToCommand`).

**Test**: 13 nuovi test coprono direttamente ogni bullet delle Verifiche, più
l'aggiornamento di un test esistente in `react-flow-adapter` che ora osserva
`sourceHandle`/`targetHandle` propagati. CI completa verde via Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto): dati di
porta Block/Rule sono forniti dal chiamante, non presi da un Core live; non esiste
ancora un pacchetto catalogo Block/Rule (analogo a `catalog-model` per i Module
Driver) da cui costruire `ResolveProcessingNodeDescriptor` reali; i cap di
fan-out/depth/budget sono Kconfig-tunable nel firmware e non applicati qui oltre al
`maxFanOut` opzionale — il vero conteggio budget (costo per record, dimensione
state/workspace) è compito di S072.
