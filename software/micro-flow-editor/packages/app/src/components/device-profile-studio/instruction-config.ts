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
  { label: "PWM", ops: ["PWM_SET"] },
  { label: "Transazione I2C", ops: ["I2C_WRITE", "I2C_READ", "I2C_WRITE_READ"] },
  { label: "Transazione SPI", ops: ["SPI_TRANSCEIVE"] },
  { label: "Transazione UART", ops: ["UART_WRITE", "UART_READ_UNTIL", "UART_READ"] },
  { label: "Transazione 1-Wire", ops: ["W1_WRITE_READ"] },
  { label: "GPIO", ops: ["GPIO_GET", "GPIO_SET", "GPIO_SET_VALUE", "GPIO_PULSE"] },
  { label: "ADC", ops: ["ADC_READ"] },
  { label: "Letture con tempi precisi", ops: ["DS18B20_SETUP", "DS18B20_READ", "DHT22_POWER", "DHT22_READ"] },
  { label: "Colore e movimento", ops: ["RGB_PROGRAM", "STEPPER"] },
  { label: "Messaggi", ops: ["MESSAGE_LOAD", "MESSAGE_PATCH", "I2C_MESSAGE_WRITE"] },
  { label: "Attese", ops: ["DELAY_BOUNDED", "WAIT_FIELD_MASK", "WAIT_GPIO"] },
  {
    label: "Dati e variabili",
    ops: [
      "LOAD_CONST",
      "LOAD_ARGUMENT",
      "LOAD_VALUE",
      "SCALE_PACK",
      "COPY_BYTES",
      "CONCAT",
      "BYTE_SWAP",
    ],
  },
  { label: "Bit e segno", ops: ["MASK", "SHIFT", "SIGN_EXTEND"] },
  { label: "CRC", ops: ["CRC8", "CRC16"] },
  { label: "Uscite", ops: ["EMIT_FIELD", "EMIT_DECIMAL", "EMIT_RECORD"] },
];

export const OP_LABEL: Record<Instruction["op"], string> = {
  PWM_SET: "Imposta intensità PWM",
  EMIT_DECIMAL: "Pubblica temperatura in gradi",
  DS18B20_SETUP: "Inizializza DS18B20",
  DS18B20_READ: "Leggi DS18B20",
  DHT22_POWER: "Alimentazione DHT",
  DHT22_READ: "Leggi DHT22",
  RGB_PROGRAM: "Programma LED RGB",
  MESSAGE_LOAD: "Carica messaggio",
  MESSAGE_PATCH: "Aggiorna messaggio",
  I2C_MESSAGE_WRITE: "Invia messaggio I²C",
  I2C_WRITE: "Scrivi I²C",
  I2C_READ: "Leggi I²C",
  I2C_WRITE_READ: "Scrivi e leggi I²C",
  SPI_TRANSCEIVE: "Trasferisci SPI",
  UART_WRITE: "Invia UART",
  UART_READ_UNTIL: "Leggi UART fino al terminatore",
  UART_READ: "Leggi UART",
  W1_WRITE_READ: "Scrivi e leggi 1-Wire",
  GPIO_GET: "Leggi ingresso",
  GPIO_SET: "Imposta Alto / Basso",
  GPIO_SET_VALUE: "GPIO da variabile",
  GPIO_PULSE: "Impulso GPIO",
  STEPPER: "Motore ULN2003",
  ADC_READ: "Leggi analogico",
  DELAY_BOUNDED: "Attendi",
  WAIT_FIELD_MASK: "Attendi valore",
  WAIT_GPIO: "Attendi ingresso",
  LOAD_CONST: "Carica valore costante",
  LOAD_VALUE: "Variabile del sensore",
  LOAD_ARGUMENT: "Parametro azione",
  SCALE_PACK: "Scala e codifica",
  COPY_BYTES: "Estrai byte",
  CONCAT: "Unisci byte",
  BYTE_SWAP: "Inverti ordine byte",
  MASK: "Applica maschera",
  SHIFT: "Sposta bit",
  SIGN_EXTEND: "Interpreta segno",
  CRC8: "CRC8",
  CRC16: "CRC16",
  EMIT_FIELD: "Prepara uscita",
  EMIT_RECORD: "Pubblica uscite",
};

