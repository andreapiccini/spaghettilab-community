# TASK-378-01 — Creare SDK host e contratto Node-RED

**Stato:** ✅ DONE
**Fase:** 378 — SDK host e contratto Node-RED

## Cosa devo fare

### Creare il package TypeScript comune

Crea `tools/sdk/typescript/` con `package.json`, `package-lock.json`, `tsconfig.json`, `src/`, `test/` e
README. Il package si chiama `@spaghettilab/protocol`; viene compilato localmente e non
deve essere pubblicato su npm per completare il task. Node-RED, test e futuri tool
JavaScript importano questo package invece di ricopiare codec e retry.

Scrivi questi contratti in `src/types.ts` e `src/transport.ts`:

```ts
export type CorrelationId = number;
export type ProtocolStatus =
  | "ok" | "invalid_argument" | "unsupported" | "unauthorized"
  | "conflict" | "busy" | "unavailable" | "timeout"
  | "resource_exhausted" | "malformed_request" | "internal_error";

export interface ProtocolTransport {
  readonly name: string;
  send(request: Uint8Array, timeoutMs: number): Promise<Uint8Array>;
  events(): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

export interface ConfigRevision {
  generation: number;
  sha256: string;
}

export interface ConfigSnapshot {
  config: SpaghettiConfig;
  revision: ConfigRevision;
}

export interface ApplyResult {
  changed: boolean;
  revision: ConfigRevision;
}

export interface FunctionBay {
  id: number;
  ordinalFromField: number;
  availablePowerRails: number[];
}

export interface HardwareFlow {
  id: number;
  portId: number;
  direction: "field_to_core" | "core_to_field" | "bidirectional";
  signalCount: 5;
  bays: FunctionBay[];
}

export interface PowerRail {
  id: number;
  assurance: "unmanaged" | "switched" | "switched_and_measured";
  minMicrovolts?: number;
  maxMicrovolts?: number;
  maxTotalMicroamps?: number;
}

export interface CoreTopology {
  flows: HardwareFlow[];
  powerRails: PowerRail[];
}
```

`Uint8Array` è owned dal chiamante fino alla risoluzione di `send()`; il transport deve
copiarlo se lo conserva oltre la chiamata. `events()` restituisce envelope completi,
non frammenti BLE o pacchetti MQTT. `sha256` è hex lowercase di 64 caratteri.

In `src/client.ts` implementa:

```ts
export class SpaghettiClient {
  constructor(transport: ProtocolTransport, options?: ClientOptions);
  getCatalog(forceRefresh?: boolean): Promise<Catalog>;
  getStatus(): Promise<CoreStatus>;
  getTopology(): Promise<CoreTopology>;
  getConfig(): Promise<ConfigSnapshot>;
  validateConfig(config: SpaghettiConfig): Promise<void>;
  applyConfig(
    config: SpaghettiConfig,
    expectedGeneration: number
  ): Promise<ApplyResult>;
  moduleCommand(
    key: number,
    command: string,
    arguments_: PropertyValues
  ): Promise<void>;
  close(): Promise<void>;
}
```

Il client possiede correlation ID, timeout, retry, paginazione e cache catalogo. Un
retry riusa gli stessi byte e correlation ID; non ricodifica la request. Su status
`conflict`, `unauthorized` o `invalid_argument` non fa retry automatico. Dopo reconnect
può ritentare soltanto entro la replay window dichiarata e se `boot_id` non è cambiato.
Dopo un nuovo boot rilegge stato e non ripete automaticamente command, reset o update.
Se cambia il catalog fingerprint elimina l'intera cache prima di interpretare nuovi
record.

Catalog field semantic e `referenceGroup` restano UI-neutral. Esponi un helper puro
`buildEditorModel(catalog, topology, config)` che restituisce tipi di nodo, handle,
Flow/Bay e collegamenti normalizzati; non importa React, React Flow o Node-RED. La UI
React Flow potrà adattare questo modello senza duplicare regole firmware. Un rail
unmanaged deve mantenere lo stato `unverified`, mai diventare implicitamente sicuro.

### Implementare CBOR e valori senza perdita

Crea `src/codec.ts`, `src/catalog.ts` e `src/value.ts`. Codifica esattamente le chiavi e
gli ID congelati in `PROTOCOL_V1.md`; rifiuta chiavi extra, numeri non interi, payload
oltre limite e status sconosciuti.

INT64 e UINT64 diventano `bigint` internamente. Nei messaggi Node-RED/JSON:

- usa `number` soltanto nel range sicuro JavaScript;
- fuori range usa stringa decimale;
- conserva nel catalogo il tipo wire per ricodificare il valore;
- non usa mai `parseFloat()` per interi wire.

