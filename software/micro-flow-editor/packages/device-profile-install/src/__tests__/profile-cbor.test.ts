import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import { PortTransport } from "@spaghettilab/device-profile-authoring-model";
import {
  encodeArray,
  encodeMap,
  encodeText,
  encodeUint,
} from "@spaghettilab/protocol-sdk";
import { describe, expect, it } from "vitest";
import { decodeDeviceProfileCbor, encodeDeviceProfileCbor } from "../profile-cbor.js";

function u32(n: number) {
  return encodeUint(BigInt(n));
}

function minimalDraft(): DeviceProfileDraft {
  return {
    profileId: "s",
    version: 1,
    transport: PortTransport.I2C,
    requiredCapabilities: 1,
    maxTotalTimeMs: 1,
    maxTransactions: 1,
    maxBytes: 1,
    initOps: [],
    sampleOps: [],
    safeStopOps: [],
    sampleSchemaId: "",
    sampleSchemaVersion: 1,
    sampleFields: [],
  };
}

function fullDraft(): DeviceProfileDraft {
  return {
    profileId: "sensor.example",
    version: 2,
    transport: PortTransport.I2C,
    requiredCapabilities: 1,
    maxTotalTimeMs: 100,
    maxTransactions: 5,
    maxBytes: 16,
    initOps: [{ op: "I2C_WRITE", src: 0, length: 1, timeoutMs: 20 }],
    sampleOps: [
      { op: "I2C_READ", dst: 1, length: 2, timeoutMs: 20 },
      { op: "EMIT_FIELD", src: 1, fieldId: 1 },
      { op: "EMIT_RECORD" },
    ],
    safeStopOps: [{ op: "GPIO_SET", value: false }],
    sampleSchemaId: "sensor.example.sample",
    sampleSchemaVersion: 1,
    sampleFields: [{ fieldId: 1, type: "int64", name: "current", unit: "mA" }],
  };
}

describe("encodeDeviceProfileCbor / decodeDeviceProfileCbor — S063 wire encoder", () => {
  it("round-trips wire-v2 action slices and parameter loads", () => {
    const draft: DeviceProfileDraft = {
      ...minimalDraft(),
      sampleSchemaId: "actions",
      sampleOps: [
        {
          op: "LOAD_ARGUMENT",
          dst: 0,
          argumentId: 1,
          length: 1,
          littleEndian: true,
          required: true,
          low: 0,
          high: 0,
        },
        { op: "EMIT_RECORD" },
      ],
      actions: [{ id: 2, first: 0, count: 2 }],
    };
    expect(decodeDeviceProfileCbor(encodeDeviceProfileCbor(draft))).toEqual({
      ok: true,
      value: draft,
    });
  });
  it("round-trips a minimal draft byte-for-byte reproducibly", () => {
    const bytes = encodeDeviceProfileCbor(minimalDraft());
    const decoded = decodeDeviceProfileCbor(bytes);
    expect(decoded).toEqual({ ok: true, value: minimalDraft() });
    expect(
      encodeDeviceProfileCbor(decoded.ok ? decoded.value : minimalDraft()),
    ).toEqual(bytes);
  });

  it("round-trips a full draft (ops, fields, non-empty every plan) with no loss", () => {
    const draft = fullDraft();
    const bytes = encodeDeviceProfileCbor(draft);
    const decoded = decodeDeviceProfileCbor(bytes);
    expect(decoded).toEqual({ ok: true, value: draft });
  });

  it("emits the top-level map keys in exact ascending 0-13 order (expect_key requires this sequence, not a free-order map)", () => {
    const bytes = encodeDeviceProfileCbor(minimalDraft());
    // Indefinite-length map: 0xBF <key,value>* 0xFF. First byte after 0xBF is
    // the first key (0), a single-byte unsigned int 0x00.
    expect(bytes[0]).toBe(0xbf);
    expect(bytes[1]).toBe(0x00); // key 0 (WIRE)
    expect(bytes[bytes.length - 1]).toBe(0xff); // break
  });

  it("rejects an unsupported wire version", () => {
    const bytes = encodeDeviceProfileCbor(minimalDraft());
    // Byte 2 is the WIRE field's value (uint 1, single byte 0x01) — corrupt it to 3.
    const tampered = new Uint8Array(bytes);
    tampered[2] = 3;
    const result = decodeDeviceProfileCbor(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("device-profile-install.unsupported_wire_version");
  });

  it("rejects malformed CBOR with a structured error, not a thrown exception", () => {
    const result = decodeDeviceProfileCbor(new Uint8Array([0xff, 0xff]));
    expect(result.ok).toBe(false);
  });

  it("rejects a sample field claiming a value type other than INT64(1)/UINT64(2) — e.g. TEXT(3), unsupported for Device Profiles", () => {
    const craftedField = encodeArray([u32(1), u32(3), encodeText("x"), encodeText("")]);
    const bytes = encodeMap([
      [0, u32(1)],
      [1, encodeText("s")],
      [2, u32(1)],
      [3, u32(PortTransport.I2C)],
      [4, u32(1)],
      [5, u32(1)],
      [6, u32(1)],
      [7, u32(1)],
      [8, encodeArray([])],
      [9, encodeArray([])],
      [10, encodeArray([])],
      [11, encodeText("s")],
      [12, u32(1)],
      [13, encodeArray([craftedField])],
    ]);
    const result = decodeDeviceProfileCbor(bytes);
    expect(result.ok).toBe(false);
  });
});
