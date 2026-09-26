import { describe, expect, it } from "vitest";
import { isDemoOnlyEnabled, isDemoQueryEnabled, isScreenAllowedInDemo, isTruthyFlag } from "../demo-only.js";
import { publicAsset } from "../public-asset.js";

describe("isTruthyFlag", () => {
  it("accepts 1 / true / yes", () => {
    expect(isTruthyFlag("1")).toBe(true);
    expect(isTruthyFlag("true")).toBe(true);
    expect(isTruthyFlag("YES")).toBe(true);
    expect(isTruthyFlag(true)).toBe(true);
  });

  it("rejects missing or other values", () => {
    expect(isTruthyFlag(undefined)).toBe(false);
    expect(isTruthyFlag(null)).toBe(false);
    expect(isTruthyFlag("")).toBe(false);
    expect(isTruthyFlag("0")).toBe(false);
    expect(isTruthyFlag(false)).toBe(false);
  });
});

describe("isDemoQueryEnabled", () => {
  it("accepts ?demo=1 (and true/yes)", () => {
    expect(isDemoQueryEnabled("?demo=1")).toBe(true);
    expect(isDemoQueryEnabled("demo=true")).toBe(true);
    expect(isDemoQueryEnabled("?foo=bar&demo=yes")).toBe(true);
  });

  it("rejects absent or other values", () => {
    expect(isDemoQueryEnabled("")).toBe(false);
    expect(isDemoQueryEnabled("?demo=0")).toBe(false);
    expect(isDemoQueryEnabled("?demo")).toBe(false);
    expect(isDemoQueryEnabled(undefined)).toBe(false);
  });
});

describe("isDemoOnlyEnabled", () => {
  it("turns on from query or env without the other", () => {
    expect(isDemoOnlyEnabled({ search: "?demo=1", envFlag: undefined })).toBe(true);
    expect(isDemoOnlyEnabled({ search: "", envFlag: "1" })).toBe(true);
    expect(isDemoOnlyEnabled({ search: "", envFlag: undefined })).toBe(false);
  });
});

describe("isScreenAllowedInDemo", () => {
  it("allows only Processing Graph", () => {
    expect(isScreenAllowedInDemo("processing-graph")).toBe(true);
    expect(isScreenAllowedInDemo("core-connections")).toBe(false);
    expect(isScreenAllowedInDemo("market")).toBe(false);
  });
});

describe("publicAsset", () => {
  it("joins BASE_URL and a path for non-root deploys", () => {
    expect(publicAsset("ux-assets/logo-full.png", "./")).toBe("./ux-assets/logo-full.png");
    expect(publicAsset("/ux-assets/logo-full.png", "/repo/")).toBe("/repo/ux-assets/logo-full.png");
  });
});
