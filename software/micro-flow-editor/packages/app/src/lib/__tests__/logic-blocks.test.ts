import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { logicProperties, requireLogicInputType } from "../logic-blocks.js";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
import { compileConfig } from "@spaghettilab/config-compiler";
import { oneShotDeploymentInput } from "../one-shot-deployment.js";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";

it("accepts comparable scalar samples and numeric text", () => {
  for (const type of ["bool", "digital", "int", "int64", "uint64", "number", "float", "string"]) expect(() => requireLogicInputType("AND", type)).not.toThrow();
  for (const type of ["bytes", "enum", undefined]) expect(() => requireLogicInputType("IF", type)).toThrow(/non supportato/);
});
it("validates integer comparisons and ignores legacy timer settings", () => {
  expect(logicProperties("logic_while", { condition: "4", value: -3, intervalMs: 250 })).toEqual({"1":4n,"2":-3n});
  expect(() => logicProperties("logic_if", { value: 1.2 })).toThrow(/intero/);
  expect(logicProperties("logic_while", { intervalMs: 0 })).toEqual({"1":1n,"2":0n});
});
it("compiles WHILE without any timer, including in manual mode", () => {
  const input = {
    physicalGraph: {layer:"physical-composition" as const,nodes:[],edges:[]},
    processingGraph: {layer:"device-processing" as const,nodes:[
      {layer:"device-processing" as const,id:"trigger",data:{kind:"block" as const,blockTypeId:"ui.manual_trigger",properties:{}}},
      {layer:"device-processing" as const,id:"while",data:{kind:"block" as const,blockTypeId:"logic_while",catalogEntryId:"logic.while",properties:{condition:"1",intervalMs:250}}},
      {layer:"device-processing" as const,id:"viewer",data:{kind:"block" as const,blockTypeId:"ui.data_viewer",properties:{}}},
    ],edges:[{layer:"device-processing" as const,id:"in",source:"trigger",target:"while",sourceHandle:"trigger",targetHandle:"0"},{layer:"device-processing" as const,id:"out",source:"while",target:"viewer",sourceHandle:"0",targetHandle:"0"}]},
    mqtt:DISABLED_MQTT,connectivity:0,energy:DEFAULT_ENERGY,
  };
  const plan=prepareDriverDeployment({authoringMetadata:{}} as ProjectV1,"master",input);
  const result=compileConfig(plan.input, plan.options);
  expect(result.ok ? [] : result.error).toEqual([]);
  expect(plan.input.processingGraph.nodes.some(n=>n.data.kind==="schedule" && n.data.enabled)).toBe(false);
  expect(plan.input.processingGraph.nodes.find(n=>n.id==="while")?.data).toMatchObject({properties:{"1":1n,"2":0n}});
  const manual=oneShotDeploymentInput(plan.input,plan.profiles);
  expect(manual.processingGraph.nodes.some(n=>n.id.startsWith("logic-clock:"))).toBe(false);
});
it("requires both inputs and exposes configurable IF and WHILE", () => {
  expect(findCatalogEntryById("logic.and")?.inputs).toHaveLength(2);
  expect(findCatalogEntryById("logic.if")?.fields?.some(f=>f.id==="condition")).toBe(true);
  expect(findCatalogEntryById("logic.while")?.fields?.some(f=>f.id==="intervalMs")).toBe(false);
});
it("maps the selected IF outcomes to digital levels", () => {
  expect(logicProperties("logic_if", {})).toMatchObject({"5":1n,"6":0n});
  expect(logicProperties("logic_if", {whenTrue:"low",whenFalse:"high"})).toMatchObject({"5":0n,"6":1n});
  expect(()=>logicProperties("logic_if", {whenTrue:"invalid"})).toThrow(/Alto o Basso/);
  const fields=findCatalogEntryById("logic.if")?.fields;
  expect(fields?.some(field=>field.id==="whenTrue")).toBe(true);
  expect(fields?.some(field=>field.id==="whenFalse")).toBe(true);
});

