import { describe, expect, it } from "vitest";
import golden from "../__fixtures__/project.golden.json";
import {
  canonicalProjectHash,
  createEmptyProject,
  exportProjectV1,
  importProjectV1,
  validateProjectV1,
  type ProjectV1,
} from "../project.js";
import { coreBindingId, projectId } from "../ids.js";
import type { Result } from "../result.js";

function mustOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("expected an ok Result in test fixture setup");
  return result.value;
}

describe("validateProjectV1", () => {
  it("accepts the golden fixture", () => {
    const result = validateProjectV1(golden);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object", () => {
    const result = validateProjectV1("not a project");
    expect(result.ok).toBe(false);
  });

  it("collects every problem instead of stopping at the first", () => {
    const result = validateProjectV1({ schemaVersion: 99, name: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.error.map((e) => e.path.join("."));
      expect(paths).toContain("schemaVersion");
      expect(paths).toContain("name");
      expect(paths).toContain("coreBindings");
      expect(result.error.length).toBeGreaterThan(2);
    }
  });
});

describe("export/import round-trip", () => {
  it("round-trips the golden fixture through export -> import with no loss", () => {
    const project = golden as unknown as ProjectV1;
    const json = exportProjectV1(project);
    const imported = importProjectV1(json);
    expect(imported).toEqual({ ok: true, value: project });
  });

  it("serializes bigint graph properties as decimal strings instead of throwing", () => {
    const id = mustOk(projectId("bbbbbbbb-0000-4000-8000-0000000000b1"));
    const project: ProjectV1 = {
      ...createEmptyProject(id, "bigint-demo"),
      deviceGraphs: [
        {
          layer: "device-processing",
          nodes: [{ layer: "device-processing", id: "n1", data: { kind: "block", properties: { threshold: 42n } } }],
          edges: [],
        },
      ],
    };
    const json = exportProjectV1(project);
    expect(json).toContain('"threshold": "42"');
    expect(() => canonicalProjectHash(project)).not.toThrow();
    const imported = importProjectV1(json);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      const data = imported.value.deviceGraphs[0]?.nodes[0]?.data as { properties: { threshold: string } };
      expect(data.properties.threshold).toBe("42");
    }
  });

  it("importProjectV1 rejects malformed JSON with a structured error, not a thrown SyntaxError", () => {
    const result = importProjectV1("{not json");
    expect(result.ok).toBe(false);
  });
});

describe("canonicalProjectHash", () => {
  it("is stable for the same content", () => {
    const project = golden as unknown as ProjectV1;
    expect(canonicalProjectHash(project)).toBe(canonicalProjectHash(project));
  });

  it("does not change when array order is insignificant", () => {
    const id = mustOk(projectId("bbbbbbbb-0000-4000-8000-000000000001"));
    const c1 = mustOk(coreBindingId("bbbbbbbb-0000-4000-8000-0000000000c1"));
    const c2 = mustOk(coreBindingId("bbbbbbbb-0000-4000-8000-0000000000c2"));
    const base = createEmptyProject(id, "demo");
    const a: ProjectV1 = {
      ...base,
      coreBindings: [
        { bindingId: c1, expectedDeviceId: "d1", connectionProfileId: "p1" },
        { bindingId: c2, expectedDeviceId: "d2", connectionProfileId: "p2" },
      ],
    };
    const b: ProjectV1 = {
      ...base,
      coreBindings: [...a.coreBindings].reverse(),
    };
    expect(canonicalProjectHash(a)).toBe(canonicalProjectHash(b));
  });

  it("does not change when only authoringMetadata differs", () => {
    const id = mustOk(projectId("bbbbbbbb-0000-4000-8000-000000000002"));
    const base = createEmptyProject(id, "demo");
    const withMetadata: ProjectV1 = {
      ...base,
      authoringMetadata: { "some-node": { position: { x: 1, y: 2 }, selected: true } },
    };
    expect(canonicalProjectHash(base)).toBe(canonicalProjectHash(withMetadata));
  });

  it("does change when deployable content actually differs", () => {
    const id = mustOk(projectId("bbbbbbbb-0000-4000-8000-000000000003"));
    const a = createEmptyProject(id, "demo-a");
    const b = createEmptyProject(id, "demo-b");
    expect(canonicalProjectHash(a)).not.toBe(canonicalProjectHash(b));
  });
});
