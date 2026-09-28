import { encodeArray, encodeBool, encodeInt, encodeMap, encodeNull, encodeText, encodeUint, type FieldPair } from "@spaghettilab/protocol-sdk";
import type {
  CanonicalBlock,
  CanonicalConfig,
  CanonicalEdge,
  CanonicalEnergy,
  CanonicalModule,
  CanonicalMqtt,
  CanonicalRule,
  CanonicalSchedule,
  PropertySet,
} from "./canonical-config.js";

/**
 * Produces the exact wire-V3 CBOR bytes `spaghetti_config_encode_cbor`
 * (`firmware/backbone/subsys/config/config_cbor.c`) emits — map key order, per
 * every sub-record shape, and the `properties` sort-by-field-id rule, all
 * read directly from that file rather than the (stale) CDDL-incompleteness
 * note previously carried in `protocol-sdk`. Decode is intentionally not
 * implemented here — S073 (decompiler) is the task that needs the reverse
 * direction; this compiler only ever produces bytes, never consumes them.
 */

function u32(value: number): Uint8Array {
  return encodeUint(BigInt(value));
}

function optionalU8(value: number | undefined): Uint8Array {
  // `encode_optional_u8` (config_cbor.c): nil when unspecified. This
  // compiler always has a real bayId/powerRailId from ModuleNodeData
  // (S050), so `undefined` here is a defensive fallback, not the common
  // case — CBOR simple value 22 (`0xF6`) is the wire `null`.
  return value === undefined ? encodeNull() : u32(value);
}

/** `encode_properties` insertion-sorts by `field_id` ascending before emitting — this is the canonicalization step S072's hash-reproducibility guarantee depends on. */
function encodeProperties(properties: PropertySet): Uint8Array {
  const pairs: FieldPair[] = Object.entries(properties)
    .map(([key, value]): FieldPair => {
      const fieldId = Number(key);
      if (typeof value === "boolean") return [fieldId, encodeBool(value)];
      if (typeof value === "bigint") return [fieldId, encodeInt(value)];
      return [fieldId, encodeText(value)];
    })
    .sort((a, b) => a[0] - b[0]);
  return encodeMap(pairs);
}

function encodeModule(m: CanonicalModule): Uint8Array {
  return encodeMap([
    [0, u32(m.key)],
    [1, u32(m.portId)],
    [2, encodeText(m.typeId)],
    [3, encodeProperties(m.properties)],
    [4, optionalU8(m.bayId)],
    [5, optionalU8(m.powerRailId)],
  ]);
}

function encodeSchedule(s: CanonicalSchedule): Uint8Array {
  return encodeMap([
    [0, u32(s.sourceKey)],
    [1, u32(s.periodMs)],
    [2, encodeBool(s.enabled)],
  ]);
}

function encodeRule(r: CanonicalRule): Uint8Array {
  return encodeMap([
    [0, u32(r.key)],
    [1, encodeText(r.typeId)],
    [2, encodeProperties(r.properties)],
  ]);
}

function encodeBlock(b: CanonicalBlock): Uint8Array {
  return encodeMap([
    [0, u32(b.key)],
    [1, encodeText(b.typeId)],
    [2, u32(b.minVersion)],
    [3, u32(b.exactVersion)],
    [4, encodeProperties(b.properties)],
  ]);
}

function encodeEdge(e: CanonicalEdge): Uint8Array {
  return encodeMap([
    [0, u32(e.sourceKey)],
    [1, u32(e.sourcePortOrField)],
    [2, u32(e.targetKey)],
    [3, u32(e.targetInput)],
    [4, u32(e.sourceKind)],
  ]);
}

function encodeMqtt(m: CanonicalMqtt): Uint8Array {
  return encodeMap([
    [0, encodeBool(m.enabled)],
    [1, encodeText(m.host)],
    [2, u32(m.port)],
    [3, encodeText(m.baseTopic)],
    [4, u32(m.security)],
    [5, u32(m.credentialId)],
  ]);
}

function encodeEnergy(e: CanonicalEnergy): Uint8Array {
  return encodeMap([
    [0, u32(e.bleAvailability)],
    [1, u32(e.advertisingWindowMs)],
    [2, u32(e.advertisingPeriodMs)],
  ]);
}

export function encodeConfigCbor(config: CanonicalConfig): Uint8Array {
  return encodeMap([
    [0, u32(config.version)],
    [1, encodeArray(config.modules.map(encodeModule))],
    [2, encodeArray(config.schedules.map(encodeSchedule))],
    [3, encodeArray(config.rules.map(encodeRule))],
    [4, encodeMqtt(config.mqtt)],
    [5, u32(config.connectivity)],
    [6, encodeEnergy(config.energy)],
    [7, encodeArray(config.blocks.map(encodeBlock))],
    [8, encodeArray(config.edges.map(encodeEdge))],
  ]);
}

/** Canonical debug JSON — sorted keys, `bigint` properties rendered as `"123n"` strings since `JSON.stringify` cannot serialize `bigint` natively. Never the wire format; only for human/log inspection. */
export function canonicalConfigJson(config: CanonicalConfig): string {
  return JSON.stringify(config, (_key, value) => (typeof value === "bigint" ? `${value.toString()}n` : value), 0);
}
