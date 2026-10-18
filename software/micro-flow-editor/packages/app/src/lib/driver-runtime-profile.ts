import { compileRgbRuntime } from "./rgb-runtime.js";
import { MOVEMENT_COMPLETED_FIELD } from "./flow-sequence.js";
import {
  gpioSignalType,
  gpioWriteLogicalLevel,
  physicalLevelForSignal,
} from "./gpio-operation-registry.js";
import { appendLongI2cMessage } from "./i2c-long-message.js";
import {
  PortCapability,
  PortTransport,
  validateDeviceProfile,
  type DeviceProfileDraft,
  type Instruction,
} from "@spaghettilab/device-profile-authoring-model";
import {
  parseVarRef,
  waitDurationMs,
  type DeviceRecipeDraft,
  effectiveActionSteps,
  type DeviceRecipeOp,
} from "./device-recipe-draft.js";
import { parseI2cMessage } from "./i2c-message-input.js";
import { parseHexByteToken } from "./i2c-hex.js";

export type RuntimeAction = {
  commandId: number;
  inputIds: Readonly<Record<string, number>>;
  outputIds: Readonly<Record<string, number>>;
};
export type RuntimeDriver = {
  profile: DeviceProfileDraft;
  actions: ReadonlyMap<string, RuntimeAction>;
};
type Value = {
  slot?: number;
  width: number;
  byteOrder: "be" | "le";
  signed: boolean;
  argument?: number;
  cachedField?: number;
  required?: boolean;
  defaultValue?: bigint;
  multiply?: number;
  divide?: number;
  offset?: number;
  decimalFormat?: "float" | "string";
};
export function stableDriverHash(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, "0");
}
function constant(dst: number, bytes: readonly number[]): Instruction {
  if (!bytes.length || bytes.length > 8)
    throw new Error("Ogni buffer deve contenere da 1 a 8 byte.");
  let packed = 0n;
  bytes.forEach((byte, i) => {
    packed |= BigInt(byte) << BigInt(i * 8);
  });
  return {
    op: "LOAD_CONST",
    dst,
    length: bytes.length,
    low: Number(packed & 0xffffffffn),
    high: Number(packed >> 32n),
  };
}
function bytesOf(value: bigint, width: number): number[] {
  return Array.from({ length: width }, (_, i) =>
    Number((value >> BigInt(i * 8)) & 255n),
  );
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label}: serve un intero tra ${min} e ${max}.`);
  return value;
}
/** Production compilation: no ignored steps, no truncated payloads, no modulo slot reuse. */
export function compileRuntimeDriver(
  draft: DeviceRecipeDraft,
  connectedInputs: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  gpioChannels: ReadonlyMap<string, number> = new Map(),
  scheduledActionId?: string,
): RuntimeDriver {
  if (draft.rgbModule) return compileRgbRuntime(draft, gpioChannels);
  if (draft.binding.bus !== "i2c" && draft.binding.bus !== "gpio")
    throw new Error(`${draft.name}: il driver richiede I²C o GPIO digitale.`);
  const gpioSignal = (id: string, write = false) => {
    if (draft.binding.bus !== "gpio")
      throw new Error("Un passo GPIO richiede un driver GPIO.");
    const signal = draft.binding.gpioSignals.find((signal) => signal.id === id);
    if (
      !signal ||
      !["digital_input", "digital_output"].includes(gpioSignalType(signal))
    )
      throw new Error("Seleziona un segnale digitale esistente.");
    if (write && gpioSignalType(signal) !== "digital_output")
      throw new Error(`«${signal.name}» è un ingresso: non può essere scritto.`);
    const channel =
      gpioChannels.get(id) ?? (draft.binding.gpioSignals.length === 1 ? 0 : undefined);
    if (channel === undefined)
      throw new Error(`Assegna «${signal.name}» nel Module Function.`);
    return { signal, channel: integer(channel, "Canale GPIO", 0, 3) };
  };
  const commands = draft.commands
    .map((command) => ({ ...command, steps: effectiveActionSteps(draft, command) }))
    .sort((a, b) =>
      a.id === scheduledActionId
        ? -1
        : b.id === scheduledActionId
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
    );
  if (!commands.length || commands.length > 8)
    throw new Error(`${draft.name}: sono ammesse da 1 a 8 azioni.`);
  const emitted = [
    ...new Set(
      commands.flatMap((c) =>
        c.steps.flatMap((op) => (op.type === "emit" ? [op.channelId] : [])),
      ),
    ),
  ].sort();
  if (emitted.length > 8)
    throw new Error(`${draft.name}: sono ammesse al massimo 8 uscite nel profilo.`);
  const fields = new Map(emitted.map((id, i) => [id, i + 1]));
  const publishedVariables = new Map<string, Set<number>>();
  commands.forEach((command) =>
    command.steps.forEach((op) => {
      if (op.type === "emit") {
        const name = parseVarRef(op.from) ?? op.from;
        const ids = publishedVariables.get(name) ?? new Set<number>();
        ids.add(fields.get(op.channelId)!);
        publishedVariables.set(name, ids);
      }
    }),
  );
  const fieldTypes = new Map<string, "int64" | "uint64" | "float" | "text">();
  const actions = new Map<string, RuntimeAction>();
  const initOps: Instruction[] = [],
    sampleOps: Instruction[] = [];
  const messageData: number[] = [];
  const slices: { id: number; first: number; count: number }[] = [];

  function sequence(
    steps: readonly DeviceRecipeOp[],
    target: Instruction[],
    inputIds: Readonly<Record<string, number>>,
    required: ReadonlySet<string>,
    isInit: boolean,
  ) {
    const sequenceStart = target.length;
    let used = new Set<number>();
    const values = new Map<string, Value>();
    const take = () => {
      for (let slot = 0; slot < 8; slot++)
        if (!used.has(slot)) {
          used.add(slot);
          return slot;
        }
      throw new Error(
        "La sequenza usa più di 8 buffer temporanei: dividila in azioni più piccole.",
      );
    };
    const get = (name: string): Value => {
      const key = parseVarRef(name) ?? name;
      const existing = values.get(key);
      if (existing) return existing;
      const variable = draft.variables.find((v) => v.name === key);
      const cached = publishedVariables.get(key);
      if (!cached && variable?.valueType === "hex") {
        const parsed = parseI2cMessage(String(variable.defaultValue ?? "00"));
        if (
          parsed.error ||
          parsed.tokens.length > 8 ||
          parsed.tokens.some((token) => token.startsWith("$"))
        )
          throw new Error(`Variabile HEX «${key}»: specifica da 1 a 8 byte costanti.`);
        const value: Value = {
          width: parsed.tokens.length,
          byteOrder: "be",
          signed: false,
          defaultValue: BigInt(
            `0x${parsed.tokens.map((token) => token.replace(/^0x/i, "")).join("")}`,
          ),
        };
        values.set(key, value);
        return value;
      }

      if (!cached && (!variable || !["number", "bool"].includes(variable.valueType)))
        throw new Error(`Variabile «${key}» non definita prima dell’uso.`);
      const defaultValue =
        typeof variable?.defaultValue === "boolean"
          ? BigInt(variable.defaultValue ? 1 : 0)
          : BigInt(
              integer(
                variable?.valueType === "bool"
                  ? variable.defaultValue === "true" || variable.defaultValue === "1"
                    ? 1
                    : 0
                  : Number(variable?.defaultValue ?? 0),
                key,
                Number.MIN_SAFE_INTEGER,
                Number.MAX_SAFE_INTEGER,
              ),
            );
      if (cached && cached.size > 1)
        throw new Error(
          `La variabile «${key}» è prodotta da più blocchi: usa un collegamento esplicito.`,
        );
      const producer = commands
        .flatMap((command) => command.steps)
        .find((op) => op.type === "decode" && op.into === key);
      const signed =
        producer?.type === "decode"
          ? producer.signed ||
            (producer.multiply ?? 1) < 0 ||
            (producer.offset ?? 0) < 0
          : true;
      const value: Value = {
        width: draft.binding.bus === "gpio" && variable?.valueType === "number" ? 8 : 1,
        byteOrder: "le",
        signed,
        defaultValue,
        ...(cached ? { cachedField: [...cached][0] } : {}),
      };
      values.set(key, value);
      return value;
    };
    const materialize = (value: Value): number => {
      if (value.slot !== undefined) return value.slot;
      const slot = take();
      if (value.argument || value.cachedField)
        target.push({
          op: value.cachedField ? "LOAD_VALUE" : "LOAD_ARGUMENT",
          dst: slot,
          argumentId: (value.cachedField ?? value.argument)!,
          length: value.width,
          littleEndian: value.byteOrder === "le",
          required: value.required ?? false,
          low: Number(
            BigInt.asUintN(value.width * 8, value.defaultValue ?? 0n) & 0xffffffffn,
          ),
          high: Number(
            BigInt.asUintN(value.width * 8, value.defaultValue ?? 0n) >> 32n,
          ),
        });
      else target.push(constant(slot, bytesOf(value.defaultValue ?? 0n, value.width)));
      value.slot = slot;
      return slot;
    };
    const payload = (tokens: readonly string[]): { slot: number; width: number } => {
      let joined: { slot: number; width: number } | undefined;
      const literals: number[] = [];
      const release = (slot: number) => {
        if (![...values.values()].some((value) => value.slot === slot))
          used.delete(slot);
      };
      const append = (part: { slot: number; width: number }) => {
        if ((joined?.width ?? 0) + part.width > 32)
          throw new Error("Una transazione I²C può contenere al massimo 32 byte.");
        if (!joined) {
          joined = part;
          return;
        }
        const dst = take();
        target.push({ op: "CONCAT", srcA: joined.slot, srcB: part.slot, dst });
        release(joined.slot);
        release(part.slot);
        joined = { slot: dst, width: joined.width + part.width };
      };
      const flush = () => {
        while (literals.length) {
          const chunk = literals.splice(0, 8),
            slot = take();
          target.push(constant(slot, chunk));
          append({ slot, width: chunk.length });
        }
      };
      for (const token of tokens) {
        const ref = parseVarRef(token);
        if (ref) {
          flush();
          const value = get(ref);
          append({ slot: materialize(value), width: value.width });
        } else {
          const byte = parseHexByteToken(token);
          if (byte === null) throw new Error(`Byte HEX non valido: ${token}`);
          literals.push(byte);
        }
      }
      flush();
      if (!joined) throw new Error("Inserisci almeno un byte nel messaggio I²C.");
      return joined;
    };
    for (const op of steps) {
      if (op.type.startsWith("i2c_") && draft.binding.bus !== "i2c")
        throw new Error("Un passo I²C richiede un driver I²C.");
      switch (op.type) {
        case "stepper": {
          if (op.signalIds.length !== 4)
            throw new Error("ULN2003 richiede IN1, IN2, IN3 e IN4.");
          const channels = op.signalIds.map((id) => gpioSignal(id, true).channel);
          if (new Set(channels).size !== 4)
            throw new Error("ULN2003 richiede quattro GPIO distinti.");
          let src = 0;
          if (op.command === "position") {
            const value = get(op.positionVariable ?? "posizione");
            src = materialize(value);
            if (
              value.byteOrder === "be" ||
              value.multiply !== undefined ||
              value.offset !== undefined ||
              value.divide !== undefined
            ) {
              const dst = take();
              target.push({
                op: "SCALE_PACK",
                src,
                dst,
                flags: (value.byteOrder === "be" ? 1 : 0) | (value.signed ? 2 : 0),
                width: 8,
                divisor: integer(value.divide ?? 1, "Divisore posizione", 1, 65535),
                multiplier: integer(
                  value.multiply ?? 1,
                  "Scala posizione",
                  -2147483648,
                  2147483647,
                ),
                offset: integer(
                  value.offset ?? 0,
                  "Offset posizione",
                  -2147483648,
                  2147483647,
                ),
              });
              src = dst;
            }
          }
          target.push({
            op: "STEPPER",
            command: op.command === "start" ? 1 : op.command === "stop" ? 0 : 2,
            channels: channels.reduce(
              (packed, channel, index) => packed | (channel << (2 * index)),
              0,
            ),
            intervalMs: integer(op.intervalMs, "Intervallo passo", 2, 100),
            stepsPerRevolution: integer(
              op.stepsPerRevolution,
              "Passi per giro",
              8,
              16384,
            ),
            src,
          });
          break;
        }
        case "gpio_pulse": {
          const { signal, channel } = gpioSignal(op.signalId, true);
          if (op.durationMs.kind !== "fixed")
            throw new Error("L’impulso richiede una durata costante.");
          target.push({
            op: "GPIO_PULSE",
            channel,
            milliseconds: integer(
              Number(op.durationMs.value),
              "Durata impulso",
              1,
              60000,
            ),
            activeHigh: physicalLevelForSignal(signal, op.activeState) === 1,
            restoreHigh: physicalLevelForSignal(signal, op.restoreState) === 1,
          });
          break;
        }
        case "dht22_convert": {
          values.set(op.into, { ...get(op.input), decimalFormat: op.format });
          break;
        }
        case "dht22_power": {
          const data = gpioSignal("DATA").channel;
          const power = gpioSignal("POWER", true).channel;
          if (data === power) throw new Error("DATA e alimentazione richiedono pin distinti.");
          target.push({ op: "DHT22_POWER", dataChannel: data, powerChannel: power, on: op.on });
          break;
        }
        case "dht22_read": {
          const data = gpioSignal("DATA").channel;
          const power = gpioSignal("POWER", true).channel;
          if (data === power) throw new Error("DATA e alimentazione richiedono pin distinti.");
          const temperature = take(), humidity = take();
          target.push({ op: "DHT22_READ", dst: temperature, humidityDst: humidity, dataChannel: data, powerChannel: power, ...(draft.dht22Version ? { queued: true } : {}) });
          values.set(op.temperatureInto, { slot: temperature, width: 2, byteOrder: "le", signed: true });
          values.set(op.humidityInto, { slot: humidity, width: 2, byteOrder: "le", signed: false });
          break;
        }
        case "gpio_read": {
          const { signal, channel } = gpioSignal(op.signalId);
          const slot = take();
          target.push({ op: "GPIO_GET", dst: slot, channel });
          values.set(op.into, {
            slot,
            width: 1,
            byteOrder: "le",
            signed: false,
            ...(signal.activeLow ? { multiply: -1, offset: 1 } : {}),
          });
          break;
        }
        case "gpio_write": {
          const { signal, channel } = gpioSignal(op.signalId, true);
          const logical = gpioWriteLogicalLevel(op);
          if (logical !== undefined) {
            target.push({
              op: "GPIO_SET",
              channel,
              value: physicalLevelForSignal(signal, logical) === 1,
            });
          } else if (op.value?.kind === "variable") {
            const value = get(op.value.name);
            let src = materialize(value);
            if (
              (value.byteOrder === "be" && value.width > 1) ||
              value.multiply !== undefined ||
              value.offset !== undefined ||
              value.divide !== undefined
            ) {
              const dst = take();
              target.push({
                op: "SCALE_PACK",
                src,
                dst,
                flags: (value.byteOrder === "be" ? 1 : 0) | (value.signed ? 2 : 0),
                width: 8,
                divisor: integer(value.divide ?? 1, "Divisore digitale", 1, 65535),
                multiplier: integer(
                  value.multiply ?? 1,
                  "Moltiplicatore digitale",
                  -2147483648,
                  2147483647,
                ),
                offset: integer(
                  value.offset ?? 0,
                  "Offset digitale",
                  -2147483648,
                  2147483647,
                ),
              });
              src = dst;
            }
            // The native instruction checks every byte: invalid values never change the pin.
            target.push({
              op: "GPIO_SET_VALUE",
              src,
              channel,
              invert: Boolean(signal.activeLow) !== Boolean(op.invert),
            });
          } else
            throw new Error(
              "Per il livello GPIO scegli Alto, Basso o una variabile digitale.",
            );
          break;
        }
        case "sample_external": {
          if (op.inputMode === "trigger") break;
          if (isInit)
            throw new Error(
              "Gli ingressi Flow vanno letti nelle azioni, non all’avvio.",
            );
          const variable = draft.variables.find((v) => v.name === op.into);
          const original = variable?.defaultValue ?? 0;
          const raw =
            op.valueType === "hex" && typeof original === "string"
              ? Number.parseInt(original.replace(/^0x/i, "").replace(/\s/g, ""), 16) ||
                0
              : original;
          if (op.valueType === "string")
            throw new Error(
              "Gli ingressi del runtime accettano numeri, booleani o byte HEX; prepara il valore nel canvas.",
            );
          values.set(op.into, {
            argument: inputIds[op.fromChannelId],
            required: required.has(op.fromChannelId),
            defaultValue: BigInt(
              typeof raw === "boolean"
                ? Number(raw)
                : integer(
                    op.valueType === "bool"
                      ? raw === "true" || raw === "1"
                        ? 1
                        : 0
                      : Number(raw),
                    "Valore iniziale",
                    Number.MIN_SAFE_INTEGER,
                    Number.MAX_SAFE_INTEGER,
                  ),
            ),
            width: integer(op.widthBytes ?? 8, "Byte ingresso", 1, 8),
            byteOrder: op.byteOrder ?? "le",
            signed: op.valueType !== "hex",
          });
          break;
        }
        case "encode": {
          if (op.toType === "string" || op.fromType === "string")
            throw new Error(
              "La codifica di stringhe non è supportata dal runtime I²C.",
            );
          const source = get(op.input);
          const multiply = integer(
            op.multiply ?? 1,
            "Moltiplicatore encoder",
            -2147483648,
            2147483647,
          );
          const divide = integer(op.divide ?? 1, "Divisore encoder", 1, 65535);
          const offset = integer(
            op.offset ?? 0,
            "Offset encoder",
            -2147483648,
            2147483647,
          );
          const width =
            op.toType === "hex" ? integer(op.widthBytes, "Byte encoder", 1, 8) : 8;
          if (
            (source.argument || source.cachedField) &&
            multiply === 1 &&
            divide === 1 &&
            offset === 0
          ) {
            values.set(op.into, {
              ...source,
              slot: undefined,
              width,
              byteOrder: op.toType === "hex" ? op.byteOrder : "le",
            });
          } else {
            const src = materialize(source),
              dst = take();
            target.push({
              op: "SCALE_PACK",
              src,
              dst,
              flags:
                (source.byteOrder === "be" ? 1 : 0) |
                (source.signed ? 2 : 0) |
                (op.toType === "hex" && op.byteOrder === "be" ? 4 : 0),
              width,
              divisor: divide,
              multiplier: multiply,
              offset,
            });
            values.set(op.into, {
              slot: dst,
              width,
              byteOrder: op.toType === "hex" ? op.byteOrder : "le",
              signed: true,
            });
          }
          break;
        }
        case "i2c_write": {
          if (
            appendLongI2cMessage(
              op.bytes,
              messageData,
              target,
              (name) => {
                const value = get(name);
                return { width: value.width, materialize: () => materialize(value) };
              },
              op.timeoutMs,
            )
          )
            break;
          const bytes = payload(op.bytes);
          target.push({
            op: "I2C_WRITE",
            src: bytes.slot,
            length: bytes.width,
            timeoutMs: op.timeoutMs ?? 20,
          });
          break;
        }
        case "i2c_read": {
          const dst = take();
          const width = integer(op.len, "Byte da leggere", 1, 8);
          target.push({
            op: "I2C_READ",
            dst,
            length: width,
            timeoutMs: op.timeoutMs ?? 20,
          });
          values.set(op.into, { slot: dst, width, byteOrder: "be", signed: false });
          break;
        }
        case "i2c_write_read": {
          const bytes = payload(op.writeBytes),
            dst = take();
          const width = integer(op.readLen, "Byte da leggere", 1, 8);
          target.push({
            op: "I2C_WRITE_READ",
            src: bytes.slot,
            dst,
            readLength: width,
            writeLength: bytes.width,
            timeoutMs: op.timeoutMs ?? 20,
          });
          values.set(op.into, { slot: dst, width, byteOrder: "be", signed: false });
          break;
        }
        case "decode": {
          const source = get(op.input),
            src = materialize(source);
          const start = integer(op.startByte, "Primo byte decoder", 0, 7),
            end = integer(op.endByte, "Ultimo byte decoder", start, source.width - 1);
          const width = end - start + 1;
          let slot = src;
          if (start > 0) {
            slot = take();
            target.push({
              op: "COPY_BYTES",
              src,
              dst: slot,
              length: width,
              offset: start,
            });
          }
          values.set(op.into, {
            slot,
            width,
            byteOrder: op.byteOrder,
            signed: op.signed,
            multiply: op.multiply ?? 1,
            divide: op.divide ?? 1,
            offset: op.offset ?? 0,
          });
          break;
        }
        case "emit": {
          if (isInit) throw new Error("Pubblica le uscite dentro le azioni.");
          const value = get(op.from);
          if (value.decimalFormat) {
            fieldTypes.set(op.channelId, value.decimalFormat === "float" ? "float" : "text");
            target.push({ op: "EMIT_DECIMAL", src: materialize(value), fieldId: fields.get(op.channelId)!, text: value.decimalFormat === "string" });
            break;
          }
          let src = materialize(value),
            width = value.width,
            byteOrder = value.byteOrder;
          const multiply = integer(
              value.multiply ?? 1,
              "Moltiplicatore decoder",
              -2147483648,
              2147483647,
            ),
            divisor = integer(value.divide ?? 1, "Divisore decoder", 1, 65535),
            offset = integer(
              value.offset ?? 0,
              "Offset decoder",
              -2147483648,
              2147483647,
            );
          if (multiply !== 1 || divisor !== 1 || offset !== 0) {
            const dst = take();
            target.push({
              op: "SCALE_PACK",
              src,
              dst,
              flags: (byteOrder === "be" ? 1 : 0) | (value.signed ? 2 : 0),
              width: 8,
              divisor,
              multiplier: multiply,
              offset,
            });
            src = dst;
            width = 8;
            byteOrder = "le";
          }
          fieldTypes.set(
            op.channelId,
            value.signed || offset < 0 || multiply < 0 || divisor !== 1
              ? "int64"
              : "uint64",
          );
          target.push({
            op: "EMIT_FIELD",
            src,
            fieldId: fields.get(op.channelId)!,
            width,
            byteOrder,
            signExtend: value.signed || offset < 0 || multiply < 0,
            multiplier: 0,
          });
          break;
        }
        case "wait":
          target.push({
            op: "DELAY_BOUNDED",
            milliseconds: integer(Math.ceil(waitDurationMs(op)), "Attesa", 1, 60000),
          });
          break;
        default:
          throw new Error(
            `Passo «${op.type}» non compilabile per il runtime: non viene ignorato.`,
          );
      }
      used = new Set(
        [...values.values()].flatMap((value) =>
          value.slot === undefined ? [] : [value.slot],
        ),
      );
    }
    // Declared input ports remain latchable even when this action does not consume them.
    const argumentsUsed = new Set(
      target
        .slice(sequenceStart)
        .filter(
          (
            instruction,
          ): instruction is Extract<
            Instruction,
            { op: "LOAD_ARGUMENT" | "LOAD_VALUE" }
          > => instruction.op === "LOAD_ARGUMENT",
        )
        .map((instruction) => instruction.argumentId),
    );
    for (const value of values.values())
      if (value.argument && !argumentsUsed.has(value.argument)) {
        // Motor controls remain usable before the first position event. Unused
        // position inputs may latch a value but cannot gate Start or Stop.
        if (steps.some((op) => op.type === "stepper" && op.command !== "position"))
          value.required = false;
        value.slot = undefined;
        materialize(value);
        argumentsUsed.add(value.argument);
        used = new Set(
          [...values.values()].flatMap((value) =>
            value.slot === undefined ? [] : [value.slot],
          ),
        );
      }
  }
  sequence(draft.phases.init, initOps, {}, new Set(), true);
  commands.forEach((command, index) => {
    const inputs = [
      ...new Set(
        command.steps.flatMap((op) =>
          op.type === "sample_external" ? [op.fromChannelId] : [],
        ),
      ),
    ].sort();
    if (inputs.length > 8)
      throw new Error("Un’azione può avere al massimo 8 ingressi.");
    const inputIds = Object.fromEntries(inputs.map((id, i) => [id, i + 1]));
    const first = sampleOps.length;
    sequence(
      command.steps,
      sampleOps,
      inputIds,
      connectedInputs.get(command.id) ?? new Set(),
      false,
    );
    sampleOps.push({ op: "EMIT_RECORD" });
    slices.push({ id: index + 1, first, count: sampleOps.length - first });
    actions.set(command.id, {
      commandId: index + 1,
      inputIds,
      outputIds: Object.fromEntries(
        command.steps.flatMap((op) =>
          op.type === "emit" ? [[op.channelId, fields.get(op.channelId)!]] : [],
        ),
      ),
    });
  });
  if (initOps.length > 16 || sampleOps.length > 16)
    throw new Error(
      `${draft.name}: il profilo supera le 16 operazioni firmware; riduci o raggruppa i passi.`,
    );
  const sampleFields = emitted.map((id) => ({
    fieldId: fields.get(id)!,
    type: fieldTypes.get(id) ?? ("int64" as const),
    name: `value_${fields.get(id)!}`,
    unit: draft.channels.find((c) => c.id === id)?.unit || undefined,
  }));
  if (commands.some((command) => command.steps.some((step) => step.type === "stepper")))
    sampleFields.push({ fieldId: MOVEMENT_COMPLETED_FIELD, type: "uint64", name: "movement_completed", unit: undefined });
  const semantic = {
    initOps,
    sampleOps,
    slices,
    sampleFields,
    ...(messageData.length ? { messageData } : {}),
  };
  const profileId = `drv.${stableDriverHash(JSON.stringify(semantic))}`;
  const profile: DeviceProfileDraft = {
    ...(messageData.length ? { messageData } : {}),
    profileId,
    version: 1,
    transport: draft.binding.bus === "gpio" ? PortTransport.GPIO : PortTransport.I2C,
    requiredCapabilities:
      draft.binding.bus === "gpio"
        ? (draft.binding.gpioSignals.some(
            (signal) => gpioSignalType(signal) === "digital_output",
          )
            ? PortCapability.DIGITAL_OUTPUT
            : 0) | PortCapability.DIGITAL_INPUT
        : PortCapability.I2C,
    maxTotalTimeMs: 60000,
    maxTransactions: 64,
    maxBytes: messageData.length ? 65535 : 256,
    initOps,
    sampleOps,
    safeStopOps: draft.dht22Module ? [{ op: "DHT22_POWER", dataChannel: gpioChannels.get("DATA")!, powerChannel: gpioChannels.get("POWER")!, on: false }] : [],
    sampleSchemaId: `${profileId}.s`,
    sampleSchemaVersion: 1,
    sampleFields,
    actions: slices,
  };
  const validation = validateDeviceProfile(profile);
  if (!validation.ok)
    throw new Error(validation.error.map((issue) => issue.remediation).join("; "));
  return { profile, actions };
}
