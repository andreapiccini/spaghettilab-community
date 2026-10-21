import { decodeOne, encodeArray, encodeBytes, ProtocolCodecError } from "../cbor.js";
import {
  boolField,
  bytesField,
  encodeEmptyPayload,
  encodeMap,
  requireBool,
  requireBytes,
  requireMap,
  requireU32,
  u32Field,
} from "../fields.js";

/** `GET_CONFIG` (op 16) optionally requests a chunk at a byte offset. */
export function encodeGetConfigRequest(offset?: number): Uint8Array {
  return offset === undefined ? encodeEmptyPayload() : encodeMap([u32Field(0, offset)]);
}
export function decodeGetConfigRequest(bytes: Uint8Array): number | undefined {
  if (bytes.length === 0) return undefined;
  const map = requireMap(decodeOne(bytes), "GetConfigRequest");
  if (map.size === 0) return undefined;
  if (map.size !== 1 || !map.has(0))
    throw new ProtocolCodecError("Invalid GetConfigRequest fields");
  return requireU32(map, 0, "GetConfigRequest");
}

/**
 * `GET_CONFIG` (op 16) response — `config_ops.c`. The Config CBOR itself is
 * kept opaque (`Uint8Array`) *in this package* — decoding it is not this
 * package's job, only its placement inside this envelope's payload is.
 * Correction (S072): a real, complete decoder for these bytes does exist —
 * `firmware/backbone/subsys/config/config_cbor.c`'s `spaghetti_config_encode_cbor`/
 * `decode_wire_v3` — targeting wire version 4
 * (`SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V3`), distinct from the in-memory
 * `SPAGHETTI_CONFIG_VERSION` (5). See `@spaghettilab/config-compiler`, which
 * produces these exact bytes from the authoring graph (encode direction);
 * S073 is the task that will add the decode direction. The earlier note here
 * ("CDDL only goes up to v3... not yet specified") predated reading that
 * file and was wrong.
 */
export type GetConfigResponse = {
  readonly generation: number;
  readonly sha256: Uint8Array;
  readonly configBytes: Uint8Array;
  readonly totalSize?: number;
  readonly offset?: number;
};

export function encodeGetConfigResponse(r: GetConfigResponse): Uint8Array {
  return encodeMap([
    u32Field(0, r.generation),
    bytesField(1, r.sha256),
    bytesField(2, r.configBytes),
    ...(r.totalSize === undefined
      ? []
      : [u32Field(3, r.totalSize), u32Field(4, r.offset ?? 0)]),
  ]);
}

export function decodeGetConfigResponse(bytes: Uint8Array): GetConfigResponse {
  const map = requireMap(decodeOne(bytes), "GetConfigResponse");
  return {
    generation: requireU32(map, 0, "GetConfigResponse"),
    sha256: requireBytes(map, 1, "GetConfigResponse"),
    configBytes: requireBytes(map, 2, "GetConfigResponse"),
    ...(map.has(3)
      ? {
          totalSize: requireU32(map, 3, "GetConfigResponse"),
          offset: requireU32(map, 4, "GetConfigResponse"),
        }
      : {}),
  };
}

/** `VALIDATE_CONFIG` (op 17) request. */
export type ValidateConfigRequest = { readonly configBytes: Uint8Array };

export function encodeValidateConfigRequest(r: ValidateConfigRequest): Uint8Array {
  return encodeMap([bytesField(0, r.configBytes)]);
}

export function decodeValidateConfigRequest(bytes: Uint8Array): ValidateConfigRequest {
  const map = requireMap(decodeOne(bytes), "ValidateConfigRequest");
  return { configBytes: requireBytes(map, 0, "ValidateConfigRequest") };
}

/**
 * `VALIDATE_CONFIG` response. Envelope status is always `OK` for this
 * operation even when the config itself is invalid — invalidity is signaled
 * inside this payload's `valid: false`, not via the envelope's status field
 * (see the S021 research note).
 */
export type ValidateConfigResponse =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly failureField: number;
      readonly failureIndex: number;
      readonly failureReason: number;
    };

