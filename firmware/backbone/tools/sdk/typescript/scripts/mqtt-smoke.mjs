/**
 * Fake MQTT → SpaghettiClient smoke (no broker, no Node-RED process).
 * Covers GET_STATUS, paginated GET_CATALOG, and lossless int64 vector presence.
 */
import {
  SpaghettiClient,
  MqttProtocolTransport,
  decodeRequest,
  encodeResponse,
  encodeGetStatusResponse,
  encodeCatalogPage,
  Operation,
  integerFromJson,
  integerToJson,
} from "../dist/index.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectorsDir = join(
  __dirname,
  "../../../../../../contracts/protocol-v1/vectors/v1",
);

async function main() {
  const handlers = new Map();

  const connection = {
    async publish(topic, payload) {
      if (!topic.includes("/requests/")) return;
      const req = decodeRequest(payload);
      const responseTopic = topic.replace("/requests/", "/responses/");
      let body;

      if (req.operation === Operation.GET_STATUS) {
        body = encodeGetStatusResponse({
          state: 1,
          mode: 0,
          imageState: 0,
          activeSlot: 0,
          imageConfirmed: true,
          version: "smoke",
          portCount: 2,
          lastResetCause: 0,
          healthState: 0,
          modules: [],
        });
      } else if (req.operation === Operation.GET_CATALOG) {
        body = encodeCatalogPage({
          protocolVersion: 1,
          configVersion: 5,
          fingerprint: "11".repeat(32),
          drivers: [
            { typeId: "fake_temperature", commandCount: 0, commands: [], fields: [] },
            { typeId: "fake_pwm", commandCount: 1, commands: [], fields: [] },
          ],
          nextCursor: 0,
          driverCount: 2,
        });
      } else {
        throw new Error(`unexpected operation ${req.operation}`);
      }

      const response = encodeResponse(req.correlationId, "ok", body);
      for (const handler of handlers.get(responseTopic) ?? []) {
        handler(response);
      }
    },
    subscribe(topic, handler) {
      const list = handlers.get(topic) ?? [];
      list.push(handler);
      handlers.set(topic, list);
      return () => {
        const next = (handlers.get(topic) ?? []).filter((h) => h !== handler);
        handlers.set(topic, next);
      };
    },
    async close() {
      handlers.clear();
    },
  };

  const transport = new MqttProtocolTransport(connection, {
    coreId: "11".repeat(32),
    clientId: "mqtt-smoke",
    baseTopic: "spaghetti",
  });
  const client = new SpaghettiClient(transport, { defaultTimeoutMs: 2000 });

  const status = await client.getStatus();
  if (status.version !== "smoke") {
    throw new Error(`unexpected status version ${status.version}`);
  }

  const catalog = await client.getCatalog(true);
  if (catalog.driverCount < 2 || catalog.drivers.length < 2) {
    throw new Error("catalog missing fake drivers");
  }

  const int64min = JSON.parse(
    readFileSync(join(vectorsDir, "int64min.json"), "utf8"),
  );
  const raw =
    int64min.normalized?.value ??
    int64min.value ??
    "-9223372036854775808";
  const value = integerFromJson(raw);
  if (typeof integerToJson(value) !== "string") {
    throw new Error("int64min must round-trip as string outside safe range");
  }

  const uint64max = JSON.parse(
    readFileSync(join(vectorsDir, "uint64max.json"), "utf8"),
  );
  integerFromJson(
    uint64max.normalized?.value ??
      uint64max.value ??
      "18446744073709551615",
  );
  await client.close();
  console.log("node-red-mqtt-smoke: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
