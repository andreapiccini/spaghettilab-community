# Architettura funzionale React Flow SpaghettiLAB V1

[Roadmap e task](roadmap/react-flow-v1/README.md) ·
[Firmware platform closure](../firmware/backbone/roadmap/V1-PLATFORM-CLOSURE.md)

## Scopo

Questa specifica definisce la prima versione completa dell'applicazione React Flow di
SpaghettiLAB. Descrive funzioni, dati, responsabilità e flussi; non stabilisce colori,
layout, componenti visivi o stile. La rappresentazione grafica deve derivare dai
contratti funzionali e può cambiare senza modificare il modello di dominio.

Al termine della roadmap l'applicazione deve poter configurare, aggiornare, osservare
e diagnosticare uno o più Core; creare Device Profile senza firmware nuovo; usare
blocchi firmware installati; installare Capability Pack tramite OTA; e collegare Core
distinti mediante Node-RED.

## Confini del sistema

React Flow è un editor e orchestratore host. Non è il runtime real-time del Core e non
sostituisce Node-RED.

```text
React Flow application
  ├── configura il comportamento locale di ogni Core
  ├── gestisce profili, capability, OTA e diagnostica
  ├── osserva record e risorse
  └── compila/deploya collegamenti fra Core verso Node-RED

Core firmware
  ├── acquisizione e processing bounded/offline
  ├── safe state e accesso hardware
  └── Config canonico, catalogo, topologia e record

Node-RED
  ├── automazioni fra Core e servizi esterni
  ├── routing di record e comandi
  └── esecuzione continua sull'host
```

Una funzione che deve rispettare timing, safe state o funzionare senza host appartiene
al firmware. Una relazione fra dispositivi differenti o servizi Internet appartiene a
Node-RED. React Flow costruisce e coordina entrambe senza eseguire direttamente la
logica finale.

Node-RED è un **runtime trasparente**, non un secondo editor. L'utente disegna
automazioni host (HTTP, socket, cron, Core A→Core B) solo in React Flow, nella
sezione Automazioni. Serve un server Node-RED raggiungibile — locale
(`127.0.0.1:1880`), un altro device in LAN, o un host in rete — visibile e
selezionabile lì, come un Core è visibile in Core Connections. L'editor Node-RED
nativo non è il flusso di lavoro. Token e URL restano nello store host, mai in
`ProjectV1`.

## Tre grafi distinti

### Physical Composition Graph

Descrive ciò che è fisicamente collegato a un Core. La Backbone è la catena di Bay
universali, non un PCB con slot predefiniti:

```text
[Bay] — [Bay] — [Bay]     ← Backbone
   │        │        │
 Module   Core    Module     (funzione = Module, non tipo di Bay)
```

Contiene Core, Flow, Bay, rail/Power Lane, Module, Connector, sensore/attuatore
esterno, indirizzo e label. Deve rispettare la topologia e le capability dichiarate
dal Core. Input/output restano riferiti al Core: i lati FRONT/REAR di una Bay non
sono IN/OUT permanenti. Hardware:
[`hardware/HARDWARE_SYSTEM_ARCHITECTURE.md`](../hardware/HARDWARE_SYSTEM_ARCHITECTURE.md).

### Device Processing Graph

Descrive il comportamento locale compilato nel Config del singolo Core:

```text
Module/Device Profile → schedule/event → Block → Block → record/Rule/command
```

Usa soltanto Module Driver, Device Profile, Rule e Block presenti nel catalogo del
Core. Il grafo salvato nel progetto contiene metadati editor; quello inviato al Core è
normalizzato, bounded e privo di coordinate.

Finché `GET_CATALOG` elenca solo i Module Driver, l'authoring usa
`@spaghettilab/processing-block-catalog` (S074): Library AppBlocks mappata sui quattro
node kind firmware, più i Block Driver già in `spaghetti_blocks/`. HTTP/socket
restano Node-RED; display senza hardware sul Core, SMS e for-next non si fingono
come driver. I blocchi vendor-only non stanno nel catalogo.
Le Features AppBlocks (debug, variabili, oggetti timer) arrivano col dump successivo,
non come `type_id` inventati. Un `typeId` shipped deve coincidere con un driver
registrato; un Block `planned` si può mettere sul grafo ma il dry-run avvisa.

### System Automation Graph

Descrive collegamenti fra Core o servizi esterni:

```text
Core A / temperatura → Node-RED → Core B / display
```

Viene compilato in flow Node-RED gestiti da SpaghettiLAB. Non entra nel Config di un
singolo Core e deve poter essere aggiornato senza OTA firmware.

I tre grafi possono essere mostrati insieme, ma non devono condividere ownership o
serializzazione.

## Componenti software

### Domain Kernel

