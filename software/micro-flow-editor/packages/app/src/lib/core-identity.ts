import { bytesToHex } from "@spaghettilab/core-session";

/** First six identity bytes as `aa:bb:cc:dd:ee:ff` — readable when no friendly name exists. */
export function formatDeviceId(hex: string): string {
  const compact = hex.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (compact.length < 2) return hex;
  const pairs = compact.match(/.{1,2}/g) ?? [];
  return pairs.slice(0, 6).join(":");
}

export function macBytesToColon(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 6), (byte) => byte.toString(16).padStart(2, "0")).join(":");
}

/** Same padding the USB bridge uses so CAN peers keep a stable backend id. */
export function macToDeviceIdHex(mac: string): string {
  const compact = mac.toLowerCase().replace(/[^0-9a-f]/g, "");
  return (compact + "0".repeat(64)).slice(0, 64);
}

export function coreDisplayName(deviceName: string | undefined, deviceIdHex: string): string {
  const trimmed = deviceName?.trim();
  if (trimmed) return trimmed;
  return formatDeviceId(deviceIdHex);
}

export function identityFromStatus(status: { deviceId?: Uint8Array; deviceName?: string }, fallbackId: string): { deviceIdHex: string; deviceName: string } {
  return {
    deviceIdHex: status.deviceId && status.deviceId.length > 0 ? bytesToHex(status.deviceId) : fallbackId,
    deviceName: status.deviceName?.trim() ?? "",
  };
}