Crea `tests/protocol/vectors/v1/` con file JSON contenenti nome, byte CBOR hex e oggetto
normalizzato per request, response, errore, Config, catalog page, record, INT64 minimo e
UINT64 massimo. Firmware C, SDK TypeScript e CLI Python devono leggere gli stessi file;
nessun linguaggio mantiene copie diverse dei vector.

### Definire il Config Coordinator di Node-RED

Crea `src/config-coordinator.ts`:

```ts
export interface ConfigFragment {
  ownerId: string;
  modules?: ModuleConfig[];
  schedules?: ScheduleConfig[];
  rules?: RuleConfig[];
}

export class ConfigCoordinator {
  constructor(client: SpaghettiClient);
  setFragment(fragment: ConfigFragment): void;
  removeFragment(ownerId: string): void;
  preview(): Promise<SpaghettiConfig>;
  synchronize(): Promise<ApplyResult>;
}
```

`ownerId` è un ID stabile del nodo Node-RED e resta host-only: non entra nella Config
firmware. Il coordinator conserva una sola entry per owner. Durante `preview()`:

1. legge la Config corrente;
2. ordina i fragment per `ownerId` per ottenere merge deterministico;
3. indicizza Module e rule per key;
4. rifiuta localmente due owner che dichiarano la stessa key con contenuti diversi;
5. conserva gli elementi del Core non posseduti da alcun fragment;
6. sostituisce gli elementi posseduti e ordina l'output canonico;
7. chiama VALIDATE_CONFIG senza modificare il Core.

`synchronize()` applica con la generation letta. Su CONFLICT rilegge una sola volta,
rifà merge e validate, poi riprova con una nuova correlation ID; un secondo conflitto
viene restituito al flow. Non applica mai una Config vuota durante deploy parziale e
non permette ai singoli nodi Module di chiamare `applyConfig()` direttamente.

Documenta in `examples/node_red/README.md` la struttura futura:

```text
spaghetti-core          connessione, credenziale, client e catalogo
spaghetti-config        unico Config Coordinator
spaghetti-module        produce un fragment, non scrive il Core
spaghetti-record        sottoscrive record tipizzati
spaghetti-command       invia un comando dichiarato dal catalogo
spaghetti-discovery     scan/list/accept
spaghetti-connectivity  policy e lease
spaghetti-update        job update e progresso
```

### Implementare i transport host

Crea adapter `src/transports/mqtt.ts` e `src/transports/websocket.ts`. MQTT usa i topic
V1 della fase 370; WebSocket usa il gateway della fase 375. Entrambi consegnano byte
identici a `SpaghettiClient`, non traducono Config e non possiedono retry applicativi
separati. Credenziali e broker config vengono iniettati dal nodo `spaghetti-core`, non
salvati nel flow esportato.

Un nodo Node-RED non esegue funzioni Zephyr arbitrarie. Se una funzione deve toccare
hardware, rispettare timing deterministico, funzionare offline o garantire safe state,
va implementata come Module Driver, Rule Driver oppure operation handler firmware e
compilata nell'immagine. Il nodo host può chiamarla soltanto se compare nel catalogo
con schema request/response e permessi.

## Perché è fatto così

Senza SDK, flow MQTT, gateway BLE e CLI JavaScript divergerebbero su errori, int64,
retry e Config. Il coordinator evita il caso più pericoloso: due nodi che leggono la
stessa Config e applicano snapshot complete cancellando reciprocamente le modifiche.

## Come si usa

```ts
const client = new SpaghettiClient(mqttTransport);
const coordinator = new ConfigCoordinator(client);

coordinator.setFragment({
  ownerId: "flow-ina219-0",
  modules: [{
    key: 10,
    port: 0,
    bay: 0,
    powerRail: 1,
    type: "ina219",
    properties: {i2c_address: 64}
  }]
});

const result = await coordinator.synchronize();
```

## Checklist di completamento

- [x] Codec, transport e client hanno responsabilità separate.
- [x] Retry conserva correlation ID e byte originali.
- [x] Status V1 non dipende da errno Zephyr.
- [x] INT64/UINT64 attraversano CBOR e JSON senza perdita.
- [x] Catalog cache usa il fingerprint e viene invalidata dopo OTA.
- [x] Topology e modello editor descrivono più Flow da cinque segnali senza hardcode di board.
- [x] Config Coordinator impedisce lost update e apply durante deploy parziale.
- [x] MQTT e WebSocket superano gli stessi test di contratto.
- [x] C, Python e TypeScript leggono gli stessi golden vector.

## Verifica e fine task

```sh
make host-tools
npm --prefix tools/sdk/typescript ci
npm --prefix tools/sdk/typescript test
.venv/bin/python -m unittest discover -s tools/tests -v
make node-red-mqtt-smoke
make node-red-ble-smoke
```

I test devono coprire paginazione, fingerprint cambiato, timeout con retry, response
duplicata, interi estremi, due fragment in conflitto, due client concorrenti, Config
identica e identico risultato usando MQTT oppure WebSocket.
