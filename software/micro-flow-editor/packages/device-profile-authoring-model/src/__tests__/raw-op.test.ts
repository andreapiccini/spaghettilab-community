import { describe, expect, it } from "vitest";
import type { Instruction } from "../instruction.js";
import { DeviceProfileOpcode } from "../opcodes.js";
import { fromRawOp, toRawOp } from "../raw-op.js";

describe("toRawOp — fixed per-opcode compile, S061 point 3", () => {
  it("compiles I2C_READ using imm0 for length and imm1 for timeoutMs, per device_profile_exec.c's exec_i2c_read", () => {
    expect(toRawOp({ op: "I2C_READ", dst: 1, length: 2, timeoutMs: 50 })).toEqual({
      opcode: DeviceProfileOpcode.I2C_READ,
      dst: 1,
      srcA: 0,
      srcB: 0,
      imm0: 2,
      imm1: 50,
      imm2: 0,
      imm3: 0,
    });
  });

  it("compiles I2C_WRITE_READ with imm0=readLength, imm1=writeLength, imm2=timeoutMs — easy to get backwards, verified against exec_i2c_write_read's call site", () => {
    expect(toRawOp({ op: "I2C_WRITE_READ", src: 0, dst: 1, readLength: 4, writeLength: 1, timeoutMs: 20 })).toEqual({
      opcode: DeviceProfileOpcode.I2C_WRITE_READ,
      dst: 1,
      srcA: 0,
      srcB: 0,
      imm0: 4,
      imm1: 1,
      imm2: 20,
      imm3: 0,
    });
  });

  it("compiles UART_READ_UNTIL with imm0=maxLength, imm1=timeoutMs, imm2=stopByte", () => {
    expect(toRawOp({ op: "UART_READ_UNTIL", dst: 2, maxLength: 16, timeoutMs: 100, stopByte: 0x0a })).toEqual({
      opcode: DeviceProfileOpcode.UART_READ_UNTIL,
      dst: 2,
      srcA: 0,
      srcB: 0,
      imm0: 16,
      imm1: 100,
      imm2: 0x0a,
      imm3: 0,
    });
  });

  it("compiles GPIO_SET as an immediate boolean in imm0, never a temp slot", () => {
    expect(toRawOp({ op: "GPIO_SET", value: true })).toEqual({
      opcode: DeviceProfileOpcode.GPIO_SET,
      dst: 0,
      srcA: 0,
      srcB: 0,
      imm0: 1,
      imm1: 0,
      imm2: 0,
      imm3: 0,
    });
  });

  it("compiles WAIT_FIELD_MASK with dst as the result slot, src as the optional write-command slot, and attempts/intervalMs/mask/expected in imm0-imm3", () => {
    expect(toRawOp({ op: "WAIT_FIELD_MASK", dst: 1, src: 3, mask: 0xff, expected: 0x01, attempts: 5, intervalMs: 10 })).toEqual({
      opcode: DeviceProfileOpcode.WAIT_FIELD_MASK,
      dst: 1,
      srcA: 3,
      srcB: 0,
      imm0: 5,
      imm1: 10,
      imm2: 0xff,
      imm3: 0x01,
    });
  });

  it("compiles LOAD_CONST using imm0 for length and imm2/imm3 for the value, per 'Load imm2/imm3 bytes'", () => {
    expect(toRawOp({ op: "LOAD_CONST", dst: 0, length: 4, low: 100, high: 0 })).toEqual({
      opcode: DeviceProfileOpcode.LOAD_CONST,
      dst: 0,
      srcA: 0,
      srcB: 0,
      imm0: 4,
      imm1: 0,
      imm2: 100,
      imm3: 0,
    });
  });

  it("compiles SPI_TRANSCEIVE mode 3 into imm3, leaving Mode 0 as imm3=0", () => {
    expect(toRawOp({ op: "SPI_TRANSCEIVE", src: 0, dst: 1, length: 2, timeoutMs: 10, frequencyHz: 1_000_000, mode: 3 }).imm3).toBe(3);
    expect(toRawOp({ op: "SPI_TRANSCEIVE", src: 0, dst: 1, length: 2, timeoutMs: 10, frequencyHz: 1_000_000, mode: 0 }).imm3).toBe(0);
  });

  it("compiles W1_WRITE_READ with imm0=readLength, imm1=writeLength, imm2=timeoutMs — ROM is binding, not this op", () => {
    expect(toRawOp({ op: "W1_WRITE_READ", src: 0, dst: 1, readLength: 2, writeLength: 1, timeoutMs: 20 })).toEqual({
      opcode: DeviceProfileOpcode.W1_WRITE_READ,
      dst: 1,
      srcA: 0,
      srcB: 0,
      imm0: 2,
      imm1: 1,
      imm2: 20,
      imm3: 0,
    });
  });

  it("compiles UART_READ with imm0=length and imm1=timeoutMs, distinct from UART_READ_UNTIL", () => {
    expect(toRawOp({ op: "UART_READ", dst: 2, length: 8, timeoutMs: 40 })).toEqual({
      opcode: DeviceProfileOpcode.UART_READ,
      dst: 2,
      srcA: 0,
      srcB: 0,
      imm0: 8,
      imm1: 40,
      imm2: 0,
      imm3: 0,
    });
  });

  it("compiles WAIT_GPIO with attempts/intervalMs/expectedLevel in imm0-imm2", () => {
    expect(toRawOp({ op: "WAIT_GPIO", dst: 0, attempts: 5, intervalMs: 10, expectedLevel: 1 })).toEqual({
      opcode: DeviceProfileOpcode.WAIT_GPIO,
      dst: 0,
      srcA: 0,
      srcB: 0,
      imm0: 5,
      imm1: 10,
      imm2: 1,
      imm3: 0,
    });
  });

  it("compiles EMIT_FIELD with the field id in dst, per the struct's own 'destination temp slot or emitted field id'", () => {
    expect(toRawOp({ op: "EMIT_FIELD", src: 2, fieldId: 7 })).toMatchObject({
      opcode: DeviceProfileOpcode.EMIT_FIELD,
      srcA: 2,
      dst: 7,
    });
  });

  it("compiles EMIT_RECORD with no operands", () => {
    expect(toRawOp({ op: "EMIT_RECORD" })).toEqual({
      opcode: DeviceProfileOpcode.EMIT_RECORD,
      dst: 0,
      srcA: 0,
      srcB: 0,
      imm0: 0,
      imm1: 0,
      imm2: 0,
      imm3: 0,
    });
  });
});

