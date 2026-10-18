import { expect, it } from "vitest";
import { manualTriggerProfile, sendManualTrigger } from "../flow-trigger.js";
import { validateDeviceProfile } from "@spaghettilab/device-profile-authoring-model";
import {
  encodeDeviceProfileCbor,
  decodeDeviceProfileCbor,
} from "@spaghettilab/device-profile-install";
it("provides bounded LOW/HIGH commands without GPIO, sleeps or periodic sampling", () => {
  const profile = manualTriggerProfile("button-1");
  expect(validateDeviceProfile(profile).ok).toBe(true);
  expect(decodeDeviceProfileCbor(encodeDeviceProfileCbor(profile)).ok).toBe(true);
  expect(profile.sampleOps.filter((op) => op.op === "LOAD_CONST")).toMatchObject([
    { low: 0 },
    { low: 1 },
  ]);
  expect(profile.profileId.length).toBeLessThan(32);
  expect(profile.sampleSchemaId.length).toBeLessThan(32);
});
it("makes each click a new rising edge and always restores LOW on failure", async () => {
  const ids: number[] = [];
  await sendManualTrigger(async (id) => {
    ids.push(id);
  });
  await sendManualTrigger(async (id) => {
    ids.push(id);
  });
  expect(ids).toEqual([1, 2, 1, 1, 2, 1]);
  const failed: number[] = [];
  await expect(
    sendManualTrigger(async (id) => {
      failed.push(id);
      if (id === 2) throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(failed).toEqual([1, 2, 1]);
});
