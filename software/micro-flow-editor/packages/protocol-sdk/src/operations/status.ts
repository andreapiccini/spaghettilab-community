import { decodeOne, encodeArray } from "../cbor.js";
import { boolField, bytesField, decodeEmptyPayload, encodeEmptyPayload, encodeMap, requireArray, requireBool, requireBytes, requireMap, requireText, requireU32, textField, u32Field } from "../fields.js";

/** `GET_STATUS` (op 2) has an empty request payload. */
export const encodeGetStatusRequest = encodeEmptyPayload;
export function decodeGetStatusRequest(bytes: Uint8Array): void {
  decodeEmptyPayload(bytes, "GetStatusRequest");
}

/**
 * `GET_STATUS` (op 2) response — `status.c`. Enum-shaped fields (`state`,
 * `mode`, `imageState`, `healthState`, module `state`, `endpointKind`) are
 * kept as plain numbers rather than guessed TS enum members: this pass only
 * has the enum *names* from the firmware source
 * (`spaghetti_core_state`/`_mode`/`_image_state`/`_health_state`/
 * `_module_state`, `endpoint.kind`), not their integer→label mapping —
 * inventing labels here would be worse than leaving the raw number, which
 * round-trips correctly regardless. Resolving real labels is a follow-up,
 * not a codec-correctness requirement.
 */
export type ModuleStatus = {
  readonly key: number;
  readonly id: number;
  readonly portId: number;
  readonly state: number;
  readonly endpointKind: number;
  /** First up to 4 raw bytes of `endpoint.value` reinterpreted as uint32 by the firmware — not a semantically meaningful integer on its own, see the S021 research note. */
  readonly endpointValueRaw: number;
  readonly typeId: string;
};

export type ChainPeerStatus = {
  readonly physical?: Uint8Array;
  readonly nodeId: number;
  readonly mac: Uint8Array;
  readonly flags: number;
  readonly local: boolean;
  /** Signed image version from the peer. Absent on older images. */
  readonly version?: string;
};

export type GetStatusResponse = {
  readonly physical?: Uint8Array;
  readonly state: number;
  readonly mode: number;
  readonly imageState: number;
  readonly activeSlot: number;
  readonly imageConfirmed: boolean;
  readonly version: string;
  readonly portCount: number;
  readonly lastResetCause: number;
  readonly healthState: number;
  readonly modules: readonly ModuleStatus[];
  /** Hardware-derived identity from firmware `spaghetti_identity` — absent on older images. */
  readonly deviceId?: Uint8Array;
  /** Friendly name from Settings; empty string when unset. Absent on older images. */
  readonly deviceName?: string;
  /** Live CAN/USB chain from the last Discover sweep. Absent on older images. */
  readonly chainPeers?: readonly ChainPeerStatus[];
  /** Live Type-A tags on this board and, when this session is a master, on CAN peers. */
  readonly nfcTags?: readonly NfcTagStatus[];
};

export type NfcTagStatus = {
  readonly portId: number;
  readonly typeId: string;
  readonly uid: Uint8Array;
  readonly nodeId: number;
  readonly local: boolean;
  /** SLM1 `module_type_id`. Absent on pre-SLM1 firmware images. */
  readonly moduleTypeId?: number;
  /** SLM1 `vendor_id`. Absent on pre-SLM1 firmware images. */
  readonly vendorId?: number;
  /** SLM1 `fallback_class`. Absent on pre-SLM1 firmware images. */
  readonly fallbackClass?: number;
  /** SLM1 `registry_id`. Absent on pre-SLM1 firmware images. */
  readonly registryId?: number;
};

export function encodeGetStatusResponse(r: GetStatusResponse): Uint8Array {
  const modules = r.modules.map((m) =>
    encodeMap([
      u32Field(0, m.key),
      u32Field(1, m.id),
      u32Field(2, m.portId),
      u32Field(3, m.state),
      u32Field(4, m.endpointKind),
      u32Field(5, m.endpointValueRaw),
      textField(6, m.typeId),
    ]),
  );
  const fields: Array<readonly [number, Uint8Array]> = [
    u32Field(0, r.state),
    u32Field(1, r.mode),
    u32Field(2, r.imageState),
    u32Field(3, r.activeSlot),
    boolField(4, r.imageConfirmed),
    textField(5, r.version),
    u32Field(6, r.portCount),
    u32Field(7, r.lastResetCause),
    u32Field(8, r.healthState),
    [9, encodeArray(modules)],
  ];
  if (r.deviceId !== undefined) {
    fields.push(bytesField(10, r.deviceId));
  }
  if (r.deviceName !== undefined) {
    fields.push(textField(11, r.deviceName));
  }
  if (r.chainPeers !== undefined) {
    fields.push([
      12,
      encodeArray(
        r.chainPeers.map((peer) =>
          encodeMap([
            u32Field(0, peer.nodeId),
            bytesField(1, peer.mac),
            u32Field(2, peer.flags),
            boolField(3, peer.local),
            ...(peer.version !== undefined ? [textField(4, peer.version)] : []),
            ...(peer.physical !== undefined ? [bytesField(5, peer.physical)] : []),
          ]),
        ),
      ),
    ]);
  }
  if (r.nfcTags !== undefined) {
    fields.push([
      13,
      encodeArray(
        r.nfcTags.map((tag) =>
          encodeMap([
            u32Field(0, tag.portId),
            textField(1, tag.typeId),
            bytesField(2, tag.uid),
            u32Field(3, tag.nodeId),
            boolField(4, tag.local),
            ...(tag.moduleTypeId !== undefined ? [u32Field(5, tag.moduleTypeId)] : []),
            ...(tag.vendorId !== undefined ? [u32Field(6, tag.vendorId)] : []),
            ...(tag.fallbackClass !== undefined ? [u32Field(7, tag.fallbackClass)] : []),
            ...(tag.registryId !== undefined ? [u32Field(8, tag.registryId)] : []),
          ]),
        ),
      ),
    ]);
  }
  if (r.physical !== undefined) fields.push(bytesField(14, r.physical));
  return encodeMap(fields);
}

