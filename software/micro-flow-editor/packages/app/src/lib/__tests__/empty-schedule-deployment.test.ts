import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { compileConfig, type CompileConfigInput } from "@spaghettilab/config-compiler";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { DISABLED_MQTT, DEFAULT_ENERGY } from "../default-config-policy.js";
const project = { authoringMetadata: {} } as ProjectV1;
function input(withSchedule = true): CompileConfigInput {
  return {
    physicalGraph: { layer: "physical-composition", nodes: [], edges: [] },
    processingGraph: { layer: "device-processing", nodes: [
      ...(withSchedule ? [{ layer: "device-processing" as const, id: "schedule", data: { kind: "schedule" as const, moduleNodeId: "", periodMs: 2000, enabled: true } }] : []),
      { layer: "device-processing", id: "tick", data: { kind: "block", blockTypeId: "ab.flow_start", properties: {} } },
    ], edges: withSchedule ? [{ id: "tick-edge", source: "schedule", target: "tick", sourceHandle: "0", targetHandle: "0" }] : [] },
    mqtt: DISABLED_MQTT, energy: DEFAULT_ENERGY, connectivity: 0,
  };
}
it("never uploads the authoring-only tick from an empty Schedule as a firmware block", () => {
  const plan = prepareDriverDeployment(project, "master", input());
  const compiled = compileConfig(plan.input, plan.options);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  expect(compiled.value.blocks.map(block => block.typeId)).not.toContain("ab.flow_start");
  expect(compiled.value.blocks).toEqual([]);
});
it("omits an isolated tick instead of uploading the unknown 71-byte program", () => {
  const plan = prepareDriverDeployment(project, "master", input(false));
  const compiled = compileConfig(plan.input, plan.options);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  expect(compiled.value.blocks).toEqual([]);
});
it("rejects a connected tick without a source before uploading", () => {
  const source = input(false);
  const invalid: CompileConfigInput = { ...source, processingGraph: { ...source.processingGraph,
    nodes: [...source.processingGraph.nodes, { id: "target", layer: "device-processing", data: { kind: "block", blockTypeId: "status_led", properties: {} } }],
    edges: [{ id: "wire", source: "tick", target: "target", sourceHandle: "0", targetHandle: "0" }],
  } };
  expect(() => prepareDriverDeployment(project, "master", invalid)).toThrow("Attivazione");
});
