import { exportProjectV1, importProjectV1, createEmptyProject, projectId, type ProjectV1 } from "@spaghettilab/domain";

export const FAIR_BASELINE = "spaghettilab.fair.baseline.v1";
export const FAIR_PREVIOUS = "spaghettilab.fair.previous.v1";
type Store = Pick<Storage, "getItem" | "setItem">;

export async function captureFairBaseline(project: ProjectV1, storage: Store, save: (project: ProjectV1) => Promise<void>) {
  const raw = exportProjectV1(project);
  await save(project);
  storage.setItem(FAIR_BASELINE, raw);
}

/** No project or questionnaire may be replaced until hardware Stop is confirmed. */
export async function restoreFairBaseline(input: {
  storage: Store;
  current: ProjectV1 | null;
  stop: () => Promise<void>;
  save: (project: ProjectV1) => Promise<void>;
  open: (project: ProjectV1) => void;
}): Promise<ProjectV1> {
  const raw = input.storage.getItem(FAIR_BASELINE);
  if (!raw) throw new Error("Nessuna base demo salvata. Apri il progetto e usa salva-base.");
  const parsed = importProjectV1(raw);
  if (!parsed.ok) throw new Error("Base demo non valida: non è stato modificato alcun progetto.");
  await input.stop();
  if (input.current) input.storage.setItem(FAIR_PREVIOUS, exportProjectV1(input.current));
  await input.save(parsed.value);
  input.open(parsed.value);
  return parsed.value;
}

/** Start a new visitor canvas, retaining hardware setup but no preloaded logic. */
export function createFairStartupProject(template: ProjectV1 | null): ProjectV1 {
  const id = projectId(crypto.randomUUID());
  if (!id.ok) throw new Error("Impossibile creare il progetto della fiera.");
  if (!template) return createEmptyProject(id.value, "Demo fiera");
  return { ...template, projectId: id.value, name: "Demo fiera",
    deviceGraphs: template.deviceGraphs.map(graph => ({ ...graph, nodes: [], edges: [] })),
    systemAutomationGraph: { ...template.systemAutomationGraph, nodes: [], edges: [] },
    deploymentRecords: [],
  };
}

/** Clear the working project only after every connected Backbone was stopped. */
export async function clearFairProject(input: {
  storage: Store;
  current: ProjectV1;
  resetHardware: () => Promise<void>;
  save: (project: ProjectV1) => Promise<void>;
  open: (project: ProjectV1) => void;
}): Promise<ProjectV1> {
  input.storage.setItem(FAIR_PREVIOUS, exportProjectV1(input.current));
  const baseline = input.storage.getItem(FAIR_BASELINE);
  if (baseline) input.storage.setItem(`${FAIR_BASELINE}.before-clear`, baseline);
  await input.resetHardware();
  const empty = { ...createEmptyProject(input.current.projectId, input.current.name),
    coreBindings: input.current.coreBindings,
    physicalGraphs: input.current.physicalGraphs.map(graph => ({ ...graph, nodes: [], edges: [] })),
    deviceGraphs: input.current.deviceGraphs.map(graph => ({ ...graph, nodes: [], edges: [] })),
  };
  await input.save(empty);
  input.storage.setItem(FAIR_BASELINE, exportProjectV1(empty));
  input.open(empty);
  return empty;
}
