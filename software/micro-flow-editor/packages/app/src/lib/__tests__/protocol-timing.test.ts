import { describe, expect, it } from "vitest";
import { createBlankDraft, createI2cTemperatureExample } from "../device-recipe-draft.js";
import { parseHexBytesInput } from "../i2c-hex.js";
import { buildProtocolTimingFromOps } from "../protocol-timing.js";
import { buildRecipeTestConfigBytes, recipePlanToTestProfile } from "../recipe-to-test-profile.js";
import { decodeConfigCbor } from "@spaghettilab/config-decompiler";

describe("protocol-timing", () => {
  it("I2C Scrivi 0x3C / 00 AF A5 → START · 0x78 · 0x00 · 0xAF · 0xA5 · STOP", () => {
    const draft = {
      ...createBlankDraft("i2c"),
      binding: {
        bus: "i2c" as const,
        i2c: { address: "0x3C", addressBits: 7 as const, busUnit: "I2C0", sdaLabel: "", sclLabel: "" },
        gpioSignals: [],
        auxGpio: [],
      },
    };
    const parsed = parseHexBytesInput("00 AF A5");
    expect(parsed.bytes).toEqual([0x00, 0xaf, 0xa5]);
    const op = {
      id: "w",
      type: "i2c_write" as const,
      address: "0x3C",
      bytes: parsed.tokens,
    };
    const model = buildProtocolTimingFromOps(draft, [op]);
    const labels = model.cells.map((c) => c.label);
    expect(labels).toEqual([
      "START",
      "0x78",
      "ACK",
      "0x00",
      "ACK",
      "0xAF",
      "ACK",
      "0xA5",
      "ACK",
      "STOP",
    ]);
    expect(labels.filter((l) => l === "STOP")).toHaveLength(1);
    expect(labels.filter((l) => l === "START")).toHaveLength(1);
    expect(labels).not.toContain("Sr");
    // Each data byte = 8 time units (SCL cycles) on the chart
    const dataCells = model.cells.filter((c) => c.kind === "data");
    expect(dataCells).toHaveLength(3);
    expect(dataCells.every((c) => c.units === 8)).toBe(true);
  });

  it("I2C Scrivi with a single byte still works", () => {
    const draft = createBlankDraft("i2c");
    const op = { id: "w", type: "i2c_write" as const, address: "0x48", bytes: ["0xAA"] };
    const labels = buildProtocolTimingFromOps(draft, [op]).cells.map((c) => c.label);
    expect(labels).toEqual(["START", "0x90", "ACK", "0xAA", "ACK", "STOP"]);
  });

  it("Testa profile packs all write bytes into one I2C_WRITE", () => {
    const draft = createBlankDraft("i2c");
    const op = {
      id: "w",
      type: "i2c_write" as const,
      address: "0x3C",
      bytes: parseHexBytesInput("00 AF A5").tokens,
    };
    const { profile } = recipePlanToTestProfile(draft, [], [op]);
    const write = profile.sampleOps.find((i) => i.op === "I2C_WRITE");
    const load = profile.sampleOps.find((i) => i.op === "LOAD_CONST");
    expect(write).toMatchObject({ op: "I2C_WRITE", length: 3 });
    expect(load).toMatchObject({ op: "LOAD_CONST", length: 3 });
    if (load && load.op === "LOAD_CONST") {
      // little-endian: 0x00 | 0xAF<<8 | 0xA5<<16
      expect(load.low).toBe(0x00 | (0xaf << 8) | (0xa5 << 16));
    }
    // Firmware uint16 version: 1..65535 (decode_profile_cbor rejects larger).
    expect(profile.version).toBeGreaterThanOrEqual(1);
    expect(profile.version).toBeLessThanOrEqual(65535);

    const bytes = buildRecipeTestConfigBytes({
      profileId: profile.profileId,
      profileVersion: profile.version,
      i2cAddress: 0x3c,
      periodMs: null,
    });
    expect(bytes).not.toBeNull();
    const decoded = decodeConfigCbor(bytes!);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const mod = decoded.value.modules[0]!;
    // Port 0 = I²C connector on Backbone/Core (port 1 is often CAN/GPIO-only).
    expect(mod.portId).toBe(0);
    expect(profile.profileId).toBe("try.i2c");
    // declarative-device: 1=profile_id (text), 2=profile_version, 4=i2c_address
    expect(mod.properties[1]).toBe(profile.profileId);
    expect(mod.properties[2]).toBe(BigInt(profile.version));
    expect(mod.properties[4]).toBe(0x3cn);
    // Bay/rail unspecified (null on wire) — avoid uint8 overflow / topology mismatch
    expect(mod.bayId).toBeUndefined();
    expect(mod.powerRailId).toBeUndefined();
    // Testa applies without schedule so start_runtime is skipped.
    expect(decoded.value.schedules).toEqual([]);
  });

  it("expands I2C write_read+RESTART with START/STOP/ACK/NACK and wire ADDR", () => {
    const draft = createI2cTemperatureExample();
    const steps = draft.commands[0]!.steps;
    const model = buildProtocolTimingFromOps(draft, steps);
    const labels = model.cells.map((c) => c.label);
    expect(labels[0]).toBe("START");
    expect(labels).toContain("Sr");
    expect(labels).toContain("STOP");
    expect(labels).toContain("ACK");
    expect(labels).toContain("NACK");
    // 0x48 write → 0x90, read → 0x91
    expect(labels).toContain("0x90");
    expect(labels).toContain("0x91");
    expect(labels).toContain("D0");
    expect(labels).toContain("D1");
    expect(labels.at(-1)).toBe("STOP");
    const srAt = labels.indexOf("Sr");
    expect(labels.slice(0, srAt)).not.toContain("STOP");
    expect(model.lanes.map((l) => l.id)).toEqual(["scl", "sda"]);
    expect(model.phaseBands.length).toBe(model.cells.length);
    expect(model.stepSpans.length).toBe(steps.length);
  });

  it("expands pure I2C read with ACK then NACK", () => {
    const draft = createI2cTemperatureExample();
    const op = {
      id: "rd",
      type: "i2c_read" as const,
      address: "0x48",
      len: 2,
      into: "raw",
    };
    const model = buildProtocolTimingFromOps(draft, [op]);
    const labels = model.cells.map((c) => c.label);
    expect(labels[0]).toBe("START");
    expect(labels).toContain("0x91"); // 0x48<<1 | 1
    expect(labels.filter((l) => l === "ACK").length).toBeGreaterThanOrEqual(2);
    expect(labels).toContain("NACK");
    expect(labels.at(-1)).toBe("STOP");
  });

  it("inserts wait delay between I2C transactions on the time axis", () => {
    const draft = createI2cTemperatureExample();
    const ops = [
      { id: "w1", type: "i2c_write" as const, address: "0x48", bytes: ["0x01"] },
      { id: "d1", type: "wait" as const, ms: 100, unit: "ms" as const },
      { id: "w2", type: "i2c_write" as const, address: "0x48", bytes: ["0x02"] },
    ];
    const model = buildProtocolTimingFromOps(draft, ops);
    const firstStop = model.cells.find((c) => c.kind === "stop")!;
    const secondStart = model.cells.filter((c) => c.kind === "start")[1]!;
    expect(secondStart.t0).toBeGreaterThan(firstStop.t1 + 5);
  });

  it("encodes 10-bit address header on the wire", () => {
    const draft = createI2cTemperatureExample();
    const with10 = {
      ...draft,
      binding: {
        ...draft.binding,
        i2c: { ...draft.binding.i2c!, address: "0x148", addressBits: 10 as const },
      },
    };
    const model = buildProtocolTimingFromOps(with10, with10.commands[0]!.steps);
    // 10-bit header byte labeled as 0xF5+W style (11110 A9 A8 W)
    expect(model.cells.some((c) => c.kind === "addr_w" && c.label.includes("+W"))).toBe(true);
  });
});
