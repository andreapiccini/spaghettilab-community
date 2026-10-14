import {
  PortCapability,
  PortTransport,
  type DeviceProfileDraft,
  type Instruction,
} from "@spaghettilab/device-profile-authoring-model";
import { encodeConfigCbor, compileConfig, type CompileConfigInput } from "@spaghettilab/config-compiler";
import type { DeviceRecipeDraft, DeviceRecipeOp } from "./device-recipe-draft.js";

function parseHexByte(raw: string): number {
  const n = Number.parseInt(raw.trim().replace(/^0x/i, ""), 16);
  return Number.isFinite(n) ? n & 0xff : 0;
}

/** Pack up to 8 bytes into LOAD_CONST low/high (little-endian). */
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

function mapOp(op: DeviceRecipeOp, temp: { next: number }): Instruction[] {
  const take = () => {
    const s = temp.next % 8;
    temp.next += 1;
    return s;
  };

  switch (op.type) {
    case "wait":
      return [{ op: "DELAY_BOUNDED", milliseconds: Math.max(1, Math.min(op.ms, 60_000)) }];
    case "i2c_write": {
      const payload: number[] = [];
      if (op.reg) payload.push(parseHexByte(op.reg));
      for (const b of op.bytes) payload.push(parseHexByte(b));
      if (payload.length === 0) payload.push(0);
      const src = take();
      return [loadConst(src, payload), { op: "I2C_WRITE", src, length: payload.length, timeoutMs: op.timeoutMs ?? 20 }];
    }
    case "i2c_read": {
      const dst = take();
      return [{ op: "I2C_READ", dst, length: Math.max(1, op.len), timeoutMs: op.timeoutMs ?? 20 }];
    }
    case "i2c_write_read": {
      const payload: number[] = [];
      if (op.reg) payload.push(parseHexByte(op.reg));
      for (const b of op.writeBytes) payload.push(parseHexByte(b));
      const src = take();
      const dst = take();
      const writeLength = payload.length;
      const ops: Instruction[] = [];
      if (writeLength > 0) ops.push(loadConst(src, payload));
      else ops.push(loadConst(src, [0]));
      ops.push({
        op: "I2C_WRITE_READ",
        src,
        dst,
        readLength: Math.max(1, op.readLen),
        writeLength: Math.max(1, writeLength || 1),
        timeoutMs: op.timeoutMs ?? 20,
      });
      return ops;
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
    const before = temp.next;
    const part = mapOp(op, temp);
    if (part.length === 0 && isExecutableCandidate(op)) skipped.push(op.type);
    mappedSample.push(...part);
    if (op.type === "i2c_read" || op.type === "i2c_write_read") {
      lastReadSlot = (before + (op.type === "i2c_write_read" ? 1 : 0)) % 8;
    }
  }

  const fieldId = 1;
  if (lastReadSlot !== null) {
    mappedSample.push({ op: "EMIT_FIELD", src: lastReadSlot, fieldId });
  } else {
    // Ensure validate-profile has something to emit if sampleFields declared
    const dst = temp.next % 8;
    mappedSample.push(loadConst(dst, [0]), { op: "EMIT_FIELD", src: dst, fieldId });
  }
  mappedSample.push({ op: "EMIT_RECORD" });

  const { transport, caps } = transportOf(draft);
  const profileId = `try.${draft.id.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 20)}` || "try.recipe";
  const profile: DeviceProfileDraft = {
    profileId: profileId.slice(0, 31),
    version: 1,
    transport,
    requiredCapabilities: caps,
    maxTotalTimeMs: 5000,
    maxTransactions: 64,
    maxBytes: 256,
    initOps: mappedInit,
    sampleOps: mappedSample,
    safeStopOps: [],
    sampleSchemaId: `${profileId.slice(0, 20)}.s`.slice(0, 31),
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
  readonly i2cAddress?: number;
  readonly portId?: number;
  readonly bayId?: number;
  readonly railId?: number;
  readonly periodMs?: number;
};

/** Minimal one-module config: declarative-device + schedule. Does not touch the project canvas. */
export function buildRecipeTestConfigBytes(params: RecipeTestConfigParams): Uint8Array | null {
  const portId = params.portId ?? 1;
  const bayId = params.bayId ?? 100;
  const railId = params.railId ?? 1000;
  const addr = params.i2cAddress ?? 0x48;
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
            bayId,
            railId,
            electricalMode: "input-only",
            properties: { "1": BigInt(addr) },
          },
        },
      ],
      edges: [],
    },
    processingGraph: {
      layer: "device-processing",
      nodes: [
        {
          layer: "device-processing",
          id: "try-sched",
          data: {
            kind: "schedule",
            moduleNodeId: "try-mod",
            periodMs: params.periodMs ?? 200,
            enabled: true,
          },
        },
      ],
      edges: [],
    },
    mqtt: { enabled: false, host: "", port: 0, baseTopic: "", security: 0, credentialId: 0 },
    connectivity: 0,
    energy: { bleAvailability: 0, advertisingWindowMs: 0, advertisingPeriodMs: 0 },
  };

  const compiled = compileConfig(input);
  if (!compiled.ok) return null;
  return encodeConfigCbor(compiled.value);
}
