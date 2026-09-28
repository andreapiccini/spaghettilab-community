import {
  decodeOne,
  encodeBool,
  encodeBytes,
  encodeInt,
  encodeMap,
  encodeText,
  encodeUint,
  ProtocolCodecError,
  type CborValue,
} from "./cbor.js";

/** Shared field-map read/write helpers for the 27 operations and 4 event payloads. */

export type FieldMap = ReadonlyMap<number, CborValue>;

function get(map: FieldMap, key: number, context: string): CborValue {
  const value = map.get(key);
  if (value === undefined) {
    throw new ProtocolCodecError(`${context}: missing required field ${key}`);
  }
  return value;
}

export function requireU32(map: FieldMap, key: number, context: string): number {
  const value = get(map, key, context);
  if (value.kind !== "uint") throw new ProtocolCodecError(`${context}: field ${key} must be a uint`);
  if (value.value > 0xffffffffn) throw new ProtocolCodecError(`${context}: field ${key} exceeds uint32 range`);
  return Number(value.value);
}

export function optionalU32(map: FieldMap, key: number, defaultValue: number, context: string): number {
  const value = map.get(key);
  if (value === undefined) return defaultValue;
  if (value.kind !== "uint") throw new ProtocolCodecError(`${context}: field ${key} must be a uint`);
  return Number(value.value);
}

/** Signed or unsigned 64-bit field — `boot_id`/`uptime_ms`/`lease_expires_at_ms` and the `int32` error fields all use this. */
export function requireInt64(map: FieldMap, key: number, context: string): bigint {
  const value = get(map, key, context);
  if (value.kind !== "uint" && value.kind !== "int") {
    throw new ProtocolCodecError(`${context}: field ${key} must be an integer`);
  }
  return value.value;
}

export function requireBytes(map: FieldMap, key: number, context: string): Uint8Array {
  const value = get(map, key, context);
  if (value.kind !== "bytes") throw new ProtocolCodecError(`${context}: field ${key} must be a byte string`);
  return value.value;
}

export function requireText(map: FieldMap, key: number, context: string): string {
  const value = get(map, key, context);
  if (value.kind !== "text") throw new ProtocolCodecError(`${context}: field ${key} must be a text string`);
  return value.value;
}

export function requireBool(map: FieldMap, key: number, context: string): boolean {
  const value = get(map, key, context);
  if (value.kind !== "bool") throw new ProtocolCodecError(`${context}: field ${key} must be a boolean`);
  return value.value;
}

export function requireArray(map: FieldMap, key: number, context: string): readonly CborValue[] {
  const value = get(map, key, context);
  if (value.kind !== "array") throw new ProtocolCodecError(`${context}: field ${key} must be an array`);
  return value.value;
}

export function requireMap(value: CborValue, context: string): FieldMap {
  if (value.kind !== "map") throw new ProtocolCodecError(`${context}: expected a map entry`);
  return value.value;
}

/** Reads a required nested map field (e.g. a `ResourcePool` sub-map). */
export function requireMapField(map: FieldMap, key: number, context: string): FieldMap {
  return requireMap(get(map, key, context), context);
}

// --- encoding side: [key, encoded-value] pair builders, fed to encodeMap ---

export type FieldPair = readonly [number, Uint8Array];

export function u32Field(key: number, value: number): FieldPair {
  return [key, encodeUint(BigInt(value))];
}

export function int64Field(key: number, value: bigint): FieldPair {
  return [key, encodeInt(value)];
}

export function bytesField(key: number, value: Uint8Array): FieldPair {
  return [key, encodeBytes(value)];
}

export function textField(key: number, value: string): FieldPair {
  return [key, encodeText(value)];
}

export function boolField(key: number, value: boolean): FieldPair {
  return [key, encodeBool(value)];
}

export { encodeMap };

export const EMPTY_PAYLOAD_MAP: readonly FieldPair[] = [];

/** The canonical empty-map payload (`0xA0`) used by every operation whose request or response carries no fields — success/absence is signaled by the envelope alone. */
export function encodeEmptyPayload(): Uint8Array {
  return encodeMap([]);
}

/** Validates that a payload is exactly the empty map, rather than silently ignoring unexpected fields. */
export function decodeEmptyPayload(bytes: Uint8Array, context: string): void {
  const value = decodeOne(bytes);
  if (value.kind !== "map" || value.value.size !== 0) {
    throw new ProtocolCodecError(`${context}: expected an empty payload map`);
  }
}

/**
 * Shared `{0: job_id}` shape returned by an actual `SPAGHETTI_OPERATION_ASYNC_JOB`
 * handler. `SCAN_DISCOVERY` (op 5) is the only one of the 27 Protocol V1
 * operations that is genuinely `ASYNC_JOB`
 * (`firmware/backbone/subsys/communication/operations/discovery_ops.c`) —
 * confirmed by grep across every `operations/*.c` file. `OPEN_NETWORK_MAINTENANCE`
 * and `OPEN_WIFI_UPDATE` were previously (and incorrectly) documented here
 * too; both are actually `SERIALIZED_MUTATION` and return a handover
 * acknowledgment, not a job id — see `HandoverAckResponse` below.
 */
export type JobIdResponse = { readonly jobId: number };

export function encodeJobIdResponse(r: JobIdResponse): Uint8Array {
  return encodeMap([u32Field(0, r.jobId)]);
}

export function decodeJobIdResponse(bytes: Uint8Array): JobIdResponse {
  const map = requireMap(decodeOne(bytes), "JobIdResponse");
  return { jobId: requireU32(map, 0, "JobIdResponse") };
}

/**
 * Shared response shape for `OPEN_NETWORK_MAINTENANCE` (op 13) and
 * `OPEN_WIFI_UPDATE` (op 14) — both route through `run_wifi_handover()`
 * (`connectivity_ops.c`), which always finishes with `encode_handover_ack()`
 * (`connectivity_ops.c:88-113`): a 4-key map, `{0: address(tstr), 1:
 * port(uint), 2: lease_expires_at_ms(int64), 3: reached_state(uint32)}`.
 * Corrects a prior mistake in this SDK, which decoded both as the unrelated
 * `{0: job_id}` shape (see `JobIdResponse` above) — neither operation is
 * actually `ASYNC_JOB` on the firmware side. `reachedState` means a
 * different enum depending on which operation produced it: OTA state for
 * `OPEN_WIFI_UPDATE`, remote-console state for `OPEN_NETWORK_MAINTENANCE` —
 * this SDK does not decode either enum's labels, same "leave it a raw
 * number, don't guess a label table" policy as `GetStatusResponse.lastResetCause`.
 */
export type HandoverAckResponse = {
  readonly address: string;
  readonly port: number;
  readonly leaseExpiresAtMs: bigint;
  readonly reachedStateRaw: number;
};

export function encodeHandoverAckResponse(r: HandoverAckResponse): Uint8Array {
  return encodeMap([textField(0, r.address), u32Field(1, r.port), int64Field(2, r.leaseExpiresAtMs), u32Field(3, r.reachedStateRaw)]);
}

export function decodeHandoverAckResponse(bytes: Uint8Array): HandoverAckResponse {
  const map = requireMap(decodeOne(bytes), "HandoverAckResponse");
  return {
    address: requireText(map, 0, "HandoverAckResponse"),
    port: requireU32(map, 1, "HandoverAckResponse"),
    leaseExpiresAtMs: requireInt64(map, 2, "HandoverAckResponse"),
    reachedStateRaw: requireU32(map, 3, "HandoverAckResponse"),
  };
}
