import { decodeOne, ProtocolCodecError } from "../cbor.js";
import {
  encodeMap,
  u32Field,
  bytesField,
  requireMap,
  requireBytes,
  requireU32,
} from "../fields.js";
export type NfcPageRequest = {
  nodeId: number;
  antenna: number;
  uid: Uint8Array;
  page: number;
  data?: Uint8Array;
};
export function encodeNfcPageRequest(req: NfcPageRequest): Uint8Array {
  if (
    !Number.isInteger(req.antenna) ||
    !Number.isInteger(req.nodeId) ||
    req.uid.length !== 7 ||
    req.antenna < 0 ||
    req.antenna > 2 ||
    req.nodeId < 0 ||
    req.nodeId > 0xffffff ||
    !Number.isInteger(req.page) ||
    !((req.page >= 4 && req.page <= 43) || (!req.data && [3, 45].includes(req.page))) ||
    (req.data && req.data.length !== 4)
  )
    throw new ProtocolCodecError("Invalid NFC page target");
  return encodeMap([
    u32Field(0, req.nodeId),
    u32Field(1, req.antenna),
    bytesField(2, req.uid),
    u32Field(3, req.page),
    u32Field(4, req.data ? 1 : 0),
    ...(req.data ? [bytesField(5, req.data)] : []),
  ]);
}
export function decodeNfcPageResponse(bytes: Uint8Array, page: number): Uint8Array {
  const map = requireMap(decodeOne(bytes), "NFC page");
  const confirmed = requireU32(map, 0, "NFC page");
  const data = requireBytes(map, 1, "NFC page");
  if (confirmed !== page || data.length !== 4)
    throw new ProtocolCodecError("NFC page acknowledgment mismatch");
  return data;
}
