import {
  CborReader,
  encodeBytes,
  encodeMap,
  encodeUint,
  ProtocolCodecError,
} from "./cbor.js";

/**
 * Protocol V1 envelope — the same 4-field CBOR map for request, response and
 * event, per `firmware/backbone/include/spaghetti/protocol.h` and
 * `protocol_cbor.c`'s `encode_envelope`/`decode_envelope`. Field 1 means
 * `correlation_id` for request/response and `sequence` for events; field 2
 * means `operation`/`status`/`event type` respectively — the shape is
 * identical, only the value's meaning shifts, matching the firmware's own
 * single shared encoder.
 */

export const PROTOCOL_VERSION = 1;
/** `SPAGHETTI_PROTOCOL_PAYLOAD_ABSOLUTE_MAX` — the hard ceiling regardless of build profile. */
export const PAYLOAD_ABSOLUTE_MAX = 2048;

const KEY_VERSION = 0;
const KEY_FIELD1 = 1;
const KEY_FIELD2 = 2;
const KEY_PAYLOAD = 3;

/** `enum spaghetti_protocol_operation`, `protocol.h` — stable numeric IDs 1..31 (28-31 added for BLE OTA, Firmware commit 875c115). */
export enum Operation {
  GET_CATALOG = 1,
  GET_STATUS = 2,
  APPLY_CONFIG = 3,
  LIST_DISCOVERY = 4,
  SCAN_DISCOVERY = 5,
  ACCEPT_DISCOVERY = 6,
  MODULE_COMMAND = 7,
  GET_UPDATE_STATUS = 8,
  GET_CAPABILITIES = 9,
  GET_CONNECTIVITY_STATUS = 10,
  ACQUIRE_CONNECTIVITY_LEASE = 11,
  RELEASE_CONNECTIVITY_LEASE = 12,
  OPEN_NETWORK_MAINTENANCE = 13,
  OPEN_WIFI_UPDATE = 14,
  FACTORY_RESET = 15,
  GET_CONFIG = 16,
  VALIDATE_CONFIG = 17,
  GET_AUDIT_LOG = 18,
  GET_JOB_STATUS = 19,
  GET_TOPOLOGY = 20,
  GET_RESOURCES = 21,
  LIST_DEVICE_PROFILES = 22,
  GET_DEVICE_PROFILE = 23,
  VALIDATE_DEVICE_PROFILE = 24,
  INSTALL_DEVICE_PROFILE = 25,
  REMOVE_DEVICE_PROFILE = 26,
  GET_FEATURES = 27,
  OPEN_BLE_UPDATE = 28,
  WRITE_BLE_UPDATE = 29,
  FINISH_BLE_UPDATE = 30,
  CANCEL_BLE_UPDATE = 31,
}

/** `enum spaghetti_protocol_status`, `protocol.h` — 0..10. */
export enum ProtocolStatus {
  OK = 0,
  INVALID_ARGUMENT = 1,
  UNSUPPORTED = 2,
  UNAUTHORIZED = 3,
  CONFLICT = 4,
  BUSY = 5,
  UNAVAILABLE = 6,
  TIMEOUT = 7,
  RESOURCE_EXHAUSTED = 8,
  MALFORMED_REQUEST = 9,
  INTERNAL_ERROR = 10,
}

/** `enum spaghetti_protocol_event_type`, `protocol.h` — 1..4. */
export enum EventType {
  RECORD = 1,
  STATUS = 2,
  DISCOVERY = 3,
  CONNECTIVITY = 4,
}

const OPERATION_MIN = Operation.GET_CATALOG;
const OPERATION_MAX = Operation.CANCEL_BLE_UPDATE;

export type RequestEnvelope = {
  readonly correlationId: number;
  readonly operation: Operation;
  readonly payload: Uint8Array;
};

export type ResponseEnvelope = {
  readonly correlationId: number;
  readonly status: ProtocolStatus;
  readonly payload: Uint8Array;
};

export type EventEnvelope = {
  readonly sequence: number;
  readonly type: EventType;
  readonly payload: Uint8Array;
};

function encodeEnvelope(
  field1: number,
  field2: number,
  payload: Uint8Array,
): Uint8Array {
  if (payload.length > PAYLOAD_ABSOLUTE_MAX) {
    throw new ProtocolCodecError(
      `payload of ${payload.length} bytes exceeds the ${PAYLOAD_ABSOLUTE_MAX}-byte limit`,
    );
  }
  return encodeMap([
    [KEY_VERSION, encodeUint(BigInt(PROTOCOL_VERSION))],
    [KEY_FIELD1, encodeUint(BigInt(field1))],
    [KEY_FIELD2, encodeUint(BigInt(field2))],
    [KEY_PAYLOAD, encodeBytes(payload)],
  ]);
}