it("preserves decimal thresholds and validates numeric strings", () => {
 expect(logicProperties("logic_if",{condition:"5",value:"28,50"},"number")).toMatchObject({"1":5n,"2":0n,"7":"28.5","8":2n});
 expect(logicProperties("logic_if",{value:"-3.125"},"string")).toMatchObject({"7":"-3.125","8":255n});
 expect(()=>logicProperties("logic_if",{value:"28.555"},"number")).toThrow(/due decimali/);
 for(const value of ["28 °C","abc","NaN","Infinity",""]) expect(()=>logicProperties("logic_if",{value},"string")).toThrow();
 expect(()=>logicProperties("logic_if",{value:"28.5"},"int")).toThrow(/intero/);
});
it("compiles a decimal comparison from the real DS18B20 output", async () => {
 const {planModuleImport,commitModuleImport}=await import("../module-import.js");
 const {catalogDs18b20Driver,withDs18b20PowerMode}=await import("../gpio-driver-presets.js");
 const base={coreBindings:[{bindingId:"master",expectedDeviceId:"board",connectionProfileId:"usb"}],physicalGraphs:[{layer:"physical-composition",nodes:[],edges:[]}],deviceGraphs:[{layer:"device-processing",nodes:[],edges:[]}],authoringMetadata:{}} as unknown as ProjectV1;
 const imported=planModuleImport(base,"master","master:board",withDs18b20PowerMode(catalogDs18b20Driver(),"gpio"),{name:"Function",variant:"v1",modes:[0,0,0,0],i2cSpeed:0,local:true,backendPortId:0});
 const project=commitModuleImport(base,imported,"temperature",false,true);
 const graph=project.deviceGraphs[0]!;
 const plan=prepareDriverDeployment(project,"master",{physicalGraph:project.physicalGraphs[0]!,processingGraph:{...graph,nodes:[...graph.nodes,{layer:"device-processing",id:"if",data:{kind:"block",blockTypeId:"logic_if",properties:{condition:"5",value:"28,50"}}}],edges:[{layer:"device-processing",id:"compare",source:graph.nodes[0]!.id,sourceHandle:"temperature",target:"if",targetHandle:"0"}]},mqtt:DISABLED_MQTT,connectivity:0,energy:DEFAULT_ENERGY});
 expect(plan.input.processingGraph.nodes.find(n=>n.id==="if")?.data).toMatchObject({properties:{"7":"28.5","8":2n}});
 const result=compileConfig(plan.input,plan.options);
 expect(result.ok?[]:result.error).toEqual([]);
});

it("publishes IF output to animate a direct internal LED connection, including LOW",async()=>{
 const {activeEdgesForRecord}=await import("../edge-activity.js");
 const input={physicalGraph:{layer:"physical-composition" as const,nodes:[],edges:[]},processingGraph:{layer:"device-processing" as const,nodes:[
 {layer:"device-processing" as const,id:"start",data:{kind:"block" as const,blockTypeId:"ui.manual_trigger",properties:{}}},
 {layer:"device-processing" as const,id:"if",data:{kind:"block" as const,blockTypeId:"logic_if",catalogEntryId:"logic.if",properties:{condition:"1"}}},
 {layer:"device-processing" as const,id:"led",data:{kind:"block" as const,blockTypeId:"ab.led",properties:{statusLed:true}}},
 ],edges:[{layer:"device-processing" as const,id:"check",source:"start",sourceHandle:"trigger",target:"if",targetHandle:"0"},{layer:"device-processing" as const,id:"command",source:"if",sourceHandle:"0",target:"led",targetHandle:"0"}]},mqtt:DISABLED_MQTT,connectivity:0,energy:DEFAULT_ENERGY};
 const plan=prepareDriverDeployment({authoringMetadata:{}} as ProjectV1,"master",input);
 const route=plan.activityRoutes?.find(route=>route.edgeId==="command");expect(route).toBeDefined();expect(route?.kind).toBe("data");
 expect(plan.input.processingGraph.nodes.some(node=>node.id==="driver-publish:command")).toBe(true);
 const compiled=compileConfig(plan.input,plan.options);expect(compiled.ok?[]:compiled.error).toEqual([]);
 expect(activeEdgesForRecord([route!],{sourceKey:route!.key,schemaId:route!.schemaId,fields:{[route!.field]:0n}} as Parameters<typeof activeEdgesForRecord>[1])).toHaveLength(1);
});

it("encodes inclusive ranges and rejects reversed bounds", () => {
 expect(logicProperties("logic_if",{condition:"8",value:"20,5",valueMax:"30,25"},"number")).toMatchObject({"1":8n,"7":"20.5","9":"30.25"});
 expect(logicProperties("logic_if",{condition:"9",value:-10,valueMax:0},"int")).toMatchObject({"1":9n,"2":-10n,"9":"0"});
 expect(()=>logicProperties("logic_if",{condition:"8",value:30,valueMax:20},"number")).toThrow(/massimo/);
 expect(()=>logicProperties("logic_if",{condition:"8",value:20,valueMax:"abc"},"number")).toThrow();
 expect(()=>logicProperties("logic_if",{condition:"8",value:20,valueMax:30.001},"number")).toThrow(/decimali/);
});