const FIELDS: Record<Instruction["op"], readonly FieldSpec[]> = {
  PWM_SET: [{key:"src",label:"Valore intensità (0–10000)",kind:"tempSlot"},{key:"channel",label:"Canale segnale",kind:"number"},{key:"frequencyHz",label:"Frequenza Hz (0 = configurata)",kind:"number"}],
  DS18B20_SETUP: [{ key: "channel", label: "Canale DATA", kind: "number" }, { key: "on", label: "Attivo", kind: "boolean" }],
  DS18B20_READ: [{ key: "channel", label: "Canale DATA", kind: "number" }, { key: "dst", label: "Temperatura", kind: "tempSlot" }],
  EMIT_DECIMAL: [{ key: "src", label: "Sorgente", kind: "tempSlot" }, { key: "fieldId", label: "Uscita", kind: "number" }, { key: "text", label: "Testo con unità", kind: "boolean" }],
  DHT22_POWER: [{ key: "dataChannel", label: "Canale DATA", kind: "number" }, { key: "powerChannel", label: "Canale alimentazione", kind: "number" }, { key: "on", label: "Acceso", kind: "boolean" }],
  DHT22_READ: [{ key: "dataChannel", label: "Canale DATA", kind: "number" }, { key: "powerChannel", label: "Canale alimentazione", kind: "number" }, { key: "dst", label: "Temperatura", kind: "tempSlot" }, { key: "humidityDst", label: "Umidità", kind: "tempSlot" }],
  RGB_PROGRAM: [{ key: "offset", label: "Offset", kind: "number" }, { key: "length", label: "Byte", kind: "number" }, { key: "channels", label: "Canali RGB", kind: "number" }, { key: "inverted", label: "Anodo comune", kind: "boolean" }],
  STEPPER: [
    { key: "command", label: "Comando (0 Stop, 1 Start, 2 Posizione)", kind: "number" },
    { key: "channels", label: "Mappa IN1–IN4", kind: "number" },
    { key: "intervalMs", label: "Intervallo passo (ms)", kind: "number" },
    { key: "stepsPerRevolution", label: "Mezzi passi per giro", kind: "number" },
    { key: "src", label: "Posizione (temp)", kind: "tempSlot" },
  ],
  GPIO_PULSE: [
    { key: "channel", label: "Canale", kind: "number" },
    { key: "milliseconds", label: "Durata (ms)", kind: "number" },
    { key: "activeHigh", label: "Livello attivo HIGH", kind: "boolean" },
    { key: "restoreHigh", label: "Ripristino HIGH", kind: "boolean" },
  ],
  GPIO_SET_VALUE: [
    { key: "src", label: "Sorgente", kind: "tempSlot" },
    { key: "channel", label: "Canale", kind: "number" },
    { key: "invert", label: "Inverti", kind: "boolean" },
  ],
  MESSAGE_LOAD: [
    { key: "offset", label: "Offset", kind: "number" },
    { key: "length", label: "Byte", kind: "number" },
  ],
  MESSAGE_PATCH: [
    { key: "src", label: "Sorgente", kind: "tempSlot" },
    { key: "offset", label: "Offset", kind: "number" },
    { key: "length", label: "Byte", kind: "number" },
  ],
  I2C_MESSAGE_WRITE: [
    { key: "length", label: "Byte", kind: "number" },
    { key: "timeoutMs", label: "Timeout (ms)", kind: "number" },
  ],
  SCALE_PACK: [
    { key: "src", label: "Sorgente", kind: "tempSlot" },
    { key: "dst", label: "Destinazione", kind: "tempSlot" },
    { key: "flags", label: "Endian / segno", kind: "number" },
    { key: "width", label: "Byte", kind: "number" },
    { key: "divisor", label: "Divisore", kind: "number" },
    { key: "multiplier", label: "Moltiplicatore", kind: "number" },
    { key: "offset", label: "Offset", kind: "number" },
  ],
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
  GPIO_GET: [{key:"channel",label:"Segnale",kind:"number"}, { key: "dst", label: "dst (temp slot)", kind: "tempSlot" }],
  GPIO_SET: [{key:"channel",label:"Segnale",kind:"number"}, { key: "value", label: "valore", kind: "boolean" }],
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
  LOAD_VALUE: [
    { key: "dst", label: "Destinazione", kind: "tempSlot" },
    { key: "argumentId", label: "ID variabile", kind: "number" },
    { key: "length", label: "Byte", kind: "number" },
    { key: "littleEndian", label: "Little endian", kind: "boolean" },
    { key: "required", label: "Obbligatorio", kind: "boolean" },
    { key: "low", label: "Default low", kind: "number" },
    { key: "high", label: "Default high", kind: "number" },
  ],
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
    case "PWM_SET": return {op,src:0,channel:0,frequencyHz:0};
    case "DS18B20_SETUP": return { op, channel: 0, on: true };
    case "DS18B20_READ": return { op, channel: 0, dst: 0 };
    case "EMIT_DECIMAL": return { op, src: 0, fieldId: 1, text: false };
    case "DHT22_POWER": return { op, dataChannel: 0, powerChannel: 1, on: true };
    case "DHT22_READ": return { op, dataChannel: 0, powerChannel: 1, dst: 0, humidityDst: 1 };
    case "RGB_PROGRAM": return { op, offset: 0, length: 6, channels: 36, inverted: false };
    case "STEPPER":
      return {
        op: "STEPPER",
        command: 0,
        channels: 228,
        intervalMs: 3,
        stepsPerRevolution: 4096,
        src: 0,
      };
    case "GPIO_PULSE":
      return {
        op,
        channel: 0,
        milliseconds: 100,
        activeHigh: true,
        restoreHigh: false,
      };
    case "MESSAGE_LOAD":
      return { op, offset: 0, length: 1 };
    case "MESSAGE_PATCH":
      return { op, src: 0, offset: 0, length: 1 };
    case "I2C_MESSAGE_WRITE":
      return { op, length: 1, timeoutMs: 100 };
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
    case "GPIO_SET_VALUE":
      return { op, src: 0, channel: 0 };
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
      return {
        op,
        src: 0,
        dst: 1,
        flags: 0,
        width: 1,
        divisor: 1,
        multiplier: 1,
        offset: 0,
      };
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
