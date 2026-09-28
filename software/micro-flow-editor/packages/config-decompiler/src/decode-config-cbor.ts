import { decodeOne, requireArray, requireBool, requireMap, requireText, requireU32, type CborValue } from "@spaghettilab/protocol-sdk";
import {
  CONFIG_WIRE_VERSION,
  type CanonicalBlock,
  type CanonicalConfig,
  type CanonicalEdge,
  type CanonicalEnergy,
  type CanonicalModule,
  type CanonicalMqtt,
  type CanonicalRule,
  type CanonicalSchedule,
  type PropertySet,
  type PropertyValue,
} from "@spaghettilab/config-compiler";
import { domainError, err, ok, type DomainError, type Result } from "@spaghettilab/domain";
import { ConfigDecompilerErrorCode } from "./errors.js";

/**
 * The exact inverse of `@spaghettilab/config-compiler`'s `encodeConfigCbor`
 * — same map key order, same per-record shapes, read from the same source
 * (`firmware/backbone/subsys/config/config_cbor.c`'s `decode_wire_v3`). This is
 * the reverse direction S072 explicitly left undone.
 */

function malformed(target: string, remediation: string, cause?: unknown): DomainError {
  return domainError({ code: ConfigDecompilerErrorCode.MALFORMED_CBOR, path: ["config-decompiler", "cbor"], target, remediation, cause });
}

function decodeOptionalU8(value: CborValue | undefined, context: string): number | undefined {
  if (value === undefined || value.kind === "null") return undefined;
  if (value.kind !== "uint") throw new Error(`${context}: expected uint or null`);
  return Number(value.value);
}

function decodePropertyValue(value: CborValue): PropertyValue {
  if (value.kind === "bool") return value.value;
  if (value.kind === "uint" || value.kind === "int") return value.value;
  if (value.kind === "text") return value.value;
  throw new Error(`unsupported property value kind "${value.kind}" — Config properties are bool/int/uint/text only`);
}

function decodeProperties(value: CborValue): PropertySet {
  if (value.kind !== "map") throw new Error("properties must be a CBOR map");
  const out: Record<number, PropertyValue> = {};
  for (const [fieldId, v] of value.value) {
    out[fieldId] = decodePropertyValue(v);
  }
  return out;
}

function decodeModule(value: CborValue): CanonicalModule {
  const m = requireMap(value, "CanonicalModule");
  return {
    key: requireU32(m, 0, "CanonicalModule"),
    portId: requireU32(m, 1, "CanonicalModule"),
    typeId: requireText(m, 2, "CanonicalModule"),
    properties: decodeProperties(m.get(3)!),
    bayId: decodeOptionalU8(m.get(4), "CanonicalModule.bayId"),
    powerRailId: decodeOptionalU8(m.get(5), "CanonicalModule.powerRailId"),
  };
}

function decodeSchedule(value: CborValue): CanonicalSchedule {
  const m = requireMap(value, "CanonicalSchedule");
  return { sourceKey: requireU32(m, 0, "CanonicalSchedule"), periodMs: requireU32(m, 1, "CanonicalSchedule"), enabled: requireBool(m, 2, "CanonicalSchedule") };
}

function decodeRule(value: CborValue): CanonicalRule {
  const m = requireMap(value, "CanonicalRule");
  return { key: requireU32(m, 0, "CanonicalRule"), typeId: requireText(m, 1, "CanonicalRule"), properties: decodeProperties(m.get(2)!) };
}

function decodeBlock(value: CborValue): CanonicalBlock {
  const m = requireMap(value, "CanonicalBlock");
  return {
    key: requireU32(m, 0, "CanonicalBlock"),
    typeId: requireText(m, 1, "CanonicalBlock"),
    minVersion: requireU32(m, 2, "CanonicalBlock"),
    exactVersion: requireU32(m, 3, "CanonicalBlock"),
    properties: decodeProperties(m.get(4)!),
  };
}

function decodeEdge(value: CborValue): CanonicalEdge {
  const m = requireMap(value, "CanonicalEdge");
  const sourceKind = requireU32(m, 4, "CanonicalEdge");
  return {
    sourceKey: requireU32(m, 0, "CanonicalEdge"),
    sourcePortOrField: requireU32(m, 1, "CanonicalEdge"),
    targetKey: requireU32(m, 2, "CanonicalEdge"),
    targetInput: requireU32(m, 3, "CanonicalEdge"),
    sourceKind: sourceKind === 1 ? 1 : 0,
  };
}

function decodeMqtt(value: CborValue): CanonicalMqtt {
  const m = requireMap(value, "CanonicalMqtt");
  return {
    enabled: requireBool(m, 0, "CanonicalMqtt"),
    host: requireText(m, 1, "CanonicalMqtt"),
    port: requireU32(m, 2, "CanonicalMqtt"),
    baseTopic: requireText(m, 3, "CanonicalMqtt"),
    security: requireU32(m, 4, "CanonicalMqtt"),
    credentialId: requireU32(m, 5, "CanonicalMqtt"),
  };
}

function decodeEnergy(value: CborValue): CanonicalEnergy {
  const m = requireMap(value, "CanonicalEnergy");
  return { bleAvailability: requireU32(m, 0, "CanonicalEnergy"), advertisingWindowMs: requireU32(m, 1, "CanonicalEnergy"), advertisingPeriodMs: requireU32(m, 2, "CanonicalEnergy") };
}

export function decodeConfigCbor(bytes: Uint8Array): Result<CanonicalConfig, DomainError> {
  let root: CborValue;
  try {
    root = decodeOne(bytes);
  } catch (cause) {
    return err(malformed("bytes", "not valid CBOR", cause));
  }

  try {
    const map = requireMap(root, "CanonicalConfig");
    const version = requireU32(map, 0, "CanonicalConfig");
    if (version !== CONFIG_WIRE_VERSION) {
      return err(
        domainError({
          code: ConfigDecompilerErrorCode.UNSUPPORTED_WIRE_VERSION,
          path: ["config-decompiler", "cbor", "version"],
          target: String(version),
          remediation: `this decoder only understands wire version ${CONFIG_WIRE_VERSION}`,
        }),
      );
    }
    const config: CanonicalConfig = {
      version: CONFIG_WIRE_VERSION,
      modules: requireArray(map, 1, "CanonicalConfig").map(decodeModule),
      schedules: requireArray(map, 2, "CanonicalConfig").map(decodeSchedule),
      rules: requireArray(map, 3, "CanonicalConfig").map(decodeRule),
      mqtt: decodeMqtt(map.get(4)!),
      connectivity: requireU32(map, 5, "CanonicalConfig"),
      energy: decodeEnergy(map.get(6)!),
      blocks: requireArray(map, 7, "CanonicalConfig").map(decodeBlock),
      edges: requireArray(map, 8, "CanonicalConfig").map(decodeEdge),
    };
    return ok(config);
  } catch (cause) {
    return err(malformed("root", "a required field is missing or has the wrong CBOR type", cause));
  }
}
