import { decodeOne, encodeArray, ProtocolCodecError } from "../cbor.js";
import {
  bytesField,
  decodeEmptyPayload,
  encodeEmptyPayload,
  encodeMap,
  optionalU32,
  requireArray,
  requireBytes,
  requireMap,
  requireText,
  requireU32,
  textField,
  u32Field,
} from "../fields.js";

/** `LIST_DEVICE_PROFILES` (op 22) request — `cursor` default 0, `limit` default 8. */
export type ListDeviceProfilesRequest = {
  readonly cursor?: number;
  readonly limit?: number;
};

export function encodeListDeviceProfilesRequest(
  r: ListDeviceProfilesRequest,
): Uint8Array {
  const pairs = [];
  if (r.cursor !== undefined) pairs.push(u32Field(0, r.cursor));
  if (r.limit !== undefined) pairs.push(u32Field(1, r.limit));
  return encodeMap(pairs);
}

export function decodeListDeviceProfilesRequest(
  bytes: Uint8Array,
): ListDeviceProfilesRequest {
  const map = requireMap(decodeOne(bytes), "ListDeviceProfilesRequest");
  return {
    cursor: optionalU32(map, 0, 0, "ListDeviceProfilesRequest"),
    limit: optionalU32(map, 1, 8, "ListDeviceProfilesRequest"),
  };
}

export type DeviceProfileSummary = {
  readonly profileId: string;
  readonly version: number;
  readonly hash: Uint8Array;
};

export type ListDeviceProfilesResponse = {
  readonly profiles: readonly DeviceProfileSummary[];
  readonly nextCursor: number;
};

export function encodeListDeviceProfilesResponse(
  r: ListDeviceProfilesResponse,
): Uint8Array {
  const profiles = r.profiles.map((p) =>
    encodeMap([
      textField(0, p.profileId),
      u32Field(1, p.version),
      bytesField(2, p.hash),
    ]),
  );
  return encodeMap([[0, encodeArray(profiles)], u32Field(1, r.nextCursor)]);
}

export function decodeListDeviceProfilesResponse(
  bytes: Uint8Array,
): ListDeviceProfilesResponse {
  const map = requireMap(decodeOne(bytes), "ListDeviceProfilesResponse");
  const profiles = requireArray(map, 0, "ListDeviceProfilesResponse").map((entry) => {
    const m = requireMap(entry, "ListDeviceProfilesResponse.profiles[]");
    return {
      profileId: requireText(m, 0, "DeviceProfileSummary"),
      version: requireU32(m, 1, "DeviceProfileSummary"),
      hash: requireBytes(m, 2, "DeviceProfileSummary"),
    };
  });
  return { profiles, nextCursor: requireU32(map, 1, "ListDeviceProfilesResponse") };
}

/** `GET_DEVICE_PROFILE` (op 23) request. */
export type GetDeviceProfileRequest = { readonly index: number };

export function encodeGetDeviceProfileRequest(r: GetDeviceProfileRequest): Uint8Array {
  return encodeMap([u32Field(0, r.index)]);
}

export function decodeGetDeviceProfileRequest(
  bytes: Uint8Array,
): GetDeviceProfileRequest {
  const map = requireMap(decodeOne(bytes), "GetDeviceProfileRequest");
  return { index: requireU32(map, 0, "GetDeviceProfileRequest") };
}

export type GetDeviceProfileResponse = {
  readonly profileId: string;
  readonly version: number;
  readonly hash: Uint8Array;
  readonly transport: number;
  readonly requiredCapabilities: number;
};

export function encodeGetDeviceProfileResponse(
  r: GetDeviceProfileResponse,
): Uint8Array {
  return encodeMap([
    textField(0, r.profileId),
    u32Field(1, r.version),
    bytesField(2, r.hash),
    u32Field(3, r.transport),
    u32Field(4, r.requiredCapabilities),
  ]);
}

export function decodeGetDeviceProfileResponse(
  bytes: Uint8Array,
): GetDeviceProfileResponse {
  const map = requireMap(decodeOne(bytes), "GetDeviceProfileResponse");
  return {
    profileId: requireText(map, 0, "GetDeviceProfileResponse"),
    version: requireU32(map, 1, "GetDeviceProfileResponse"),
    hash: requireBytes(map, 2, "GetDeviceProfileResponse"),
    transport: requireU32(map, 3, "GetDeviceProfileResponse"),
    requiredCapabilities: requireU32(map, 4, "GetDeviceProfileResponse"),
  };
}

/** `VALIDATE_DEVICE_PROFILE` (op 24) request/response. */
export type ValidateDeviceProfileRequest = {
  readonly profileCbor: Uint8Array;
  readonly upload?: {
    readonly offset: number;
    readonly total: number;
    readonly token: number;
  };
};

