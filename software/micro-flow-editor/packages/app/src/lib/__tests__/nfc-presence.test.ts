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
  retainSeenNfcNodes,
  selectNfcDetect,
  stabilizeNfcPresence,
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
    const second = event({
      id: "2",
      node: { portId: 2, label: "Actuator", uid: "02" },
    });
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

describe("retainSeenNfcNodes", () => {
  const tag = { portId: 1 as const, label: "Tag NFC", uid: "0474C102A02190" };

  it("drops a tag on the first empty snapshot when the hold is 1", () => {
    expect(retainSeenNfcNodes([tag], [], new Map(), 1).nodes).toEqual([]);
  });

  it("keeps a tag through brief misses and drops it after the limit", () => {
    let misses = new Map<string, number>();
    let nodes = [tag];
    for (let i = 0; i < 3; i += 1) {
      const next = retainSeenNfcNodes(nodes, [], misses, 4);
      nodes = [...next.nodes];
      misses = new Map(next.misses);
      expect(nodes).toEqual([tag]);
    }
    const gone = retainSeenNfcNodes(nodes, [], misses, 4);
    expect(gone.nodes).toEqual([]);
  });

  it("resets the miss count when the same tag is read again", () => {
    const once = retainSeenNfcNodes([tag], [], new Map(), 4);
    const back = retainSeenNfcNodes(once.nodes, [tag], once.misses, 4);
    expect(back.nodes).toEqual([tag]);
    expect([...back.misses.values()]).toEqual([0]);
  });
});

describe("stabilizeNfcPresence", () => {
  const tag = { uid: "0474C102A02190" };

  it("shows a tag on the first snapshot that lists it", () => {
    expect(stabilizeNfcPresence([], [tag], 0)).toEqual({ tags: [tag], emptyStreak: 0 });
  });

  it("keeps the last tag through one empty poll, then drops it", () => {
    const once = stabilizeNfcPresence([tag], [], 0);
    expect(once.tags).toEqual([tag]);
    expect(once.emptyStreak).toBe(1);
    expect(stabilizeNfcPresence(once.tags, [], once.emptyStreak).tags).toEqual([]);
  });

  it("treats an omitted list as a miss, and as a leave after a discovery event", () => {
    const once = stabilizeNfcPresence([tag], undefined, 0);
    expect(once.tags).toEqual([tag]);
    expect(once.emptyStreak).toBe(1);
    expect(stabilizeNfcPresence(once.tags, undefined, once.emptyStreak).tags).toEqual([]);
    expect(
      stabilizeNfcPresence([tag], undefined, 0, { immediateLeave: true }).tags,
    ).toEqual([]);
  });

  it("drops the tag immediately on a discovery-triggered empty snapshot", () => {
    expect(stabilizeNfcPresence([tag], [], 0, { immediateLeave: true }).tags).toEqual([]);
  });
});

describe("dedicated NFC reader presence", () => {
  it("keeps unidentified tags on any reader antenna, including port 0", () => {
    const tag = {
      portId: 0,
      typeId: "t2t",
      uid: new Uint8Array([2, 1, 2, 3, 4, 5, 6]),
      nodeId: 0xe18030,
    };
    expect(collectNfcNodes([tag], true)).toMatchObject([
      { portId: 0, label: "Tag NFC", uid: "02010203040506" },
    ]);
  });

  it("shows blank tags in reader views without treating them as hardware module definitions", () => {
    const tag = {
      portId: 1,
      typeId: "t2t",
      uid: new Uint8Array([2, 1, 2, 3, 4, 5, 6]),
      nodeId: 0xe18030,
      moduleTypeId: 0,
    };
    expect(collectNfcNodes([tag])).toEqual([]);
    const nodes = collectNfcNodes([tag], true);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      label: "Tag NFC",
      uid: "02010203040506",
      nodeId: 0xe18030,
    });
    expect(isSlm1Tag(tag)).toBe(false);
  });
});
