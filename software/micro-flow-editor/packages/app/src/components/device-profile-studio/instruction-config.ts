import type { Instruction } from "@spaghettilab/device-profile-authoring-model";

/**
 * `ux/screens/S060-device-profile-studio/visual.md` § Selettore tipo step groups
 * the 25 real opcodes (`@spaghettilab/device-profile-authoring-model`'s
 * `Instruction` union) into 10 categories — "Transazione I2C" covers
 * `I2C_WRITE`/`I2C_READ`/`I2C_WRITE_READ`, etc. Field descriptors here are
 * hand-mapped from `instruction.ts`'s own field list per opcode — no schema
 * introspection exists to derive this generically, so every field name/kind
 * pair is verified against that file directly, not guessed.
 */
export type FieldKind = "tempSlot" | "number" | "boolean" | "direction" | "width24";

export type FieldSpec = {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
};

export type StepCategory = {
  readonly label: string;
  readonly ops: readonly Instruction["op"][];
};

export const STEP_CATEGORIES: readonly StepCategory[] = [
  { label: "Transazione I2C", ops: ["I2C_WRITE", "I2C_READ", "I2C_WRITE_READ"] },
  { label: "Transazione SPI", ops: ["SPI_TRANSCEIVE"] },
  { label: "Transazione UART", ops: ["UART_WRITE", "UART_READ_UNTIL", "UART_READ"] },
  { label: "Transazione 1-Wire", ops: ["W1_WRITE_READ"] },
  { label: "GPIO", ops: ["GPIO_GET", "GPIO_SET"] },
  { label: "ADC", ops: ["ADC_READ"] },
  { label: "Wait (bounded)", ops: ["DELAY_BOUNDED", "WAIT_FIELD_MASK", "WAIT_GPIO"] },
  {
    label: "Byte operation",
    ops: ["LOAD_CONST", "LOAD_ARGUMENT", "LOAD_VALUE", "SCALE_PACK", "COPY_BYTES", "CONCAT", "BYTE_SWAP"],
  },
  { label: "Mask/Shift/Sign", ops: ["MASK", "SHIFT", "SIGN_EXTEND"] },
  { label: "CRC", ops: ["CRC8", "CRC16"] },
  { label: "Emit", ops: ["EMIT_FIELD", "EMIT_RECORD"] },
];

export const OP_LABEL: Record<Instruction["op"], string> = {
  MESSAGE_LOAD: "Load message", MESSAGE_PATCH: "Patch message", I2C_MESSAGE_WRITE: "I2C message write",
  I2C_WRITE: "I2C write",
  I2C_READ: "I2C read",
  I2C_WRITE_READ: "I2C write-read",
  SPI_TRANSCEIVE: "SPI transceive",
  UART_WRITE: "UART write",
  UART_READ_UNTIL: "UART read-until",
  UART_READ: "UART read",
  W1_WRITE_READ: "1-Wire write-read",
  GPIO_GET: "GPIO get",
  GPIO_SET: "GPIO set",
  ADC_READ: "ADC read",
  DELAY_BOUNDED: "Delay (bounded)",
  WAIT_FIELD_MASK: "Wait field mask",
  WAIT_GPIO: "Wait GPIO",
  LOAD_CONST: "Load const",
  LOAD_VALUE: "Variabile del sensore",
  LOAD_ARGUMENT: "Parametro azione",
  SCALE_PACK: "Scala e codifica",
  COPY_BYTES: "Copy bytes",
  CONCAT: "Concat",
  BYTE_SWAP: "Byte swap",
  MASK: "Mask",
  SHIFT: "Shift",
  SIGN_EXTEND: "Sign extend",
  CRC8: "CRC8",
  CRC16: "CRC16",
  EMIT_FIELD: "Emit field",
  EMIT_RECORD: "Emit record",
};

