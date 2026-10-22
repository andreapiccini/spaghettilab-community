import { manualDeploymentIsCurrent } from "../manual-deployment-current.js";
import { oneShotDeploymentInput } from "../one-shot-deployment.js";
import { completionProfileIds } from "../distributed-deployment.js";
import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { rgbModuleDraft } from "../rgb-module.js";
import { planModuleImport, commitModuleImport } from "../module-import.js";
import { prepareDistributedDeployment } from "../distributed-deployment-plan.js";
import { compileConfig } from "@spaghettilab/config-compiler";
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
it("places the RGB driver on its assigned board and routes typed signals in both directions", () => {
  const { installed, input } = fixture();
  const plan = prepareDistributedDeployment(installed, "master", input);
  expect(plan.remotePlans).toHaveLength(1);
  expect(plan.hostNodeId).toBe(0xe1c4fc);
  expect(
    plan.profiles.some((p) => p.initOps.some((op) => op.op === "RGB_PROGRAM")),
  ).toBe(false);
  const remote = plan.remotePlans[0]!;
  expect(remote.nodeId).toBe(0xe17fd0);
  expect(
    remote.plan.profiles.some((p) =>
      p.initOps.some((op) => op.op === "RGB_PROGRAM" && !op.nodeId),
    ),
  ).toBe(true);
  expect(remote.plan.profiles.every((p) => !p.profileId.includes(".ne17fd0"))).toBe(
    true,
  );
  expect(
    plan.input.physicalGraph.nodes.filter(
      (n) => (n.data as { driverTypeId?: string }).driverTypeId === "can-link",
    ),
  ).toHaveLength(2);
  for (const part of [plan, remote.plan]) {
    const compiled = compileConfig(part.input, part.options);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    for (const receiver of part.input.physicalGraph.nodes.filter((node) =>
      node.id.startsWith("can-rx:"),
    )) {
      const properties = (receiver.data as { properties: Record<string, unknown> })
        .properties;
      const route = compiled.value.modules.find(
        (module) =>
          module.typeId === "can-link" && module.properties[2] === properties["2"],
      );
      expect(
        compiled.value.schedules.some(
          (schedule) => schedule.sourceKey === route?.key && !schedule.enabled,
        ),
      ).toBe(true);
    }
    expect(compiled.value.rules.length).toBeGreaterThanOrEqual(1);
    expect(compiled.value.rules.every((rule) => rule.typeId === "device-action")).toBe(
      true,
    );
  }
  expect(plan.observations?.[0]).toMatchObject({
    viewerId: "viewer",
    valueKind: "boolean",
  });
});
it("uses the USB identity when stale physical metadata calls another board local", () => {
  const { installed, input } = fixture();
  const switched = {
    ...installed,
    coreBindings: [
      {
        ...installed.coreBindings[0]!,
        expectedDeviceId: "907069e17fd0".padEnd(64, "0"),
      },
    ],
  } as ProjectV1;
  const plan = prepareDistributedDeployment(switched, "master", input);
  expect(plan.remotePlans).toHaveLength(0);
  expect(plan.hostNodeId).toBe(0xe17fd0);
});

it("keeps a decimal temperature comparable after it crosses CAN", async () => {
  const { catalogDs18b20Driver } = await import("../gpio-driver-presets.js");
  const { installed: base } = fixture();
  // Reuse only the project's board identities; install the sensor on a fresh graph.
  const project = {
    ...base,
    physicalGraphs: [{ layer: "physical-composition" as const, nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing" as const, nodes: [], edges: [] }],
    authoringMetadata: {},
  };
  const driver = catalogDs18b20Driver();
  const proposal = planModuleImport(project, "master", "master:remote", driver, {
    name: "Function",
    variant: "v2",
    modes: [0, 0, 0, 0, 0, 0, 0, 0],
    i2cSpeed: 0,
    local: false,
    nodeId: 0xe17fd0,
    backendPortId: 0,
  });
  const installed = commitModuleImport(project, proposal, "temperature", false, true);
  const graph = installed.deviceGraphs[0]!,
    sensor = graph.nodes[0]!.id;
  const output = driver.channels.find((channel) => channel.direction === "read")!.id;
  const plan = prepareDistributedDeployment(installed, "master", {
    physicalGraph: installed.physicalGraphs[0]!,
    processingGraph: {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          layer: "device-processing",
          id: "condition",
          data: {
            kind: "block",
            blockTypeId: "logic_if",
            properties: { value: "28,10", condition: 4 },
          },
        },
        {
          layer: "device-processing",
          id: "viewer",
          data: { kind: "block", blockTypeId: "ui.data_viewer", properties: {} },
        },
      ],
      edges: [
        {
          id: "sample",
          source: sensor,
          sourceHandle: output,
          target: "condition",
          targetHandle: "0",
        },
        {
          id: "display",
          source: "condition",
          sourceHandle: "0",
          target: "viewer",
          targetHandle: "0",
        },
      ],
    },
    mqtt: DISABLED_MQTT,
    connectivity: 0,
    energy: DEFAULT_ENERGY,
  });
  const condition = plan.input.processingGraph.nodes.find(
    (node) => node.id === "condition",
  )!.data as { properties: Record<string, unknown> };
  expect(condition.properties["7"]).toBe("28.1");
  expect(condition.properties["8"]).toBe(2n);
  expect(
    plan.remotePlans[0]!.plan.profiles.some((profile) =>
      profile.sampleOps.some((op) => op.op === "DS18B20_READ"),
    ),
  ).toBe(true);
  expect(compileConfig(plan.input, plan.options).ok).toBe(true);
});

