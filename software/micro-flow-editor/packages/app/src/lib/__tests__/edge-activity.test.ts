import { expect, it } from "vitest";
import { activeEdgesForRecord, SignalWavePlanner, SIGNAL_TRAVEL_MS, type EdgeActivityRoute } from "../edge-activity.js";
const routes: EdgeActivityRoute[] = [
  { edgeId: "read", key: 2, field: 1, schemaId: "trigger.s", kind: "trigger" },
  { edgeId: "show", key: 3, field: 7, schemaId: "sensor.s", action: 4, kind: "data" },
];
it("animates the trigger only on HIGH, not on its LOW reset", () => {
  for (const value of [0n, false, 0])
    expect(
      activeEdgesForRecord(routes, {
        sourceKey: 2,
        sequence: 1,
        schemaId: "trigger.s",
        schemaVersion: 1,
        fields: { 1: value },
      }),
    ).toEqual([]);
  expect(
    activeEdgesForRecord(routes, {
      sourceKey: 2,
      sequence: 2,
      schemaId: "trigger.s",
      schemaVersion: 1,
      fields: { 1: 1n },
    }).map((route) => route.edgeId),
  ).toEqual(["read"]);
});
it("zero and repeated values are real data packets too", () => {
  for (const sequence of [1, 2])
    expect(
      activeEdgesForRecord(routes, {
        sourceKey: 3,
        sequence,
        schemaId: "sensor.s",
        schemaVersion: 1,
        actionId: 4,
        fields: { 7: 0 },
      }).map((route) => route.edgeId),
    ).toEqual(["show"]);
});
it("does not light unrelated schemas, actions, fields, or missing payloads", () => {
  const record = {
    sourceKey: 3,
    sequence: 1,
    schemaId: "sensor.s",
    schemaVersion: 1,
    actionId: 4,
    fields: { 7: 22 },
  };
  for (const changed of [
    { schemaId: "other" },
    { sourceKey: 8 },
    { actionId: 5 },
    { fields: { 8: 22 } },
    { fields: undefined },
  ])
    expect(activeEdgesForRecord(routes, { ...record, ...changed })).toEqual([]);
});
it("deduplicates one wire even if several observations match", () => {
  expect(
    activeEdgesForRecord([routes[0]!, routes[0]!], {
      sourceKey: 2,
      sequence: 1,
      schemaId: "trigger.s",
      schemaVersion: 1,
      fields: { 1: true },
    }),
  ).toHaveLength(1);
});

const wire = (edgeId: string): EdgeActivityRoute => ({edgeId,key:1,field:1,kind:"data"});
const chain = [{id:"in",source:"sensor",target:"if"},{id:"out",source:"if",target:"led"},{id:"view",source:"sensor",target:"viewer"}];
it("orders a reversed telemetry burst and keeps fanout simultaneous",()=>{
 const wave=new SignalWavePlanner(chain).plan([wire("out"),wire("view"),wire("in")],100);
 expect(wave.find(item=>item.route.edgeId==="in")?.delay).toBe(0);
 expect(wave.find(item=>item.route.edgeId==="view")?.delay).toBe(0);
 expect(wave.find(item=>item.route.edgeId==="out")?.delay).toBe(SIGNAL_TRAVEL_MS+40);
});
it("waits for an incoming packet already travelling before showing output",()=>{
 const planner=new SignalWavePlanner(chain);
 planner.plan([wire("in")],100);
 expect(planner.plan([wire("out")],120)[0]?.delay).toBe(SIGNAL_TRAVEL_MS+20);
});
it("coalesces fast telemetry without restarting travel or accumulating backlog",()=>{
 const planner=new SignalWavePlanner(chain);
 expect(planner.plan([wire("in")],100)).toHaveLength(1);
 for(let time=110;time<390;time+=10) expect(planner.plan([wire("in")],time)).toEqual([]);
 expect(planner.plan([wire("in")],400)[0]?.delay).toBe(0);
});
it("does not invent downstream events and handles feedback without recursion",()=>{
 expect(new SignalWavePlanner(chain).plan([wire("in")],100).map(item=>item.route.edgeId)).toEqual(["in"]);
 const cycle=[{id:"a",source:"a",target:"b"},{id:"b",source:"b",target:"a"}];
 const planner=new SignalWavePlanner(cycle);
 for(let now=100;now<5000;now+=20) {
  const wave=planner.plan([wire("a"),wire("b")],now);
  expect(wave.every(item=>item.delay<=900)).toBe(true);
 }
});
