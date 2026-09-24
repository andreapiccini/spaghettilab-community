import { describe, expect, it } from "vitest";
import { NODE_GAP, NODE_HEIGHT, NODE_WIDTH } from "./layout-constants.js";
import { nodesOverlap, rectsOverlap, resolveRectOverlap, resolveSiblingOverlap } from "./node-overlap.js";

describe("resolveSiblingOverlap", () => {
  it("moves a dropped block off an occupied card instead of stacking", () => {
    const occupied = { x: 80, y: 80 };
    const resolved = resolveSiblingOverlap("new", occupied, [{ id: "old", position: occupied }]);
    expect(nodesOverlap(resolved, occupied)).toBe(false);
    expect(resolved).not.toEqual(occupied);
  });

  it("finds a free slot when the drop sits in a packed cluster", () => {
    const siblings = [
      { id: "a", position: { x: 0, y: 0 } },
      { id: "b", position: { x: NODE_WIDTH, y: 0 } },
      { id: "c", position: { x: 0, y: NODE_HEIGHT } },
      { id: "d", position: { x: NODE_WIDTH, y: NODE_HEIGHT } },
    ];
    const resolved = resolveSiblingOverlap("new", { x: 10, y: 10 }, siblings);
    for (const sibling of siblings) {
      expect(nodesOverlap(resolved, sibling.position)).toBe(false);
    }
  });

  it("treats a small tick disc as its real size so a card can sit close beside it", () => {
    const tick = { id: "tick", position: { x: 100, y: 178 }, w: 28, h: 28 };
    const beside = { x: 160, y: 160 };
    const resolved = resolveSiblingOverlap("toggle", beside, [tick]);
    expect(resolved).toEqual(beside);
  });
});

describe("resolveRectOverlap", () => {
  it("pushes two stacked schedule-sized boxes apart", () => {
    const size = { w: NODE_WIDTH + 48, h: NODE_HEIGHT + 80 };
    const origin = { x: 40, y: 20 };
    const resolved = resolveRectOverlap("a", origin, size, [{ id: "b", position: origin, w: size.w, h: size.h }]);
    expect(resolved).not.toEqual(origin);
    expect(rectsOverlap({ x: resolved.x, y: resolved.y, width: size.w, height: size.h }, { x: origin.x, y: origin.y, width: size.w, height: size.h })).toBe(false);
    const gapX = resolved.x >= origin.x ? resolved.x - (origin.x + size.w) : origin.x - (resolved.x + size.w);
    const gapY = resolved.y >= origin.y ? resolved.y - (origin.y + size.h) : origin.y - (resolved.y + size.h);
    expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(NODE_GAP);
  });
});
