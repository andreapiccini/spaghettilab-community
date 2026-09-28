import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bytesToHex,
  encodeCatalogPage,
  emptySpaghettiConfig,
  encodeConfig,
  encodeEmptyPayload,
  encodeInt64Value,
  encodeRecordEventPayload,
  encodeRequest,
  encodeResponse,
  encodeUint64Value,
  integerJsonRoundTrip,
  Operation,
} from "../dist/index.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../contracts/protocol-v1/vectors/v1",
);
mkdirSync(root, { recursive: true });

function write(name, cbor, normalized) {
  const doc = {
    name,
    cbor_hex: bytesToHex(cbor),
    normalized,
  };
  writeFileSync(path.join(root, `${name}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${name}.json (${cbor.length} bytes)`);
}

write(
  "request",
  encodeRequest({
    correlationId: 1,
    operation: Operation.GET_STATUS,
    payload: encodeEmptyPayload(),
  }),
  {
    version: 1,
    correlation_id: 1,
    operation: Operation.GET_STATUS,
    payload: {},
  },
);

write(
  "response",
  encodeResponse(1, "ok", encodeEmptyPayload()),
  {
    version: 1,
    correlation_id: 1,
    status: 0,
    status_name: "ok",
    payload: {},
  },
);

write(
  "error",
  encodeResponse(42, "unauthorized", encodeEmptyPayload()),
  {
    version: 1,
    correlation_id: 42,
    status: 3,
    status_name: "unauthorized",
    payload: {},
  },
);

const config = emptySpaghettiConfig();
config.modules = [
  {
    key: 10,
    port: 0,
    bay: 0,
    powerRail: 1,
    type: "ina219",
    properties: { "1": 64 },
    propertyTypes: { "1": "uint64" },
  },
];
write("config", encodeConfig(config), {
  version: 4,
  modules: [
    {
      key: 10,
      port: 0,
      bay: 0,
      power_rail: 1,
      type: "ina219",
      properties: { "1": 64 },
    },
  ],
  schedules: [],
  rules: [],
  blocks: [],
  edges: [],
  connectivity_policy: 0,
  energy_policy: { availability: 0, window_ms: 0, period_ms: 0 },
  mqtt: {
    enabled: false,
    host: "",
    port: 1883,
    base_topic: "spaghetti",
    security: 0,
    credential_id: 0,
  },
});

write(
  "catalog",
  encodeCatalogPage({
    protocolVersion: 1,
    configVersion: 5,
    fingerprint: "aa".repeat(32),
    drivers: [{ typeId: "ina219", commandCount: 2, commands: [], fields: [] }],
    nextCursor: 0,
    driverCount: 1,
  }),
  {
    protocol_version: 1,
    config_version: 5,
    fingerprint: "aa".repeat(32),
    drivers: [{ type_id: "ina219", command_count: 2 }],
    next_cursor: 0,
    driver_count: 1,
  },
);

write(
  "record",
  encodeRecordEventPayload({
    sourceKey: 10,
    sequence: 3,
    schemaId: "spaghetti.ina219.sample",
    schemaVersion: 1,
  }),
  {
    source_key: 10,
    sequence: 3,
    schema_id: "spaghetti.ina219.sample",
    schema_version: 1,
  },
);

const int64min = -9223372036854775808n;
write("int64min", encodeInt64Value(int64min), {
  type: "int64",
  value: integerJsonRoundTrip(int64min),
});

const uint64max = 18446744073709551615n;
write("uint64max", encodeUint64Value(uint64max), {
  type: "uint64",
  value: integerJsonRoundTrip(uint64max),
});
