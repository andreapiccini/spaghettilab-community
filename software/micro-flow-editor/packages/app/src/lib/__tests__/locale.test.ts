import { InMemoryStorage } from "@spaghettilab/domain";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, loadLocale, localeMeta, parseLocale, resolveLocale, saveLocale, SUPPORTED_LOCALES, LOCALE_STORAGE_KEY } from "../locale.js";

describe("parseLocale", () => {
  it("defaults missing or unknown values to Italian", () => {
    expect(parseLocale(null)).toBe(DEFAULT_LOCALE);
    expect(parseLocale("")).toBe("it");
    expect(parseLocale("IT")).toBe("it");
    expect(parseLocale("fr")).toBe("it");
  });

  it("accepts only supported ids", () => {
    expect(parseLocale("it")).toBe("it");
    expect(parseLocale("en")).toBe("en");
  });
});

describe("resolveLocale", () => {
  it("forces English in demo-only without changing the default elsewhere", () => {
    expect(resolveLocale("it", true)).toBe("en");
    expect(resolveLocale(null, true)).toBe("en");
    expect(resolveLocale("it", false)).toBe("it");
    expect(resolveLocale(null, false)).toBe(DEFAULT_LOCALE);
  });
});

describe("localeMeta / storage", () => {
  it("exposes name and flag for every supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(localeMeta(locale.id).name.length).toBeGreaterThan(0);
      expect(localeMeta(locale.id).flag.length).toBeGreaterThan(0);
    }
  });

  it("round-trips without going through ProjectV1", async () => {
    const storage = new InMemoryStorage();
    await saveLocale(storage, "en");
    expect(await storage.get(LOCALE_STORAGE_KEY)).toBe("en");
    expect(await loadLocale(storage)).toBe("en");
  });
});
