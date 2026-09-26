import { describe, expect, it } from "vitest";
import { cycleSelectValue, footerCardWidth, settingsFooterFor } from "./settings-footer.js";

describe("settingsFooterFor", () => {
  it("shows Toggle astable tabs and cycles mode", () => {
    const footer = settingsFooterFor({
      kind: "block",
      blockTypeId: "ab.digital_out_toggle",
      catalogEntryId: "appblocks.digital_out_toggle",
      properties: {},
    });
    expect(footer?.tabs.map((tab) => tab.id)).toEqual(["toggleMode", "initial", "lowToHigh", "highToLow"]);
    expect(footer?.tabs[0]?.display).toBe("AST");
    expect(cycleSelectValue(footer!.tabs[0]!)).toBe("pulse_high");
    expect(footerCardWidth(footer!.tabs.length)).toBe(208);
  });

  it("shows pulse width when Toggle is a pulse", () => {
    const footer = settingsFooterFor({
      kind: "block",
      blockTypeId: "ab.digital_out_toggle",
      catalogEntryId: "appblocks.digital_out_toggle",
      properties: { toggleMode: "pulse_high", pulseMs: 80 },
    });
    expect(footer?.tabs.map((tab) => [tab.id, tab.display])).toEqual([
      ["toggleMode", "P↑"],
      ["pulseMs", "80ms"],
    ]);
  });

  it("shows LED color and timing tabs", () => {
    const footer = settingsFooterFor({
      kind: "block",
      blockTypeId: "ab.led",
      catalogEntryId: "appblocks.led",
      properties: { color: "#FF3366", delayOnMs: 10 },
    });
    expect(footer?.tabs.map((tab) => tab.id)).toEqual(["color", "delayOnMs", "delayOffMs", "softOnMs", "softOffMs"]);
    expect(footer?.tabs[0]?.kind).toBe("color");
    expect(footer?.tabs[1]?.display).toBe("10");
    expect(footerCardWidth(footer!.tabs.length)).toBe(260);
  });

  it("cycles Relay close-when", () => {
    const footer = settingsFooterFor({
      kind: "block",
      blockTypeId: "ab.relay",
      catalogEntryId: "appblocks.relay",
      properties: {},
    });
    expect(footer?.tabs).toEqual([
      expect.objectContaining({ id: "closeWhen", display: "HIGH" }),
    ]);
    expect(cycleSelectValue(footer!.tabs[0]!)).toBe("low");
  });
});
