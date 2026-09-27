import type { CoreBindingRecord } from "@spaghettilab/domain";
import { getConnectionProfile } from "./connection-profile-store.js";
import { findGrantedUsbPort } from "./probe-usb-cores.js";
import { isLoopbackHost, USB_BRIDGE_PORT, usbBridgeCoreUrl } from "./usb-bridge.js";
import type { CoreLink } from "../state/core-sessions-context.js";

/** Resolves a binding's saved `ConnectionProfile` back into a live link — USB by Protocol V1 identity, WebSocket by host/port. */
export async function reconnectCoreBinding(
  binding: CoreBindingRecord,
  connect: (binding: CoreBindingRecord, link: CoreLink) => Promise<void>,
): Promise<void> {
  const profile = await getConnectionProfile(binding.connectionProfileId);
  if (!profile) {
    throw new Error("Profilo di connessione mancante per questa Backbone.");
  }
  if (profile.host.startsWith("can:")) {
    const [, via = "", node = "0"] = profile.host.split(":");
    const nodeId = Number.parseInt(node, 16);
    await connect(binding, {
      kind: "can",
      viaDeviceIdHex: via,
      nodeId: Number.isFinite(nodeId) ? nodeId : 0,
    });
    return;
  }
  if (profile.transport === "usb") {
    const port = await findGrantedUsbPort(profile.host);
    if (port) {
      await connect(binding, { kind: "usb", port });
      return;
    }
    await connect(binding, { kind: "websocket", url: usbBridgeCoreUrl(profile.host) });
    return;
  }
  if (isLoopbackHost(profile.host) && profile.port === USB_BRIDGE_PORT) {
    await connect(binding, { kind: "websocket", url: usbBridgeCoreUrl(binding.expectedDeviceId) });
    return;
  }
  const scheme = profile.transport === "websocket" ? "ws" : profile.transport;
  await connect(binding, { kind: "websocket", url: `${scheme}://${profile.host}:${profile.port}` });
}