Pacchetto TypeScript puro, senza React, React Flow, MQTT o storage. Possiede tipi,
invarianti, ID, unità, errori e funzioni deterministiche per:

- Project, Core binding e deployment;
- catalogo, topologia, capability e risorse;
- composizione fisica;
- Device Profile e acquisition plan;
- Module, schedule, Rule, Block ed edge;
- automazioni cross-Core;
- diff, validation failure e compatibilità.

### Protocol SDK

Implementa il contratto firmware senza semantica UI: CBOR lossless, request/response,
correlation, timeout, retry, replay window, paginazione, Config CAS, record stream e
trasporti. INT64/UINT64 restano `bigint`; credenziali e transport state non entrano nei
progetti esportati.

### Device Session Manager

Possiede connessione e sincronizzazione per ciascun Core. Mantiene device ID, boot ID,
transport, catalog fingerprint, snapshot Config/revision, topologia, status, feature
set e resource report. Un reconnect invalida stato effimero; un fingerprint cambiato
invalida l'intero catalogo.

### Project Store

Salva il modello authoring separatamente dallo stato live. Ogni progetto ha schema
versionato, migration, riferimenti stabili ai Core, grafi, label, Device Profile
richiesti, deployment record e hash dell'ultimo snapshot applicato. Token, password e
chiavi restano nel credential store locale.

### Catalog and Topology Model

Trasforma descrittori firmware in un modello UI-neutral di tipi, proprietà, handle,
porte, unità, riferimenti e vincoli. Nessun tipo concreto come INA219, Modbus o Kalman
deve essere hardcoded nell'editor.

### React Flow Adapter

Converte il dominio in node/edge React Flow e riconverte eventi di authoring in
comandi di dominio. Posizione, selezione e viewport sono metadati locali. Non valida
Config, non parla con il Core e non contiene regole firmware.

### Config Compiler and Deployment Coordinator

Compila Physical Composition e Device Processing Graph in Config canonico. Esegue
validate locale, validate remoto, diff, apply compare-and-swap e verifica post-apply.
Gestisce conflitti senza sovrascrittura cieca e conserva il progetto dirty se il deploy
fallisce.

### Device Profile Studio

Crea, importa, valida, installa, versiona e rimuove profili dichiarativi. Conosce il set
di opcode installato e distingue profilo installabile come dato da capability firmware
mancante. Un profilo associa trasporto, vincoli elettrici, init/sample/command,
conversioni necessarie e output schema.

### Runtime Monitor

Riceve record, eventi, status, discovery, drop e reset. Risolve field ID tramite il
catalogo e mantiene buffer host bounded configurabili. Permette comandi manuali
catalogati, ma segnala chiaramente che non fanno parte del Config persistente.

### Capability and Update Manager

Confronta catalogo installato, marketplace index e progetto richiesto. Verifica
manifest, variante, profilo, dipendenze, Config compatibility e resource budget;
trasferisce immagini firmate, segue trial/confirm/rollback e risincronizza catalogo e
Config dopo il reboot.

### Node-RED Deployment Adapter

Compila il System Automation Graph in un insieme gestito di nodi/flow SpaghettiLAB,
valida connessioni e credenziali, applica deploy con revisione e riconcilia solo le
risorse possedute dal progetto. Non modifica flow Node-RED creati dall'utente.
L'istanza target (URL locale/LAN/remoto) è un runtime host, non un campo del
progetto esportabile.

## Modello dati principale

```text
Workspace
  projects[]
  connectionProfiles[]        senza segreti esportabili

Project
  projectId, schemaVersion, name
  coreBindings[]
  physicalGraphs[]            uno per Core
  deviceGraphs[]              uno per Core
  systemAutomationGraph       cross-Core/servizi
  requiredArtifacts[]         profile/pack/version/hash
  deploymentRecords[]

CoreBinding
  bindingId
  expectedDeviceId
  connectionProfileId
  lastKnownVariant/profile/featureSet

DeploymentRecord
  target, timestamp
  sourceProjectHash
  configGeneration/configHash o Node-RED revision
  catalogFingerprint/featureSetHash
  outcome
```

ID locali del progetto sono UUID e non vengono riutilizzati. Module/Rule/Block key
destinate al firmware sono assegnate deterministicamente e restano stabili fra deploy.

## Stato di una sessione Core

```text
DISCONNECTED
  → CONNECTING
  → AUTHENTICATING
  → SYNCHRONIZING
  → READY
       ├── VALIDATING → READY
       ├── APPLYING → READY | CONFLICT | ERROR
       └── UPDATING → REBOOTING → TRIAL → READY | ROLLED_BACK
```

`READY` non significa che progetto e dispositivo coincidano. La relazione separata è:

```text
IN_SYNC | PROJECT_DIRTY | DEVICE_CHANGED | DIVERGED | INCOMPATIBLE
```

