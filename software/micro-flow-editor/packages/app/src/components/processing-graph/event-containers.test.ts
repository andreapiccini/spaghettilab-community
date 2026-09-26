import type { GraphState } from "@spaghettilab/domain";
import { describe, expect, it } from "vitest";
import { computeEventContainers, detachMemberEdges, formatSchedulePeriod, memberEscapesContainer, overlappingPeerContainer, peerContainerObstacles, planMembershipDrop } from "./event-containers.js";
import { EVENT_CONTAINER_HEADER_HEIGHT, NODE_HEIGHT, NODE_PADDING, NODE_WIDTH } from "./layout-constants.js";

describe("memberEscapesContainer", () => {
  const box = { x: 100, y: 80 };

  it("is inside on the trigger's quadrant (right/down of the dashed origin)", () => {
    expect(memberEscapesContainer({ x: 100, y: 80 }, box)).toBe(false);
    expect(memberEscapesContainer({ x: 140, y: 200 }, box)).toBe(false);
  });

  it("escapes as soon as the block crosses the top or left dashed edge", () => {
    expect(memberEscapesContainer({ x: 100, y: 79 }, box)).toBe(true);
    expect(memberEscapesContainer({ x: 99, y: 80 }, box)).toBe(true);
  });
});

describe("detachMemberEdges", () => {
  const container = { triggerId: "sched", memberIds: ["a", "b", "c"] };

  it("breaks both wires to the inside and splices a linear chain", () => {
    const plan = detachMemberEdges("b", container, [
      { id: "e1", source: "sched", target: "a" },
      { id: "e2", source: "a", target: "b" },
      { id: "e3", source: "b", target: "c" },
    ]);
    expect(plan.removeIds).toEqual(["e2", "e3"]);
    expect(plan.splice).toEqual({ source: "a", target: "c" });
  });

  it("only removes the inbound edge when the last member leaves", () => {
    const plan = detachMemberEdges("c", container, [
      { id: "e1", source: "sched", target: "a" },
      { id: "e2", source: "a", target: "b" },
      { id: "e3", source: "b", target: "c" },
    ]);
    expect(plan.removeIds).toEqual(["e3"]);
    expect(plan.splice).toBeUndefined();
  });
});

describe("computeEventContainers size preview", () => {
  it("grows the dashed box to cover a block being dropped in, without making it a member", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [{ layer: "device-processing", id: "sched", data: { kind: "schedule", moduleNodeId: "m1", periodMs: 1000, enabled: true } }],
      edges: [],
    };
    const meta = { sched: { position: { x: 100, y: 100 } } };
    const idle = computeEventContainers(graphState, meta);
    const preview = computeEventContainers(graphState, meta, undefined, { triggerId: "sched", position: { x: 100, y: 300 } });
    expect(preview[0]!.memberIds).toEqual([]);
    expect(preview[0]!.height).toBe(idle[0]!.height + 200);
    expect(preview[0]!.width).toBe(NODE_WIDTH + NODE_PADDING * 2);
    expect(preview[0]!.height).toBe(200 + NODE_HEIGHT + NODE_PADDING * 2 + EVENT_CONTAINER_HEADER_HEIGHT);
  });
});