describe("fromRawOp — the inverse of toRawOp, used by device-profile-install's CBOR decoder", () => {
  const samples: Instruction[] = [
    { op: "I2C_WRITE", src: 0, length: 2, timeoutMs: 10 },
    { op: "I2C_READ", dst: 1, length: 4, timeoutMs: 10 },
    { op: "I2C_WRITE_READ", src: 0, dst: 1, readLength: 4, writeLength: 1, timeoutMs: 20 },
    { op: "SPI_TRANSCEIVE", src: 0, dst: 1, length: 3, timeoutMs: 5, frequencyHz: 1_000_000, mode: 0 },
    { op: "UART_WRITE", src: 0, length: 2, timeoutMs: 10 },
    { op: "UART_READ_UNTIL", dst: 1, maxLength: 16, timeoutMs: 100, stopByte: 0x0a },
    { op: "UART_READ", dst: 1, length: 4, timeoutMs: 50 },
    { op: "W1_WRITE_READ", src: 0, dst: 1, readLength: 2, writeLength: 1, timeoutMs: 20 },
    { op: "GPIO_GET", dst: 0 },
    { op: "GPIO_SET", value: true },
    { op: "ADC_READ", dst: 0, timeoutMs: 5 },
    { op: "DELAY_BOUNDED", milliseconds: 15 },
    { op: "WAIT_FIELD_MASK", dst: 0, src: 1, mask: 0xff, expected: 0x01, attempts: 3, intervalMs: 10 },
    { op: "WAIT_GPIO", dst: 0, attempts: 5, intervalMs: 10, expectedLevel: 1 },
    { op: "LOAD_CONST", dst: 0, length: 4, low: 100, high: 0 },
    { op: "COPY_BYTES", src: 0, dst: 1, length: 2 },
    { op: "CONCAT", srcA: 0, srcB: 1, dst: 2 },
    { op: "BYTE_SWAP", src: 0, dst: 1, width: 2 },
    { op: "MASK", src: 0, dst: 1, mask: 0xff },
    { op: "SHIFT", src: 0, dst: 1, amount: 4, direction: "left" },
    { op: "SHIFT", src: 0, dst: 1, amount: 4, direction: "right" },
    { op: "SIGN_EXTEND", src: 0, dst: 1, bits: 16 },
    { op: "CRC8", src: 0, dst: 1 },
    { op: "CRC16", src: 0, dst: 1 },
    { op: "EMIT_FIELD", src: 0, fieldId: 7 },
    { op: "EMIT_RECORD" },
  ];

  it.each(samples)("round-trips %j through toRawOp -> fromRawOp", (instruction) => {
    const result = fromRawOp(toRawOp(instruction));
    expect(result).toEqual({ ok: true, value: instruction });
  });

  it("rejects an opcode outside the known vocabulary rather than guessing", () => {
    const result = fromRawOp({ opcode: 999, dst: 0, srcA: 0, srcB: 0, imm0: 0, imm1: 0, imm2: 0, imm3: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("device-profile.unknown_opcode");
  });

  it("rejects a BYTE_SWAP width that isn't 2 or 4", () => {
    const result = fromRawOp({ opcode: DeviceProfileOpcode.BYTE_SWAP, dst: 1, srcA: 0, srcB: 0, imm0: 3, imm1: 0, imm2: 0, imm3: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("device-profile.invalid_raw_operand");
  });

  it("rejects an SPI_TRANSCEIVE mode outside 0-3", () => {
    const result = fromRawOp({ opcode: DeviceProfileOpcode.SPI_TRANSCEIVE, dst: 1, srcA: 0, srcB: 0, imm0: 2, imm1: 10, imm2: 1000000, imm3: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("device-profile.invalid_raw_operand");
  });
});

describe("runtime variable and encoder operations", () => {
  it.each<Instruction>([
    { op: "SCALE_PACK", dst: 2, src: 1, flags: 7, width: 2, divisor: 10, multiplier: -3, offset: -12 },
    { op: "LOAD_VALUE", dst: 1, argumentId: 2, required: false, length: 2, littleEndian: false, low: 0x1234, high: 0 },
    { op: "COPY_BYTES", src: 0, dst: 1, length: 2, offset: 3 },
  ])("preserves signed coefficients, cached field IDs and byte offsets: $op", instruction => {
    expect(fromRawOp(toRawOp(instruction))).toEqual({ ok: true, value: instruction });
  });
});

describe("indexed digital GPIO", () => {
  it("preserves the selected channel and variable polarity on the wire", () => {
    for (const op of [
      { op: "GPIO_GET", dst: 3, channel: 2 },
      { op: "GPIO_SET", value: false, channel: 3 },
      { op: "GPIO_SET_VALUE", src: 4, channel: 1, invert: true },
    ] as const) expect(fromRawOp(toRawOp(op))).toEqual({ ok: true, value: op });
  });
});

it("round trips an asynchronous active-low pulse without a blocking delay", () => {
  const pulse: Instruction = { op: "GPIO_PULSE", channel: 2, milliseconds: 125, activeHigh: false, restoreHigh: true };
  const raw = toRawOp(pulse);
  expect(raw.opcode).toBe(33);
  expect(raw.imm2).toBe(2);
  expect(fromRawOp(raw)).toEqual({ ok: true, value: pulse });
});
