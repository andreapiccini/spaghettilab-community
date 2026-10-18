import {
  decodeOne,
  encodeInt,
  encodeFloat,
  encodeText,
  encodeBool,
  encodeBytes,
  ProtocolCodecError,
} from "./cbor.js";
import {
  encodeMap,
  requireBytes,
  requireInt64,
  requireMap,
  requireText,
  requireU32,
  u32Field,
  bytesField,
  int64Field,
  textField,
} from "./fields.js";

/** `spaghetti_protocol_encode_record_event_payload`, `protocol_cbor.c` — `EventType.RECORD` payload. */
export type RecordEventPayload = {
  readonly sourceKey: number;
  readonly sequence: number;
  readonly schemaId: string;
  readonly schemaVersion: number;
  readonly actionId?: number;
  readonly fields?: Readonly<
    Record<number, bigint | number | string | boolean | Uint8Array>
  >;
};

export function encodeRecordEventPayload(p: RecordEventPayload): Uint8Array {
  return encodeMap([
    u32Field(0, p.sourceKey),
    u32Field(1, p.sequence),
    textField(2, p.schemaId),
    u32Field(3, p.schemaVersion),
    ...(p.fields
      ? [
          [
            4,
            encodeMap(
              Object.entries(p.fields).map(
                ([id, value]) =>
                  [
                    Number(id),
                    typeof value === "bigint"
                      ? encodeInt(value)
                      : typeof value === "number"
                        ? encodeFloat(value)
                        : typeof value === "string"
                          ? encodeText(value)
                          : typeof value === "boolean"
                            ? encodeBool(value)
                            : encodeBytes(value),
                  ] as const,
              ),
            ),
          ] as const,
        ]
      : []),
    ...(p.actionId !== undefined ? [u32Field(5, p.actionId)] : []),
  ]);
}

export function decodeRecordEventPayload(bytes: Uint8Array): RecordEventPayload {
  const map = requireMap(decodeOne(bytes), "RecordEventPayload");
  let fields:
    Record<number, bigint | number | string | boolean | Uint8Array> | undefined;
  if (map.has(4)) {
    const values = requireMap(map.get(4)!, "Record fields");
    if (values.size > 8) throw new ProtocolCodecError("Too many record fields");
    fields = {};
    for (const [id, value] of values) {
      if (
        id < 1 ||
        id > 65535 ||
        !["uint", "int", "float", "text", "bool", "bytes"].includes(value.kind)
      )
        throw new ProtocolCodecError("Invalid record field");
      if (
        value.kind === "uint" ||
        value.kind === "int" ||
        value.kind === "float" ||
        value.kind === "text" ||
        value.kind === "bool" ||
        value.kind === "bytes"
      )
        fields[id] = value.value;
    }
  }
  return {
    ...(fields ? { fields } : {}),
    ...(map.has(5) ? { actionId: requireU32(map, 5, "RecordEventPayload") } : {}),
    sourceKey: requireU32(map, 0, "RecordEventPayload"),
    sequence: requireU32(map, 1, "RecordEventPayload"),
    schemaId: requireText(map, 2, "RecordEventPayload"),
    schemaVersion: requireU32(map, 3, "RecordEventPayload"),
  };
}

/** `EventType.STATUS` payload — `boot_id` is `uint64`, never a JS `number` (see `int64.ts`). */
export type StatusEventPayload = {
  readonly deviceId: Uint8Array;
  readonly bootId: bigint;
  readonly queueDepth: number;
  readonly dropCount: number;
};

export function encodeStatusEventPayload(p: StatusEventPayload): Uint8Array {
  return encodeMap([
    bytesField(0, p.deviceId),
    int64Field(1, p.bootId),
    u32Field(2, p.queueDepth),
    u32Field(3, p.dropCount),
  ]);
}

export function decodeStatusEventPayload(bytes: Uint8Array): StatusEventPayload {
  const map = requireMap(decodeOne(bytes), "StatusEventPayload");
  return {
    deviceId: requireBytes(map, 0, "StatusEventPayload"),
    bootId: requireInt64(map, 1, "StatusEventPayload"),
    queueDepth: requireU32(map, 2, "StatusEventPayload"),
    dropCount: requireU32(map, 3, "StatusEventPayload"),
  };
}

/** `EventType.DISCOVERY` payload. */
export type DiscoveryEventPayload = {
  readonly candidateId: number;
  readonly portId: number;
  readonly generation: number;
};

export function encodeDiscoveryEventPayload(p: DiscoveryEventPayload): Uint8Array {
  return encodeMap([
    u32Field(0, p.candidateId),
    u32Field(1, p.portId),
    u32Field(2, p.generation),
  ]);
}

export function decodeDiscoveryEventPayload(bytes: Uint8Array): DiscoveryEventPayload {
  const map = requireMap(decodeOne(bytes), "DiscoveryEventPayload");
  return {
    candidateId: requireU32(map, 0, "DiscoveryEventPayload"),
    portId: requireU32(map, 1, "DiscoveryEventPayload"),
    generation: requireU32(map, 2, "DiscoveryEventPayload"),
  };
}

/** `EventType.CONNECTIVITY` payload — `lastError` is a signed `int32` (raw firmware errno, can be negative). */
export type ConnectivityEventPayload = {
  readonly policy: number;
  readonly activeServices: number;
  readonly lastError: bigint;
};

export function encodeConnectivityEventPayload(
  p: ConnectivityEventPayload,
): Uint8Array {
  return encodeMap([
    u32Field(0, p.policy),
    u32Field(1, p.activeServices),
    int64Field(2, p.lastError),
  ]);
}

export function decodeConnectivityEventPayload(
  bytes: Uint8Array,
): ConnectivityEventPayload {
  const map = requireMap(decodeOne(bytes), "ConnectivityEventPayload");
  return {
    policy: requireU32(map, 0, "ConnectivityEventPayload"),
    activeServices: requireU32(map, 1, "ConnectivityEventPayload"),
    lastError: requireInt64(map, 2, "ConnectivityEventPayload"),
  };
}
