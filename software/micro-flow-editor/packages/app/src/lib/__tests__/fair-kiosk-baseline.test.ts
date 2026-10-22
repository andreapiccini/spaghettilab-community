import { expect, it, vi } from "vitest";
import { buildDemoProject } from "../demo-project.js";
import { FAIR_BASELINE, FAIR_PREVIOUS, captureFairBaseline, restoreFairBaseline, createFairStartupProject } from "../fair-kiosk-baseline.js";
import { exportProjectV1 } from "@spaghettilab/domain";
function store() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
it("captures the actual project and keeps the baseline separate from regular saves", async () => {
  const storage = store();
  const project = buildDemoProject("Base fiera")!;
  const save = vi.fn(async () => {});
  await captureFairBaseline(project, storage, save);
  expect(save).toHaveBeenCalledWith(project);
  expect(storage.getItem(FAIR_BASELINE)).toBe(exportProjectV1(project));
});
it("does not alter projects when Stop fails", async () => {
  const storage = store();
  await captureFairBaseline(buildDemoProject("Base")!, storage, async () => {});
  const save = vi.fn(async () => {}), open = vi.fn();
  await expect(restoreFairBaseline({ storage, current: buildDemoProject("Partecipante")!,
    stop: async () => { throw new Error("Stop non confermato"); }, save, open })).rejects.toThrow("Stop non confermato");
  expect(save).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(storage.getItem(FAIR_PREVIOUS)).toBeNull();
});
it("backs up the participant project and restores only after confirmed Stop", async () => {
  const storage = store();
  const base = buildDemoProject("Base")!, current = buildDemoProject("Partecipante")!;
  await captureFairBaseline(base, storage, async () => {});
  const order: string[] = [];
  const restored = await restoreFairBaseline({ storage, current,
    stop: async () => { order.push("stop"); }, save: async () => { order.push("save"); }, open: () => { order.push("open"); } });
  expect(order).toEqual(["stop", "save", "open"]);
  expect(restored.name).toBe("Base");
  expect(storage.getItem(FAIR_PREVIOUS)).toBe(exportProjectV1(current));
});
it("rejects missing or corrupt baselines before sending any hardware command", async () => {
  const storage = store(), stop = vi.fn(async () => {}), save = vi.fn(async () => {}), open = vi.fn();
  const input = { storage, current: null, stop, save, open };
  await expect(restoreFairBaseline(input)).rejects.toThrow("Nessuna base");
  storage.setItem(FAIR_BASELINE, "invalid");
  await expect(restoreFairBaseline(input)).rejects.toThrow("Base demo non valida");
  expect(stop).not.toHaveBeenCalled();
});

it("starts empty without changing the baseline or hardware setup", () => {
  const base = buildDemoProject("Base")!;
  const original = exportProjectV1(base);
  const started = createFairStartupProject(base);
  expect(started.projectId).not.toBe(base.projectId);
  expect(started.deviceGraphs.every(graph => !graph.nodes.length && !graph.edges.length)).toBe(true);
  expect(started.coreBindings).toEqual(base.coreBindings);
  expect(started.physicalGraphs).toEqual(base.physicalGraphs);
  expect(started.deploymentRecords).toEqual([]);
  expect(exportProjectV1(base)).toBe(original);
});
it("starts empty even without a saved baseline", () => {
  const started = createFairStartupProject(null);
  expect(started.name).toBe("Demo fiera");
  expect(started.deviceGraphs).toEqual([]);
});

it("clears modules and both graphs only after hardware reset, keeping a recovery copy", async () => {
  const { clearFairProject } = await import("../fair-kiosk-baseline.js");
  const storage = store(), current = buildDemoProject("Da svuotare")!;
  await captureFairBaseline(current, storage, async () => {});
  const original = exportProjectV1(current), order: string[] = [];
  const cleared = await clearFairProject({ storage, current,
    resetHardware: async () => { order.push("hardware"); },
    save: async () => { order.push("save"); }, open: () => { order.push("open"); } });
  expect(order).toEqual(["hardware", "save", "open"]);
  expect(cleared.coreBindings).toEqual(current.coreBindings);
  expect(cleared.physicalGraphs.every(graph => !graph.nodes.length && !graph.edges.length)).toBe(true);
  expect(cleared.deviceGraphs.every(graph => !graph.nodes.length && !graph.edges.length)).toBe(true);
  expect(cleared.authoringMetadata).toEqual({});
  expect(storage.getItem(FAIR_PREVIOUS)).toBe(original);
  expect(storage.getItem(`${FAIR_BASELINE}.before-clear`)).toBe(original);
  expect(storage.getItem(FAIR_BASELINE)).toBe(exportProjectV1(cleared));
});
it("does not replace the project or base if hardware reset is not confirmed", async () => {
  const { clearFairProject } = await import("../fair-kiosk-baseline.js");
  const storage = store(), current = buildDemoProject("Da svuotare")!;
  await captureFairBaseline(current, storage, async () => {});
  const original = storage.getItem(FAIR_BASELINE), save = vi.fn(async () => {}), open = vi.fn();
  await expect(clearFairProject({ storage, current, save, open,
    resetHardware: async () => { throw new Error("Stop non confermato"); } })).rejects.toThrow("Stop non confermato");
  expect(save).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  expect(storage.getItem(FAIR_BASELINE)).toBe(original);
});
