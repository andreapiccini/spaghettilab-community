import { oneShotDeploymentInput } from "../one-shot-deployment.js";
import { configHasContinuousSchedules } from "../stop-deployed-runtime.js";
import { expect, it } from "vitest";
import type { GraphState, ProjectV1 } from "@spaghettilab/domain";
import { PortTransport } from "@spaghettilab/device-profile-authoring-model";
import { compileConfig } from "@spaghettilab/config-compiler";
import { planModuleImport, commitModuleImport } from "../module-import.js";
import { catalogDs18b20Driver, withDs18b20PowerMode } from "../gpio-driver-presets.js";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
import {
  computeEventContainers,
  canChainIntoEventContainer,
  detachMemberEdges,
} from "../../components/processing-graph/event-containers.js";

function fixture(enabled = true) {
  const project = {
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as unknown as ProjectV1;
  const plan = planModuleImport(
    project,
    "master",
    "master:board",
    withDs18b20PowerMode(catalogDs18b20Driver(), "gpio"),
    {
      name: "Function",
      variant: "v1",
      modes: [0, 0, 0, 0],
      i2cSpeed: 0,
      local: true,
      backendPortId: 0,
    },
  );
  const installed = commitModuleImport(project, plan, "temperature", false, true);
  const base = installed.deviceGraphs[0]!;
  const graph: GraphState<"device-processing"> = {
    ...base,
    nodes: [
      ...base.nodes,
      {
        layer: "device-processing",
        id: "schedule",
        data: { kind: "schedule", moduleNodeId: "", periodMs: 2000, enabled },
      },
      {
        layer: "device-processing",
        id: "tick",
        data: { kind: "block", blockTypeId: "ab.flow_start", properties: {} },
      },
      {
        layer: "device-processing",
        id: "trigger",
        data: {
          kind: "block",
          blockTypeId: "ui.manual_trigger",
          catalogEntryId: "appblocks.manual_trigger",
          properties: {},
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
        id: "tick",
        source: "schedule",
        target: "tick",
        sourceHandle: "0",
        targetHandle: "0",
      },
      {
        id: "membership",
        source: "tick",
        target: "trigger",
        sourceHandle: "0",
        targetHandle: "0",
      },
      {
        id: "read",
        source: "trigger",
        target: base.nodes[0]!.id,
        sourceHandle: "trigger",
        targetHandle: "read-trigger",
      },
      {
        id: "show",
        source: base.nodes[0]!.id,
        target: "viewer",
        sourceHandle: "temperature",
        targetHandle: "value",
      },
    ],
  };
  const input = {
    physicalGraph: installed.physicalGraphs[0]!,
    processingGraph: graph,
    mqtt: DISABLED_MQTT,
    connectivity: 0,
    energy: DEFAULT_ENERGY,
  };
  return { installed, graph, input };
}
it("schedules every tick on the Backbone alongside an independent manual trigger using a logical timer", () => {
  const f = fixture();
  const plan = prepareDriverDeployment(f.installed, "master", f.input);
  expect(plan.profiles).toHaveLength(3);
  expect(
    plan.profiles.find((profile) => profile.profileId === "flow.clock")?.transport,
  ).toBe(PortTransport.LOGICAL);
  expect(
    plan.profiles.some((profile) => profile.profileId.startsWith("flow.trigger")),
  ).toBe(true);
  expect(
    plan.input.processingGraph.nodes.find((node) => node.id === "schedule")?.data,
  ).toMatchObject({ kind: "schedule", periodMs: 2000, enabled: true });
  expect(
    plan.input.processingGraph.nodes.filter((node) => node.data.kind === "rule"),
  ).toMatchObject([
    { data: { properties: { "8": 1n } } },
    { data: { properties: { "8": 0n } } },
  ]);
  expect(plan.observations).toHaveLength(1);
  const compiled = compileConfig(plan.input, plan.options);
  expect(
    compiled.ok,
    JSON.stringify(compiled, (_, value) =>
      typeof value === "bigint" ? String(value) : value,
    ),
  ).toBe(true);
});
it("preserves disabled schedules and rejects unsupported periods", () => {
  const f = fixture(false);
  const plan = prepareDriverDeployment(f.installed, "master", f.input);
  expect(
    plan.input.processingGraph.nodes.find((node) => node.id === "schedule")?.data,
  ).toMatchObject({ enabled: false });
  const invalid = {
    ...f.graph,
    nodes: f.graph.nodes.map((node) =>
      node.id === "schedule"
        ? { ...node, data: { ...(node.data as object), periodMs: 60001 } }
        : node,
    ),
  };
  expect(() =>
    prepareDriverDeployment(f.installed, "master", {
      ...f.input,
      processingGraph: invalid,
    }),
  ).toThrow("60000");
});
it("contains the trigger without swallowing the downstream device or viewer", () => {
  const f = fixture();
  const container = computeEventContainers(f.graph, {})[0]!;
  expect(container.memberIds).toEqual(["tick", "trigger"]);
  expect(
    canChainIntoEventContainer({
      kind: "block",
      blockTypeId: "ui.manual_trigger",
      properties: {},
    }),
  ).toBe(true);
  const detached = detachMemberEdges("trigger", container, f.graph.edges);
  expect(detached.removeIds).toEqual(["membership"]);
  const manual = prepareDriverDeployment(f.installed, "master", {
    ...f.input,
    processingGraph: {
      ...f.graph,
      edges: f.graph.edges.filter((edge) => !detached.removeIds.includes(edge.id)),
    },
  });
  expect(
    manual.input.processingGraph.nodes.filter((node) => node.data.kind === "rule"),
  ).toHaveLength(1);
});

it("does not send two periodic activations when a legacy direct wire remains", () => {
  const f = fixture();
  const graph = {
    ...f.graph,
    edges: [
      ...f.graph.edges,
      {
        id: "legacy",
        source: "tick",
        target: f.graph.nodes[0]!.id,
        sourceHandle: "0",
        targetHandle: "read-trigger",
      },
    ],
  };
  const plan = prepareDriverDeployment(f.installed, "master", {
    ...f.input,
    processingGraph: graph,
  });
  expect(
    plan.input.processingGraph.nodes.filter((node) => node.data.kind === "rule"),
  ).toHaveLength(2);
});
it("maps both automatic and manual signals to the visible trigger wire without extra drivers", () => {
  const f = fixture();
  const plan = prepareDriverDeployment(f.installed, "master", f.input);
  expect(plan.profiles).toHaveLength(3);
  expect(plan.activityRoutes?.filter((route) => route.edgeId === "read")).toHaveLength(
    2,
  );
  expect(
    plan.activityRoutes
      ?.filter((route) => route.edgeId === "read")
      .every((route) => route.kind === "trigger"),
  ).toBe(true);
  expect(plan.activityRoutes?.find((route) => route.edgeId === "show")).toMatchObject({
    kind: "data",
  });
});

it("uploads manual commands without starting clocks, retaining sensor completion and links", () => {
  const f = fixture();
  const plan = prepareDriverDeployment(f.installed, "master", f.input);
  const completionProfiles = plan.profiles.filter(profile => profile.sampleOps.some(op => op.op === "DS18B20_READ")).map(profile => profile.profileId);
  const input = oneShotDeploymentInput(plan.input, completionProfiles);
  const compiled = compileConfig(input, plan.options);
  const running = compileConfig(plan.input, plan.options);
  if (!compiled.ok || !running.ok) throw new Error("expected valid deployment");
  expect(configHasContinuousSchedules(compiled.value)).toBe(false);
  expect(configHasContinuousSchedules(running.value)).toBe(true);
  expect(compiled.value.schedules.some(schedule => schedule.enabled)).toBe(true);
  expect(compiled.value.modules).toEqual(running.value.modules);
  expect(compiled.value.rules).toEqual(running.value.rules);
});
