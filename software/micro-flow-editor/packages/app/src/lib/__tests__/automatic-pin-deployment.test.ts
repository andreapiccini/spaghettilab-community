import { describe, expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";

describe("automatic physical input deployment", () => {
  const pin = { id: "physical-pin:master:board:0", layer: "physical-composition" as const, data: { kind: "module" as const, driverTypeId: "digital_input_trigger", portId: 0, bayId: 0, railId: 0, electricalMode: "input-only" as const, properties: { "1": 0n, "2": true, "3": true } } };
  const project = { coreBindings: [{ bindingId: "master" }], authoringMetadata: {} } as unknown as ProjectV1;
  function plan(used: boolean) {
    return prepareDriverDeployment(project, "master", {
      physicalGraph: { layer: "physical-composition", nodes: [pin], edges: [] },
      processingGraph: { layer: "device-processing", nodes: used ? [{ id: "input", layer: "device-processing", data: { kind: "event-source", moduleNodeId: pin.id } }] : [], edges: [] },
      mqtt: DISABLED_MQTT, energy: DEFAULT_ENERGY, connectivity: 0,
    });
  }
  it("omits unused potential inputs from the runtime program", () => {
    expect(plan(false).input.physicalGraph.nodes).toEqual([]);
  });
  it("keeps used inputs and migrates old virtual bay bindings without mutating the project", () => {
    expect(plan(true).input.physicalGraph.nodes[0]?.data).toMatchObject({ bayId: 255, railId: 255 });
    expect(pin.data.bayId).toBe(0);
  });
});
