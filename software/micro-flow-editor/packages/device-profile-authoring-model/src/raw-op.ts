import { domainError, err, ok, type DomainError, type Result } from "@spaghettilab/domain";
import { DeviceProfileErrorCode } from "./errors.js";
import { DeviceProfileOpcode } from "./opcodes.js";
import type { Instruction } from "./instruction.js";

/**
 * Mirrors `struct spaghetti_device_profile_op` field-for-field
 * (`device_profile.h`): "operand meaning depends on opcode. Immediate
 * fields carry lengths, timeouts, masks, and small constants." This is the
 * wire/storage layout — `toRawOp()` is the one place a typed `Instruction`
 * is mapped onto it, mechanically, never by an arbitrary formula.
 */
export type RawDeviceProfileOp = {
  readonly opcode: number;
  readonly dst: number;
  readonly srcA: number;
  readonly srcB: number;
  readonly imm0: number;
  readonly imm1: number;
  readonly imm2: number;
  readonly imm3: number;
};

const LEFT = 0;
const RIGHT = 1;

/** Fixed per-opcode compile — see each `Instruction` variant's doc comment in `instruction.ts` for the operand meaning this mirrors (grounded in `device_profile_exec.c`, not just the opcode enum's one-line comments). */
export function toRawOp(instruction: Instruction): RawDeviceProfileOp {
  const base = { dst: 0, srcA: 0, srcB: 0, imm0: 0, imm1: 0, imm2: 0, imm3: 0 };
  switch (instruction.op) {
    case "I2C_WRITE":
      return { ...base, opcode: DeviceProfileOpcode.I2C_WRITE, srcA: instruction.src, imm0: instruction.length, imm1: instruction.timeoutMs };
    case "I2C_READ":
      return { ...base, opcode: DeviceProfileOpcode.I2C_READ, dst: instruction.dst, imm0: instruction.length, imm1: instruction.timeoutMs };
    case "I2C_WRITE_READ":
      return {
        ...base,
        opcode: DeviceProfileOpcode.I2C_WRITE_READ,
        srcA: instruction.src,
        dst: instruction.dst,
        imm0: instruction.readLength,
        imm1: instruction.writeLength,
        imm2: instruction.timeoutMs,
      };
    case "SPI_TRANSCEIVE":
      return {
        ...base,
        opcode: DeviceProfileOpcode.SPI_TRANSCEIVE,
        srcA: instruction.src,
        dst: instruction.dst,
        imm0: instruction.length,
        imm1: instruction.timeoutMs,
        imm2: instruction.frequencyHz,
        imm3: instruction.mode,
      };
    case "UART_WRITE":
      return { ...base, opcode: DeviceProfileOpcode.UART_WRITE, srcA: instruction.src, imm0: instruction.length, imm1: instruction.timeoutMs };
    case "UART_READ_UNTIL":
      return {
        ...base,
        opcode: DeviceProfileOpcode.UART_READ_UNTIL,
        dst: instruction.dst,
        imm0: instruction.maxLength,
        imm1: instruction.timeoutMs,
        imm2: instruction.stopByte,
      };
    case "UART_READ":
      return {
        ...base,
        opcode: DeviceProfileOpcode.UART_READ,
        dst: instruction.dst,
        imm0: instruction.length,
        imm1: instruction.timeoutMs,
      };
    case "W1_WRITE_READ":
      return {
        ...base,
        opcode: DeviceProfileOpcode.W1_WRITE_READ,
        srcA: instruction.src,
        dst: instruction.dst,
        imm0: instruction.readLength,
        imm1: instruction.writeLength,
        imm2: instruction.timeoutMs,
      };
    case "GPIO_GET":
      return { ...base, opcode: DeviceProfileOpcode.GPIO_GET, dst: instruction.dst };
    case "GPIO_SET":
      return { ...base, opcode: DeviceProfileOpcode.GPIO_SET, imm0: instruction.value ? 1 : 0 };
    case "ADC_READ":
      return { ...base, opcode: DeviceProfileOpcode.ADC_READ, dst: instruction.dst, imm0: instruction.timeoutMs };
    case "DELAY_BOUNDED":
      return { ...base, opcode: DeviceProfileOpcode.DELAY_BOUNDED, imm0: instruction.milliseconds };
    case "WAIT_FIELD_MASK":
      return {
        ...base,
        opcode: DeviceProfileOpcode.WAIT_FIELD_MASK,
        dst: instruction.dst,
        srcA: instruction.src,
        imm0: instruction.attempts,
        imm1: instruction.intervalMs,
        imm2: instruction.mask,
        imm3: instruction.expected,
      };
    case "WAIT_GPIO":
      return {
        ...base,
        opcode: DeviceProfileOpcode.WAIT_GPIO,
        dst: instruction.dst,
        imm0: instruction.attempts,
        imm1: instruction.intervalMs,
        imm2: instruction.expectedLevel,
      };
    case "SCALE_PACK":
      return { ...base, opcode: DeviceProfileOpcode.SCALE_PACK, dst: instruction.dst, srcA: instruction.src, srcB: instruction.flags, imm0: instruction.width, imm1: instruction.divisor, imm2: instruction.multiplier >>> 0, imm3: instruction.offset >>> 0 };
    case "LOAD_VALUE":
    case "LOAD_ARGUMENT":
      return { ...base, opcode: instruction.op === "LOAD_VALUE" ? DeviceProfileOpcode.LOAD_VALUE : DeviceProfileOpcode.LOAD_ARGUMENT, dst: instruction.dst, srcA: instruction.argumentId, srcB: instruction.required ? 1 : 0, imm0: instruction.length, imm1: instruction.littleEndian ? 1 : 0, imm2: instruction.low, imm3: instruction.high };
    case "LOAD_CONST":
      return { ...base, opcode: DeviceProfileOpcode.LOAD_CONST, dst: instruction.dst, imm0: instruction.length, imm2: instruction.low, imm3: instruction.high };
    case "COPY_BYTES":
      return { ...base, opcode: DeviceProfileOpcode.COPY_BYTES, srcA: instruction.src, dst: instruction.dst, imm0: instruction.length, imm1: instruction.offset ?? 0 };
    case "CONCAT":
      return { ...base, opcode: DeviceProfileOpcode.CONCAT, srcA: instruction.srcA, srcB: instruction.srcB, dst: instruction.dst };
    case "BYTE_SWAP":
      return { ...base, opcode: DeviceProfileOpcode.BYTE_SWAP, srcA: instruction.src, dst: instruction.dst, imm0: instruction.width };
    case "MASK":
      return { ...base, opcode: DeviceProfileOpcode.MASK, srcA: instruction.src, dst: instruction.dst, imm2: instruction.mask };
    case "SHIFT":
      return {
        ...base,
        opcode: DeviceProfileOpcode.SHIFT,
        srcA: instruction.src,
        dst: instruction.dst,
        imm0: instruction.amount,
        imm1: instruction.direction === "left" ? LEFT : RIGHT,
      };
    case "SIGN_EXTEND":
      return { ...base, opcode: DeviceProfileOpcode.SIGN_EXTEND, srcA: instruction.src, dst: instruction.dst, imm0: instruction.bits };
    case "CRC8":
      return { ...base, opcode: DeviceProfileOpcode.CRC8, srcA: instruction.src, dst: instruction.dst };
    case "CRC16":
      return { ...base, opcode: DeviceProfileOpcode.CRC16, srcA: instruction.src, dst: instruction.dst };
    case "EMIT_FIELD":
      return { ...base, opcode: DeviceProfileOpcode.EMIT_FIELD, srcA: instruction.src, dst: instruction.fieldId, imm0: instruction.width ?? 0, imm1: instruction.byteOrder === "be" ? 1 : 0, imm2: instruction.signExtend ? 1 : 0, imm3: instruction.multiplier ?? 0 };
    case "EMIT_RECORD":
      return { ...base, opcode: DeviceProfileOpcode.EMIT_RECORD };
  }
}

