import {
  decodeOne,
  encodeInt,
  encodeBool,
  encodeBytes,
  encodeArray,
  ProtocolCodecError,
} from "../cbor.js";
import { encodeMap, requireMap, requireU32, u32Field, boolField } from "../fields.js";

export type ModuleCommandValue = bigint | boolean | Uint8Array;
export type ModuleCommandRequest = {
  readonly key: number;
  readonly commandId: number;
  readonly arguments?: Readonly<Record<number, ModuleCommandValue>>;
};
export type ModuleCommandResponse = {
  readonly fields?: Readonly<Record<number, bigint>>;
  readonly rxReads?: readonly Uint8Array[];
  readonly rxTruncated?: boolean;
};
function encodeValue(value: ModuleCommandValue): Uint8Array {
  return typeof value === "bigint"
    ? encodeInt(value)
    : typeof value === "boolean"
      ? encodeBool(value)
      : encodeBytes(value);
}
export function encodeModuleCommandRequest(r: ModuleCommandRequest): Uint8Array {
  return encodeMap([
    u32Field(0, r.key),
    u32Field(1, r.commandId),
    ...(r.arguments
      ? [
          [
            2,
            encodeMap(
              Object.entries(r.arguments).map(
                ([id, value]) => [Number(id), encodeValue(value)] as const,
              ),
            ),
          ] as const,
        ]
      : []),
  ]);
}
export function decodeModuleCommandRequest(bytes: Uint8Array): ModuleCommandRequest {
  const map = requireMap(decodeOne(bytes), "ModuleCommandRequest");
  let args: Record<number, ModuleCommandValue> | undefined;
  if (map.has(2)) {
    args = {};
    const values = requireMap(map.get(2)!, "ModuleCommand arguments");
    if (values.size > 8) throw new ProtocolCodecError("Too many command arguments");
    for (const [id, value] of values) {
      if (id < 1 || id > 65535) throw new ProtocolCodecError("Invalid argument ID");
      if (value.kind === "uint" || value.kind === "int") args[id] = value.value;
      else if (value.kind === "bool") args[id] = value.value;
      else if (value.kind === "bytes" && value.value.length <= 8)
        args[id] = value.value;
      else throw new ProtocolCodecError("Invalid command argument");
    }
  }
  return {
    key: requireU32(map, 0, "ModuleCommandRequest"),
    commandId: requireU32(map, 1, "ModuleCommandRequest"),
    ...(args ? { arguments: args } : {}),
  };
}
export function encodeModuleCommandResponse(r: ModuleCommandResponse = {}): Uint8Array {
  if (!r.fields) return encodeMap([]);
  return encodeMap([
    [
      0,
      encodeMap(
        Object.entries(r.fields).map(
          ([id, value]) => [Number(id), encodeInt(value)] as const,
        ),
      ),
    ],
    [1, encodeArray((r.rxReads ?? []).map(encodeBytes))],
    boolField(2, r.rxTruncated ?? false),
  ]);
}
export function decodeModuleCommandResponse(bytes: Uint8Array): ModuleCommandResponse {
  const map = requireMap(decodeOne(bytes), "ModuleCommandResponse");
  if (!map.has(0)) return {};
  const fields: Record<number, bigint> = {};
  const values = requireMap(map.get(0)!, "Command fields");
  if (values.size > 8) throw new ProtocolCodecError("Too many result fields");
  for (const [id, value] of values) {
    if (value.kind !== "uint" && value.kind !== "int")
      throw new ProtocolCodecError("Invalid result field");
    fields[id] = value.value;
  }
  const rx = map.get(1);
  const truncated = map.get(2);
  if (
    !rx ||
    rx.kind !== "array" ||
    rx.value.length > 8 ||
    !truncated ||
    truncated.kind !== "bool"
  )
    throw new ProtocolCodecError("Invalid command capture");
  const rxReads = rx.value.map((value) => {
    if (value.kind !== "bytes" || value.value.length > 8)
      throw new ProtocolCodecError("Invalid command RX");
    return value.value;
  });
  return { fields, rxReads, rxTruncated: truncated.value };
}
