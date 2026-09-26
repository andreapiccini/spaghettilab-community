import { SpaghettiClient, WebSerialProtocolTransport } from "@spaghettilab/protocol-sdk";
import { browserSerial, openBrowserSerial, type UsbSerialPort } from "./browser-serial-connection.js";
import { identityFromStatus } from "./core-identity.js";
import { usbBridgeCoreUrl, usbBridgeListUrl } from "./usb-bridge.js";

type FoundUsbCoreBase = {
  readonly deviceIdHex: string;
  readonly deviceName: string;
  readonly version: string;
};

export type FoundUsbCore =
  | (FoundUsbCoreBase & { readonly source: "webserial"; readonly port: UsbSerialPort })
  | (FoundUsbCoreBase & { readonly source: "bridge"; readonly url: string });

async function identifyUsbCore(port: UsbSerialPort): Promise<FoundUsbCore | null> {
  try {
    const connection = await openBrowserSerial(port);
    const transport = new WebSerialProtocolTransport(connection);
    const client = new SpaghettiClient(transport, { defaultTimeoutMs: 4000, maxRetries: 0 });
    try {
      const status = await client.getStatus();
      const info = "getInfo" in port && typeof port.getInfo === "function"
        ? (port.getInfo() as { usbVendorId?: number; usbProductId?: number })
        : {};
      const fallback = `usb-${info.usbVendorId ?? 0}:${info.usbProductId ?? 0}`;
      const identity = identityFromStatus(status, fallback);
      return {
        source: "webserial",
        port,
        deviceIdHex: identity.deviceIdHex,
        deviceName: identity.deviceName,
        version: status.version,
      };
    } finally {
      client.dispose();
      transport.dispose();
    }
  } catch {
    return null;
  }
}

function mergeUsbCores(...groups: readonly (readonly FoundUsbCore[])[]): FoundUsbCore[] {
  const found: FoundUsbCore[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const core of group) {
      if (seen.has(core.deviceIdHex)) continue;
      seen.add(core.deviceIdHex);
      found.push(core);
    }
  }
  return found;
}

/** Probe the localhost USB bridge (`make usb-bridge`). Empty if it is not running. */
export async function probeUsbBridgeCores(): Promise<readonly FoundUsbCore[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(usbBridgeListUrl(), { signal: controller.signal });
    if (!response.ok) return [];
    const document = (await response.json()) as {
      cores?: readonly {
        deviceIdHex?: string;
        deviceName?: string;
        version?: string;
      }[];
    };
    const cores: FoundUsbCore[] = [];
    for (const item of document.cores ?? []) {
      const deviceIdHex = item.deviceIdHex?.toLowerCase();
      if (!deviceIdHex) continue;
      cores.push({
        source: "bridge",
        url: usbBridgeCoreUrl(deviceIdHex),
        deviceIdHex,
        deviceName: item.deviceName?.trim() ?? "",
        version: item.version ?? "",
      });
    }
    return cores;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Web Serial ports plus localhost USB bridge, Web Serial first if both see the same Core. */
export async function probeUsbCores(): Promise<readonly FoundUsbCore[]> {
  const [granted, bridged] = await Promise.all([probeGrantedUsbCores(), probeUsbBridgeCores()]);
  return mergeUsbCores(granted, bridged);
}

/** Probe every already-granted Web Serial port with Protocol V1 `GET_STATUS`. */
export async function probeGrantedUsbCores(): Promise<readonly FoundUsbCore[]> {
  const serial = browserSerial();
  if (!serial) return [];
  const ports = await serial.getPorts();
  const found: FoundUsbCore[] = [];
  const seen = new Set<string>();
  for (const port of ports) {
    const core = await identifyUsbCore(port);
    if (!core || seen.has(core.deviceIdHex)) continue;
    seen.add(core.deviceIdHex);
    found.push(core);
  }
  return found;
}

/**
 * Browser picker (user gesture required). Any serial device may be chosen;
 * only a Core that answers Protocol V1 is returned.
 */
export async function requestUsbCorePort(): Promise<FoundUsbCore | null> {
  const serial = browserSerial();
  if (!serial) {
    throw new Error("usb-serial-unavailable");
  }
  const port = await serial.requestPort();
  const core = await identifyUsbCore(port);
  if (core) return core;
  throw new Error("usb-not-a-core");
}

export async function findGrantedUsbPort(deviceIdHex: string): Promise<UsbSerialPort | null> {
  const cores = await probeGrantedUsbCores();
  const match = cores.find((core) => core.deviceIdHex === deviceIdHex.toLowerCase());
  return match?.source === "webserial" ? match.port : null;
}

export function usbSerialSupported(): boolean {
  return browserSerial() !== null;
}
