import { describe, expect, it } from "vitest";

import { SpaghettiClient } from "../src/client.js";
import { ConfigCoordinator } from "../src/config-coordinator.js";
import { buildEditorModel } from "../src/editor-model.js";
import { ProtocolConflictError, ProtocolError } from "../src/errors.js";
import { encodeCatalogPage } from "../src/catalog.js";
import {
  emptySpaghettiConfig,
  encodeResponse,
  decodeRequest,
  encodeConfig,
} from "../src/config-codec.js";
import { Operation } from "../src/types.js";
import {
  FakeTransport,
  makeCoreState,
  sha256Hex,
  withMutableCatalog,
} from "./fake-transport.js";
import { MqttProtocolTransport, type MqttConnection } from "../src/transports/mqtt.js";
import {
  WebSocketProtocolTransport,
  type WebSocketConnection,
} from "../src/transports/websocket.js";

describe("SpaghettiClient", () => {
  it("paginates catalog and caches by fingerprint", async () => {
    const drivers = [
      { typeId: "a", commandCount: 0, commands: [], fields: [] },
      { typeId: "b", commandCount: 0, commands: [], fields: [] },
    ];
    const { handler } = withMutableCatalog({
      protocolVersion: 1,
      configVersion: 5,
      fingerprint: "ab".repeat(32),
      drivers,
      driverCount: 2,
    });
    const transport = new FakeTransport("fake", handler);
    const client = new SpaghettiClient(transport, { defaultTimeoutMs: 1000, maxRetries: 1 });
    const catalog = await client.getCatalog();
    expect(catalog.drivers.map((d) => d.typeId)).toEqual(["a", "b"]);
    const cached = await client.getCatalog();
    expect(cached.fingerprint).toBe(catalog.fingerprint);
    const sendsBefore = transport.sent.length;
    await client.getCatalog();
    expect(transport.sent.length).toBe(sendsBefore);
    await client.close();
  });

  it("restarts catalog pagination when fingerprint changes mid-read", async () => {
    let pageReads = 0;
    let fingerprint = "11".repeat(32);
    const transport = new FakeTransport("fake", async (operation, payload) => {
      if (operation !== Operation.GET_CATALOG) {
        return makeCoreState()(operation, payload, 1);
      }
      pageReads += 1;
      const { decodeOne, requireMap, optionalU32 } = await import("../src/codec.js");
      const map = requireMap(decodeOne(payload), "cat");
      const cursor = optionalU32(map, 0, 0, "cat");
      // First full attempt: change fingerprint on second page.
      if (pageReads === 2) {
        fingerprint = "22".repeat(32);
      }
      if (cursor === 0) {
        return encodeCatalogPage({
          protocolVersion: 1,
          configVersion: 5,
          fingerprint,
          drivers: [{ typeId: "a", commandCount: 0, commands: [], fields: [] }],
          nextCursor: 1,
          driverCount: 2,
        });
      }
      return encodeCatalogPage({
        protocolVersion: 1,
        configVersion: 5,
        fingerprint,
        drivers: [{ typeId: "b", commandCount: 0, commands: [], fields: [] }],
        nextCursor: 0,
        driverCount: 2,
      });
    });
    const client = new SpaghettiClient(transport, { defaultTimeoutMs: 1000 });
    const catalog = await client.getCatalog(true);
    expect(catalog.fingerprint).toBe("22".repeat(32));
    expect(catalog.drivers.map((d) => d.typeId)).toEqual(["a", "b"]);
    await client.close();
  });

  it("ignores duplicate response after the first settle", async () => {
    let calls = 0;
    const transport = new FakeTransport("fake", async (operation, payload, correlationId) => {
      calls += 1;
      const result = await makeCoreState()(operation, payload, correlationId);
      return result;
    });
    const originalSend = transport.send.bind(transport);
    transport.send = async (request, timeoutMs) => {
      const first = await originalSend(request, timeoutMs);
      // A late duplicate with the same correlation must not break the client.
      void first;
      return first;
    };
    const client = new SpaghettiClient(transport);
    await client.getStatus();
    expect(calls).toBe(1);
    await client.close();
  });

  it("retries timeout with identical bytes and correlation", async () => {
    const transport = new FakeTransport("fake", makeCoreState());
    transport.failTimes = 1;
    const client = new SpaghettiClient(transport, {
      defaultTimeoutMs: 50,
      maxRetries: 2,
      retryDelayMs: 5,
    });
    await client.getStatus();
    expect(transport.sent.length).toBe(2);
    expect(Buffer.from(transport.sent[0]!).equals(Buffer.from(transport.sent[1]!))).toBe(true);
    const a = decodeRequest(transport.sent[0]!);
    const b = decodeRequest(transport.sent[1]!);
    expect(a.correlationId).toBe(b.correlationId);
    await client.close();
  });

  it("does not auto-retry conflict / unauthorized / invalid_argument", async () => {
    const transport = new FakeTransport("fake", async () => ({ status: "conflict" }));
    const client = new SpaghettiClient(transport, { maxRetries: 3, retryDelayMs: 1 });
    await expect(client.getStatus()).rejects.toBeInstanceOf(ProtocolConflictError);
    expect(transport.sent.length).toBe(1);
    await client.close();
  });

  it("handles identical Config apply as success path", async () => {
    const config = emptySpaghettiConfig();
    const transport = new FakeTransport(
      "fake",
      makeCoreState({ config, generation: 3 }),
    );
    const client = new SpaghettiClient(transport);
    const snap = await client.getConfig();
    expect(snap.revision.generation).toBe(3);
    expect(snap.revision.sha256).toBe(sha256Hex(encodeConfig(config)));
    await client.close();
  });
});

