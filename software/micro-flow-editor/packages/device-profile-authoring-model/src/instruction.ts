/**
 * Typed, ergonomic instructions for authoring an acquisition plan — one
 * variant per opcode in `opcodes.ts`, with named fields instead of raw
 * `imm0`-`imm3` operand slots. `raw-op.ts` compiles each variant down to the
 * exact `spaghetti_device_profile_op` struct layout mechanically (a fixed
 * per-opcode mapping, never an arbitrary formula — S061 point 3).
 *
 * Operand meaning is grounded in the firmware's own **executor and
 * validator** (`firmware/backbone/subsys/device_profiles/device_profile_exec.c`'s
 * `case` blocks and `device_profile.c`'s `accumulate_op_budget`), not just
 * the one-line comments on `enum spaghetti_device_profile_opcode` — an
 * earlier revision of this file was grounded only in those comments and got
 * several operands wrong (e.g. `GPIO_SET` doesn't read a temp slot at all;
 * `UART_READ_UNTIL`'s stop byte is `imm2`, not `imm0`). Fixed after actually
 * reading the exec/validate source (2026-08-13).
 *
 * A `TempSlot` is an index into the firmware's 8 temporary byte slots
 * (`SPAGHETTI_DEVICE_PROFILE_TEMP_SLOTS`); `MAX_TEMP_SLOTS` here mirrors that
 * constant, not an invented editor limit.
 */
export const MAX_TEMP_SLOTS = 8;

export type TempSlot = number;

type Op<Kind extends string> = { readonly op: Kind };

/** `exec_i2c_write`: `imm0` is the byte count to send (must be >0 and <= the temp's actual size), `imm1` the transfer timeout in ms. */
export type I2cWriteInstruction = Op<"I2C_WRITE"> & { readonly src: TempSlot; readonly length: number; readonly timeoutMs: number };
/** `exec_i2c_read`: `imm0` bytes read into `dst`, `imm1` timeout in ms. */
export type I2cReadInstruction = Op<"I2C_READ"> & { readonly dst: TempSlot; readonly length: number; readonly timeoutMs: number };
/** `exec_i2c_write_read`: `imm0` is the **read** length, `imm1` the **write** length (0 = use `src`'s actual size), `imm2` the timeout in ms — this order is easy to get backwards, and an earlier revision of this file did. */
export type I2cWriteReadInstruction = Op<"I2C_WRITE_READ"> & {
  readonly src: TempSlot;
  readonly dst: TempSlot;
  readonly readLength: number;
  readonly writeLength: number;
  readonly timeoutMs: number;
};
/** `exec_spi`: `imm0` full-duplex byte count, `imm1` timeout ms, `imm2` SPI clock in Hz, `imm3` SPI mode 0..3 (CPOL/CPHA; `0` is Mode 0, the previous hardcoded value). */
export type SpiTransceiveInstruction = Op<"SPI_TRANSCEIVE"> & {
  readonly src: TempSlot;
  readonly dst: TempSlot;
  readonly length: number;
  readonly timeoutMs: number;
  readonly frequencyHz: number;
  readonly mode: 0 | 1 | 2 | 3;
};
/** `spaghetti_port_uart_write`: `imm0` byte count (0 = use `src`'s actual size), `imm1` timeout ms. */
export type UartWriteInstruction = Op<"UART_WRITE"> & { readonly src: TempSlot; readonly length: number; readonly timeoutMs: number };
/** `spaghetti_port_uart_read_until`: `imm0` max byte count, `imm1` timeout ms, `imm2` the stop byte — **not** `imm0`, despite what the opcode's one-line comment alone would suggest. */
export type UartReadUntilInstruction = Op<"UART_READ_UNTIL"> & {
  readonly dst: TempSlot;
  readonly maxLength: number;
  readonly timeoutMs: number;
  readonly stopByte: number;
};
/** `spaghetti_port_uart_read`: `imm0` exact byte count, `imm1` timeout ms — distinct from `UART_READ_UNTIL` (stop byte). */
export type UartReadInstruction = Op<"UART_READ"> & {
  readonly dst: TempSlot;
  readonly length: number;
  readonly timeoutMs: number;
};
export type GpioGetInstruction = Op<"GPIO_GET"> & { readonly dst: TempSlot };
/** `spaghetti_port_set_output(port, imm0 != 0)` — an immediate boolean, never a temp slot read (the firmware doesn't even validate `src_a` for this opcode). */
export type GpioSetInstruction = Op<"GPIO_SET"> & { readonly value: boolean };
/** `imm0` is the ADC read timeout in ms; the channel itself comes from the instance `binding`, not this op. */
export type AdcReadInstruction = Op<"ADC_READ"> & { readonly dst: TempSlot; readonly timeoutMs: number };
export type DelayBoundedInstruction = Op<"DELAY_BOUNDED"> & { readonly milliseconds: number };
/**
 * "Bounded ready poll" — `attempts` (`imm0`) must be > 0 (the firmware
 * itself rejects zero attempts as an unbounded wait, `-EINVAL`); this is the
 * only looping construct the instruction set has. Each attempt performs an
 * I2C read into `dst` (write-then-read via `src` first when `src`'s temp
 * slot is non-empty, plain read otherwise), checks `(value & mask) ==
 * (expected & mask)`, and sleeps `intervalMs` between attempts.
 */
