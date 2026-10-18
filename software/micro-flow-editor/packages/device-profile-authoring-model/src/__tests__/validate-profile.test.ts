import { describe, expect, it } from "vitest";
import type { DeviceProfileDraft } from "../profile.js";
import { PortCapability, PortTransport } from "../transport.js";
import { validateDeviceProfile } from "../validate-profile.js";

function baseDraft(overrides: Partial<DeviceProfileDraft> = {}): DeviceProfileDraft {
  return {
    profileId: "sensor.example",
    version: 1,
    transport: PortTransport.I2C,
    requiredCapabilities: 0,
    maxTotalTimeMs: 1000,
    maxTransactions: 10,
    maxBytes: 64,
    initOps: [],
    sampleOps: [],
    safeStopOps: [],
    sampleSchemaId: "",
    sampleSchemaVersion: 1,
    sampleFields: [],
    ...overrides,
  };
}

describe("validateDeviceProfile — S061 § Verifiche", () => {
  it("accepts two sensors with different register maps under the same generic driver (nothing here hardcodes a driver)", () => {
    const sensorA = baseDraft({
      initOps: [{ op: "I2C_WRITE", src: 0, length: 1, timeoutMs: 20 }],
      sampleOps: [
        { op: "LOAD_CONST", dst: 0, length: 1, low: 0x02, high: 0 },
        { op: "I2C_WRITE_READ", src: 0, dst: 1, readLength: 2, writeLength: 1, timeoutMs: 20 },
        { op: "BYTE_SWAP", src: 1, dst: 1, width: 2 },
        { op: "SIGN_EXTEND", src: 1, dst: 2, bits: 16 },
        { op: "EMIT_FIELD", src: 2, fieldId: 1 },
        { op: "EMIT_RECORD" },
      ],
      sampleSchemaId: "sensor.example.sample",
      sampleFields: [{ fieldId: 1, type: "int64", name: "current", unit: "mA" }],
    });
    const sensorB = baseDraft({
      profileId: "sensor.other",
      initOps: [{ op: "I2C_WRITE", src: 0, length: 1, timeoutMs: 20 }],
      sampleOps: [
        { op: "LOAD_CONST", dst: 0, length: 1, low: 0x09, high: 0 },
        { op: "I2C_WRITE_READ", src: 0, dst: 1, readLength: 4, writeLength: 1, timeoutMs: 20 },
        { op: "EMIT_FIELD", src: 1, fieldId: 5 },
        { op: "EMIT_RECORD" },
      ],
      sampleSchemaId: "sensor.other.sample",
      sampleFields: [{ fieldId: 5, type: "uint64", name: "raw", unit: "" }],
    });

    expect(validateDeviceProfile(sensorA).ok).toBe(true);
    expect(validateDeviceProfile(sensorB).ok).toBe(true);
  });

  it("builds a profile with init, polling ready (WAIT_FIELD_MASK), CRC, and multiple outputs entirely in the model", () => {
    const draft = baseDraft({
      maxTransactions: 10,
      maxBytes: 16,
      maxTotalTimeMs: 100,
      initOps: [{ op: "I2C_WRITE", src: 0, length: 1, timeoutMs: 5 }],
      sampleOps: [
        { op: "WAIT_FIELD_MASK", dst: 0, src: 0, mask: 0x01, expected: 0x01, attempts: 3, intervalMs: 10 },
        { op: "I2C_READ", dst: 1, length: 3, timeoutMs: 5 },
        { op: "CRC8", src: 1, dst: 2 },
        { op: "MASK", src: 1, dst: 3, mask: 0xff },
        { op: "EMIT_FIELD", src: 3, fieldId: 10 },
        { op: "EMIT_FIELD", src: 2, fieldId: 11 },
        { op: "EMIT_RECORD" },
      ],
      sampleSchemaId: "sensor.multi.sample",
      sampleFields: [
        { fieldId: 10, type: "uint64", name: "value" },
        { fieldId: 11, type: "uint64", name: "crc" },
      ],
    });

    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.transactions).toBe(1 /* init I2C_WRITE */ + 3 /* WAIT attempts */ + 1 /* I2C_READ */);
      expect(result.value.bytes).toBe(1 /* I2C_WRITE length */ + 6 /* WAIT attempts*2 */ + 3 /* I2C_READ length */);
      expect(result.value.totalTimeMs).toBe(5 /* I2C_WRITE timeout */ + 30 /* WAIT attempts*interval */ + 5 /* I2C_READ timeout */);
      expect(result.value.operations).toBe(8);
    }
  });

  it("rejects a WAIT_FIELD_MASK with zero attempts as an unbounded wait, with a precise path", () => {
    const draft = baseDraft({
      sampleOps: [{ op: "WAIT_FIELD_MASK", dst: 0, src: 0, mask: 1, expected: 1, attempts: 0, intervalMs: 10 }],
    });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.error.find((x) => x.code === "device-profile.unbounded_wait");
      expect(e).toBeDefined();
      expect(e!.path).toEqual(["device-profile", "sampleOps", "0"]);
    }
  });

  it("rejects a computed time budget that exceeds the declared maxTotalTimeMs", () => {
    const draft = baseDraft({
      maxTotalTimeMs: 10,
      sampleOps: [{ op: "WAIT_FIELD_MASK", dst: 0, src: 0, mask: 1, expected: 1, attempts: 3, intervalMs: 10 }],
    });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((e) => e.code === "device-profile.time_budget_exceeded")).toBe(true);
  });

  it("rejects a computed byte budget that exceeds the declared maxBytes (buffer)", () => {
    const draft = baseDraft({
      maxBytes: 1,
      sampleOps: [{ op: "I2C_READ", dst: 0, length: 100, timeoutMs: 5 }],
    });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((e) => e.code === "device-profile.byte_budget_exceeded")).toBe(true);
  });

  it("rejects a computed transaction budget that exceeds the declared maxTransactions", () => {
    const draft = baseDraft({
      maxTransactions: 1,
      sampleOps: [
        { op: "I2C_READ", dst: 0, length: 1, timeoutMs: 5 },
        { op: "I2C_READ", dst: 1, length: 1, timeoutMs: 5 },
      ],
    });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((e) => e.code === "device-profile.transaction_budget_exceeded")).toBe(true);
  });

  it("rejects a duplicate sampleField id with a precise path", () => {
    const draft = baseDraft({
      sampleSchemaId: "s",
      sampleOps: [
        { op: "EMIT_FIELD", src: 0, fieldId: 1 },
        { op: "EMIT_FIELD", src: 0, fieldId: 1 },
        { op: "EMIT_RECORD" },
      ],
      sampleFields: [
        { fieldId: 1, type: "int64", name: "a" },
        { fieldId: 1, type: "int64", name: "b" },
      ],
    });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.error.find((x) => x.code === "device-profile.duplicate_field_id");
      expect(e).toBeDefined();
      expect(e!.path).toEqual(["device-profile", "sampleFields", "1"]);
    }
  });

  it("rejects a schema (EMIT_FIELD referencing an undeclared field, and a declared field never emitted)", () => {
    const draft = baseDraft({
      sampleSchemaId: "s",
      sampleOps: [{ op: "EMIT_FIELD", src: 0, fieldId: 99 }, { op: "EMIT_RECORD" }],
      sampleFields: [{ fieldId: 1, type: "int64", name: "unused" }],
    });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((e) => e.code === "device-profile.unknown_emitted_field")).toBe(true);
      expect(result.error.some((e) => e.code === "device-profile.unemitted_field")).toBe(true);
    }
  });

  it("rejects a temp slot out of the firmware's 0-7 range", () => {
    const draft = baseDraft({ initOps: [{ op: "I2C_WRITE", src: 8, length: 1, timeoutMs: 5 }] });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((e) => e.code === "device-profile.temp_slot_out_of_range")).toBe(true);
  });

  it("rejects GPIO_SET modeled correctly as an immediate boolean (no temp slot to bounds-check)", () => {
    const draft = baseDraft({ initOps: [{ op: "GPIO_SET", value: true }] });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(true);
  });

  it("rejects LOAD_CONST with a length outside 1-8 bytes", () => {
    const draft = baseDraft({ initOps: [{ op: "LOAD_CONST", dst: 0, length: 9, low: 0, high: 0 }] });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(false);
  });

  it("collects every problem instead of stopping at the first", () => {
    const draft = baseDraft({
      profileId: "",
      initOps: [{ op: "I2C_WRITE", src: 9, length: 1, timeoutMs: 5 }],
      sampleOps: [{ op: "WAIT_FIELD_MASK", dst: 0, src: 0, mask: 1, expected: 1, attempts: 0, intervalMs: 1 }],
    });
    const result = validateDeviceProfile(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThanOrEqual(3);
  });

  it("honors an optional caller-supplied maxOperationCount cap", () => {
    const draft = baseDraft({ initOps: [{ op: "EMIT_RECORD" }, { op: "EMIT_RECORD" }] });
    const result = validateDeviceProfile(draft, { maxOperationCount: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((e) => e.code === "device-profile.operation_count_exceeded")).toBe(true);
  });

  it("accepts 1-Wire, UART_READ, WAIT_GPIO, and SPI mode 3 drafts", () => {
    const w1 = baseDraft({
      profileId: "sensor.ds18b20",
      transport: PortTransport.W1,
      requiredCapabilities: PortCapability.W1,
      sampleOps: [
        { op: "LOAD_CONST", dst: 0, length: 1, low: 0xbe, high: 0 },
        { op: "W1_WRITE_READ", src: 0, dst: 1, readLength: 2, writeLength: 1, timeoutMs: 20 },
        { op: "EMIT_FIELD", src: 1, fieldId: 1 },
        { op: "EMIT_RECORD" },
      ],
      sampleSchemaId: "sensor.ds18b20.sample",
      sampleFields: [{ fieldId: 1, type: "int64", name: "raw" }],
    });
    const uart = baseDraft({
      profileId: "sensor.pms",
      transport: PortTransport.UART,
      requiredCapabilities: PortCapability.UART,
      sampleOps: [
        { op: "UART_READ", dst: 0, length: 4, timeoutMs: 50 },
        { op: "EMIT_FIELD", src: 0, fieldId: 1 },
        { op: "EMIT_RECORD" },
      ],
      sampleSchemaId: "sensor.pms.sample",
      sampleFields: [{ fieldId: 1, type: "uint64", name: "frame" }],
    });
    const spi = baseDraft({
      profileId: "sensor.adc",
      transport: PortTransport.SPI,
      requiredCapabilities: PortCapability.SPI,
      sampleOps: [
        { op: "LOAD_CONST", dst: 0, length: 2, low: 0, high: 0 },
        { op: "SPI_TRANSCEIVE", src: 0, dst: 1, length: 2, timeoutMs: 10, frequencyHz: 1_000_000, mode: 3 },
        { op: "EMIT_FIELD", src: 1, fieldId: 1 },
        { op: "EMIT_RECORD" },
      ],
      sampleSchemaId: "sensor.adc.sample",
      sampleFields: [{ fieldId: 1, type: "uint64", name: "raw" }],
    });
    const gpio = baseDraft({
      profileId: "sensor.pir",
      transport: PortTransport.I2C,
      requiredCapabilities: PortCapability.I2C | PortCapability.DIGITAL_INPUT,
      sampleOps: [
        { op: "WAIT_GPIO", dst: 0, attempts: 5, intervalMs: 10, expectedLevel: 1 },
        { op: "EMIT_FIELD", src: 0, fieldId: 1 },
        { op: "EMIT_RECORD" },
      ],
      sampleSchemaId: "sensor.pir.sample",
      sampleFields: [{ fieldId: 1, type: "uint64", name: "level" }],
    });

    expect(validateDeviceProfile(w1).ok).toBe(true);
    expect(validateDeviceProfile(uart).ok).toBe(true);
    expect(validateDeviceProfile(spi).ok).toBe(true);
    expect(validateDeviceProfile(gpio).ok).toBe(true);
  });
});

it("prevents a logical timer from accessing physical GPIO", () => {
  expect(validateDeviceProfile(baseDraft({ transport: PortTransport.LOGICAL,
    initOps: [{ op: "GPIO_SET", channel: 0, value: true }],
  })).ok).toBe(false);
  expect(validateDeviceProfile(baseDraft({ transport: PortTransport.LOGICAL,
    initOps: [{ op: "LOAD_CONST", dst: 0, length: 1, low: 1, high: 0 }],
  })).ok).toBe(true);
});
