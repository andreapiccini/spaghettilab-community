import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import type { CompileConfigInput } from "@spaghettilab/config-compiler";
import { compileConfig } from "@spaghettilab/config-compiler";
import { catalogGpioRelayDriver } from "../gpio-driver-presets.js";
import { planModuleImport, commitModuleImport } from "../module-import.js";
import { prepareDistributedDeployment } from "../distributed-deployment-plan.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
it.each([false, true])("executes relay ON/OFF when its mapped level changes (CAN=%s)", remote => {
  const project = { coreBindings: [{ bindingId: "master", expectedDeviceId: "907069e18040".padEnd(64, "0"), connectionProfileId: "usb" }],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }], authoringMetadata: {} } as unknown as ProjectV1;
  const installed = commitModuleImport(project, planModuleImport(project, "master", remote ? "master:remote" : "master:local", catalogGpioRelayDriver(), {
    name: "Function", variant: "v2", modes: Array(8).fill(0), i2cSpeed: 0,
    local: !remote, nodeId: remote ? 0xe17fd0 : 0, backendPortId: 0,
  }), "relay", false, true);
  const graph = installed.deviceGraphs[0]!;
  const relay = graph.nodes[0]!.id;
  const input = { physicalGraph: installed.physicalGraphs[0]!, processingGraph: { ...graph,
    nodes: [...graph.nodes, { layer: "device-processing", id: "trigger", data: { kind: "block", blockTypeId: "ui.manual_trigger", properties: {} } }, { layer: "device-processing", id: "condition", data: {
      kind: "block", blockTypeId: "logic_if", properties: { condition: 5, value: 1, whenTrue: "high", whenFalse: "low" },
    } }],
    edges: [{ layer: "device-processing", id: "input", source: "trigger", sourceHandle: "trigger", target: "condition", targetHandle: "0" }, { layer: "device-processing", id: "condition-relay", source: "condition", sourceHandle: "0", target: relay, targetHandle: "comando" }],
  }, mqtt: DISABLED_MQTT, connectivity: 0, energy: DEFAULT_ENERGY } as CompileConfigInput;
  const plan = prepareDistributedDeployment(installed, "master", input);
  const part = remote ? plan.remotePlans[0]!.plan : plan;
  const compiled = compileConfig(part.input, part.options);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const driver = compiled.value.modules.find(module => module.typeId === "declarative-device" && String(module.properties[1]).startsWith("drv."));
  expect(driver).toBeDefined();
  const command = compiled.value.rules.find(rule => rule.typeId === "device-action" && rule.properties[3] === BigInt(driver!.key));
  // Mode 3 only latches the argument and never executes the relay's GPIO write.
  // Mode 4 updates the value then executes the mapped ON/OFF action, also for LOW.
  expect(command?.properties[8]).toBe(4n);
  expect(command?.properties[6]).toBe(1n);
  expect(part.profiles.some(profile => profile.sampleOps.some(op => op.op === "GPIO_SET_VALUE" && op.channel === 0))).toBe(true);
});
