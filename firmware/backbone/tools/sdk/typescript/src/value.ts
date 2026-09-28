import { ProtocolCodecError } from "./codec.js";
import type { JsonWireValue, WireValue, WireValueType } from "./types.js";

const INTEGER_STRING = /^-?\d+$/;

/** Parse JSON/Node-RED value into bigint without parseFloat. */
export function integerFromJson(value: unknown): bigint {
  if (typeof value === "string") {
    if (!INTEGER_STRING.test(value)) {
      throw new ProtocolCodecError(`"${value}" is not a valid integer string`);
    }
    return BigInt(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new ProtocolCodecError(
        `${value} is outside the JSON safe-integer range; use a decimal string`,
      );
    }
    return BigInt(value);
  }
  throw new ProtocolCodecError(`expected integer number or decimal string, got ${typeof value}`);
}

/** Emit JSON-safe representation of a bigint. */
export function integerToJson(value: bigint): number | string {
  if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value.toString();
}

export function wireValueToJson(value: WireValue): JsonWireValue {
  switch (value.type) {
    case "bool":
      return value.value;
    case "text":
      return value.value;
    case "int64":
    case "uint64":
      return integerToJson(value.value);
    case "bytes":
      return Array.from(value.value, (b) => b.toString(16).padStart(2, "0")).join("");
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

export function wireValueFromJson(
  json: JsonWireValue,
  type: WireValueType,
): WireValue {
  switch (type) {
    case "bool":
      if (typeof json !== "boolean") {
        throw new ProtocolCodecError("expected boolean");
      }
      return { type: "bool", value: json };
    case "text":
      if (typeof json !== "string") {
        throw new ProtocolCodecError("expected text string");
      }
      return { type: "text", value: json };
    case "int64":
      return { type: "int64", value: integerFromJson(json) };
    case "uint64": {
      const n = integerFromJson(json);
      if (n < 0n) {
        throw new ProtocolCodecError("uint64 cannot be negative");
      }
      return { type: "uint64", value: n };
    }
    case "bytes": {
      if (typeof json !== "string") {
        throw new ProtocolCodecError("bytes must be hex string in JSON");
      }
      const clean = json.toLowerCase();
      if (clean.length % 2 !== 0 || (clean.length > 0 && !/^[0-9a-f]+$/.test(clean))) {
        throw new ProtocolCodecError("invalid bytes hex");
      }
      const out = new Uint8Array(clean.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
      }
      return { type: "bytes", value: out };
    }
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/** Infer a wire type from a JSON value when catalog types are absent. */
export function inferWireType(json: JsonWireValue): WireValueType {
  if (typeof json === "boolean") return "bool";
  if (typeof json === "number") {
    if (!Number.isSafeInteger(json)) {
      throw new ProtocolCodecError("JSON number is not a safe integer");
    }
    return json < 0 ? "int64" : "uint64";
  }
  if (typeof json === "string") {
    if (INTEGER_STRING.test(json)) {
      return json.startsWith("-") ? "int64" : "uint64";
    }
    if (/^[0-9a-fA-F]*$/.test(json) && json.length % 2 === 0 && json.length > 0) {
      return "bytes";
    }
    return "text";
  }
  throw new ProtocolCodecError("unsupported JSON wire value");
}
