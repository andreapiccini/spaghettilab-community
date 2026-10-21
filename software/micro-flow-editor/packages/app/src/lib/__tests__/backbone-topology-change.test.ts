import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import type { GetStatusResponse } from "@spaghettilab/protocol-sdk";
import { topologyBoards, topologySignature, topologyNeedsReconfiguration, topologyReviewAccepted, withTopologyCheckpoint, initialTopologyCheckpoint } from "../backbone-topology-change.js";
import { resolveLogicalBackbones } from "../logical-backbone-slots.js";
const project={coreBindings:[{bindingId:"master",expectedDeviceId:"907069e1c4fc"}],authoringMetadata:{},physicalGraphs:[],deviceGraphs:[]} as unknown as ProjectV1;
function status(ids:number[],host=ids[0]) {return {deviceId:new Uint8Array([0x90,0x70,0x69,host!>>16,(host!>>8)&255,host!&255]),chainPeers:ids.map(nodeId=>({nodeId,local:nodeId===host,flags:0}))} as unknown as GetStatusResponse;}
const before=status([1,2,3]);
const baseline=withTopologyCheckpoint(project,"master",{boards:topologyBoards(before),pending:false});
it("ignores telemetry and firmware while detecting order, replacement and count changes",()=>{
 expect(topologyNeedsReconfiguration(baseline,"master",{...before,version:"new"})).toBe(false);
 for(const current of [status([1,3,2]),status([1,2]),status([1,2,4]),status([1,2,3],2)])
  expect(topologyNeedsReconfiguration(baseline,"master",current)).toBe(true);
});
it("latches disconnection even if the original boards reconnect",()=>{
 const disconnected=withTopologyCheckpoint(baseline,"master",{boards:topologyBoards(before),pending:true});
 expect(topologyNeedsReconfiguration(disconnected,"master",before)).toBe(true);
 expect(()=>resolveLogicalBackbones(disconnected,"master",before)).toThrow(/riconfigura/);
});
it("requires review of exactly the current topology and confirms only after upload",()=>{
 const after=status([2,3,1]);
 const reviewed=withTopologyCheckpoint(baseline,"master",{boards:topologyBoards(before),pending:true,accepted:topologySignature(topologyBoards(after))});
 expect(topologyReviewAccepted(reviewed,"master",after)).toBe(true);
 expect(topologyNeedsReconfiguration(reviewed,"master",after)).toBe(true);
 expect(()=>resolveLogicalBackbones(reviewed,"master",after)).not.toThrow();
 expect(topologyReviewAccepted(reviewed,"master",before)).toBe(false);
 const applied=withTopologyCheckpoint(reviewed,"master",{boards:topologyBoards(after),pending:false});
 expect(topologyNeedsReconfiguration(applied,"master",after)).toBe(false);
});
it("has a baseline for USB-only status and excludes module reader peers",()=>{
 expect(topologyBoards({deviceId:new Uint8Array([1,2,3,4,5,6])} as GetStatusResponse)).toEqual([{nodeId:0x040506,local:true}]);
 expect(topologyBoards({...before,chainPeers:[...before.chainPeers!,{nodeId:9,flags:2,local:false}]} as GetStatusResponse)).toHaveLength(3);
});

it("does not silently accept changed identities in a legacy project",()=>{
 const legacy={...project,authoringMetadata:{__backbonePhysical:{comment:JSON.stringify({drafts:{"master:host":{nodeId:1,local:true,logicalSlot:1,modes:[0,0,0,0]},"master:peer":{nodeId:2,local:false,logicalSlot:2,modes:[0,0,0,0]}}})}}};
 const checkpoint=initialTopologyCheckpoint(legacy,"master",topologyBoards(status([1,3])));
 expect(checkpoint.pending).toBe(true);
 expect(checkpoint.boards.map(board=>board.nodeId)).toEqual([1,2]);
});
