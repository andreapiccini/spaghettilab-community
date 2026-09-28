import { describe, expect, it } from "vitest";
import {
  collectNfcNodes,
  diffNfcNodes,
  dismissNfcPopup,
  dismissAllNfcPopups,
  emptyNfcPopupQueue,
  enqueueNfcPopups,
  nfcEventsFromDiff,
  nfcNodesForBoard,
  selectNfcPopup,
  type NfcPopupEvent,
} from "../nfc-presence.js";

function event(
  partial: Partial<NfcPopupEvent> & Pick<NfcPopupEvent, "id">,
): NfcPopupEvent {
  return {
    kind: "read",
    node: { portId: 1, label: "sense-dial" },
    backboneMac: "90:70:69:e1:c5:2c",
    ...partial,
  };
}

describe("collectNfcNodes", () => {
  it("merges status modules and discovery candidates without duplicates", () => {
    expect(
      collectNfcNodes(
        [
          { portId: 2, typeId: "relay" },
          { portId: 3, typeId: "  " },
        ],
        [
          { portId: 2, suggestedTypeId: "relay" },
          { portId: 4, suggestedTypeId: "sense-dial" },
        ],
      ),
    ).toEqual([
      { portId: 2, label: "relay" },
      { portId: 4, label: "sense-dial" },
    ]);
  });

  it("prefers live GET_STATUS tags and maps t2t to a friendly label", () => {
    expect(
      collectNfcNodes(
        [],
        [],
        [
          {
            portId: 1,
            typeId: "t2t",
            uid: new Uint8Array([0x04, 0xab, 0x01]),
            nodeId: 0xe18030,
            backboneMac: "90:70:69:e1:80:30",
          },
        ],
      ),
    ).toEqual([
      {
        portId: 1,
        label: "Tag NFC",
        uid: "04AB01",
        nodeId: 0xe18030,
        backboneMac: "90:70:69:e1:80:30",
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
    portId: 1,
    label: "Tag NFC",
    nodeId: 0xe1c52c,
    backboneMac: "90:70:69:e1:c5:2c",
  };
  const slaveTag = {
    portId: 2,
    label: "Tag NFC",
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
          { portId: 1, label: "relay" },
          { portId: 2, label: "old" },
        ],
        [
          { portId: 1, label: "relay" },
          { portId: 3, label: "sense-dial" },
        ],
      ),
    ).toEqual({
      added: [{ portId: 3, label: "sense-dial" }],
      removed: [{ portId: 2, label: "old" }],
    });
  });
});

describe("nfc popup queue", () => {
  it("shows the first event immediately and queues the rest", () => {
    const first = event({ id: "1", node: { portId: 1, label: "a", uid: "01" } });
    const second = event({ id: "2", node: { portId: 2, label: "b", uid: "02" } });
    const third = event({ id: "3", node: { portId: 1, label: "a", uid: "03" } });
    const queued = enqueueNfcPopups(emptyNfcPopupQueue(), [first, second, third]);
    expect(queued.items).toEqual([first, second, third]);
    expect(queued.activeIndex).toBe(0);
  });

  it("advances to the next popup as soon as the current one is dismissed", () => {
    const first = event({ id: "1", node: { portId: 1, label: "a" } });
    const second = event({ id: "2", node: { portId: 2, label: "b" } });
    let queue = enqueueNfcPopups(emptyNfcPopupQueue(), [first, second]);
    queue = dismissNfcPopup(queue);
    expect(queue.items).toEqual([second]);
    queue = dismissNfcPopup(queue);
    expect(queue).toEqual(emptyNfcPopupQueue());
  });

  it("queues repeated scans of the same tag as separate reads", () => {
    const first = event({ id: "1" });
    const dup = event({ id: "2" });
    const queued = enqueueNfcPopups(enqueueNfcPopups(emptyNfcPopupQueue(), [first]), [
      dup,
    ]);
    expect(queued.items).toEqual([first, dup]);
  });

  it("allows browsing without closing and can close the full stack", () => {
    const first = event({ id: "1", node: { portId: 1, label: "Tag NFC", uid: "01" } });
    const second = event({ id: "2", node: { portId: 1, label: "Tag NFC", uid: "02" } });
    let queue = enqueueNfcPopups(emptyNfcPopupQueue(), [first, second]);
    queue = selectNfcPopup(queue, 1);
    expect(queue.items).toEqual([first, second]);
    expect(queue.activeIndex).toBe(1);
    expect(dismissAllNfcPopups()).toEqual(emptyNfcPopupQueue());
  });
});

describe("nfcEventsFromDiff", () => {
  it("builds a popup only for newly read tags, not removals", () => {
    let n = 0;
    const events = nfcEventsFromDiff(
      "aa:bb",
      [{ portId: 1, label: "gone" }],
      [{ portId: 2, label: "new" }],
      () => String(++n),
    );
    expect(events.map((e) => e.kind)).toEqual(["read"]);
    expect(events[0]?.node).toEqual({ portId: 2, label: "new" });
  });
});
