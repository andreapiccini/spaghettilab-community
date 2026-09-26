import { describe, expect, it } from "vitest";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import { isIncompatibleDemoEdge, isValidDemoProcessingConnection, isValidProcessingConnection } from "./connection-rules.js";

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

  it("allows Toggle → IF and Temperature → IF by catalog ports", () => {
    const resolve = (id: string) => {
      if (id === "t") return findCatalogEntryById("appblocks.digital_out_toggle");
      if (id === "temp") return findCatalogEntryById("appblocks.temperature_sensor");
      return findCatalogEntryById("appblocks.compare_if");
    };
    expect(isValidProcessingConnection({ source: "t", target: "if" }, resolve)).toBe(true);
    expect(isValidProcessingConnection({ source: "temp", target: "if" }, resolve)).toBe(true);
  });
});

describe("isValidDemoProcessingConnection", () => {
  const toggle = { id: "t", data: { kind: "block" as const, blockTypeId: "ab.digital_out_toggle", catalogEntryId: "appblocks.digital_out_toggle", properties: {} } };
  const iff = { id: "if", data: { kind: "block" as const, blockTypeId: "ab.compare_if", catalogEntryId: "appblocks.compare_if", properties: {} } };
  const temp = { id: "temp", data: { kind: "block" as const, blockTypeId: "ab.temperature_sensor", catalogEntryId: "appblocks.temperature_sensor", properties: {} } };
  const led = { id: "led", data: { kind: "block" as const, blockTypeId: "ab.led", catalogEntryId: "appblocks.led", properties: {} } };
  const relay = { id: "relay", data: { kind: "block" as const, blockTypeId: "ab.relay", catalogEntryId: "appblocks.relay", properties: {} } };
  const nodes = [toggle, iff, temp, led, relay];

  it("lets Toggle or Temperature feed IF, replacing a previous input", () => {
    expect(isValidDemoProcessingConnection({ source: "t", target: "if" }, { nodes, edges: [] })).toBe(true);
    expect(isValidDemoProcessingConnection({ source: "temp", target: "if" }, { nodes, edges: [] })).toBe(true);
    expect(isValidDemoProcessingConnection({ source: "temp", target: "if" }, { nodes, edges: [{ source: "t", target: "if" }] })).toBe(true);
  });

  it("keeps the temperature sensor wired only to IF", () => {
    expect(isValidDemoProcessingConnection({ source: "temp", target: "led" }, { nodes, edges: [] })).toBe(false);
    expect(isValidDemoProcessingConnection({ source: "temp", target: "relay" }, { nodes, edges: [] })).toBe(false);
  });

  it("lets IF and Toggle drive LED or Relay", () => {
    expect(isValidDemoProcessingConnection({ source: "if", target: "led" }, { nodes, edges: [] })).toBe(true);
    expect(isValidDemoProcessingConnection({ source: "if", target: "relay" }, { nodes, edges: [] })).toBe(true);
    expect(isValidDemoProcessingConnection({ source: "t", target: "relay" }, { nodes, edges: [] })).toBe(true);
    expect(isValidDemoProcessingConnection({ source: "if", target: "led" }, { nodes, edges: [{ source: "t", target: "led" }] })).toBe(true);
  });

  it("keeps Boolean IF → LED drawable but marks the wire as broken", () => {
    const booleanIf = { ...iff, data: { ...iff.data, properties: { outputType: "boolean" } } };
    const ctx = { nodes: [toggle, booleanIf, temp, led, relay], edges: [{ source: "if", target: "led" }] };
    expect(isValidDemoProcessingConnection({ source: "if", target: "led" }, ctx)).toBe(true);
    expect(isIncompatibleDemoEdge({ source: "if", target: "led" }, ctx)).toBe(true);
    expect(isIncompatibleDemoEdge({ source: "if", target: "led" }, { nodes, edges: [{ source: "if", target: "led" }] })).toBe(false);
  });

  it("keeps Toggle → analog IF and Temperature → digital IF drawable but marks the wire as broken", () => {
    const analogIf = { ...iff, data: { ...iff.data, properties: { inputType: "analog" } } };
    const digitalIf = { ...iff, data: { ...iff.data, properties: { inputType: "digital" } } };
    expect(isIncompatibleDemoEdge({ source: "t", target: "if" }, { nodes: [toggle, analogIf], edges: [{ source: "t", target: "if" }] })).toBe(true);
    expect(isIncompatibleDemoEdge({ source: "temp", target: "if" }, { nodes: [temp, digitalIf], edges: [{ source: "temp", target: "if" }] })).toBe(true);
    expect(isIncompatibleDemoEdge({ source: "t", target: "if" }, { nodes: [toggle, digitalIf], edges: [{ source: "t", target: "if" }] })).toBe(false);
    expect(isIncompatibleDemoEdge({ source: "temp", target: "if" }, { nodes: [temp, analogIf], edges: [{ source: "temp", target: "if" }] })).toBe(false);
    expect(isIncompatibleDemoEdge({ source: "temp", target: "if" }, { nodes, edges: [{ source: "temp", target: "if" }] })).toBe(false);
  });
});
