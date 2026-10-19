import { expect, it } from "vitest";
import { activeEdgesForRecord, type EdgeActivityRoute } from "../edge-activity.js";
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