const FIELDS: Record<Instruction["op"], readonly FieldSpec[]> = {
  MESSAGE_LOAD: [{ key: "offset", label: "Offset", kind: "number" }, { key: "length", label: "Byte", kind: "number" }],
  MESSAGE_PATCH: [{ key: "src", label: "Sorgente", kind: "tempSlot" }, { key: "offset", label: "Offset", kind: "number" }, { key: "length", label: "Byte", kind: "number" }],
  I2C_MESSAGE_WRITE: [{ key: "length", label: "Byte", kind: "number" }, { key: "timeoutMs", label: "Timeout (ms)", kind: "number" }],
  SCALE_PACK: [{ key: "src", label: "Sorgente", kind: "tempSlot" }, { key: "dst", label: "Destinazione", kind: "tempSlot" }, { key: "flags", label: "Endian / segno", kind: "number" }, { key: "width", label: "Byte", kind: "number" }, { key: "divisor", label: "Divisore", kind: "number" }, { key: "multiplier", label: "Moltiplicatore", kind: "number" }, { key: "offset", label: "Offset", kind: "number" }],
  I2C_WRITE: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "length", label: "length", kind: "number" },
    { key: "timeoutMs", label: "timeout (ms)", kind: "number" },
  ],
  I2C_READ: [
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "length", label: "length", kind: "number" },
    { key: "timeoutMs", label: "timeout (ms)", kind: "number" },
  ],
  I2C_WRITE_READ: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "readLength", label: "read length", kind: "number" },
    { key: "writeLength", label: "write length (0 = usa src)", kind: "number" },
    { key: "timeoutMs", label: "timeout (ms)", kind: "number" },
  ],
  SPI_TRANSCEIVE: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "length", label: "length", kind: "number" },
    { key: "timeoutMs", label: "timeout (ms)", kind: "number" },
    { key: "frequencyHz", label: "frequenza (Hz)", kind: "number" },
    { key: "mode", label: "SPI mode (0-3)", kind: "number" },
  ],
  UART_WRITE: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "length", label: "length (0 = usa src)", kind: "number" },
    { key: "timeoutMs", label: "timeout (ms)", kind: "number" },
  ],
  UART_READ_UNTIL: [
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "maxLength", label: "max length", kind: "number" },
    { key: "timeoutMs", label: "timeout (ms)", kind: "number" },
    { key: "stopByte", label: "stop byte", kind: "number" },
  ],
  UART_READ: [
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "length", label: "length", kind: "number" },
    { key: "timeoutMs", label: "timeout (ms)", kind: "number" },
  ],
  W1_WRITE_READ: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "readLength", label: "read length", kind: "number" },
    { key: "writeLength", label: "write length (0 = usa src)", kind: "number" },
    { key: "timeoutMs", label: "timeout (ms)", kind: "number" },
  ],
  GPIO_GET: [{ key: "dst", label: "dst (temp slot)", kind: "tempSlot" }],
  GPIO_SET: [{ key: "value", label: "valore", kind: "boolean" }],
  ADC_READ: [
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "timeoutMs", label: "timeout (ms)", kind: "number" },
  ],
  DELAY_BOUNDED: [{ key: "milliseconds", label: "durata (ms)", kind: "number" }],
  WAIT_FIELD_MASK: [
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "mask", label: "mask", kind: "number" },
    { key: "expected", label: "expected", kind: "number" },
    { key: "attempts", label: "tentativi (>0)", kind: "number" },
    { key: "intervalMs", label: "intervallo (ms)", kind: "number" },
  ],
  WAIT_GPIO: [
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "attempts", label: "tentativi (>0)", kind: "number" },
    { key: "intervalMs", label: "intervallo (ms)", kind: "number" },
    { key: "expectedLevel", label: "livello atteso (0/1)", kind: "number" },
  ],
  LOAD_CONST: [
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "length", label: "byte (1-8)", kind: "number" },
    { key: "low", label: "low", kind: "number" },
    { key: "high", label: "high", kind: "number" },
  ],
  LOAD_VALUE: [{ key: "dst", label: "Destinazione", kind: "tempSlot" }, { key: "argumentId", label: "ID variabile", kind: "number" }, { key: "length", label: "Byte", kind: "number" }, { key: "littleEndian", label: "Little endian", kind: "boolean" }, { key: "required", label: "Obbligatorio", kind: "boolean" }, { key: "low", label: "Default low", kind: "number" }, { key: "high", label: "Default high", kind: "number" }],
  LOAD_ARGUMENT: [
    { key: "dst", label: "Destinazione", kind: "tempSlot" },
    { key: "argumentId", label: "Parametro (1–8)", kind: "number" },
    { key: "length", label: "Byte (1–8)", kind: "number" },
    { key: "littleEndian", label: "Little endian", kind: "boolean" },
    { key: "required", label: "Obbligatorio", kind: "boolean" },
    { key: "low", label: "Default low", kind: "number" },
    { key: "high", label: "Default high", kind: "number" },
  ],
  COPY_BYTES: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "length", label: "length (0 = usa src)", kind: "number" },
  ],
  CONCAT: [
    { key: "srcA", label: "srcA (temp slot)", kind: "tempSlot" },
    { key: "srcB", label: "srcB (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
  ],
  BYTE_SWAP: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "width", label: "width (2 o 4)", kind: "width24" },
  ],
  MASK: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "mask", label: "mask", kind: "number" },
  ],
  SHIFT: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "amount", label: "amount", kind: "number" },
    { key: "direction", label: "direzione", kind: "direction" },
  ],
  SIGN_EXTEND: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
    { key: "bits", label: "bits", kind: "number" },
  ],
  CRC8: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
  ],
  CRC16: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "dst", label: "dst (temp slot)", kind: "tempSlot" },
  ],
  EMIT_FIELD: [
    { key: "src", label: "src (temp slot)", kind: "tempSlot" },
    { key: "fieldId", label: "fieldId (da Output)", kind: "number" },
  ],
  EMIT_RECORD: [],
};

