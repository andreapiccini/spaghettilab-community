import {
  assertOnlyKeys,
  bytesToHex,
  decodeOne,
  encodeArray,
  encodeBytes,
  encodeEmptyMap,
  encodeMap,
  encodeText,
  ProtocolCodecError,
  requireArray,
  requireBytes,
  requireMap,
  requireText,
  requireU32,
  textField,
  u32Field,
  type CborValue,
} from "./codec.js";
import type {
  Catalog,
  CatalogDriver,
  CatalogField,
  FieldSemantic,
  WireValueType,
} from "./types.js";

const SEMANTICS: FieldSemantic[] = [
  "value",
  "module_key_ref",
  "record_field_ref",
  "command_ref",
  "port_ref",
  "flow_ref",
  "bay_ref",
  "power_rail_ref",
  "duration_ms",
];

const VALUE_TYPES: WireValueType[] = ["bool", "int64", "uint64", "text", "bytes"];

export interface CatalogPage {
  protocolVersion: number;
  configVersion: number;
  fingerprint: string;
  drivers: CatalogDriver[];
  nextCursor: number;
  driverCount: number;
}

export function encodeGetCatalogRequest(cursor?: number, limit?: number): Uint8Array {
  const pairs: Array<readonly [number, Uint8Array]> = [];
  if (cursor !== undefined) pairs.push(u32Field(0, cursor));
  if (limit !== undefined) pairs.push(u32Field(1, limit));
  return encodeMap(pairs);
}

function decodeDriver(entry: CborValue): CatalogDriver {
  const m = requireMap(entry, "CatalogDriver");
  assertOnlyKeys(m, [0, 1], "CatalogDriver");
  return {
    typeId: requireText(m, 0, "CatalogDriver"),
    commandCount: requireU32(m, 1, "CatalogDriver"),
    commands: [],
    fields: [],
  };
}

export function decodeCatalogPage(bytes: Uint8Array): CatalogPage {
  const map = requireMap(decodeOne(bytes), "GetCatalogResponse");
  assertOnlyKeys(map, [0, 1, 2, 3, 4, 5], "GetCatalogResponse");
  return {
    protocolVersion: requireU32(map, 0, "GetCatalogResponse"),
    configVersion: requireU32(map, 1, "GetCatalogResponse"),
    fingerprint: bytesToHex(requireBytes(map, 2, "GetCatalogResponse")),
    drivers: requireArray(map, 3, "GetCatalogResponse").map(decodeDriver),
    nextCursor: requireU32(map, 4, "GetCatalogResponse"),
    driverCount: requireU32(map, 5, "GetCatalogResponse"),
  };
}

export function encodeCatalogPage(page: CatalogPage): Uint8Array {
  const drivers = page.drivers.map((d) =>
    encodeMap([textField(0, d.typeId), u32Field(1, d.commandCount)]),
  );
  const fp = Uint8Array.from(
    (page.fingerprint.match(/.{2}/g) ?? []).map((h) => Number.parseInt(h, 16)),
  );
  if (fp.length !== 32) {
    throw new ProtocolCodecError("catalog fingerprint must be 32 bytes (64 hex chars)");
  }
  return encodeMap([
    u32Field(0, page.protocolVersion),
    u32Field(1, page.configVersion),
    [2, encodeBytes(fp)],
    [3, encodeArray(drivers)],
    u32Field(4, page.nextCursor),
    u32Field(5, page.driverCount),
  ]);
}

export function mergeCatalogPages(pages: CatalogPage[]): Catalog {
  if (pages.length === 0) {
    throw new ProtocolCodecError("empty catalog pages");
  }
  const fingerprint = pages[0]!.fingerprint;
  const drivers: CatalogDriver[] = [];
  for (const page of pages) {
    if (page.fingerprint !== fingerprint) {
      throw new ProtocolCodecError("catalog fingerprint changed during pagination");
    }
    drivers.push(...page.drivers);
  }
  const last = pages[pages.length - 1]!;
  return {
    protocolVersion: last.protocolVersion,
    configVersion: last.configVersion,
    fingerprint,
    drivers,
    driverCount: last.driverCount,
  };
}

export function fingerprintEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function attachDriverSchema(
  driver: CatalogDriver,
  fields: CatalogField[],
  commands: { commandId: number; name: string }[],
): CatalogDriver {
  return { ...driver, fields, commands };
}

export function semanticFromCode(code: number): FieldSemantic {
  return SEMANTICS[code] ?? "value";
}

export function valueTypeFromCode(code: number): WireValueType {
  return VALUE_TYPES[code] ?? "uint64";
}

export function emptyCatalogPayload(): Uint8Array {
  return encodeEmptyMap();
}

export function encodeDriverTypeId(typeId: string): Uint8Array {
  return encodeText(typeId);
}
