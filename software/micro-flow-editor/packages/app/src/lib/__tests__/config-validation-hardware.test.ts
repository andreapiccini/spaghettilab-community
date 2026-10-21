import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { rgbModuleDraft } from "../rgb-module.js";
import { planModuleImport, commitModuleImport } from "../module-import.js";
import { prepareDistributedDeployment } from "../distributed-deployment-plan.js";
import { writeFileSync } from "node:fs";
import {
  SpaghettiClient,
  WebSocketProtocolTransport,
} from "@spaghettilab/protocol-sdk";
import { compileConfig, encodeConfigCbor } from "@spaghettilab/config-compiler";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
function fixture() {
  const p = {
    coreBindings: [
      {
        bindingId: "master",
        expectedDeviceId: "907069e1c4fc".padEnd(64, "0"),
        connectionProfileId: "usb",
      },
    ],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as unknown as ProjectV1;
  const proposal = planModuleImport(p, "master", "master:remote", rgbModuleDraft(), {
    name: "Function",
    variant: "v2",
    modes: [0, 0, 0, 0, 0, 0, 0, 0],
    i2cSpeed: 0,
    local: false,
    nodeId: 0xe17fd0,
    backendPortId: 0,
  });
  const installed = commitModuleImport(p, proposal, "rgb", false, true);
  const graph = installed.deviceGraphs[0]!;
  const led = graph.nodes[0]!.id;
  const input = {
    physicalGraph: installed.physicalGraphs[0]!,
    processingGraph: {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          layer: "device-processing" as const,
          id: "colors",
          data: { kind: "block" as const, blockTypeId: "led_driver", properties: {} },
        },
        {
          layer: "device-processing" as const,
          id: "viewer",
          data: {
            kind: "block" as const,
            blockTypeId: "ui.data_viewer",
            properties: {},
          },
        },
      ],
      edges: [
        {
          id: "color-wire",
          source: "colors",
          sourceHandle: "0",
          target: led,
          targetHandle: "color-input",
        },
        {
          id: "state-wire",
          source: led,
          sourceHandle: "state",
          target: "viewer",
          targetHandle: "0",
        },
      ],
    },
    mqtt: DISABLED_MQTT,
    connectivity: 0,
    energy: DEFAULT_ENERGY,
  };
  return { installed, input };
}
it.skipIf(process.env.RUN_CONFIG_VALIDATION !== "1")(
  "validates generated RGB flow without applying it",
  async () => {
    const { installed, input } = fixture();
    const graph = input.processingGraph;
    graph.nodes = graph.nodes.filter((node) => node.id !== "viewer");
    graph.nodes.push({
      layer: "device-processing",
      id: "dp-1792359755769-578758",
      parentId: "timer",
      data: { kind: "block", blockTypeId: "ui.manual_trigger", properties: {} },
    } as never);
    graph.nodes.push({
      layer: "device-processing",
      id: "timer",
      data: { kind: "schedule", moduleNodeId: "", periodMs: 2000, enabled: true },
    } as never);
    graph.edges = graph.edges.filter((edge) => edge.id !== "state-wire");
    graph.edges.push({
      id: "trigger",
      source: "dp-1792359755769-578758",
      sourceHandle: "0",
      target: "colors",
      targetHandle: "0",
    });
    graph.edges.push({
      id: "membership",
      source: "timer",
      sourceHandle: "0",
      target: "dp-1792359755769-578758",
      targetHandle: "0",
    });
    const plan = prepareDistributedDeployment(installed, "master", input);
    const compiled = compileConfig(plan.input, plan.options);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled));
    const bytes = encodeConfigCbor(compiled.value);
    writeFileSync("/private/tmp/validate-rgb-generated.cbor", bytes);
    const socket = new WebSocket(
      "ws://127.0.0.1:8766/core/" + "907069e1c4fc".padEnd(64, "0"),
    );
    socket.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = reject;
    });
    const transport = new WebSocketProtocolTransport({
      send: (bytes) => socket.send(bytes),
      onMessage: (handler) => {
        const listener = (event: MessageEvent) => handler(new Uint8Array(event.data));
        socket.addEventListener("message", listener);
        return () => socket.removeEventListener("message", listener);
      },
    });
    const client = new SpaghettiClient(transport, {
      maxRetries: 0,
      defaultTimeoutMs: 10000,
      attemptTimeoutMs: 9000,
    });
    try {
      const status = await client.getStatus();
      const peer = client.forCanNode(0xe17fd0);
      let peerVersion: string | undefined;
      try {
        peerVersion = (await peer.getStatus()).version;
      } finally {
        peer.dispose();
      }
      const results = [];
      for (let i = 0; i < 3; i++)
        results.push(await client.validateConfig({ configBytes: bytes }));
      expect(results.every((result) => result.valid)).toBe(true);
      writeFileSync(
        "/private/tmp/validate-rgb-generated-result.json",
        JSON.stringify({
          bytes: bytes.length,
          usbVersion: status.version,
          canVersion: peerVersion,
          results,
        }),
      );
    } finally {
      client.dispose();
      transport.dispose();
      socket.close();
    }
  },
  30000,
);
