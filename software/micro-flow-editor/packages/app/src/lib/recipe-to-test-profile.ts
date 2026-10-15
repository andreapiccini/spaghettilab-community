import {
  PortCapability,
  PortTransport,
  type DeviceProfileDraft,
  type Instruction,
} from "@spaghettilab/device-profile-authoring-model";
import {
  encodeConfigCbor,
  compileConfig,
  type CanonicalConfig,
  type CompileConfigInput,
} from "@spaghettilab/config-compiler";
import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import { waitDurationMs, type DeviceRecipeDraft, type DeviceRecipeOp } from "./device-recipe-draft.js";
import { hexStringsToBytes } from "./i2c-hex.js";

/**
 * Pack bytes into LOAD_CONST low/high (little-endian).
 * LOAD_CONST packs eight bytes; CONCAT assembles larger messages before a single transfer.
 */
function loadConst(dst: number, bytes: readonly number[]): Instruction {
  const slice = bytes.slice(0, 8);
  let low = 0;
  let high = 0;
  for (let i = 0; i < slice.length; i++) {
    const b = slice[i]! & 0xff;
    if (i < 4) low |= b << (8 * i);
    else high |= b << (8 * (i - 4));
  }
  return { op: "LOAD_CONST", dst, length: Math.max(1, slice.length), low: low >>> 0, high: high >>> 0 };
}

/** One I2C_WRITE transaction for up to 32 payload bytes (same START…STOP). */
function mapI2cWritePayload(
  payload: readonly number[],
  timeoutMs: number,
  take: () => number,
): Instruction[] {
  const bytes = payload.length > 0 ? [...payload] : [0];
  if (bytes.length > 32) throw new Error("Una transazione I²C può contenere al massimo 32 byte.");
  const result: Instruction[] = [];
  let src: number | undefined;
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const slot = take();
    result.push(loadConst(slot, bytes.slice(offset, offset + 8)));
    if (src === undefined) src = slot;
    else { const dst = take(); result.push({ op: "CONCAT", srcA: src, srcB: slot, dst }); src = dst; }
  }
  result.push({ op: "I2C_WRITE", src: src!, length: bytes.length, timeoutMs });
  return result;
}

function mapOp(op: DeviceRecipeOp, temp: { next: number }): Instruction[] {
  const take = () => {
    const s = temp.next % 8;
    temp.next += 1;
    return s;
  };

  switch (op.type) {
    case "wait": {
      const ms = Math.max(1, Math.min(Math.ceil(waitDurationMs(op)), 60_000));
      return [{ op: "DELAY_BOUNDED", milliseconds: ms }];
    }
    case "i2c_write": {
      const payload = hexStringsToBytes(op.bytes);
      return mapI2cWritePayload(payload, op.timeoutMs ?? 20, take);
    }
    case "i2c_read": {
      const dst = take();
      return [{ op: "I2C_READ", dst, length: Math.max(1, op.len), timeoutMs: op.timeoutMs ?? 20 }];
    }
    case "i2c_write_read": {
      const payload = hexStringsToBytes(op.writeBytes);
      const timeoutMs = op.timeoutMs ?? 20;
      const ops = mapI2cWritePayload(payload, timeoutMs, take);
      const write = ops.pop()!;
      if (write.op !== "I2C_WRITE") throw new Error("Messaggio I²C non valido.");
      const dst = take();
      ops.push({ op: "I2C_WRITE_READ", src: write.src, dst, readLength: Math.max(1, op.readLen), writeLength: write.length, timeoutMs });
      return ops;
    }
    case "i2c_transaction": {
      // Best-effort flatten: WRITE/READ phases → WRITE + WRITE_READ/READ; START/STOP/Sr implicit.
      const timeoutMs = op.timeoutMs ?? 20;
      const out: Instruction[] = [];
      let pendingWrite: number[] = [];
      const flushWrite = () => {
        if (pendingWrite.length === 0) return;
        out.push(...mapI2cWritePayload(pendingWrite, timeoutMs, take));
        pendingWrite = [];
      };
      for (const phase of op.phases) {
        if (phase.kind === "write") {
          pendingWrite.push(...hexStringsToBytes(phase.bytes));
        } else if (phase.kind === "read") {
          const dst = take();
          if (pendingWrite.length > 0) {
            const packed = mapI2cWritePayload(pendingWrite, timeoutMs, take);
            const write = packed.pop()!;
            if (write.op !== "I2C_WRITE") throw new Error("Messaggio I²C non valido.");
            out.push(...packed);
            out.push({
              op: "I2C_WRITE_READ",
              src: write.src,
              dst,
              readLength: Math.max(1, phase.len),
              writeLength: write.length,
              timeoutMs,
            });
            pendingWrite = [];
          } else {
            out.push({ op: "I2C_READ", dst, length: Math.max(1, phase.len), timeoutMs });
          }
        } else if (phase.kind === "stop" || phase.kind === "start") {
          flushWrite();
        }
      }
      flushWrite();
      return out;
    }
    default:
      return [];
  }
}

