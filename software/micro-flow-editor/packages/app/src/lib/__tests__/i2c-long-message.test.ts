import { describe, it, expect } from "vitest";
import { createI2cGenericExample } from "../device-recipe-draft.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import { recipePlanToTestProfile } from "../recipe-to-test-profile.js";
import {
  encodeDeviceProfileCbor,
  decodeDeviceProfileCbor,
} from "@spaghettilab/device-profile-install";
import { validateDeviceProfile } from "@spaghettilab/device-profile-authoring-model";
import { appendLongI2cMessage, messageTimeoutMs } from "../i2c-long-message.js";

const draft = () => {
  const base = createI2cGenericExample();
  return {
    ...base,
    flowInterfaces: [],
    commands: [
      {
        ...base.commands[0]!,
        steps: [
          {
            id: "write",
            type: "i2c_write" as const,
            bytes: Array.from({ length: 2048 }, (_, i) =>
              (i % 256).toString(16).padStart(2, "0"),
            ),
          },
        ],
      },
    ],
  };
};
describe("transparent long I2C messages", () => {
  it("compiles 2048 bytes as one transfer with bounded data and no large scalar temporaries", () => {
    const source = draft();
    const { profile } = compileRuntimeDriver(source);
    expect(profile.sampleOps.map((op) => op.op)).toEqual([
      "MESSAGE_LOAD",
      "I2C_MESSAGE_WRITE",
      "EMIT_RECORD",
    ]);
    expect(profile.messageData).toHaveLength(2048);
    expect(profile.sampleOps[1]).toMatchObject({
      length: 2048,
      timeoutMs: messageTimeoutMs(2048),
    });
    expect(validateDeviceProfile(profile).ok).toBe(true);
    const decoded = decodeDeviceProfileCbor(encodeDeviceProfileCbor(profile));
    expect(decoded).toEqual({ ok: true, value: profile });
    const tested = recipePlanToTestProfile(
      source,
      source.commands[0]!.steps,
      [],
    ).profile;
    expect(tested.initOps.map((op) => op.op)).toEqual([
      "MESSAGE_LOAD",
      "I2C_MESSAGE_WRITE",
    ]);
    expect(tested.messageData).toEqual(profile.messageData);
  });
  it("patches variables at their exact byte offset and reuses identical constant templates", () => {
    const data: number[] = [],
      ops: import("@spaghettilab/device-profile-authoring-model").Instruction[] = [];
    const tokens = [...Array<string>(40).fill("AA"), "$var1", "FE"];
    const variable = () => ({ width: 2, materialize: () => 3 });
    expect(appendLongI2cMessage(tokens, data, ops, variable)).toBe(true);
    expect(ops[1]).toEqual({ op: "MESSAGE_PATCH", src: 3, offset: 40, length: 2 });
    expect(data.slice(39)).toEqual([0xaa, 0, 0, 0xfe]);
    appendLongI2cMessage(tokens, data, ops, variable);
    expect(data).toHaveLength(43);
    expect(() =>
      appendLongI2cMessage(Array<string>(2049).fill("00"), [], [], variable),
    ).toThrow("2048");
    expect(() =>
      appendLongI2cMessage(
        Array<string>(2048).fill("FF"),
        Array<number>(2048).fill(0),
        [],
        variable,
      ),
    ).toThrow("Memoria");
  });
  it("rejects missing templates and writes without a loaded message", () => {
    const { profile } = compileRuntimeDriver(draft());
    expect(validateDeviceProfile({ ...profile, messageData: [] }).ok).toBe(false);
    expect(
      validateDeviceProfile({ ...profile, sampleOps: profile.sampleOps.slice(1) }).ok,
    ).toBe(false);
  });
});
