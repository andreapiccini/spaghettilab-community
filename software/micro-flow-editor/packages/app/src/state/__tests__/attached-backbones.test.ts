import { describe, expect, it } from "vitest";
import { attachedFromStatus, liveAttachedChain, retainAttachedVersions, type AttachedBackbone } from "../core-sessions-context.js";

const master: AttachedBackbone = {
  deviceIdHex: "aa",
  mac: "aa:bb",
  nodeId: 1,
  local: true,
  version: "0.1.0+0",
};

const slave: AttachedBackbone = {
  deviceIdHex: "cc",
  mac: "cc:dd",
  nodeId: 2,
  local: false,
  version: "0.1.0+0",
};

describe("retainAttachedVersions", () => {
  it("keeps a slave version when the next snapshot omits it", () => {
    const next = retainAttachedVersions([master, slave], [
      master,
      { deviceIdHex: "cc", mac: "cc:dd", nodeId: 2, local: false },
    ]);
    expect(next[1]?.version).toBe("0.1.0+0");
  });

  it("prefers a freshly reported version", () => {
    const next = retainAttachedVersions([slave], [{ ...slave, version: "0.2.0+0" }]);
    expect(next[0]?.version).toBe("0.2.0+0");
  });
});

describe("liveAttachedChain", () => {
  it("drops a slave as soon as the live snapshot no longer lists it", () => {
    expect(liveAttachedChain([master], { ...master, version: undefined })).toEqual([master]);
  });

  it("shows only the USB root when GET_STATUS has not reported a chain yet", () => {
    expect(liveAttachedChain([], master)).toEqual([master]);
  });
});

describe("attachedFromStatus", () => {
  it("keeps the slave that GET_STATUS reported next to the master", () => {
    const chain = attachedFromStatus(
      {
        state: 1,
        mode: 1,
        imageState: 0,
        activeSlot: 0,
        imageConfirmed: true,
        version: "0.1.0+0",
        portCount: 0,
        lastResetCause: 0,
        healthState: 1,
        modules: [],
        deviceId: new Uint8Array([0x90, 0x70, 0x69, 0xe1, 0xc5, 0x2c]),
        chainPeers: [
          { nodeId: 0xe1c52c, mac: new Uint8Array([0x90, 0x70, 0x69, 0xe1, 0xc5, 0x2c]), flags: 0x80, local: true, version: "0.1.0+0" },
          { nodeId: 0xe18030, mac: new Uint8Array([0x90, 0x70, 0x69, 0xe1, 0x80, 0x30]), flags: 0, local: false, version: "0.1.0+0" },
        ],
      },
      "old-fixed-master-id",
    );
    expect(chain?.map((peer) => peer.local)).toEqual([true, false]);
    expect(chain?.[0]?.deviceIdHex).toBe(
      "907069e1c52c" + "0".repeat(52),
    );
    expect(chain?.[1]?.deviceIdHex).toBe(
      "907069e18030" + "0".repeat(52),
    );
    expect(chain?.[1]?.version).toBe("0.1.0+0");
    expect(chain?.[1]?.nodeId).toBe(0xe18030);
  });

  it("keeps the MAC identity when a board reconnects with a different CAN node id", () => {
    const base = {
      state: 1,
      mode: 1,
      imageState: 0,
      activeSlot: 0,
      imageConfirmed: true,
      version: "0.1.0+0",
      portCount: 0,
      lastResetCause: 0,
      healthState: 1,
      modules: [],
      deviceId: new Uint8Array([0xff, 0xff]),
    };
    const mac = new Uint8Array([0x90, 0x70, 0x69, 0xe1, 0x80, 0x30]);
    const first = attachedFromStatus(
      { ...base, chainPeers: [{ nodeId: 1, mac, flags: 0, local: false }] },
      "first-session-id",
    );
    const reconnected = attachedFromStatus(
      { ...base, chainPeers: [{ nodeId: 99, mac, flags: 0, local: true }] },
      "different-session-id",
    );
    expect(reconnected?.[0]?.deviceIdHex).toBe(first?.[0]?.deviceIdHex);
    expect(reconnected?.[0]?.nodeId).toBe(99);
  });
});