function transportOf(draft: DeviceRecipeDraft): { transport: number; caps: number } {
  switch (draft.binding.bus) {
    case "i2c":
      return { transport: PortTransport.I2C, caps: PortCapability.I2C };
    case "spi":
      return { transport: PortTransport.SPI, caps: PortCapability.SPI };
    case "adc":
      return { transport: PortTransport.ADC, caps: PortCapability.ADC };
    case "w1":
      return { transport: PortTransport.W1, caps: PortCapability.W1 };
    default:
      return { transport: PortTransport.GPIO, caps: PortCapability.DIGITAL_INPUT };
  }
}

/**
 * Compile a Testa plan into a temporary Device Profile (init + sample).
 * Skips non-bus post-ops (decode/emit/…) — firmware profile is bus + emit only.
 */
export function recipePlanToTestProfile(
  draft: DeviceRecipeDraft,
  initOps: readonly DeviceRecipeOp[],
  bodyOps: readonly DeviceRecipeOp[],
): { readonly profile: DeviceProfileDraft; readonly skipped: readonly string[] } {
  const skipped: string[] = [];
  const temp = { next: 0 };
  const mappedInit: Instruction[] = [];
  for (const op of initOps) {
    const part = mapOp(op, temp);
    if (part.length === 0 && isExecutableCandidate(op)) skipped.push(op.type);
    mappedInit.push(...part);
  }
  const mappedSample: Instruction[] = [];
  let lastReadSlot: number | null = null;
  for (const op of bodyOps) {
    if (op.type === "emit" || op.type === "decode" || op.type === "encode" || op.type === "sample_external") {
      skipped.push(op.type);
      continue;
    }
    const part = mapOp(op, temp);
    if (part.length === 0 && isExecutableCandidate(op)) skipped.push(op.type);
    mappedSample.push(...part);
    for (const instruction of part) if (instruction.op === "I2C_READ" || instruction.op === "I2C_WRITE_READ") lastReadSlot = instruction.dst;
  }

  const fieldId = 1;
  if (lastReadSlot !== null) {
    mappedSample.push({ op: "EMIT_FIELD", src: lastReadSlot, fieldId, width: 1, byteOrder: "le", signExtend: false, multiplier: 0 });
  } else {
    // Ensure validate-profile has something to emit if sampleFields declared
    const dst = temp.next % 8;
    mappedSample.push(loadConst(dst, [0]), { op: "EMIT_FIELD", src: dst, fieldId, width: 1, byteOrder: "le", signExtend: false, multiplier: 0 });
  }
  mappedSample.push({ op: "EMIT_RECORD" });

  const { transport, caps } = transportOf(draft);
  // Short stable id (≤31): easier to match in declarative-device config properties / catalog cleanup.
  const profileId = `try.${draft.binding.bus}`.slice(0, 31);
  // Firmware stores version as uint16 and rejects 0 or >65535 in decode_profile_cbor (-EINVAL).
  // Unique-ish each Testa run avoids CONFLICT when the same id was installed earlier.
  const version = ((Date.now() + Math.floor(Math.random() * 997)) % 65535) + 1;
  const profile: DeviceProfileDraft = {
    profileId,
    version,
    transport,
    requiredCapabilities: caps,
    maxTotalTimeMs: 5000,
    maxTransactions: 64,
    maxBytes: 256,
    initOps: mappedInit,
    sampleOps: mappedSample,
    safeStopOps: [],
    sampleSchemaId: `${profileId}.s`.slice(0, 31),
    sampleSchemaVersion: 1,
    sampleFields: [{ fieldId, type: "uint64", name: "raw", unit: "" }],
  };
  return { profile, skipped };
}

function isExecutableCandidate(op: DeviceRecipeOp): boolean {
  return (
    op.type === "i2c_write" ||
    op.type === "i2c_read" ||
    op.type === "i2c_write_read" ||
    op.type === "i2c_transaction" ||
    op.type === "i2c_scan" ||
    op.type === "wait" ||
    op.type === "spi_transfer" ||
    op.type === "gpio_read" ||
    op.type === "adc_sample" ||
    op.type === "w1_read" ||
    op.type === "w1_write"
  );
}

