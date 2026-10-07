import { describe, expect, it } from "vitest";
import {
  hubCatalog,
  normalizeHubUrl,
  parseHubSnapshot,
  type HubSnapshot,
} from "../community-hub.js";

const snapshot = (): HubSnapshot => ({
  schemaVersion: 1,
  revision: 4,
  updatedAt: "2026-10-06T12:00:00Z",
  modules: [],
  packages: [],
  posts: [],
  polls: [],
  contests: [],
});

describe("community hub synchronization", () => {
  it("permits local simulation and HTTPS hosting without embedded credentials", () => {
    expect(normalizeHubUrl(" http://127.0.0.1:8790/ ")).toBe("http://127.0.0.1:8790");
    expect(normalizeHubUrl("https://hub.example.org/service/")).toBe(
      "https://hub.example.org/service",
    );
    expect(() => normalizeHubUrl("http://external.example.org")).toThrow();
    expect(() => normalizeHubUrl("https://user:password@hub.example.org")).toThrow();
    expect(() => normalizeHubUrl("https://hub.example.org?token=secret")).toThrow();
  });
  it("rejects broken remote content before caching or rendering it", () => {
    expect(parseHubSnapshot(snapshot()).revision).toBe(4);
    expect(() =>
      parseHubSnapshot({
        ...snapshot(),
        posts: [{ id: "x", title: "x", description: "x", body: "x", tags: [null] }],
      }),
    ).toThrow();
    expect(() =>
      parseHubSnapshot({
        ...snapshot(),
        polls: [
          {
            id: "x",
            title: "x",
            description: "",
            options: ["A", "B"],
            counts: [0, -1],
            closesAt: "2026-11-01",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseHubSnapshot({
        ...snapshot(),
        packages: [
          {
            id: "x",
            title: "x",
            description: "",
            kind: "firmware",
            version: "1",
            target: "ESP32",
            file: {
              id: "a".repeat(64),
              sha256: "b".repeat(64),
              size: 100,
              name: "fw.bin",
            },
          },
        ],
      }),
    ).toThrow();
  });
  it("uses the published NFC catalogue including an intentionally empty catalogue", () => {
    expect(hubCatalog(snapshot())).toEqual([]);
    const value = {
      ...snapshot(),
      modules: [
        {
          id: "m",
          title: "Custom module",
          description: "",
          registryId: 2,
          vendorId: 3,
          moduleTypeId: 4000,
          available: true,
        },
      ],
    } as unknown as HubSnapshot;
    expect(hubCatalog(value)[0]?.name).toBe("Custom module");
    expect(hubCatalog(value)[0]?.vendorId).toBe(3);
  });
});
