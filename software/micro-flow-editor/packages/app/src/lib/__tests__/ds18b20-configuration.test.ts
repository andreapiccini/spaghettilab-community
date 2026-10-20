import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { configureDs18b20 } from "../ds18b20-configuration.js";
import { catalogDs18b20Driver } from "../gpio-driver-presets.js";
import { commitModuleImport, planModuleImport } from "../module-import.js";
import { BACKBONE_SENSOR_MODULES_META_KEY, parseBackboneSensorModules } from "../backbone-sensor-modules.js";
import { PHYSICAL_META_KEY, parsePhysicalProject } from "../backbone-physical.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
function fixture() {
  const project = { coreBindings: [{ bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" }],
    physicalGraphs: [], deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }], authoringMetadata: {} } as unknown as ProjectV1;
  const plan = planModuleImport(project, project.coreBindings[0]!.bindingId, "master:board", catalogDs18b20Driver(),
    { name: "Function", variant: "v1", modes: [0,0,0,12], i2cSpeed: 0, local: true, backendPortId: 0 });
  return commitModuleImport(project, plan, "sensor", false, true);
}
function sensor(project: ProjectV1) { return parseBackboneSensorModules(project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding.master![0]!; }
it("changes mode and pins without replacing canvas blocks, wires or positions", () => {
  const before = fixture();
  const after = configureDs18b20(before, "master", sensor(before).id, "gpio", 2, 1, true);
  expect(after.deviceGraphs).toBe(before.deviceGraphs);
  expect(after.physicalGraphs).toBe(before.physicalGraphs);
  for (const [id, meta] of Object.entries(before.authoringMetadata))
    if (![BACKBONE_SENSOR_MODULES_META_KEY, PHYSICAL_META_KEY].includes(id)) expect(after.authoringMetadata[id]).toBe(meta);
  expect(sensor(after).id).toBe(sensor(before).id);
  expect(sensor(after).gpioAssignments?.channels).toEqual({ DATA: 2, POWER: 1 });
  expect(parsePhysicalProject(after.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts["master:board"]?.modes).toEqual([1,2,1,12]);
  const compiled = compileRuntimeDriver(sensor(after).recipe.deviceDraft!, new Map(), new Map([["DATA",2],["POWER",1]])).profile;
  expect(compiled.initOps).toContainEqual({ op: "DS18B20_SETUP", channel: 2, on: true, powerChannel: 1 });
  const parasite = configureDs18b20(after, "master", sensor(after).id, "parasite", 2, 1);
  expect(sensor(parasite).gpioAssignments?.channels).toEqual({ DATA: 2 });
  expect(sensor(parasite).recipe.deviceDraft?.binding.gpioSignals.map(s => s.id)).toEqual(["DATA"]);
});
it("rejects shared DATA/VCC and pins used by another protocol", () => {
  const project = fixture(); const id = sensor(project).id;
  expect(() => configureDs18b20(project,"master",id,"gpio",0,0)).toThrow("diversi");
  expect(() => configureDs18b20(project,"master",id,"parasite",3,1)).toThrow("protocollo");
});
it("rejects pins claimed by a different module", () => {
  const project = fixture(); const first = sensor(project);
  const modules = parseBackboneSensorModules(project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment);
  const occupied = { ...project, authoringMetadata: { ...project.authoringMetadata, [BACKBONE_SENSOR_MODULES_META_KEY]: {
    comment: JSON.stringify({ ...modules, byBinding: { master: [first, { ...first, id: "other", label: "Altro sensore", gpioAssignments: { boardKey: "master:board", channels: { DATA: 2 } } }] } }) } } };
  expect(() => configureDs18b20(occupied,"master",first.id,"parasite",2,1)).toThrow("Altro sensore");
});