export function encodeValidateConfigResponse(r: ValidateConfigResponse): Uint8Array {
  if (r.valid) {
    return encodeMap([boolField(0, true)]);
  }
  return encodeMap([
    boolField(0, false),
    u32Field(1, r.failureField),
    u32Field(2, r.failureIndex),
    u32Field(3, r.failureReason),
  ]);
}

export function decodeValidateConfigResponse(
  bytes: Uint8Array,
): ValidateConfigResponse {
  const map = requireMap(decodeOne(bytes), "ValidateConfigResponse");
  const valid = requireBool(map, 0, "ValidateConfigResponse");
  if (valid) return { valid: true };
  return {
    valid: false,
    failureField: requireU32(map, 1, "ValidateConfigResponse"),
    failureIndex: requireU32(map, 2, "ValidateConfigResponse"),
    failureReason: requireU32(map, 3, "ValidateConfigResponse"),
  };
}

/** `APPLY_CONFIG` (op 3) request — `expectedGeneration` implements compare-and-swap; a mismatch maps to `ProtocolStatus.CONFLICT` (`-ESTALE`). */
export type ApplyConfigRequest = {
  readonly expectedGeneration: number;
  readonly configBytes: Uint8Array;
};

export function encodeApplyConfigRequest(r: ApplyConfigRequest): Uint8Array {
  return encodeMap([u32Field(0, r.expectedGeneration), bytesField(1, r.configBytes)]);
}

export function decodeApplyConfigRequest(bytes: Uint8Array): ApplyConfigRequest {
  const map = requireMap(decodeOne(bytes), "ApplyConfigRequest");
  return {
    expectedGeneration: requireU32(map, 0, "ApplyConfigRequest"),
    configBytes: requireBytes(map, 1, "ApplyConfigRequest"),
  };
}

export type ApplyConfigResponse = {
  readonly rxReads?: readonly Uint8Array[];
  readonly rxTruncated?: boolean;
  readonly changed: boolean;
  readonly generation: number;
  readonly sha256: Uint8Array;
};

export function encodeApplyConfigResponse(r: ApplyConfigResponse): Uint8Array {
  return encodeMap([
    boolField(0, r.changed),
    u32Field(1, r.generation),
    bytesField(2, r.sha256),
    ...(r.rxReads
      ? [
          [3, encodeArray(r.rxReads.map(encodeBytes))] as const,
          boolField(4, r.rxTruncated ?? false),
        ]
      : []),
  ]);
}

export function decodeApplyConfigResponse(bytes: Uint8Array): ApplyConfigResponse {
  const map = requireMap(decodeOne(bytes), "ApplyConfigResponse");
  return {
    ...(map.has(3)
      ? {
          rxReads: (() => {
            const value = map.get(3)!;
            if (value.kind !== "array" || value.value.length > 8)
              throw new ProtocolCodecError("ApplyConfigResponse: invalid RX capture");
            return value.value.map((entry) => {
              if (entry.kind !== "bytes" || entry.value.length > 8)
                throw new ProtocolCodecError("ApplyConfigResponse: invalid RX bytes");
              return entry.value;
            });
          })(),
          rxTruncated: requireBool(map, 4, "ApplyConfigResponse"),
        }
      : {}),
    changed: requireBool(map, 0, "ApplyConfigResponse"),
    generation: requireU32(map, 1, "ApplyConfigResponse"),
    sha256: requireBytes(map, 2, "ApplyConfigResponse"),
  };
}

/** Bounded upload extension. Only the final chunk validates or commits. */
export function encodeConfigChunk(
  operation: "validate" | "apply",
  configBytes: Uint8Array,
  token: number,
  offset: number,
  total: number,
  generation = 0,
): Uint8Array {
  return encodeMap([
    ...(operation === "apply" ? [u32Field(0, generation)] : []),
    bytesField(operation === "apply" ? 1 : 0, configBytes),
    u32Field(10, token),
    u32Field(11, offset),
    u32Field(12, total),
  ]);
}
