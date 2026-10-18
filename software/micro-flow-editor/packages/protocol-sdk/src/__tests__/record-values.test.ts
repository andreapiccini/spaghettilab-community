import { it, expect } from "vitest";
import { encodeRecordEventPayload, decodeRecordEventPayload } from "../events.js";
it("round trips typed streamed records and keeps uint64 exact", () => {
  const record = {
    sourceKey: 1,
    sequence: 3,
    schemaId: "dht22",
    schemaVersion: 1,
    actionId: 2,
    fields: {
      1: 23.4,
      2: "23.4 °C",
      3: true,
      4: 18446744073709551615n,
      5: new Uint8Array([1, 255]),
    },
  };
  expect(decodeRecordEventPayload(encodeRecordEventPayload(record))).toEqual(record);
});
it("keeps old metadata-only firmware events readable", () => {
  const legacy = { sourceKey: 1, sequence: 3, schemaId: "old", schemaVersion: 1 };
  expect(decodeRecordEventPayload(encodeRecordEventPayload(legacy))).toEqual(legacy);
});
