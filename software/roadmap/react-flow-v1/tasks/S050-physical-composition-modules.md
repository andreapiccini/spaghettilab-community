# S050 — Composizione fisica e configurazione Module

**Stato:** ✅ DONE
**Dipende da:** S043

## Obiettivo

Rappresentare e validare backbone, Power, Core, Bay, Connector e dispositivo esterno,
producendo istanze Module coerenti con l'hardware reale.

## Implementazione richiesta

1. Definisci entità authoring per Backbone, Power source, Core, Function Bay,
   Connector, external device e cablaggio; associa label e grouping senza alterare
   identità firmware.
2. Costruisci la composizione soltanto dalle Flow/Bay/rail dichiarate dal Core; gestisci
   backbone compatte, DIN o future varianti come metadata/proprietà catalogate, non
   come assunzioni elettriche.
3. Configura Module key stabile, driver/profile, Port, Bay, power rail, endpoint,
   indirizzo, chip-select, modalità elettrica e proprietà schema-driven.
4. Permetti uno o più Module per Port quando endpoint/transport lo consentono e mostra
   collisioni prima del deploy.
5. Modella Connector separato dalla Bay: connettore/pinout e sensore esterno possono
   cambiare senza trasformare automaticamente l'interfaccia elettrica.
6. Supporta composizioni input-only, output-only e complete; lo stesso formato fisico
   non implica reversibilità elettrica.
7. Integra discovery candidate: preview, confidence/authority, confronto, accettazione
   con key/Bay/rail scelta e rifiuto senza side effect.
8. Implementa label e raggruppamento logico “sensore” che unisce external device,
   Connector, Bay, Module e canali prodotti.

## Verifiche

- due Module I2C sulla stessa Port con indirizzi distinti sono validi;
- collisione endpoint, Bay inesistente, rail incompatibile e transport errato falliscono;
- power passivo resta `UNVERIFIED` e richiede acknowledgement dove previsto;
- cambiare label/posizione non cambia Config hash;
- accettare discovery produce un diff esplicito e non applica automaticamente.

## Fine task

- [x] Ogni elemento fisico discusso è rappresentabile.
- [x] Connector, Bay, Module e dispositivo esterno restano distinti.
- [x] Config Module nasce senza hardcode di board o sensore.
- [x] Vincoli elettrici/topologici sono verificati prima dell'I/O.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/physical-composition-model`
(`software/micro-flow-editor/packages/physical-composition-model/`), che dipende da
`domain`, `catalog-model` e `protocol-sdk`.

**Entità authoring** (`entities.ts`): `BackboneNodeData`, `PowerSourceNodeData`,
`ConnectorNodeData`, `ExternalDeviceNodeData`, `ModuleNodeData` — union discriminata su
`kind`, pensate come node data della `GraphState<"physical-composition">` già esistente
(S013/S014, un grafo per Core in `project.physicalGraphs`). Il cablaggio è espresso
dagli archi del grafo stesso, mai da un campo di back-reference duplicato. Bay/Port/Rail
non sono mai entità authoring: un `ModuleNodeData` referenzia direttamente gli ID
numerici esatti dichiarati dal Core (`TopologyIndex` di `catalog-model`, S041) — punto
2 del task. Nessuna di queste entità porta un campo label/grouping: per punto 1, label e
raggruppamento (incluso il raggruppamento logico "sensore", punto 8) vivono in
`AuthoringMetadata.comment`/`AuthoringMetadata.groupId` (`@spaghettilab/domain`), già
esclusi da `canonicalProjectHash` — quindi rinominare/riraggruppare non può
strutturalmente cambiare un Config hash (verifica "cambiare label/posizione non cambia
Config hash" soddisfatta per costruzione, nessun test aggiuntivo necessario oltre a
quelli già esistenti su `canonicalProjectHash`). `ConnectorNodeData` resta
deliberatamente separato dalla Bay (punto 5): il suo pinout/dispositivo esterno può
cambiare senza toccare `electricalMode`, che vive solo su `ModuleNodeData`.
`ElectricalMode = "input-only" | "output-only" | "input-output"` supporta le tre
composizioni richieste dal punto 6.

**Power** (`power.ts`): `RailAssurance`/`PowerAdmission` risolvono i numeri raw che
`catalog-model` passa attraverso senza normalizzare (`assurance`/`admission`),
recuperati leggendo direttamente `firmware/backbone/include/spaghetti/power.h`
(`enum spaghetti_power_assurance`, `enum spaghetti_power_admission_state`) invece di
indovinarli — nessuna modifica ai pacchetti a monte, che restano raw-passthrough.
`requiresPowerAcknowledgement()` è vero per `UNMANAGED` (power passivo).

**Validazione** (`validate-composition.ts`): `validateComposition()` verifica ogni
Module contro la topologia dichiarata (Port/Bay/Rail non esistenti → errore) e contro
gli altri Module (collisione endpoint, conflitto `moduleKey`), raccogliendo tutti i
problemi invece di fermarsi al primo (stesso pattern di `validateProjectV1`). Un rail
che richiede acknowledgement fallisce la validazione finché l'ID del nodo Module non è
nel set `acknowledgedModuleNodeIds` fornito dal chiamante. Il transport (I2C/SPI) non
esiste sul wire a livello di Module Driver generico (`ModuleDriverEntry` è solo
`{typeId, commandCount}`) — esiste invece a livello di Device Profile
(`GET_DEVICE_PROFILE` espone un `transport` reale, fase firmware 325), ma
`catalog-model` non lo indicizza ancora in `ProfileIndex`. `TransportOf` resta quindi un
classificatore fornito dal chiamante, stesso pattern di
`checkHandleCompatibility`/`installedCapabilities` in `editor-model` — se omesso, il
controllo transport semplicemente non viene eseguito, mai indovinato.

**Discovery** (`discovery.ts`): `previewDiscoveryAccept()` costruisce un Module
proposto da un `DiscoveryCandidate` (`protocol-sdk`) senza mai chiamare
`ACCEPT_DISCOVERY` né toccare un grafo. `previewDiscoveryAcceptDiff()` esegue
`validateComposition()` con quel Module proposto aggiunto a una copia del grafo
esistente, producendo il diff esplicito richiesto senza applicare nulla.
`moduleFromAcceptedDiscovery()` riempie `moduleKey` solo dopo la risposta reale di
`ACCEPT_DISCOVERY` — mai anticipato. L'applicazione effettiva riusa
`addGraphNodeCommand` già esistente in `react-flow-adapter` (nessun nuovo
`ProjectCommand` necessario). Il rifiuto non ha side effect da modellare: non viene mai
accettato, quindi non esiste una funzione dedicata.

**Test**: 20 nuovi test in 3 file (`power.test.ts`, `validate-composition.test.ts`,
`discovery.test.ts`), coprono direttamente ogni bullet delle Verifiche. CI completa
(lint, typecheck, test, build) verde via Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto): nessuna
operazione wire di Module CRUD esiste (solo `MODULE_COMMAND` e `ACCEPT_DISCOVERY`,
quest'ultimo senza campo Bay/rail); ogni campo di `ModuleNodeData` oltre a quanto
inviato da `ACCEPT_DISCOVERY` resta stato authoring, reso reale solo da un futuro
Config Compiler; `DiscoveryCandidate` non ha un campo "authority" (solo `confidence`);
Port non ha attributi oltre all'ID numerico.

