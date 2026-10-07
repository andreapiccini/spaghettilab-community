import { ProtocolCodecError, decodeOne } from "../cbor.js";
import {
  bytesField,
  encodeMap,
  requireBytes,
  requireMap,
  requireU32,
  u32Field,
} from "../fields.js";

/** Layout 1 describes Connector ×1 and Function ×2, six physical pins each. */
export type PhysicalBackbone = {
  readonly version: 1 | 2;
  readonly settings?: PhysicalInterfaceSettings;
  readonly mcu: "ESP32-S3" | "ESP32-C3" | "Unknown";
  readonly antennas: number;
  readonly layout: number;
  readonly backendPortId: number;
  readonly capabilities: number;
  readonly modes: readonly number[];
  readonly i2cSpeed: number;
  readonly source: number;
};

export function decodePhysicalBackbone(
  bytes: Uint8Array,
): PhysicalBackbone | undefined {
  if (!(
    (bytes.length === 13 && bytes[0] === 1) ||
    (bytes.length === 33 && bytes[0] === 2)
  ))
    return undefined;
  return {
    version: bytes[0] as 1 | 2,
    settings: bytes[0] === 2 ? decodePhysicalSettings(bytes.slice(13)) : undefined,
    mcu: bytes[1] === 1 ? "ESP32-S3" : bytes[1] === 2 ? "ESP32-C3" : "Unknown",
    antennas: bytes[2]!,
    layout: bytes[3]!,
    backendPortId: bytes[4]!,
    capabilities: bytes[5]! | (bytes[6]! << 8),
    modes: [...bytes.slice(7, 11)],
    i2cSpeed: bytes[11]!,
    source: bytes[12]!,
  };
}

export type ApplyPhysicalRequest = {
  readonly nodeId: number;
  readonly modes: Uint8Array;
  readonly i2cSpeed: number;
  readonly expectedTag?: Uint8Array;
  readonly settings?: PhysicalInterfaceSettings;
};

export function encodeApplyPhysicalRequest(request: ApplyPhysicalRequest): Uint8Array {
  if (
    !Number.isInteger(request.nodeId) ||
    request.nodeId < 0 ||
    request.nodeId > 0xffffff ||
    request.modes.length !== 4 ||
    (request.i2cSpeed !== 0 && request.i2cSpeed !== 1)
  ) {
    throw new ProtocolCodecError("Invalid physical port configuration");
  }
  for (const mode of request.modes) {
    if (
      (mode & 15) > 12 ||
      (mode & 0xc0) !== 0 ||
      (mode & 0x30) === 0x30 ||
      ((mode & 15) !== 1 && (mode & 0x30) !== 0)
    ) {
      throw new ProtocolCodecError("Invalid physical pin mode");
    }
  }
  const expected = request.expectedTag ?? new Uint8Array(20);
  if (expected.length !== 20 || expected[8]! > 10 || expected[19]! > 1)
    throw new ProtocolCodecError("Invalid NFC snapshot");
  return encodeMap([
    u32Field(0, request.nodeId),
    bytesField(1, request.modes),
    u32Field(2, request.i2cSpeed),
    bytesField(3, expected),
    ...(request.settings
      ? [bytesField(4, encodePhysicalSettings(request.settings))]
      : []),
  ]);
}

export function decodeApplyPhysicalResponse(bytes: Uint8Array): ApplyPhysicalRequest {
  const map = requireMap(decodeOne(bytes), "ApplyPhysicalResponse");
  const result = {
    nodeId: requireU32(map, 0, "ApplyPhysicalResponse"),
    modes: requireBytes(map, 1, "ApplyPhysicalResponse"),
    i2cSpeed: requireU32(map, 2, "ApplyPhysicalResponse"),
  };
  encodeApplyPhysicalRequest(result);
  return result;
}

export type PhysicalInterfaceSettings = {
  readonly baud: number;
  readonly dataBits: 7 | 8;
  readonly parity: "none" | "even" | "odd";
  readonly stopBits: 1 | 2;
  readonly spiHz: number;
  readonly spiMode: 0 | 1 | 2 | 3;
  readonly bitOrder: "msb" | "lsb";
  readonly pwmHz: number;
  readonly pwmInverted: boolean;
};
export const DEFAULT_PHYSICAL_SETTINGS: PhysicalInterfaceSettings = {
  baud: 115200,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  spiHz: 1000000,
  spiMode: 0,
  bitOrder: "msb",
  pwmHz: 1000,
  pwmInverted: false,
};
export function encodePhysicalSettings(
  settings: PhysicalInterfaceSettings,
): Uint8Array {
  if (
    ![settings.baud, settings.spiHz, settings.pwmHz].every(Number.isInteger) ||
    settings.baud < 1200 ||
    settings.baud > 2000000 ||
    settings.spiHz < 10000 ||
    settings.spiHz > 20000000 ||
    settings.pwmHz < 1 ||
    settings.pwmHz > 20000 ||
    ![7, 8].includes(settings.dataBits) ||
    ![1, 2].includes(settings.stopBits) ||
    ![0, 1, 2, 3].includes(settings.spiMode) ||
    !["none", "even", "odd"].includes(settings.parity) ||
    !["msb", "lsb"].includes(settings.bitOrder) ||
    typeof settings.pwmInverted !== "boolean"
  )
    throw new ProtocolCodecError("Invalid interface settings");
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  view.setUint32(1, settings.baud, true);
  view.setUint32(5, settings.spiHz, true);
  view.setUint32(9, settings.pwmHz, true);
  bytes[13] = settings.dataBits;
  bytes[14] = settings.parity === "even" ? 1 : settings.parity === "odd" ? 2 : 0;
  bytes[15] = settings.stopBits;
  bytes[16] = settings.spiMode;
  bytes[17] = settings.bitOrder === "lsb" ? 1 : 0;
  bytes[18] = settings.pwmInverted ? 1 : 0;
  return bytes;
}
export function decodePhysicalSettings(bytes: Uint8Array): PhysicalInterfaceSettings {
  if (bytes.length !== 20 || bytes[0] !== 1 || bytes[19])
    throw new ProtocolCodecError("Invalid interface settings version");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = {
    baud: view.getUint32(1, true),
    spiHz: view.getUint32(5, true),
    pwmHz: view.getUint32(9, true),
    dataBits: bytes[13] as 7 | 8,
    parity:
      bytes[14] === 1
        ? ("even" as const)
        : bytes[14] === 2
          ? ("odd" as const)
          : ("none" as const),
    stopBits: bytes[15] as 1 | 2,
    spiMode: bytes[16] as 0 | 1 | 2 | 3,
    bitOrder: bytes[17] === 1 ? ("lsb" as const) : ("msb" as const),
    pwmInverted: !!bytes[18],
  };
  const encoded = encodePhysicalSettings(result);
  if (encoded.some((value, i) => value !== bytes[i]))
    throw new ProtocolCodecError("Invalid interface flags");
  return result;
}
