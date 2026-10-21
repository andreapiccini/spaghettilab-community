import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { compileConfig } from "@spaghettilab/config-compiler";
import { DISABLED_MQTT, DEFAULT_ENERGY } from "@spaghettilab/protocol-sdk";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { formatViewerValue } from "../data-viewer.js";
it.each(["0", "1"])("publishes internal LED output %s to a generic viewer", handle => {
 const plan=prepareDriverDeployment({authoringMetadata:{}} as ProjectV1,"master",{
  physicalGraph:{layer:"physical-composition",nodes:[],edges:[]},
  processingGraph:{layer:"device-processing",nodes:[
   {layer:"device-processing",id:"led",data:{kind:"block",blockTypeId:"ab.led",properties:{statusLed:true}}},
   {layer:"device-processing",id:"viewer",data:{kind:"block",blockTypeId:"ui.data_viewer",properties:{}}}
  ],edges:[{layer:"device-processing",id:"led-value",source:"led",sourceHandle:handle,target:"viewer",targetHandle:"value"}]},
  mqtt:DISABLED_MQTT,connectivity:0,energy:DEFAULT_ENERGY
 });
 expect(plan.observations).toHaveLength(1);
 expect(plan.observations?.[0]?.valueKind).toBe(handle==="0"?"boolean":"number");
 const compiled=compileConfig(plan.input,plan.options);
 expect(compiled.ok?[]:compiled.error).toEqual([]);
 if(!compiled.ok)return;
 const source=plan.observations![0]!;
 expect(compiled.value.blocks.some(block=>block.typeId==="publish_field"&&Number(block.properties[4])===source.key&&block.properties[1]===source.schemaId)).toBe(true);
});
it("shows the boolean OFF value rather than treating it as missing",()=>{
 expect(formatViewerValue(false,2,"boolean")).toEqual({text:"false",type:"Booleano"});
 expect(formatViewerValue(true,2,"boolean")).toEqual({text:"true",type:"Booleano"});
});