export function encodeRequest(request: RequestEnvelope): Uint8Array {
  if (request.correlationId === 0)
    throw new ProtocolCodecError("correlationId must be nonzero");
  if (request.operation < OPERATION_MIN || request.operation > OPERATION_MAX) {
    throw new ProtocolCodecError(`invalid operation ${request.operation}`);
  }
  return encodeEnvelope(request.correlationId, request.operation, request.payload);
}

export function encodeResponse(response: ResponseEnvelope): Uint8Array {
  if (response.correlationId === 0)
    throw new ProtocolCodecError("correlationId must be nonzero");
  if (response.status < 0 || response.status > 10) {
    throw new ProtocolCodecError(`invalid status ${response.status}`);
  }
  return encodeEnvelope(response.correlationId, response.status, response.payload);
}

export function encodeEvent(event: EventEnvelope): Uint8Array {
  if (event.sequence === 0) throw new ProtocolCodecError("sequence must be nonzero");
  if (event.type < 1 || event.type > 4)
    throw new ProtocolCodecError(`invalid event type ${event.type}`);
  return encodeEnvelope(event.sequence, event.type, event.payload);
}

type RawEnvelope = {
  readonly field1: number;
  readonly field2: number;
  readonly payload: Uint8Array;
};

/**
 * Shared decode: exactly 4 keys (0..3), all mandatory, no unknown keys, no
 * trailing bytes after the envelope, version must equal 1 — mirrors
 * `decode_envelope`'s checks precisely (duplicate-key rejection already
 * happens inside `CborReader`'s map decoding).
 */
function decodeEnvelope(bytes: Uint8Array): RawEnvelope {
  const reader = new CborReader(bytes);
  const value = reader.readValue();
  if (reader.remaining !== 0) {
    throw new ProtocolCodecError("trailing bytes after envelope");
  }
  if (value.kind !== "map") {
    throw new ProtocolCodecError("envelope must be a CBOR map");
  }
  const map = value.value;
  for (const key of map.keys()) {
    if (key < 0 || key > 3)
      throw new ProtocolCodecError(`unexpected envelope key ${key}`);
  }
  for (const required of [KEY_VERSION, KEY_FIELD1, KEY_FIELD2, KEY_PAYLOAD]) {
    if (!map.has(required))
      throw new ProtocolCodecError(`missing envelope key ${required}`);
  }
  const version = map.get(KEY_VERSION)!;
  if (version.kind !== "uint" || version.value !== BigInt(PROTOCOL_VERSION)) {
    throw new ProtocolCodecError("unsupported envelope version");
  }
  const field1 = map.get(KEY_FIELD1)!;
  if (field1.kind !== "uint")
    throw new ProtocolCodecError("envelope field 1 must be a uint");
  if (field1.value === 0n)
    throw new ProtocolCodecError(
      "envelope field 1 (correlation/sequence) must be nonzero",
    );
  const field2 = map.get(KEY_FIELD2)!;
  if (field2.kind !== "uint")
    throw new ProtocolCodecError("envelope field 2 must be a uint");
  const payload = map.get(KEY_PAYLOAD)!;
  if (payload.kind !== "bytes")
    throw new ProtocolCodecError("envelope field 3 (payload) must be a byte string");
  if (payload.value.length > PAYLOAD_ABSOLUTE_MAX) {
    throw new ProtocolCodecError(
      `payload of ${payload.value.length} bytes exceeds the ${PAYLOAD_ABSOLUTE_MAX}-byte limit`,
    );
  }
  return {
    field1: Number(field1.value),
    field2: Number(field2.value),
    payload: payload.value,
  };
}

export function decodeRequest(bytes: Uint8Array): RequestEnvelope {
  const raw = decodeEnvelope(bytes);
  if (raw.field2 < OPERATION_MIN || raw.field2 > OPERATION_MAX)
    throw new ProtocolCodecError(`unsupported operation ${raw.field2}`);
  return {
    correlationId: raw.field1,
    operation: raw.field2 as Operation,
    payload: raw.payload,
  };
}

export function decodeResponse(bytes: Uint8Array): ResponseEnvelope {
  const raw = decodeEnvelope(bytes);
  if (raw.field2 > 10) throw new ProtocolCodecError(`unsupported status ${raw.field2}`);
  return {
    correlationId: raw.field1,
    status: raw.field2 as ProtocolStatus,
    payload: raw.payload,
  };
}

export function decodeEvent(bytes: Uint8Array): EventEnvelope {
  const raw = decodeEnvelope(bytes);
  if (raw.field2 < 1 || raw.field2 > 4)
    throw new ProtocolCodecError(`unsupported event type ${raw.field2}`);
  return { sequence: raw.field1, type: raw.field2 as EventType, payload: raw.payload };
}
