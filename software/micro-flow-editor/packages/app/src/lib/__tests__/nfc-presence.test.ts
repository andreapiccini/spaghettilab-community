import { describe, expect, it } from "vitest";
import {
  collectNfcNodes,
  diffNfcNodes,
  dismissNfcPopup,
  emptyNfcPopupQueue,
  enqueueNfcPopups,
  nfcEventsFromDiff,
  type NfcPopupEvent,
} from "../nfc-presence.js";

function event(partial: Partial<NfcPopupEvent> & Pick<NfcPopupEvent, "id" | "kind">): NfcPopupEvent {
  return {
    node: { portId: 1, label: "sense-dial" },
    backboneMac: "90:70:69:e1:c5:2c",
    ...partial,
  };
}

describe("collectNfcNodes", () => {
  it("merges status modules and discovery candidates without duplicates", () => {
    expect(
      collectNfcNodes(
        [{ portId: 2, typeId: "relay" }, { portId: 3, typeId: "  " }],
        [{ portId: 2, suggestedTypeId: "relay" }, { portId: 4, suggestedTypeId: "sense-dial" }],
      ),
    ).toEqual([
      { portId: 2, label: "relay" },
      { portId: 4, label: "sense-dial" },
    ]);
  });

  it("prefers live GET_STATUS tags and maps t2t to a friendly label", () => {
    expect(
      collectNfcNodes([], [], [{ portId: 1, typeId: "t2t", nodeId: 0xe18030, backboneMac: "90:70:69:e1:80:30" }]),
    ).toEqual([
      { portId: 1, label: "Tag NFC", nodeId: 0xe18030, backboneMac: "90:70:69:e1:80:30" },
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
    const first = event({ id: "1", kind: "connected", node: { portId: 1, label: "a" } });
    const second = event({ id: "2", kind: "connected", node: { portId: 2, label: "b" } });
    const third = event({ id: "3", kind: "removed", node: { portId: 1, label: "a" } });
    const queued = enqueueNfcPopups(emptyNfcPopupQueue(), [first, second, third]);
    expect(queued.current).toEqual(first);
    expect(queued.pending).toEqual([second, third]);
  });

  it("advances to the next popup as soon as the current one is dismissed", () => {
    const first = event({ id: "1", kind: "connected", node: { portId: 1, label: "a" } });
    const second = event({ id: "2", kind: "removed", node: { portId: 2, label: "b" } });
    let queue = enqueueNfcPopups(emptyNfcPopupQueue(), [first, second]);
    queue = dismissNfcPopup(queue);
    expect(queue.current).toEqual(second);
    expect(queue.pending).toEqual([]);
    queue = dismissNfcPopup(queue);
    expect(queue).toEqual(emptyNfcPopupQueue());
  });

  it("does not stack an identical popup that is already open or waiting", () => {
    const first = event({ id: "1", kind: "connected" });
    const dup = event({ id: "2", kind: "connected" });
    const queued = enqueueNfcPopups(enqueueNfcPopups(emptyNfcPopupQueue(), [first]), [dup]);
    expect(queued.current).toEqual(first);
    expect(queued.pending).toEqual([]);
  });

  it("keeps connect and remove of the same module as two sequential popups", () => {
    const connected = event({ id: "1", kind: "connected" });
    const removed = event({ id: "2", kind: "removed" });
    const queued = enqueueNfcPopups(emptyNfcPopupQueue(), [connected, removed]);
    expect(queued.current?.kind).toBe("connected");
    expect(queued.pending).toEqual([removed]);
  });
});

describe("nfcEventsFromDiff", () => {
  it("builds connected then removed events in that order", () => {
    let n = 0;
    const events = nfcEventsFromDiff(
      "aa:bb",
      [{ portId: 1, label: "gone" }],
      [{ portId: 2, label: "new" }],
      () => String(++n),
    );
    expect(events.map((e) => e.kind)).toEqual(["connected", "removed"]);
    expect(events[0]?.node).toEqual({ portId: 2, label: "new" });
    expect(events[1]?.node).toEqual({ portId: 1, label: "gone" });
  });
});