export type RecipeTestConfigParams = {
  readonly profileId: string;
  /** Installed Device Profile version (firmware uint16, required by declarative-device). */
  readonly profileVersion: number;
  readonly i2cAddress?: number;
  readonly portId?: number;
  /**
   * Sample period. Omit / `null` / `0` → no schedule (Testa runs ops in profile init once).
   * A schedule forces `start_runtime`, which has failed with INTERNAL_ERROR on some cores
   * even when VALIDATE_CONFIG succeeded.
   */
  readonly periodMs?: number | null;
  /**
   * Live config bytes from GET_CONFIG (parked). Used to keep mqtt/connectivity/energy
   * unchanged and to prefer an already-valid Port for the test module.
   */
  readonly parkedConfigBytes?: Uint8Array;
};

/** Port 0 is the I²C-capable connector on Backbone / Core boards; port 1 is often CAN or GPIO-only. */
const DEFAULT_I2C_PORT_ID = 0;

function pickTestPortId(explicit: number | undefined, parked: CanonicalConfig | null): number {
  if (explicit !== undefined && Number.isInteger(explicit) && explicit >= 0 && explicit <= 255) {
    return explicit;
  }
  const fromParked = parked?.modules[0]?.portId;
  if (fromParked !== undefined && fromParked >= 0 && fromParked <= 255) return fromParked;
  return DEFAULT_I2C_PORT_ID;
}

/**
 * Minimal one-module config: declarative-device (+ optional schedule). Does not touch the canvas.
 *
 * Properties match `SPAGHETTI_DECLARATIVE_CONFIG_*` (profile_id / profile_version / i2c_address).
 * Bay/rail are left unspecified on the wire (CBOR null) — authoring defaults like railId=1000
 * exceed uint8 and the Core rejects them with MALFORMED_REQUEST.
 */
export function buildRecipeTestConfigBytes(params: RecipeTestConfigParams): Uint8Array | null {
  const parked = params.parkedConfigBytes
    ? (() => {
        const decoded = decodeConfigCbor(params.parkedConfigBytes!);
        return decoded.ok ? decoded.value : null;
      })()
    : null;

  const portId = pickTestPortId(params.portId, parked);
  const version = Math.max(1, Math.min(params.profileVersion, 65535));
  const addr = (params.i2cAddress ?? 0x48) & 0x7f;
  const properties: Record<string, string | bigint> = {
    "1": params.profileId,
    "2": BigInt(version),
    "4": BigInt(addr),
  };

  const mqtt = parked?.mqtt ?? { enabled: false, host: "", port: 0, baseTopic: "", security: 0, credentialId: 0 };
  // Keep live connectivity/energy when possible — flipping LOW_ENERGY↔ONLINE during Testa
  // can fail apply/rollback with opaque INTERNAL_ERROR on some images.
  const connectivity = parked?.connectivity ?? 0;
  const energy = parked?.energy ?? { bleAvailability: 0, advertisingWindowMs: 0, advertisingPeriodMs: 0 };
  // LOW_ENERGY + mqtt.enabled is illegal; force mqtt off in that case.
  const safeMqtt =
    connectivity === 0 && mqtt.enabled
      ? { ...mqtt, enabled: false }
      : mqtt;

  const periodMs = params.periodMs;
  const withSchedule =
    periodMs !== null && periodMs !== undefined && Number.isFinite(periodMs) && periodMs > 0;

  const input: CompileConfigInput = {
    physicalGraph: {
      layer: "physical-composition",
      nodes: [
        {
          layer: "physical-composition",
          id: "try-mod",
          data: {
            kind: "module",
            driverTypeId: "declarative-device",
            profileId: params.profileId,
            portId,
            // Placeholder authoring IDs — stripped before encode (see below).
            bayId: 0,
            railId: 0,
            electricalMode: "input-only",
            properties,
          },
        },
      ],
      edges: [],
    },
    processingGraph: {
      layer: "device-processing",
      nodes: withSchedule
        ? [
            {
              layer: "device-processing",
              id: "try-sched",
              data: {
                kind: "schedule",
                moduleNodeId: "try-mod",
                periodMs: periodMs!,
                enabled: true,
              },
            },
          ]
        : [],
      edges: [],
    },
    mqtt: safeMqtt,
    connectivity,
    energy,
  };

  const compiled = compileConfig(input);
  if (!compiled.ok) return null;
  return encodeConfigCbor({
    ...compiled.value,
    modules: compiled.value.modules.map((m) => ({
      ...m,
      bayId: undefined,
      powerRailId: undefined,
    })),
  });
}