describe("computeEventContainers nesting", () => {
  it("nests Flow Start and its chain inside the Schedule box", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        { layer: "device-processing", id: "sched", data: { kind: "schedule", moduleNodeId: "m1", periodMs: 1000, enabled: true } },
        {
          layer: "device-processing",
          id: "start",
          data: { kind: "block", blockTypeId: "ab.flow_start", catalogEntryId: "native.flow_start", moduleNodeId: "m1", properties: {} },
        },
        { layer: "device-processing", id: "toggle", data: { kind: "block", blockTypeId: "appblocks.digital_out_toggle", moduleNodeId: "m1", properties: {} } },
      ],
      edges: [
        { layer: "device-processing", id: "e1", source: "sched", target: "start" },
        { layer: "device-processing", id: "e2", source: "start", target: "toggle" },
      ],
    };
    const meta = {
      sched: { position: { x: 40, y: 100 } },
      start: { position: { x: 80, y: 160 } },
      toggle: { position: { x: 220, y: 160 } },
    };
    const boxes = computeEventContainers(graphState, meta);
    expect(boxes.find((c) => c.triggerId === "sched")?.memberIds).toEqual(["start", "toggle"]);
  });

  it("nests an event-source inside a schedule without stealing the inner chain", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        { layer: "device-processing", id: "sched", data: { kind: "schedule", moduleNodeId: "m1", periodMs: 1000, enabled: true } },
        { layer: "device-processing", id: "btn", data: { kind: "event-source", moduleNodeId: "m2" } },
        { layer: "device-processing", id: "blk", data: { kind: "block", blockTypeId: "threshold", properties: {} } },
      ],
      edges: [
        { layer: "device-processing", id: "nest", source: "sched", target: "btn" },
        { layer: "device-processing", id: "inner", source: "btn", target: "blk" },
      ],
    };
    const meta = {
      sched: { position: { x: 100, y: 100 } },
      btn: { position: { x: 100, y: 280 } },
      blk: { position: { x: 100, y: 400 } },
    };
    const boxes = computeEventContainers(graphState, meta);
    const sched = boxes.find((c) => c.triggerId === "sched");
    const btn = boxes.find((c) => c.triggerId === "btn");
    expect(sched?.memberIds).toEqual(["btn"]);
    expect(btn?.memberIds).toEqual(["blk"]);
    expect(btn?.parentTriggerId).toBe("sched");
    expect(sched!.x + sched!.width).toBeGreaterThanOrEqual(btn!.x + btn!.width);
    expect(sched!.y + sched!.height).toBeGreaterThanOrEqual(btn!.y + btn!.height);
  });

  it("treats two top-level schedules as peers that must not stack", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        { layer: "device-processing", id: "a", data: { kind: "schedule", moduleNodeId: "m1", periodMs: 1000, enabled: true } },
        { layer: "device-processing", id: "b", data: { kind: "schedule", moduleNodeId: "m1", periodMs: 500, enabled: true } },
      ],
      edges: [],
    };
    const meta = { a: { position: { x: 100, y: 100 } }, b: { position: { x: 100, y: 100 } } };
    const boxes = computeEventContainers(graphState, meta);
    const byTrigger = new Map(boxes.map((c) => [c.triggerId, c]));
    expect(peerContainerObstacles("a", boxes, byTrigger).map((o) => o.id)).toEqual(["b"]);
    const a = boxes.find((c) => c.triggerId === "a")!;
    expect(overlappingPeerContainer({ x: a.x, y: a.y, width: a.width, height: a.height }, "a", boxes, byTrigger)?.triggerId).toBe("b");
  });

  it("does not treat a nested event-source as a stacking peer of its parent schedule", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        { layer: "device-processing", id: "sched", data: { kind: "schedule", moduleNodeId: "m1", periodMs: 1000, enabled: true } },
        { layer: "device-processing", id: "btn", data: { kind: "event-source", moduleNodeId: "m2" } },
      ],
      edges: [{ layer: "device-processing", id: "nest", source: "sched", target: "btn" }],
    };
    const meta = { sched: { position: { x: 100, y: 100 } }, btn: { position: { x: 100, y: 280 } } };
    const boxes = computeEventContainers(graphState, meta);
    const byTrigger = new Map(boxes.map((c) => [c.triggerId, c]));
    expect(peerContainerObstacles("sched", boxes, byTrigger)).toEqual([]);
    expect(peerContainerObstacles("btn", boxes, byTrigger)).toEqual([]);
  });

  it("treats two top-level event-sources as peers that must not stack", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        { layer: "device-processing", id: "a", data: { kind: "event-source", moduleNodeId: "m1" } },
        { layer: "device-processing", id: "b", data: { kind: "event-source", moduleNodeId: "m2" } },
      ],
      edges: [],
    };
    const meta = { a: { position: { x: 80, y: 80 } }, b: { position: { x: 80, y: 80 } } };
    const boxes = computeEventContainers(graphState, meta);
    const byTrigger = new Map(boxes.map((c) => [c.triggerId, c]));
    expect(peerContainerObstacles("a", boxes, byTrigger).map((o) => o.id)).toEqual(["b"]);
  });

  it("grows the outer schedule when a block is previewed into a nested event-source", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        { layer: "device-processing", id: "sched", data: { kind: "schedule", moduleNodeId: "m1", periodMs: 1000, enabled: true } },
        { layer: "device-processing", id: "btn", data: { kind: "event-source", moduleNodeId: "m2" } },
      ],
      edges: [{ layer: "device-processing", id: "nest", source: "sched", target: "btn" }],
    };
    const meta = { sched: { position: { x: 100, y: 100 } }, btn: { position: { x: 100, y: 280 } } };
    const idle = computeEventContainers(graphState, meta);
    const preview = computeEventContainers(graphState, meta, undefined, { triggerId: "btn", position: { x: 100, y: 500 } });
    const idleSched = idle.find((c) => c.triggerId === "sched")!;
    const previewSched = preview.find((c) => c.triggerId === "sched")!;
    expect(previewSched.height).toBeGreaterThan(idleSched.height);
    expect(preview.find((c) => c.triggerId === "btn")!.memberIds).toEqual([]);
  });
});

