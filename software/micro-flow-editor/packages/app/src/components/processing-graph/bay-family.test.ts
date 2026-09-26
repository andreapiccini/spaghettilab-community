import { describe, expect, it } from "vitest";
import { findCatalogEntryById, baySidesForEntry, isBayEntry, blockFamilyOf } from "@spaghettilab/processing-block-catalog";
import { expandPalettePlaceables, groupPlaceablesByFamily } from "./palette-placeables.js";
import { positionForBayDrop } from "./bay-layout.js";

describe("bay family model", () => {
  it("tags Toggle as functionality and LED/RGB/Relay as bay output", () => {
    const toggle = findCatalogEntryById("appblocks.digital_out_toggle")!;
    const led = findCatalogEntryById("appblocks.led")!;
    const terminal = findCatalogEntryById("appblocks.terminal_block")!;
    expect(blockFamilyOf(toggle)).toBe("functionality");
    expect(isBayEntry(led)).toBe(true);
    expect(baySidesForEntry(led)).toEqual(["output"]);
    expect(isBayEntry(terminal)).toBe(true);
    expect(baySidesForEntry(terminal)).toEqual(["input"]);
    expect(terminal.outputs).toHaveLength(6);
  });

  it("groups palette into funzionalità vs bay", () => {
    const rows = expandPalettePlaceables([
      findCatalogEntryById("native.schedule")!,
      findCatalogEntryById("appblocks.digital_out_toggle")!,
      findCatalogEntryById("appblocks.led")!,
      findCatalogEntryById("appblocks.relay")!,
    ]);
    const groups = groupPlaceablesByFamily(rows);
    expect(groups.functionality.map((r) => r.entry.id)).toEqual(["native.schedule", "appblocks.digital_out_toggle"]);
    expect(groups.bay.map((r) => r.entry.id)).toEqual(["appblocks.led", "appblocks.relay"]);
    expect(groups.bay.every((r) => r.baySide === "output")).toBe(true);
  });

  it("anchors bay uscita to the right of the schedule box", () => {
    const pos = positionForBayDrop("output", { x: 100, y: 160 }, [{ x: 20, y: 60, width: 280, height: 160 }]);
    expect(pos.x).toBeGreaterThan(20 + 280);
  });

  it("anchors bay ingresso to the left of the schedule box", () => {
    const pos = positionForBayDrop("input", { x: 100, y: 160 }, [{ x: 200, y: 60, width: 280, height: 160 }]);
    expect(pos.x).toBeLessThan(200);
  });
});
