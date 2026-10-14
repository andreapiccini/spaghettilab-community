import { describe, expect, it } from "vitest";
import { createI2cGenericExample } from "../device-recipe-draft.js";
import { buildRecipeBusCapture, rxBlocksOf } from "../recipe-bus-capture.js";
import { buildProtocolTimingFromOps } from "../protocol-timing.js";

describe("buildRecipeBusCapture", () => {
  it("extracts RX slots from i2c_write_read", () => {
    const draft = createI2cGenericExample();
    const capture = buildRecipeBusCapture(draft.phases.sample);
    const rx = rxBlocksOf(capture);
    expect(rx.length).toBe(2);
    expect(rx.every((b) => b.value === null)).toBe(true);
  });

  it("overlays measured RX into timing labels", () => {
    const draft = createI2cGenericExample();
    const op = draft.phases.sample.find((o) => o.type === "i2c_write_read");
    expect(op).toBeTruthy();
    const measured = { [op!.id]: [0x12, 0x34] };
    const capture = buildRecipeBusCapture(draft.phases.sample, measured);
    const model = buildProtocolTimingFromOps(draft, draft.phases.sample, {
      rxByOpId: capture.rxByOpId,
      emphasizeRx: true,
    });
    const rxCells = model.cells.filter((c) => c.kind === "data" && c.label.startsWith("0x"));
    expect(rxCells.some((c) => c.label === "0x12")).toBe(true);
    expect(rxCells.some((c) => c.label === "0x34")).toBe(true);
  });
});