it("deploys the same canvas on replacement boards by position rather than the saved MAC", () => {
  const { installed, input } = fixture();
  const status = {
    deviceId: Uint8Array.from([0x90, 0x70, 0x69, 0xef, 0, 1, ...Array(26).fill(0)]),
    chainPeers: [
      { nodeId: 0xef0001, local: true, mac: new Uint8Array(6), flags: 128 },
      { nodeId: 0xef0002, local: false, mac: new Uint8Array(6), flags: 0 },
    ],
  } as unknown as import("@spaghettilab/protocol-sdk").GetStatusResponse;
  const result = prepareDistributedDeployment(installed, "master", input, status);
  expect(result.hostNodeId).toBe(0xef0001);
  expect(result.remotePlans.map((part) => part.nodeId)).toEqual([0xef0002]);
  expect(result.physicalRequests?.some((request) => request.nodeId === 0xef0002)).toBe(
    true,
  );
  expect(
    result.remotePlans[0]!.plan.profiles.some((profile) =>
      profile.initOps.some((op) => op.op === "RGB_PROGRAM" && !op.nodeId),
    ),
  ).toBe(true);
});

it("compiles the temperature IF to preset 2 and a remote RGB color input", async () => {
  const { catalogDs18b20Driver } = await import("../gpio-driver-presets.js");
  const { installed, input } = fixture();
  const driver = catalogDs18b20Driver();
  const proposal = planModuleImport(installed, "master", "master:local", driver, {
    name: "Function",
    variant: "v2",
    modes: Array(8).fill(0),
    i2cSpeed: 0,
    local: true,
    nodeId: 0xe1c4fc,
  });
  const project = commitModuleImport(installed, proposal, "temperature", false, true);
  const sensor = project.deviceGraphs[0]!.nodes.find((node) =>
    node.id.includes("temperature"),
  )!;
  const graph = {
    ...input.processingGraph,
    nodes: [
      ...input.processingGraph.nodes,
      sensor,
      {
        layer: "device-processing" as const,
        id: "white",
        data: {
          kind: "block" as const,
          blockTypeId: "status_led",
          properties: { statusLed: true },
        },
      },
      {
        layer: "device-processing" as const,
        id: "if",
        data: {
          kind: "block" as const,
          blockTypeId: "logic_if",
          properties: { condition: 4, value: "30" },
        },
      },
    ],
    edges: [
      ...input.processingGraph.edges,
      {
        id: "white-level",
        source: "if",
        sourceHandle: "0",
        target: "white",
        targetHandle: "0",
      },
      {
        id: "read-if",
        source: sensor.id,
        sourceHandle: driver.channels.find((channel) => channel.direction === "read")!
          .id,
        target: "if",
        targetHandle: "0",
      },
      {
        id: "preset2",
        source: "if",
        sourceHandle: "0",
        target: "colors",
        targetHandle: "1",
      },
    ],
  };
  const plan = prepareDistributedDeployment(project, "master", {
    ...input,
    processingGraph: graph,
  });
  const configs = [plan, ...plan.remotePlans.map((item) => item.plan)].map((part) => {
    const compiled = compileConfig(part.input, part.options);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    return compiled.value;
  });
  expect(configs).toHaveLength(2);
  const host = configs[0]!;
  const condition = host.blocks.find((block) => block.typeId === "logic_if")!;
  const outgoing = host.edges.filter(
    (edge) => edge.sourceKind === 1 && edge.sourceKey === condition.key,
  );
  const publishes = new Set(
    host.blocks
      .filter((block) => block.typeId === "publish_field")
      .map((block) => block.key),
  );
  expect(outgoing.filter((edge) => publishes.has(edge.targetKey))).toHaveLength(1);
  expect(outgoing.length).toBeLessThanOrEqual(4);
});

 it("recognizes the distributed upload as current in continuous and manual mode", () => {
  const { installed, input } = fixture();
  const project = { ...installed, deviceGraphs: [input.processingGraph] } as ProjectV1;
  const plan = prepareDistributedDeployment(project, "master", input);
  for (const deployment of [plan.input, oneShotDeploymentInput(plan.input, completionProfileIds(plan))]) {
    const compiled = compileConfig(deployment, plan.options);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) continue;
    expect(manualDeploymentIsCurrent(project, "master", compiled.value)).toBe(true);
    const changed = { ...project, deviceGraphs: [{ ...input.processingGraph, edges: [] }] } as ProjectV1;
    expect(manualDeploymentIsCurrent(changed, "master", compiled.value)).toBe(false);
  }
});

it("routes integrated LED preset triggers to an RGB driver on CAN", () => {
  const { installed, input } = fixture();
  const led = input.processingGraph.nodes.find(node => node.id !== "colors" && node.id !== "viewer")!.id;
  const integrated = { ...input, processingGraph: { ...input.processingGraph,
    nodes: input.processingGraph.nodes.filter(node => node.id !== "colors").concat([{
      layer: "device-processing", id: "activate", data: { kind: "block", blockTypeId: "ui.manual_trigger", properties: {} },
    }]),
    edges: input.processingGraph.edges.filter(edge => edge.id !== "color-wire").concat([{
      id: "preset-trigger", source: "activate", sourceHandle: "trigger", target: led, targetHandle: "preset:0",
    }]),
  } };
  const plan = prepareDistributedDeployment(installed, "master", integrated);
  expect(plan.remotePlans).toHaveLength(1);
  for (const part of [plan, plan.remotePlans[0]!.plan]) {
    const compiled = compileConfig(part.input, part.options);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    expect(compiled.ok).toBe(true);
  }
});
