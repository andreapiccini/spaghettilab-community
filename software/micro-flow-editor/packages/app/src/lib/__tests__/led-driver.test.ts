import { expect, it } from "vitest";
import {
  defaultLedDriver,
  ledDriverProperties,
  readLedDriver,
  validateLedDriver,
} from "../led-driver.js";
import { viewerModuleMatches, formatViewerValue } from "../data-viewer.js";
import { rgbModuleDraft, defaultRgbModule } from "../rgb-module.js";
import { planModuleImport, commitModuleImport } from "../module-import.js";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { compileConfig } from "@spaghettilab/config-compiler";
import { DISABLED_MQTT, DEFAULT_ENERGY } from "@spaghettilab/protocol-sdk";
import type { ProjectV1 } from "@spaghettilab/domain";
it("keeps preset handles stable and encodes exact RGB colors", () => {
  const config = {
    presets: [{ id: "2", name: "Allarme", color: "#FF8000", level: "low" as const }],
  };
  const properties = { ledDriverConfig: JSON.stringify(config) };
  expect(readLedDriver(properties)).toEqual({ ...config, presets: [{ ...config.presets[0], level: "high" }] });
  expect(ledDriverProperties(properties)).toMatchObject({
    "3": 16744448n,
    "7": 1n,
    "9": 4n,
  });
  expect(defaultLedDriver().presets.map((p) => p.name)).toEqual([
    "Preset 1",
    "Preset 2",
  ]);
  expect(() =>
    validateLedDriver({ presets: [...config.presets, ...config.presets] }),
  ).toThrow();
  expect(() =>
    validateLedDriver({ presets: [{ ...config.presets[0]!, color: "red" }] }),
  ).toThrow();
});
it("recognizes RGB state by deployed profile identity and displays OFF", () => {
  const module = { key: 12, properties: { 1: "rgb.abc" } };
  expect(
    viewerModuleMatches(module, {
      key: 12,
      profileId: "rgb.abc",
      schemaId: "rgb.state",
    }),
  ).toBe(true);
  expect(
    viewerModuleMatches(module, {
      key: 12,
      profileId: "rgb.other",
      schemaId: "rgb.state",
    }),
  ).toBe(false);
  expect(formatViewerValue(0n, 2, "boolean").text).toBe("false");
});
it.each(["hex", "rgb"] as const)(
  "compiles %s generator into matching LED inputs and observes real state",
  (mode) => {
    const draft = rgbModuleDraft({ ...defaultRgbModule(), inputMode: mode });
    const p = {
      coreBindings: [
        { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
      ],
      physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
      deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
      authoringMetadata: {},
    } as unknown as ProjectV1;
    const proposal = planModuleImport(p, "master", "master:board", draft, {
      name: "Function",
      variant: "v1",
      modes: [0, 0, 0, 0],
      i2cSpeed: 0,
      local: true,
      backendPortId: 0,
    });
    const installed = commitModuleImport(p, proposal, "rgb", false, true);
    const graph = installed.deviceGraphs[0]!;
    const led = graph.nodes[0]!.id;
    // Reproduce a saved card from before the RGB module changed its actions.
    const legacyNodes = graph.nodes.map((node) =>
      node.id === led && node.data.kind === "block"
        ? {
            ...node,
            data: {
              ...node.data,
              properties: { ...node.data.properties, sensorActionId: "on" },
            },
          }
        : node,
    );
    const plan = prepareDriverDeployment(installed, "master", {
      physicalGraph: p.physicalGraphs[0]!,
      processingGraph: {
        ...graph,
        nodes: [
          ...legacyNodes,
          {
            layer: "device-processing",
            id: "preset",
            data: {
              kind: "block",
              blockTypeId: "led_driver",
              catalogEntryId: "native.led_driver",
              properties: {
                ledDriverConfig: JSON.stringify({
                  ...defaultLedDriver(),
                  outputMode: mode,
                }),
              },
            },
          },
          {
            layer: "device-processing",
            id: "activate",
            data: { kind: "block", blockTypeId: "ui.manual_trigger", properties: {} },
          },
          {
            layer: "device-processing",
            id: "viewer",
            data: { kind: "block", blockTypeId: "ui.data_viewer", properties: {} },
          },
          {
            layer: "device-processing",
            id: "colorviewer",
            data: { kind: "block", blockTypeId: "ui.data_viewer", properties: {} },
          },
        ],
        edges: [
          {
            id: "zz-preview",
            source: "preset",
            sourceHandle: mode === "hex" ? "0" : "2",
            target: "colorviewer",
            targetHandle: "value",
          },
          {
            id: "trigger",
            source: "activate",
            sourceHandle: "trigger",
            target: "preset",
            targetHandle: "0",
          },
          ...(mode === "hex"
            ? [
                {
                  id: "color",
                  source: "preset",
                  sourceHandle: "0",
                  target: led,
                  targetHandle: "color-input",
                },
              ]
            : ["red-level", "green-level", "blue-level"].map((id, index) => ({
                id: "color" + index,
                source: "preset",
                sourceHandle: String(index + 1),
                target: led,
                targetHandle: id,
              }))),
          {
            id: "state",
            source: led,
            sourceHandle: "state",
            target: "viewer",
            targetHandle: "value",
          },
        ],
      },
      mqtt: DISABLED_MQTT,
      connectivity: 0,
      energy: DEFAULT_ENERGY,
    });
    expect(
      plan.observations?.find((item) => item.viewerId === "colorviewer")?.colorKind,
    ).toBe(mode === "hex" ? "hex" : "green");
    const driver = plan.input.processingGraph.nodes.find(
      (node) => node.id === "preset",
    )!;
    expect(driver.data.kind === "block" && driver.data.properties["10"]).toBe(1n);
    expect(plan.observations?.[0]).toMatchObject({
      valueKind: "boolean",
      schemaId: "rgb.state",
    });
    expect(plan.observations?.[0]?.profileId).toMatch(/^rgb\./);
    const colorRule = plan.input.processingGraph.nodes.find(
      (node) => node.id === "rgb-input:color",
    );
    if (mode === "hex")
      expect(colorRule?.data.kind === "rule" && colorRule.data.properties["8"]).toBe(
        0n,
      );
    const result = compileConfig(plan.input, plan.options);
    expect(
      result.ok,
      JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    ).toBe(true);
  },
);

it("selects one generator output encoding at a time", () => {
  expect(ledDriverProperties({})["11"]).toBe(0n);
  expect(
    ledDriverProperties({
      ledDriverConfig: JSON.stringify({ ...defaultLedDriver(), outputMode: "rgb" }),
    })["11"],
  ).toBe(1n);
  expect(() =>
    validateLedDriver({ ...defaultLedDriver(), outputMode: "invalid" as "rgb" }),
  ).toThrow();
});