describe("planMembershipDrop", () => {
  const sched = { triggerId: "sched" };
  const interrupt = { triggerId: "btn" };

  it("attaches a free block to the innermost hovered container", () => {
    expect(planMembershipDrop({ current: undefined, hovered: interrupt, escaping: false })).toEqual({ attachTo: "btn" });
  });

  it("re-parents a schedule member dropped onto a nested event-source", () => {
    expect(planMembershipDrop({ current: sched, hovered: interrupt, escaping: false })).toEqual({ detachFrom: "sched", attachTo: "btn" });
  });

  it("moves a nested member back to the outer box when it leaves through the top/left", () => {
    expect(planMembershipDrop({ current: interrupt, hovered: sched, escaping: true })).toEqual({ detachFrom: "btn", attachTo: "sched" });
  });

  it("does nothing while the block stays in its current box", () => {
    expect(planMembershipDrop({ current: interrupt, hovered: interrupt, escaping: false })).toEqual({});
  });
});

describe("computeEventContainers labels", () => {
  it("labels an On Boot container from the catalog, not the generic Event source title", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [{ layer: "device-processing", id: "boot", data: { kind: "event-source", moduleNodeId: "", catalogEntryId: "appblocks.system", properties: {} } }],
      edges: [],
    };
    const boxes = computeEventContainers(graphState, { boot: { position: { x: 100, y: 100 } } });
    expect(boxes[0]!.label).toBe("On Boot");
  });

  it("keeps the schedule period on the container for the header badge", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [{ layer: "device-processing", id: "sched", data: { kind: "schedule", moduleNodeId: "m1", periodMs: 250, enabled: true } }],
      edges: [],
    };
    const boxes = computeEventContainers(graphState, { sched: { comment: "Schedule", position: { x: 40, y: 40 } } });
    expect(boxes[0]!.label).toBe("Schedule");
    expect(boxes[0]!.periodMs).toBe(250);
  });
});

describe("formatSchedulePeriod", () => {
  it("formats whole seconds and milliseconds in English by default", () => {
    expect(formatSchedulePeriod(1000)).toBe("every 1s");
    expect(formatSchedulePeriod(250)).toBe("every 250ms");
    expect(formatSchedulePeriod(1500)).toBe("every 1.5s");
  });

  it("keeps the Italian adverb when requested", () => {
    expect(formatSchedulePeriod(1000, "ogni")).toBe("ogni 1s");
    expect(formatSchedulePeriod(250, "ogni")).toBe("ogni 250ms");
  });
});
