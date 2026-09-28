import { describe, expect, it } from "vitest";
import {
  collectNfcNodes,
  diffNfcNodes,
  dismissNfcDetect,
  dismissAllNfcDetects,
  emptyNfcDetectQueue,
  enqueueNfcDetects,
  isSlm1Tag,
  moduleTypeLabel,
  nfcEventsFromDiff,
  nfcNodesForBoard,
  selectNfcDetect,
  type NfcDetectEvent,
} from "../nfc-presence.js";

function event(
  partial: Partial<NfcDetectEvent> & Pick<NfcDetectEvent, "id">,
): NfcDetectEvent {
  return {
    kind: "read",
    node: { portId: 1, label: "Sensor" },
    backboneMac: "90:70:69:e1:c5:2c",
    ...partial,
  };
}

describe("isSlm1Tag / moduleTypeLabel", () => {
  it("accepts tags with SLM1 moduleTypeId and rejects bare t2t/t4t", () => {
    expect(isSlm1Tag({ portId: 1, typeId: "t2t" })).toBe(false);
    expect(isSlm1Tag({ portId: 1, typeId: "sensor", moduleTypeId: 2001 })).toBe(true);
    expect(moduleTypeLabel({ typeId: "sensor", fallbackClass: 3 })).toBe("Sensor");
    expect(moduleTypeLabel({ typeId: "iface", fallbackClass: 5 })).toBe("Interface");
  });
});

describe("collectNfcNodes", () => {
  it("keeps only SLM1 tags on position 1 or 2", () => {
    expect(
      collectNfcNodes([
        { portId: 1, typeId: "t2t", uid: new Uint8Array([1]) },
        {
          portId: 1,
          typeId: "sensor",
          moduleTypeId: 2001,
          fallbackClass: 3,
          uid: new Uint8Array([0x04, 0xab, 0x01]),
          nodeId: 0xe18030,
          backboneMac: "90:70:69:e1:80:30",
          backboneLabel: "Master Backbone",
        },
        { portId: 3, typeId: "sensor", moduleTypeId: 2001 },
      ]),
    ).toEqual([
      {
        portId: 1,
        label: "Sensor",
        uid: "04AB01",
        nodeId: 0xe18030,
        backboneMac: "90:70:69:e1:80:30",
        backboneLabel: "Master Backbone",
        moduleTypeId: 2001,
        fallbackClass: 3,
      },
    ]);
  });
});

describe("nfcNodesForBoard", () => {
  const master = {
    nodeId: 0xe1c52c,
    local: true,
    mac: "90:70:69:e1:c5:2c",
    deviceIdHex: "907069e1c52c",
  };
  const slave = {
    nodeId: 0xe18030,
    local: false,
    mac: "90:70:69:e1:80:30",
    deviceIdHex: "907069e18030",
  };
  const masterTag = {
    portId: 1 as const,
    label: "Sensor",
    nodeId: 0xe1c52c,
    backboneMac: "90:70:69:e1:c5:2c",
  };
  const slaveTag = {
    portId: 2 as const,
    label: "Actuator",
    nodeId: 0xe18030,
    backboneMac: "90:70:69:e1:80:30",
  };

  it("keeps each tag on the backbone that reported it", () => {
    expect(nfcNodesForBoard(master, [masterTag, slaveTag])).toEqual([masterTag]);
    expect(nfcNodesForBoard(slave, [masterTag, slaveTag])).toEqual([slaveTag]);
  });

  it("still shows local tags when the USB row has no SLUP node id", () => {
    expect(nfcNodesForBoard({ ...master, nodeId: 0 }, [masterTag, slaveTag])).toEqual([
      masterTag,
    ]);
  });
});

describe("diffNfcNodes", () => {
  it("reports added and removed nodes by port and label", () => {
    expect(
      diffNfcNodes(
        [
          { portId: 1, label: "Sensor" },
          { portId: 2, label: "old" },
        ],
        [
          { portId: 1, label: "Sensor" },
          { portId: 2, label: "Actuator" },
        ],
      ),
    ).toEqual({
      added: [{ portId: 2, label: "Actuator" }],
      removed: [{ portId: 2, label: "old" }],
    });
  });
});

describe("nfc detect queue", () => {
  it("shows the latest detection and can dismiss it", () => {
    const first = event({ id: "1", node: { portId: 1, label: "Sensor", uid: "01" } });
    const second = event({ id: "2", node: { portId: 2, label: "Actuator", uid: "02" } });
    let queue = enqueueNfcDetects(emptyNfcDetectQueue(), [first, second]);
    expect(queue.activeIndex).toBe(1);
    queue = dismissNfcDetect(queue);
    expect(queue.items).toEqual([first]);
    expect(dismissAllNfcDetects()).toEqual(emptyNfcDetectQueue());
  });

  it("allows selecting an earlier detection", () => {
    const first = event({ id: "1" });
    const second = event({ id: "2" });
    let queue = enqueueNfcDetects(emptyNfcDetectQueue(), [first, second]);
    queue = selectNfcDetect(queue, 0);
    expect(queue.activeIndex).toBe(0);
  });
});

describe("nfcEventsFromDiff", () => {
  it("builds a detection only for newly read tags, not removals", () => {
    let n = 0;
    const events = nfcEventsFromDiff(
      "aa:bb",
      [{ portId: 1, label: "gone" }],
      [{ portId: 2, label: "Sensor" }],
      () => String(++n),
    );
    expect(events.map((e) => e.kind)).toEqual(["read"]);
    expect(events[0]?.node).toEqual({ portId: 2, label: "Sensor" });
  });
});