export function decodeGetStatusResponse(bytes: Uint8Array): GetStatusResponse {
  const map = requireMap(decodeOne(bytes), "GetStatusResponse");
  const modules = requireArray(map, 9, "GetStatusResponse").map((entry) => {
    const m = requireMap(entry, "GetStatusResponse.modules[]");
    return {
      key: requireU32(m, 0, "ModuleStatus"),
      id: requireU32(m, 1, "ModuleStatus"),
      portId: requireU32(m, 2, "ModuleStatus"),
      state: requireU32(m, 3, "ModuleStatus"),
      endpointKind: requireU32(m, 4, "ModuleStatus"),
      endpointValueRaw: requireU32(m, 5, "ModuleStatus"),
      typeId: requireText(m, 6, "ModuleStatus"),
    };
  });
  return {
    state: requireU32(map, 0, "GetStatusResponse"),
    mode: requireU32(map, 1, "GetStatusResponse"),
    imageState: requireU32(map, 2, "GetStatusResponse"),
    activeSlot: requireU32(map, 3, "GetStatusResponse"),
    imageConfirmed: requireBool(map, 4, "GetStatusResponse"),
    version: requireText(map, 5, "GetStatusResponse"),
    portCount: requireU32(map, 6, "GetStatusResponse"),
    lastResetCause: requireU32(map, 7, "GetStatusResponse"),
    healthState: requireU32(map, 8, "GetStatusResponse"),
    modules,
    ...(map.has(14) ? { physical: requireBytes(map, 14, "GetStatusResponse") } : {}),
    ...(map.get(10)?.kind === "bytes" ? { deviceId: requireBytes(map, 10, "GetStatusResponse") } : {}),
    ...(map.get(11)?.kind === "text" ? { deviceName: requireText(map, 11, "GetStatusResponse") } : {}),
    ...(map.get(12)?.kind === "array"
      ? {
          chainPeers: requireArray(map, 12, "GetStatusResponse").map((entry) => {
            const peer = requireMap(entry, "GetStatusResponse.chainPeers[]");
            return {
              nodeId: requireU32(peer, 0, "ChainPeerStatus"),
              mac: requireBytes(peer, 1, "ChainPeerStatus"),
              flags: requireU32(peer, 2, "ChainPeerStatus"),
              local: requireBool(peer, 3, "ChainPeerStatus"),
              ...(peer.get(4)?.kind === "text" ? { version: requireText(peer, 4, "ChainPeerStatus") } : {}),
              ...(peer.has(5) ? { physical: requireBytes(peer, 5, "ChainPeerStatus") } : {}),
            };
          }),
        }
      : {}),
    ...(map.get(13)?.kind === "array"
      ? {
          nfcTags: requireArray(map, 13, "GetStatusResponse").map((entry) => {
            const tag = requireMap(entry, "GetStatusResponse.nfcTags[]");
            return {
              portId: requireU32(tag, 0, "NfcTagStatus"),
              typeId: requireText(tag, 1, "NfcTagStatus"),
              uid: requireBytes(tag, 2, "NfcTagStatus"),
              nodeId: requireU32(tag, 3, "NfcTagStatus"),
              local: requireBool(tag, 4, "NfcTagStatus"),
              ...(tag.get(5)?.kind === "uint" ? { moduleTypeId: requireU32(tag, 5, "NfcTagStatus") } : {}),
              ...(tag.get(6)?.kind === "uint" ? { vendorId: requireU32(tag, 6, "NfcTagStatus") } : {}),
              ...(tag.get(7)?.kind === "uint" ? { fallbackClass: requireU32(tag, 7, "NfcTagStatus") } : {}),
              ...(tag.get(8)?.kind === "uint" ? { registryId: requireU32(tag, 8, "NfcTagStatus") } : {}),
            };
          }),
        }
      : {}),
  };
}
