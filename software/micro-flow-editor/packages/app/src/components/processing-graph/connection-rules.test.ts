import { describe, expect, it } from "vitest";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import { isValidProcessingConnection } from "./connection-rules.js";

describe("isValidProcessingConnection", () => {
  it("rejects a block connecting its output to its own input", () => {
    expect(isValidProcessingConnection({ source: "a", target: "a" })).toBe(false);
  });

  it("rejects an incomplete connection", () => {
    expect(isValidProcessingConnection({ source: "a", target: null })).toBe(false);
    expect(isValidProcessingConnection({ source: undefined, target: "b" })).toBe(false);
  });

  it("allows untyped connections when no catalog resolver is provided", () => {
    expect(isValidProcessingConnection({ source: "a", target: "b" })).toBe(true);
  });

  it("allows Schedule activation → Toggle", () => {
    const resolve = (id: string) =>
      id === "s" ? findCatalogEntryById("native.schedule") : findCatalogEntryById("appblocks.digital_out_toggle");
    expect(isValidProcessingConnection({ source: "s", target: "t" }, resolve)).toBe(true);
  });

  it("allows Toggle digital comando → LED", () => {
    const resolve = (id: string) =>
      id === "t" ? findCatalogEntryById("appblocks.digital_out_toggle") : findCatalogEntryById("appblocks.led");
    expect(isValidProcessingConnection({ source: "t", target: "led" }, resolve)).toBe(true);
  });

  it("rejects LED → Toggle (LED is a sink)", () => {
    const resolve = (id: string) =>
      id === "led" ? findCatalogEntryById("appblocks.led") : findCatalogEntryById("appblocks.digital_out_toggle");
    expect(isValidProcessingConnection({ source: "led", target: "t" }, resolve)).toBe(false);
  });

  it("allows Start → Toggle (Schedule → Start is domain-only, no tick input)", () => {
    const resolve = (id: string) => {
      if (id === "s") return findCatalogEntryById("native.schedule");
      if (id === "start") return findCatalogEntryById("native.flow_start");
      return findCatalogEntryById("appblocks.digital_out_toggle");
    };
    expect(isValidProcessingConnection({ source: "start", target: "t" }, resolve)).toBe(true);
  });
});