## Ciclo di sincronizzazione

1. Connessione e autenticazione.
2. Lettura identity/status/capability/feature set.
3. Lettura catalogo paginato con fingerprint coerente.
4. Lettura topologia, Config con generation/hash e resource report.
5. Confronto con ultimo DeploymentRecord.
6. Classificazione sync senza modificare dispositivo o progetto.
7. Scelta esplicita: importa stato live, conserva progetto, oppure riconcilia.

Un boot ID cambiato annulla request/job effimeri. Un catalog fingerprint cambiato
ricostruisce modello e validazione. Un Config cambiato esternamente non viene
sovrascritto automaticamente.

## Compilazione e validazione

La pipeline deve essere pura fino alla validazione remota:

```text
Project graphs
  → normalize
  → resolve references
  → type/unit/electrical validation
  → capability/resource validation
  → canonical Config model
  → canonical CBOR/hash
  → remote VALIDATE_CONFIG
  → APPLY_CONFIG(expectedGeneration)
  → verify snapshot/hash
```

Gli errori conservano path fino a Core, graph, node, property o edge. Nessun errore
viene ridotto a una stringa generica.

## Device Profile e Capability Pack

Il resolver produce uno di questi esiti:

- `READY`: profilo e opcode già installati;
- `PROFILE_INSTALL_REQUIRED`: basta installare dati, niente OTA;
- `FIRMWARE_UPDATE_REQUIRED`: manca Block/Driver/opcode/transport;
- `HARDWARE_INCOMPATIBLE`: Bay/Port/rail non supportano il requisito;
- `RESOURCE_INCOMPATIBLE`: il manifest candidato non entra nel profilo/Core;
- `VERSION_CONFLICT`: versione/hash richiesti non coincidono.

Un Capability Pack non viene mai caricato dinamicamente nel browser o nel Core come
codice non firmato. L'app installa esclusivamente immagini firmware firmate compatibili.

Il marketplace (S101, S104) è un indice di artifact discriminati per `kind`, non
una sola coda OTA. Un Device Profile è un kind a installazione dati
(`INSTALL_DEVICE_PROFILE`). Un kind futuro si aggiunge registrando strategia di
installazione e se serve preflight; un kind sconosciuto si ignora con
motivazione, senza eseguire il payload.

## Risorse

L'app mostra e conserva separatamente:

- slot flash, image bytes e headroom;
- RAM statica dichiarata;
- stack, pool e workspace capacity/current/peak;
- high-water e allocation failure;
- delta del manifest candidato;
- limiti Module/Profile/Schedule/Rule/Block/edge.

Non somma una stima pack alla RAM libera istantanea per promettere compatibilità. Il
preflight usa il manifest dell'immagine già compilata; il runtime report serve a
diagnosi e dimensionamento.

## Sicurezza e credenziali

- segreti in credential store, mai nel Project JSON, log o URL;
- permessi verificati prima di mostrare un'operazione come eseguibile e comunque
  imposti dal Core;
- OTA soltanto con manifest/artifact trusted;
- import non esegue codice e valida schema/dimensioni;
- Device Profile è dati bounded, non JavaScript;
- operazioni distruttive espongono target e richiedono conferma esplicita;
- audit locale registra operazione, target, revisione ed esito senza payload segreti.

## Persistenza e portabilità

Il formato progetto è JSON canonico versionato per authoring; Config e protocollo
restano CBOR firmware. Import/export include grafi, label, riferimenti e artifact
requirements, ma non credenziali, cache, record live o immagini firmware. Ogni migration
è deterministica, testata con golden file e conserva una copia di recovery prima di
scrivere.

## Criterio di completezza V1

La V1 è completa soltanto quando un utente può, senza modificare sorgenti:

1. collegare e identificare più Core;
2. leggere catalogo, topologia, Config, feature e risorse;
3. rappresentare backbone, Power, Core, Bay, Connector e dispositivo esterno;
4. configurare Module, indirizzi, rail, schedule, label e comandi;
5. creare/installare un Device Profile supportato senza OTA;
6. comporre e validare pipeline di blocchi locali;
7. rilevare un blocco mancante e installare il firmware compatibile;
8. applicare Config con CAS, diff, conflitti e verifica post-deploy;
9. osservare record, eventi, drop, health, reset e high-water;
10. eseguire comandi e discovery autorizzati;
11. configurare connettività, manutenzione e aggiornamenti supportati;
12. collegare output di un Core a input/comandi di un altro tramite Node-RED;
13. esportare/importare il progetto senza segreti;
14. recuperare da disconnessione, reboot, OTA rollback e modifiche concorrenti;
15. superare test unitari, contract, integration ed end-to-end con Core e Node-RED fake.

