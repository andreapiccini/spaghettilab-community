import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { configureDs18b20 } from "../ds18b20-configuration.js";
import { withDs18b20PowerMode, catalogDs18b20Driver } from "../gpio-driver-presets.js";
import { commitDs18b20Configuration, commitModuleImport, planModuleImport } from "../module-import.js";
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

it("uses external 3.3 V without reserving or driving a supply GPIO", () => {
  const before = fixture(); const id = sensor(before).id;
  const legacy = configureDs18b20(before, "master", id, "gpio", 0, 1);
  const after = configureDs18b20(legacy, "master", id, "vcc", 0, 1);
  const module = sensor(after);
  expect(module.gpioAssignments?.channels).toEqual({ DATA: 0 });
  expect(module.recipe.deviceDraft?.gpioHardware?.power).toBe("3.3");
  expect(module.recipe.deviceDraft?.binding.gpioSignals.map(s => s.id)).toEqual(["DATA"]);
  expect(parsePhysicalProject(after.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts["master:board"]?.modes[1]).toBe(0);
  const profile = compileRuntimeDriver(module.recipe.deviceDraft!, new Map(), new Map([["DATA",0]])).profile;
  expect(profile.initOps).toContainEqual({ op: "DS18B20_SETUP", channel: 0, on: true, externalPower: true });
  expect(profile.safeStopOps).toContainEqual({ op: "DS18B20_SETUP", channel: 0, on: false, externalPower: true });
  expect(after.deviceGraphs).toBe(before.deviceGraphs);
});

it("forces external VCC to 3.3 V, including legacy 5 V requests", () => {
  for (const voltage of ["3.3", "5"] as const) {
    const before=fixture(); const id=sensor(before).id;
    const draft=withDs18b20PowerMode(catalogDs18b20Driver(), "vcc", voltage);
    const physical=parsePhysicalProject(before.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts["master:board"]!;
    const plan=planModuleImport(before,"master","master:board",draft,{...physical,variant:"v2"});
    const after=commitDs18b20Configuration(before,plan,id,true);
    expect(sensor(after).id).toBe(id);
    expect(after.deviceGraphs).toBe(before.deviceGraphs);
    expect(sensor(after).recipe.deviceDraft?.gpioHardware?.power).toBe("3.3");
    expect(sensor(after).gpioAssignments?.channels).toEqual({DATA:0});
    expect(parsePhysicalProject(after.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts["master:board"]?.variant).toBe("v2");
    const profile=compileRuntimeDriver(sensor(after).recipe.deviceDraft!,new Map(),new Map([["DATA",0]])).profile;
    expect(profile.initOps).toContainEqual({op:"DS18B20_SETUP",channel:0,on:true,externalPower:true});
  }
});
it("normalizes saved DS18B20 VCC 5 V metadata and action drafts to 3.3 V", () => {
 const project=fixture(); const module=sensor(project);
 const safe=withDs18b20PowerMode(module.recipe.deviceDraft!,"vcc");
 const legacy={...safe,gpioHardware:{...safe.gpioHardware!,power:"5" as const}};
 const modules=parseBackboneSensorModules(JSON.stringify({version:1,byBinding:{master:[{...module,
  recipe:{...module.recipe,deviceDraft:legacy},actions:[{...module.recipe,deviceDraft:legacy}]}]}}));
 expect(modules.byBinding.master?.[0]?.recipe.deviceDraft?.gpioHardware?.power).toBe("3.3");
 expect(modules.byBinding.master?.[0]?.actions?.[0]?.deviceDraft?.gpioHardware?.power).toBe("3.3");
});

it("defaults new DS18B20 modules to fixed VCC while keeping parasite power selectable", () => {
 const draft = catalogDs18b20Driver();
 expect(draft.ds18b20PowerMode).toBe("vcc");
 expect(draft.gpioHardware?.power).toBe("3.3");
 expect(draft.binding.gpioSignals.map(signal => signal.id)).toEqual(["DATA"]);
 const parasite = withDs18b20PowerMode(draft, "parasite");
 expect(parasite.ds18b20PowerMode).toBe("parasite");
 expect(parasite.description).toContain("parassita");
 expect(parasite.gpioHardware?.power).toBe("none");
});
