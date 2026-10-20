import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { compileConfig } from "@spaghettilab/config-compiler";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { oneShotDeploymentInput } from "../one-shot-deployment.js";
import { manualDeploymentIsCurrent } from "../manual-deployment-current.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
function project() {
  return { coreBindings: [{ bindingId: "master" }], authoringMetadata: {}, physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [
      { layer: "device-processing", id: "trigger", data: { kind: "block", blockTypeId: "ui.manual_trigger", properties: {} } },
      { layer: "device-processing", id: "led", data: { kind: "block", blockTypeId: "ab.led", properties: { statusLed: true } } },
    ], edges: [{ layer: "device-processing", id: "wire", source: "trigger", sourceHandle: "trigger", target: "led", targetHandle: "0" }] }] } as unknown as ProjectV1;
}
function plan(p: ProjectV1) {
 return prepareDriverDeployment(p,"master",{ physicalGraph:p.physicalGraphs[0]!,processingGraph:p.deviceGraphs[0]!,mqtt:DISABLED_MQTT,connectivity:0,energy:DEFAULT_ENERGY });
}
function compiled(p: ProjectV1) {
 const ready=plan(p);const result=compileConfig(oneShotDeploymentInput(ready.input,[]),ready.options);
 if(!result.ok) throw new Error(JSON.stringify(result.error));return result.value;
}
it("treats a manual impulse on the LED's default input as the on action",()=>{
 const ready=plan(project());
 expect(ready.input.processingGraph.edges.find(edge=>edge.id==="wire")?.targetHandle).toBe("1");
 expect(compiled(project()).edges.some(edge=>edge.targetInput===1)).toBe(true);
});
it("preserves an explicit off action",()=>{
 const p=project(); const graph=p.deviceGraphs[0]!;
 const changed={...p,deviceGraphs:[{...graph,edges:graph.edges.map(edge=>({...edge,targetHandle:"2"}))}]};
 expect(plan(changed).input.processingGraph.edges.find(edge=>edge.id==="wire")?.targetHandle).toBe("2");
});
it("detects an added component even when the manual trigger is already loaded",()=>{
 const p=project();const live=compiled(p);
 expect(manualDeploymentIsCurrent(p,"master",live)).toBe(true);
 const graph=p.deviceGraphs[0]!;
 const changed={...p,deviceGraphs:[{...graph,nodes:[...graph.nodes,{...graph.nodes[1]!,id:"new-led"}],edges:[...graph.edges,{...graph.edges[0]!,id:"new-wire",target:"new-led"}]}]};
 expect(manualDeploymentIsCurrent(changed,"master",live)).toBe(false);
});
it("detects a rewired action but ignores visual position changes",()=>{
 const p=project();const live=compiled(p);const graph=p.deviceGraphs[0]!;
 expect(manualDeploymentIsCurrent({...p,authoringMetadata:{led:{position:{x:600,y:200}}}},"master",live)).toBe(true);
 expect(manualDeploymentIsCurrent({...p,deviceGraphs:[{...graph,edges:graph.edges.map(edge=>({...edge,targetHandle:"2"}))}]},"master",live)).toBe(false);
});

it("does not require upload for a viewer of an already published module field",()=>{
 const p=project(); const live=compiled(p); const graph=p.deviceGraphs[0]!;
 const changed={...p,deviceGraphs:[{...graph,nodes:[...graph.nodes,{layer:"device-processing" as const,id:"viewer",data:{kind:"block" as const,blockTypeId:"ui.data_viewer",properties:{format:"decimal"}}}],edges:[...graph.edges,{layer:"device-processing" as const,id:"view",source:"trigger",sourceHandle:"trigger",target:"viewer",targetHandle:"0"}]}]};
 expect(manualDeploymentIsCurrent(changed,"master",live)).toBe(true);
});
it("detects changed hardware values and returns to current after undo",()=>{
 const p=project();const live=compiled(p);const graph=p.deviceGraphs[0]!;
 const changed={...p,deviceGraphs:[{...graph,nodes:graph.nodes.map(node=>node.id!=="led"?node:{...node,data:{...node.data,properties:{statusLed:true,whiteLedConfig:JSON.stringify({initialIntensity:25,actions:[{id:"on",steps:[{kind:"on",value:100}]},{id:"off",steps:[{kind:"off",value:0}]},{id:"intensity",steps:[{kind:"intensity",value:50}]}]})}}})}]};
 expect(manualDeploymentIsCurrent(changed,"master",live)).toBe(false);
 expect(manualDeploymentIsCurrent(p,"master",live)).toBe(true);
});
it("accepts continuous and paused versions but detects schedule interval changes",()=>{
 const p=project();const graph=p.deviceGraphs[0]!;
 const scheduled={...p,deviceGraphs:[{...graph,nodes:[...graph.nodes,{layer:"device-processing" as const,id:"schedule",data:{kind:"schedule" as const,moduleNodeId:"",periodMs:1000,enabled:true}}]}],authoringMetadata:{trigger:{parentId:"schedule"}}};
 const ready=plan(scheduled);const live=compileConfig(ready.input,ready.options);
 expect(live.ok).toBe(true);if(!live.ok)return;
 expect(manualDeploymentIsCurrent(scheduled,"master",live.value)).toBe(true);
 expect(manualDeploymentIsCurrent(scheduled,"master",compiled(scheduled))).toBe(true);
 const changed={...scheduled,deviceGraphs:[{...scheduled.deviceGraphs[0]!,nodes:scheduled.deviceGraphs[0]!.nodes.map(node=>node.data.kind==="schedule"?{...node,data:{...node.data,periodMs:2000}}:node)}]};
 expect(manualDeploymentIsCurrent(changed,"master",live.value)).toBe(false);
});
