/** Local USB→WebSocket bridge (`make usb-bridge` in firmware/backbone). Safari has no Web Serial. */

export const USB_BRIDGE_HOST = "127.0.0.1";
export const USB_BRIDGE_PORT = 8766;
export const USB_BRIDGE_ORIGIN = `ws://${USB_BRIDGE_HOST}:${USB_BRIDGE_PORT}`;

function browserBridgeBase(kind: "http" | "ws"): string | null {
  if (typeof window === "undefined" || !window.location?.host) return null;
  const secure = window.location.protocol === "https:";
  const scheme = kind === "http" ? (secure ? "https:" : "http:") : secure ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/usb-bridge`;
}

/** Same-origin via Vite `/usb-bridge` proxy so Safari never opens port 8766 itself. */
export function usbBridgeListUrl(): string {
  const origin = browserBridgeBase("http");
  if (origin) return `${origin}/list`;
  return `http://${USB_BRIDGE_HOST}:${USB_BRIDGE_PORT}/list`;
}

export function usbBridgeCoreUrl(deviceIdHex: string): string {
  const id = deviceIdHex.toLowerCase();
  const origin = browserBridgeBase("ws");
  if (origin) return `${origin}/core/${id}`;
  return `${USB_BRIDGE_ORIGIN}/core/${id}`;
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