export type WaitFieldMaskInstruction = Op<"WAIT_FIELD_MASK"> & {
  readonly dst: TempSlot;
  readonly src: TempSlot;
  readonly mask: number;
  readonly expected: number;
  readonly attempts: number;
  readonly intervalMs: number;
};
/**
 * Bounded digital-input poll — `attempts` (`imm0`) must be > 0, `intervalMs`
 * (`imm1`) is milliseconds, `expectedLevel` (`imm2`) is 0 or 1. Calls
 * `spaghetti_port_get_input`; the Port must expose `CAP_DIGITAL_INPUT`.
 */
export type WaitGpioInstruction = Op<"WAIT_GPIO"> & {
  readonly dst: TempSlot;
  readonly attempts: number;
  readonly intervalMs: number;
  readonly expectedLevel: 0 | 1;
};
/** `spaghetti_port_w1_write_read`: `imm0` is the **read** length, `imm1` the **write** length (0 = use `src`'s actual size), `imm2` the timeout in ms. The 8-byte ROM is instance binding, not this op. */
export type W1WriteReadInstruction = Op<"W1_WRITE_READ"> & {
  readonly src: TempSlot;
  readonly dst: TempSlot;
  readonly readLength: number;
  readonly writeLength: number;
  readonly timeoutMs: number;
};
/** `imm0` is the byte count actually copied (1-8) from `low`/`high` (`imm2`/`imm3`, little-endian). */
export type LoadConstInstruction = Op<"LOAD_CONST"> & { readonly dst: TempSlot; readonly length: number; readonly low: number; readonly high: number };
/** `imm0` byte count to copy (0 = use `src`'s actual size). */
export type CopyBytesInstruction = Op<"COPY_BYTES"> & { readonly src: TempSlot; readonly dst: TempSlot; readonly length: number };
export type ConcatInstruction = Op<"CONCAT"> & { readonly srcA: TempSlot; readonly srcB: TempSlot; readonly dst: TempSlot };
export type ByteSwapInstruction = Op<"BYTE_SWAP"> & { readonly src: TempSlot; readonly dst: TempSlot; readonly width: 2 | 4 };
export type MaskInstruction = Op<"MASK"> & { readonly src: TempSlot; readonly dst: TempSlot; readonly mask: number };
/** `imm1 === 0` shifts left, any other value shifts right — matches `device_profile_exec.c` exactly (`if (op->imm1 == 0U) value <<= op->imm0; else value >>= op->imm0;`). */
export type ShiftInstruction = Op<"SHIFT"> & { readonly src: TempSlot; readonly dst: TempSlot; readonly amount: number; readonly direction: "left" | "right" };
export type SignExtendInstruction = Op<"SIGN_EXTEND"> & { readonly src: TempSlot; readonly dst: TempSlot; readonly bits: number };
export type Crc8Instruction = Op<"CRC8"> & { readonly src: TempSlot; readonly dst: TempSlot };
export type Crc16Instruction = Op<"CRC16"> & { readonly src: TempSlot; readonly dst: TempSlot };
/** `fieldId` must match a `SampleField.fieldId` declared on the owning `DeviceProfileDraft` — checked by `validate-profile.ts`, never assumed. */
export type EmitFieldInstruction = Op<"EMIT_FIELD"> & { readonly src: TempSlot; readonly fieldId: number };
export type EmitRecordInstruction = Op<"EMIT_RECORD">;

export type Instruction =
  | I2cWriteInstruction
  | I2cReadInstruction
  | I2cWriteReadInstruction
  | SpiTransceiveInstruction
  | UartWriteInstruction
  | UartReadUntilInstruction
  | UartReadInstruction
  | GpioGetInstruction
  | GpioSetInstruction
  | AdcReadInstruction
  | DelayBoundedInstruction
  | WaitFieldMaskInstruction
  | WaitGpioInstruction
  | W1WriteReadInstruction
  | LoadConstInstruction
  | CopyBytesInstruction
  | ConcatInstruction
  | ByteSwapInstruction
  | MaskInstruction
  | ShiftInstruction
  | SignExtendInstruction
  | Crc8Instruction
  | Crc16Instruction
  | EmitFieldInstruction
  | EmitRecordInstruction;
