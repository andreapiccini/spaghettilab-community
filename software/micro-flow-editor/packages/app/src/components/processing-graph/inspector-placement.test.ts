import { describe, expect, it } from "vitest";
import { placeInspectorAwayFromTarget } from "./inspector-placement.js";

const viewport = { width: 800, height: 600 };

describe("placeInspectorAwayFromTarget", () => {
  it("prefers sitting below the block without covering it", () => {
    const target = { left: 300, top: 80, right: 476, bottom: 132, width: 176, height: 52 };
    const box = placeInspectorAwayFromTarget(target, { width: 320, height: 200 }, viewport);
    expect(box.top).toBeGreaterThanOrEqual(target.bottom);
    expect(box.left).toBeGreaterThanOrEqual(10);
    expect(box.left + 320).toBeLessThanOrEqual(viewport.width - 10);
  });

  it("moves above when there is no room below", () => {
    const target = { left: 300, top: 480, right: 476, bottom: 532, width: 176, height: 52 };
    const box = placeInspectorAwayFromTarget(target, { width: 320, height: 200 }, viewport);
    expect(box.top + 200).toBeLessThanOrEqual(target.top);
  });

  it("sits beside a Schedule header instead of below the dashed box", () => {
    const header = { left: 80, top: 40, right: 220, bottom: 72, width: 140, height: 32 };
    const box = placeInspectorAwayFromTarget(header, { width: 320, height: 180 }, viewport, { preferSide: true });
    expect(box.left).toBeGreaterThanOrEqual(header.right);
    expect(box.top).toBeGreaterThanOrEqual(10);
    expect(box.top + 180).toBeLessThanOrEqual(viewport.height - 10);
    expect(box.left + 320).toBeLessThanOrEqual(viewport.width - 10);
  });

  it("keeps a tall Schedule box from pushing the card off-screen", () => {
    const schedule = { left: 40, top: 30, right: 420, bottom: 520, width: 380, height: 490 };
    const box = placeInspectorAwayFromTarget(schedule, { width: 320, height: 180 }, { width: 800, height: 560 });
    expect(box.left).toBeGreaterThanOrEqual(10);
    expect(box.top).toBeGreaterThanOrEqual(10);
    expect(box.left + 320).toBeLessThanOrEqual(790);
    expect(box.top + 180).toBeLessThanOrEqual(550);
  });

  it("stays inside the viewport", () => {
    const target = { left: 10, top: 10, right: 186, bottom: 62, width: 176, height: 52 };
    const box = placeInspectorAwayFromTarget(target, { width: 360, height: 280 }, { width: 390, height: 400 });
    expect(box.left).toBeGreaterThanOrEqual(10);
    expect(box.top).toBeGreaterThanOrEqual(10);
    expect(box.left + 360).toBeLessThanOrEqual(390);
    expect(box.top + 280).toBeLessThanOrEqual(400);
  });
});