export function encodeValidateDeviceProfileRequest(
  r: ValidateDeviceProfileRequest,
): Uint8Array {
  return encodeMap([
    bytesField(0, r.profileCbor),
    ...(r.upload
      ? [
          u32Field(1, r.upload.offset),
          u32Field(2, r.upload.total),
          u32Field(3, r.upload.token),
        ]
      : []),
  ]);
}

export function decodeValidateDeviceProfileRequest(
  bytes: Uint8Array,
): ValidateDeviceProfileRequest {
  const map = requireMap(decodeOne(bytes), "ValidateDeviceProfileRequest");
  return {
    profileCbor: requireBytes(map, 0, "ValidateDeviceProfileRequest"),
    ...(map.has(2)
      ? {
          upload: {
            offset: requireU32(map, 1, "ProfileUpload"),
            total: requireU32(map, 2, "ProfileUpload"),
            token: requireU32(map, 3, "ProfileUpload"),
          },
        }
      : {}),
  };
}

/**
 * `VALIDATE_DEVICE_PROFILE` response — **this operation is a stub in the
 * firmware as implemented**: it only checks the request's `bstr` is
 * non-empty and answers “valid” (see the S021 research note's incompleteness
 * list). A caller cannot rely on it to catch a malformed Device Profile.
 *
 * Wire field 0 may be either a CBOR `uint` (`1`/`0`, historical stub) or a
 * CBOR `bool` (some Core builds mirror `VALIDATE_CONFIG`). Normalized to a
 * number here so callers stay unchanged.
 */
export type ValidateDeviceProfileResponse = { readonly valid: number };

export function encodeValidateDeviceProfileResponse(
  r: ValidateDeviceProfileResponse,
): Uint8Array {
  return encodeMap([u32Field(0, r.valid)]);
}

export function decodeValidateDeviceProfileResponse(
  bytes: Uint8Array,
): ValidateDeviceProfileResponse {
  const map = requireMap(decodeOne(bytes), "ValidateDeviceProfileResponse");
  const value = map.get(0);
  if (value === undefined) {
    throw new ProtocolCodecError(
      "ValidateDeviceProfileResponse: missing required field 0",
    );
  }
  if (value.kind === "uint") {
    if (value.value > 0xffffffffn) {
      throw new ProtocolCodecError(
        "ValidateDeviceProfileResponse: field 0 exceeds uint32 range",
      );
    }
    return { valid: Number(value.value) };
  }
  if (value.kind === "bool") {
    return { valid: value.value ? 1 : 0 };
  }
  throw new ProtocolCodecError(
    "ValidateDeviceProfileResponse: field 0 must be a uint or bool",
  );
}

/** `INSTALL_DEVICE_PROFILE` (op 25) request; response payload is an empty map. */
export type InstallDeviceProfileRequest = ValidateDeviceProfileRequest;

export function encodeInstallDeviceProfileRequest(
  r: InstallDeviceProfileRequest,
): Uint8Array {
  return encodeMap([
    bytesField(0, r.profileCbor),
    ...(r.upload
      ? [
          u32Field(1, r.upload.offset),
          u32Field(2, r.upload.total),
          u32Field(3, r.upload.token),
        ]
      : []),
  ]);
}

export function decodeInstallDeviceProfileRequest(
  bytes: Uint8Array,
): InstallDeviceProfileRequest {
  const map = requireMap(decodeOne(bytes), "InstallDeviceProfileRequest");
  return {
    profileCbor: requireBytes(map, 0, "InstallDeviceProfileRequest"),
    ...(map.has(2)
      ? {
          upload: {
            offset: requireU32(map, 1, "ProfileUpload"),
            total: requireU32(map, 2, "ProfileUpload"),
            token: requireU32(map, 3, "ProfileUpload"),
          },
        }
      : {}),
  };
}

export const encodeInstallDeviceProfileResponse = encodeEmptyPayload;
export function decodeInstallDeviceProfileResponse(bytes: Uint8Array): void {
  decodeEmptyPayload(bytes, "InstallDeviceProfileResponse");
}

/** `REMOVE_DEVICE_PROFILE` (op 26) request; response payload is an empty map. */
export type RemoveDeviceProfileRequest = {
  readonly idBytes: Uint8Array;
  readonly version: number;
};

export function encodeRemoveDeviceProfileRequest(
  r: RemoveDeviceProfileRequest,
): Uint8Array {
  return encodeMap([bytesField(0, r.idBytes), u32Field(1, r.version)]);
}

export function decodeRemoveDeviceProfileRequest(
  bytes: Uint8Array,
): RemoveDeviceProfileRequest {
  const map = requireMap(decodeOne(bytes), "RemoveDeviceProfileRequest");
  return {
    idBytes: requireBytes(map, 0, "RemoveDeviceProfileRequest"),
    version: requireU32(map, 1, "RemoveDeviceProfileRequest"),
  };
}

export const encodeRemoveDeviceProfileResponse = encodeEmptyPayload;
export function decodeRemoveDeviceProfileResponse(bytes: Uint8Array): void {
  decodeEmptyPayload(bytes, "RemoveDeviceProfileResponse");
}