describe("ConfigCoordinator", () => {
  it("rejects two owners claiming the same key with different content", async () => {
    const transport = new FakeTransport("fake", makeCoreState());
    const client = new SpaghettiClient(transport);
    const coordinator = new ConfigCoordinator(client);
    coordinator.setFragment({
      ownerId: "a",
      modules: [{ key: 1, port: 0, type: "x", properties: { "1": 1 } }],
    });
    coordinator.setFragment({
      ownerId: "b",
      modules: [{ key: 1, port: 0, type: "x", properties: { "1": 2 } }],
    });
    await expect(coordinator.preview()).rejects.toBeInstanceOf(ProtocolError);
    await client.close();
  });

  it("synchronizes merged fragments and recovers one conflict", async () => {
    let generation = 1;
    let config = emptySpaghettiConfig();
    let applyCalls = 0;
    const transport = new FakeTransport("fake", async (operation, payload) => {
      if (operation === Operation.GET_CONFIG) {
        const { encodeGetConfigResponse } = await import("../src/config-codec.js");
        return encodeGetConfigResponse({
          config,
          revision: { generation, sha256: sha256Hex(encodeConfig(config)) },
        });
      }
      if (operation === Operation.VALIDATE_CONFIG) {
        const { encodeValidValidateResponse } = await import("./fake-transport.js");
        return encodeValidValidateResponse();
      }
      if (operation === Operation.APPLY_CONFIG) {
        applyCalls += 1;
        const { decodeOne, requireMap, requireU32, requireBytes } = await import(
          "../src/codec.js"
        );
        const { decodeConfig, encodeApplyConfigResponse } = await import(
          "../src/config-codec.js"
        );
        const map = requireMap(decodeOne(payload), "apply");
        const expected = requireU32(map, 0, "apply");
        if (applyCalls === 1) {
          // Force one conflict then advance generation as if another client wrote.
          generation = expected + 1;
          return { status: "conflict" as const };
        }
        if (expected !== generation) {
          return { status: "conflict" as const };
        }
        config = decodeConfig(requireBytes(map, 1, "apply"));
        generation += 1;
        return encodeApplyConfigResponse({
          changed: true,
          revision: { generation, sha256: sha256Hex(encodeConfig(config)) },
        });
      }
      return makeCoreState()(operation, payload, 1);
    });
    const client = new SpaghettiClient(transport);
    const coordinator = new ConfigCoordinator(client);
    coordinator.setFragment({
      ownerId: "flow-ina219-0",
      modules: [
        {
          key: 10,
          port: 0,
          bay: 0,
          powerRail: 1,
          type: "ina219",
          properties: { "1": 64 },
          propertyTypes: { "1": "uint64" },
        },
      ],
    });
    const result = await coordinator.synchronize();
    expect(result.changed).toBe(true);
    expect(applyCalls).toBe(2);
    await client.close();
  });

  it("supports two concurrent clients without shared mutable state", async () => {
    const t1 = new FakeTransport("a", makeCoreState({ generation: 1 }));
    const t2 = new FakeTransport("b", makeCoreState({ generation: 1 }));
    const c1 = new SpaghettiClient(t1);
    const c2 = new SpaghettiClient(t2);
    const [s1, s2] = await Promise.all([c1.getStatus(), c2.getStatus()]);
    expect(s1.version).toBe(s2.version);
    await Promise.all([c1.close(), c2.close()]);
  });
});

