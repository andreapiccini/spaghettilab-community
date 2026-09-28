# `@spaghettilab/protocol`

Host TypeScript SDK for Spaghetti LAB Communication Protocol V1.

Compiled locally under `firmware/backbone/tools/sdk/typescript/`. **Not published to npm.**

## Layout

| Path | Role |
|---|---|
| `src/codec.ts` | Canonical CBOR encode/decode (zcbor indefinite maps/arrays) |
| `src/value.ts` | Typed wire values; JSON number only in safe integer range |
| `src/catalog.ts` | Catalog page decode + fingerprint helpers |
| `src/client.ts` | `SpaghettiClient` — correlation, timeout, retry, catalog cache |
| `src/config-coordinator.ts` | Single Config merge / VALIDATE / CAS APPLY |
| `src/editor-model.ts` | Pure `buildEditorModel` (no React / Node-RED) |
| `src/transports/` | MQTT and WebSocket byte adapters |

## Golden vectors

Shared CBOR fixtures live at `contracts/protocol-v1/vectors/v1/` and are
read by TypeScript, Python (`tools/tests/test_protocol_vectors.py`), and (phase
380) C host/CLI tests. Do not fork copies per language.

## Build / test

```sh
npm --prefix tools/sdk/typescript ci
npm --prefix tools/sdk/typescript test
```

## Usage sketch

```ts
import {
  SpaghettiClient,
  ConfigCoordinator,
  MqttProtocolTransport,
} from "@spaghettilab/protocol";

const transport = new MqttProtocolTransport(connection, {
  coreId,
  clientId,
  baseTopic: "spaghetti",
});
const client = new SpaghettiClient(transport);
const coordinator = new ConfigCoordinator(client);

coordinator.setFragment({
  ownerId: "flow-ina219-0",
  modules: [{
    key: 10,
    port: 0,
    bay: 0,
    powerRail: 1,
    type: "ina219",
    properties: { "1": 64 },
  }],
});

await coordinator.synchronize();
```

Credentials and broker settings are injected by the future `spaghetti-core`
Node-RED node; they must never be stored in an exported flow.
