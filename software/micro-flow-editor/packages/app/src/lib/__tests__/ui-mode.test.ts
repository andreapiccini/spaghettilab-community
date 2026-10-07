import { InMemoryStorage } from "@spaghettilab/domain";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_UI_MODE,
  isScreenVisibleInMode,
  loadUiMode,
  parseUiMode,
  saveUiMode,
  UI_MODE_STORAGE_KEY,
} from "../ui-mode.js";

describe("parseUiMode", () => {
  it("defaults missing, empty, and unknown values to base", () => {
    expect(parseUiMode(null)).toBe("base");
    expect(parseUiMode(undefined)).toBe("base");
    expect(parseUiMode("")).toBe("base");
    expect(parseUiMode("base")).toBe("base");
    expect(parseUiMode("BASE")).toBe("base");
    expect(parseUiMode("simple")).toBe("base");
    expect(parseUiMode("{corrupt")).toBe("base");
    expect(parseUiMode(" advanced ")).toBe("base");
  });

  it("accepts only the exact string advanced", () => {
    expect(parseUiMode("advanced")).toBe("advanced");
  });
});

describe("loadUiMode / saveUiMode", () => {
  it("loads base when the key is absent (first launch)", async () => {
    const storage = new InMemoryStorage();
    expect(await loadUiMode(storage)).toBe(DEFAULT_UI_MODE);
  });

  it("round-trips advanced without going through ProjectV1", async () => {
    const storage = new InMemoryStorage();
    await saveUiMode(storage, "advanced");
    expect(await storage.get(UI_MODE_STORAGE_KEY)).toBe("advanced");
    expect(await loadUiMode(storage)).toBe("advanced");
    await saveUiMode(storage, "base");
    expect(await loadUiMode(storage)).toBe("base");
  });

  it("treats a corrupt stored value as base", async () => {
    const storage = new InMemoryStorage();
    await storage.set(UI_MODE_STORAGE_KEY, "yes-please");
    expect(await loadUiMode(storage)).toBe("base");
  });
});

describe("isScreenVisibleInMode", () => {
  it("hides platform-extension screens only in base", () => {
    expect(isScreenVisibleInMode("catalog-topology", "base")).toBe(false);
    expect(isScreenVisibleInMode("device-profile-studio", "base")).toBe(false);
    expect(isScreenVisibleInMode("capability-marketplace", "base")).toBe(false);
    expect(isScreenVisibleInMode("cross-core-automation", "base")).toBe(false);
    expect(isScreenVisibleInMode("core-connections", "base")).toBe(true);
    expect(isScreenVisibleInMode("physical-composition", "base")).toBe(true);
    expect(isScreenVisibleInMode("processing-graph", "base")).toBe(true);
    expect(isScreenVisibleInMode("deploy-diff", "base")).toBe(true);
    expect(isScreenVisibleInMode("runtime-diagnostics", "base")).toBe(true);
    expect(isScreenVisibleInMode("settings-security", "base")).toBe(true);
    expect(isScreenVisibleInMode("market", "base")).toBe(true);
    expect(isScreenVisibleInMode("generate-schematic-pcb", "base")).toBe(true);
    expect(isScreenVisibleInMode("education", "base")).toBe(true);
    expect(isScreenVisibleInMode("datasheets", "base")).toBe(true);
  });

  it("shows every screen in advanced", () => {
    expect(isScreenVisibleInMode("device-profile-studio", "advanced")).toBe(true);
    expect(isScreenVisibleInMode("catalog-topology", "advanced")).toBe(true);
  });
});
