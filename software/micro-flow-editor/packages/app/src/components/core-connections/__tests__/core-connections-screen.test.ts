import { describe, expect, it } from "vitest";
import { isVisibleBackboneRoot } from "../CoreConnectionsScreen.js";

describe("isVisibleBackboneRoot", () => {
  it("hides an unplugged USB root instead of rendering an error card", () => {
    expect(isVisibleBackboneRoot({ viaCan: null, hostLink: "usb", sessionState: "DISCONNECTED" })).toBe(false);
    expect(isVisibleBackboneRoot({ viaCan: null, hostLink: "usb", sessionState: "ERROR" })).toBe(false);
  });

  it("shows a connected USB root and excludes CAN children as separate roots", () => {
    expect(isVisibleBackboneRoot({ viaCan: null, hostLink: "usb", sessionState: "READY" })).toBe(true);
    expect(
      isVisibleBackboneRoot({
        viaCan: { viaDeviceIdHex: "aa", nodeId: 1 },
        hostLink: "usb",
        sessionState: "READY",
      }),
    ).toBe(false);
  });
});
