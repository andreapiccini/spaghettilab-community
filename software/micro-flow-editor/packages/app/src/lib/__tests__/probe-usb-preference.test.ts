import { afterEach, expect, it, vi } from "vitest";
const { getPorts } = vi.hoisted(() => ({ getPorts: vi.fn(async () => []) }));
vi.mock("../browser-serial-connection.js", () => ({ browserSerial: () => ({ getPorts }), openBrowserSerial: vi.fn() }));
import { probeUsbCores } from "../probe-usb-cores.js";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("does not probe the serial port already owned by a working bridge", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ cores: [{ deviceIdHex: "new-board", version: "0.5.33" }] }) })));
 const found = await probeUsbCores();
 expect(found.map(item => item.source)).toEqual(["bridge"]);
 expect(found[0]?.deviceIdHex).toBe("new-board");
 expect(getPorts).not.toHaveBeenCalled();
});
it("falls back to granted Web Serial ports when no bridge board is available", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ cores: [] }) })));
 expect(await probeUsbCores()).toEqual([]);
 expect(getPorts).toHaveBeenCalledOnce();
});