export function fieldsFor(op: Instruction["op"]): readonly FieldSpec[] {
  return FIELDS[op];
}

/** A minimal, valid default instance for each opcode — every numeric field starts at a small, real, executable value (never `NaN`/negative where the firmware would reject it). */
export function defaultInstruction(op: Instruction["op"]): Instruction {
  switch (op) {
    case "MESSAGE_LOAD": return { op, offset: 0, length: 1 };
    case "MESSAGE_PATCH": return { op, src: 0, offset: 0, length: 1 };
    case "I2C_MESSAGE_WRITE": return { op, length: 1, timeoutMs: 100 };
    case "I2C_WRITE":
      return { op, src: 0, length: 1, timeoutMs: 20 };
    case "I2C_READ":
      return { op, dst: 0, length: 1, timeoutMs: 20 };
    case "I2C_WRITE_READ":
      return { op, src: 0, dst: 1, readLength: 1, writeLength: 0, timeoutMs: 20 };
    case "SPI_TRANSCEIVE":
      return {
        op,
        src: 0,
        dst: 1,
        length: 1,
        timeoutMs: 20,
        frequencyHz: 1000000,
        mode: 0,
      };
    case "UART_WRITE":
      return { op, src: 0, length: 0, timeoutMs: 20 };
    case "UART_READ_UNTIL":
      return { op, dst: 0, maxLength: 16, timeoutMs: 20, stopByte: 10 };
    case "UART_READ":
      return { op, dst: 0, length: 1, timeoutMs: 20 };
    case "W1_WRITE_READ":
      return { op, src: 0, dst: 1, readLength: 1, writeLength: 0, timeoutMs: 20 };
    case "GPIO_GET":
      return { op, dst: 0 };
    case "GPIO_SET":
      return { op, value: true };
    case "ADC_READ":
      return { op, dst: 0, timeoutMs: 20 };
    case "DELAY_BOUNDED":
      return { op, milliseconds: 10 };
    case "WAIT_FIELD_MASK":
      return {
        op,
        dst: 0,
        src: 0,
        mask: 0xff,
        expected: 0,
        attempts: 5,
        intervalMs: 10,
      };
    case "WAIT_GPIO":
      return { op, dst: 0, attempts: 5, intervalMs: 10, expectedLevel: 1 };
    case "LOAD_CONST":
      return { op, dst: 0, length: 1, low: 0, high: 0 };
    case "SCALE_PACK":
      return { op, src: 0, dst: 1, flags: 0, width: 1, divisor: 1, multiplier: 1, offset: 0 };
    case "LOAD_VALUE":
    case "LOAD_ARGUMENT":
      return {
        op,
        dst: 0,
        argumentId: 1,
        length: 1,
        littleEndian: true,
        required: true,
        low: 0,
        high: 0,
      };
    case "COPY_BYTES":
      return { op, src: 0, dst: 1, length: 0 };
    case "CONCAT":
      return { op, srcA: 0, srcB: 1, dst: 2 };
    case "BYTE_SWAP":
      return { op, src: 0, dst: 1, width: 2 };
    case "MASK":
      return { op, src: 0, dst: 1, mask: 0xff };
    case "SHIFT":
      return { op, src: 0, dst: 1, amount: 1, direction: "left" };
    case "SIGN_EXTEND":
      return { op, src: 0, dst: 1, bits: 8 };
    case "CRC8":
      return { op, src: 0, dst: 1 };
    case "CRC16":
      return { op, src: 0, dst: 1 };
    case "EMIT_FIELD":
      return { op, src: 0, fieldId: 1 };
    case "EMIT_RECORD":
      return { op };
  }
}

/** One-line summary shown on the collapsed step row — `ux/screens/S060-device-profile-studio/visual.md`: "non richiede aprire un dettaglio per capire cosa fa lo step". */
export function summarize(instruction: Instruction): string {
  const fields = fieldsFor(instruction.op);
  const parts = fields.map(
    (f) =>
      `${f.key}=${String((instruction as unknown as Record<string, unknown>)[f.key])}`,
  );
  return `${OP_LABEL[instruction.op]}${parts.length > 0 ? " · " + parts.join(", ") : ""}`;
}