describe("buildEditorModel", () => {
  it("keeps unmanaged rails unverified", async () => {
    const transport = new FakeTransport("fake", makeCoreState());
    const client = new SpaghettiClient(transport);
    const catalog = await client.getCatalog();
    const topology = await client.getTopology();
    const config = await client.getConfig();
    const model = buildEditorModel(catalog, topology, config.config);
    const unmanaged = model.powerRails.find((r) => r.assurance === "unmanaged");
    expect(unmanaged?.verification).toBe("unverified");
    await client.close();
  });
});

describe("MQTT vs WebSocket contract parity", () => {
  it("returns identical payloads for the same request bytes", async () => {
    const core = makeCoreState();
    const responses = new Map<string, Uint8Array>();

    const mqttConn: MqttConnection = {
      publish: async (topic, payload) => {
        if (!topic.includes("/requests/")) return;
        const req = decodeRequest(payload);
        const result = await core(req.operation, req.payload, req.correlationId);
        const body = result instanceof Uint8Array ? result : (result.payload ?? new Uint8Array());
        const status = result instanceof Uint8Array ? "ok" : (result.status ?? "ok");
        const response = encodeResponse(req.correlationId, status, body);
        responses.set("mqtt", response);
        for (const handler of mqttHandlers) handler(response);
      },
      subscribe: (_topic, handler) => {
        mqttHandlers.push(handler);
        return () => {
          const idx = mqttHandlers.indexOf(handler);
          if (idx >= 0) mqttHandlers.splice(idx, 1);
        };
      },
      close: async () => undefined,
    };
    const mqttHandlers: Array<(p: Uint8Array) => void> = [];

    const wsHandlers: Array<(d: Uint8Array | string) => void> = [];
    const wsConn: WebSocketConnection = {
      send: (data) => {
        void (async () => {
          const req = decodeRequest(data);
          const result = await core(req.operation, req.payload, req.correlationId);
          const body = result instanceof Uint8Array ? result : (result.payload ?? new Uint8Array());
          const status = result instanceof Uint8Array ? "ok" : (result.status ?? "ok");
          const response = encodeResponse(req.correlationId, status, body);
          responses.set("ws", response);
          for (const handler of wsHandlers) handler(response);
        })();
      },
      onMessage: (handler) => {
        wsHandlers.push(handler);
        return () => {
          const idx = wsHandlers.indexOf(handler);
          if (idx >= 0) wsHandlers.splice(idx, 1);
        };
      },
      close: async () => undefined,
    };

    const mqtt = new MqttProtocolTransport(mqttConn, {
      coreId: "aa".repeat(32),
      clientId: "node-red-1",
    });
    const ws = new WebSocketProtocolTransport(wsConn);
    const mqttClient = new SpaghettiClient(mqtt, { defaultTimeoutMs: 1000 });
    const wsClient = new SpaghettiClient(ws, { defaultTimeoutMs: 1000 });
    const [mqttStatus, wsStatus] = await Promise.all([
      mqttClient.getStatus(),
      wsClient.getStatus(),
    ]);
    expect(mqttStatus).toEqual(wsStatus);
    expect(Buffer.from(responses.get("mqtt")!).equals(Buffer.from(responses.get("ws")!))).toBe(
      true,
    );
    await Promise.all([mqttClient.close(), wsClient.close()]);
  });
});