function invalidOperand(target: string, remediation: string): DomainError {
  return domainError({ code: DeviceProfileErrorCode.INVALID_RAW_OPERAND, path: ["device-profile", "raw-op"], target, remediation });
}

/**
 * The inverse of `toRawOp()` — used by `@spaghettilab/device-profile-install`
 * to reconstruct typed `Instruction`s from a decoded wire
 * `RawDeviceProfileOp` (S063's CBOR decoder). Rejects an opcode number
 * outside this package's closed vocabulary rather than silently coercing it
 * to something — an unrecognized opcode from a newer/different firmware
 * build must surface as an error, not a guess.
 */
export function fromRawOp(raw: RawDeviceProfileOp): Result<Instruction, DomainError> {
  switch (raw.opcode) {
    case DeviceProfileOpcode.I2C_WRITE:
      return ok({ op: "I2C_WRITE", src: raw.srcA, length: raw.imm0, timeoutMs: raw.imm1 });
    case DeviceProfileOpcode.I2C_READ:
      return ok({ op: "I2C_READ", dst: raw.dst, length: raw.imm0, timeoutMs: raw.imm1 });
    case DeviceProfileOpcode.I2C_WRITE_READ:
      return ok({ op: "I2C_WRITE_READ", src: raw.srcA, dst: raw.dst, readLength: raw.imm0, writeLength: raw.imm1, timeoutMs: raw.imm2 });
    case DeviceProfileOpcode.SPI_TRANSCEIVE:
      if (raw.imm3 !== 0 && raw.imm3 !== 1 && raw.imm3 !== 2 && raw.imm3 !== 3) {
        return err(invalidOperand(String(raw.imm3), "SPI_TRANSCEIVE mode (imm3) must be 0-3"));
      }
      return ok({ op: "SPI_TRANSCEIVE", src: raw.srcA, dst: raw.dst, length: raw.imm0, timeoutMs: raw.imm1, frequencyHz: raw.imm2, mode: raw.imm3 });
    case DeviceProfileOpcode.UART_WRITE:
      return ok({ op: "UART_WRITE", src: raw.srcA, length: raw.imm0, timeoutMs: raw.imm1 });
    case DeviceProfileOpcode.UART_READ_UNTIL:
      return ok({ op: "UART_READ_UNTIL", dst: raw.dst, maxLength: raw.imm0, timeoutMs: raw.imm1, stopByte: raw.imm2 });
    case DeviceProfileOpcode.UART_READ:
      return ok({ op: "UART_READ", dst: raw.dst, length: raw.imm0, timeoutMs: raw.imm1 });
    case DeviceProfileOpcode.W1_WRITE_READ:
      return ok({ op: "W1_WRITE_READ", src: raw.srcA, dst: raw.dst, readLength: raw.imm0, writeLength: raw.imm1, timeoutMs: raw.imm2 });
    case DeviceProfileOpcode.GPIO_GET:
      return ok({ op: "GPIO_GET", dst: raw.dst });
    case DeviceProfileOpcode.GPIO_SET:
      return ok({ op: "GPIO_SET", value: raw.imm0 !== 0 });
    case DeviceProfileOpcode.ADC_READ:
      return ok({ op: "ADC_READ", dst: raw.dst, timeoutMs: raw.imm0 });
    case DeviceProfileOpcode.DELAY_BOUNDED:
      return ok({ op: "DELAY_BOUNDED", milliseconds: raw.imm0 });
    case DeviceProfileOpcode.WAIT_FIELD_MASK:
      return ok({ op: "WAIT_FIELD_MASK", dst: raw.dst, src: raw.srcA, attempts: raw.imm0, intervalMs: raw.imm1, mask: raw.imm2, expected: raw.imm3 });
    case DeviceProfileOpcode.WAIT_GPIO:
      if (raw.imm2 !== 0 && raw.imm2 !== 1) {
        return err(invalidOperand(String(raw.imm2), "WAIT_GPIO expectedLevel (imm2) must be 0 or 1"));
      }
      return ok({ op: "WAIT_GPIO", dst: raw.dst, attempts: raw.imm0, intervalMs: raw.imm1, expectedLevel: raw.imm2 });
    case DeviceProfileOpcode.SCALE_PACK:
      if (raw.srcB > 7 || raw.imm0 < 1 || raw.imm0 > 8 || raw.imm1 < 1) return err(invalidOperand("SCALE_PACK", "Invalid scale operands"));
      return ok({ op: "SCALE_PACK", src: raw.srcA, dst: raw.dst, flags: raw.srcB, width: raw.imm0, divisor: raw.imm1, multiplier: raw.imm2 | 0, offset: raw.imm3 | 0 });
    case DeviceProfileOpcode.LOAD_VALUE:
    case DeviceProfileOpcode.LOAD_ARGUMENT:
      if (raw.srcA < 1 || raw.srcA > 8 || raw.srcB > 1 || raw.imm0 < 1 || raw.imm0 > 8 || raw.imm1 > 1) return err(invalidOperand("LOAD_ARGUMENT", "Invalid argument packing"));
      return ok({ op: raw.opcode === DeviceProfileOpcode.LOAD_VALUE ? "LOAD_VALUE" : "LOAD_ARGUMENT", dst: raw.dst, argumentId: raw.srcA, required: raw.srcB === 1, length: raw.imm0, littleEndian: raw.imm1 === 1, low: raw.imm2, high: raw.imm3 });
    case DeviceProfileOpcode.LOAD_CONST:
      return ok({ op: "LOAD_CONST", dst: raw.dst, length: raw.imm0, low: raw.imm2, high: raw.imm3 });
    case DeviceProfileOpcode.COPY_BYTES:
      return ok({ op: "COPY_BYTES", src: raw.srcA, dst: raw.dst, length: raw.imm0, ...(raw.imm1 ? { offset: raw.imm1 } : {}) });
    case DeviceProfileOpcode.CONCAT:
      return ok({ op: "CONCAT", srcA: raw.srcA, srcB: raw.srcB, dst: raw.dst });
    case DeviceProfileOpcode.BYTE_SWAP:
      if (raw.imm0 !== 2 && raw.imm0 !== 4) {
        return err(invalidOperand(String(raw.imm0), "BYTE_SWAP width (imm0) must be 2 or 4"));
      }
      return ok({ op: "BYTE_SWAP", src: raw.srcA, dst: raw.dst, width: raw.imm0 });
    case DeviceProfileOpcode.MASK:
      return ok({ op: "MASK", src: raw.srcA, dst: raw.dst, mask: raw.imm2 });
    case DeviceProfileOpcode.SHIFT:
      return ok({ op: "SHIFT", src: raw.srcA, dst: raw.dst, amount: raw.imm0, direction: raw.imm1 === LEFT ? "left" : "right" });
    case DeviceProfileOpcode.SIGN_EXTEND:
      return ok({ op: "SIGN_EXTEND", src: raw.srcA, dst: raw.dst, bits: raw.imm0 });
    case DeviceProfileOpcode.CRC8:
      return ok({ op: "CRC8", src: raw.srcA, dst: raw.dst });
    case DeviceProfileOpcode.CRC16:
      return ok({ op: "CRC16", src: raw.srcA, dst: raw.dst });
    case DeviceProfileOpcode.EMIT_FIELD:
      return ok({ op: "EMIT_FIELD", src: raw.srcA, fieldId: raw.dst, ...(raw.imm0 ? { width: raw.imm0, byteOrder: raw.imm1 ? "be" as const : "le" as const, signExtend: raw.imm2 !== 0, multiplier: raw.imm3 } : {}) });
    case DeviceProfileOpcode.EMIT_RECORD:
      return ok({ op: "EMIT_RECORD" });
    default:
      return err(domainError({ code: DeviceProfileErrorCode.UNKNOWN_OPCODE, path: ["device-profile", "raw-op"], target: String(raw.opcode), remediation: `opcode ${raw.opcode} is not in this package's known vocabulary` }));
  }
}
