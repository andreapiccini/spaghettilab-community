import { projectId as parseProjectId, type ProjectV1 } from "@spaghettilab/domain";
import { buildDemoProject, DEMO_PROJECT_NAME } from "./demo-project.js";
import { localStorageAdapter, projectRepository } from "./repository.js";
import { saveTourSeen } from "./tour.js";

export type PrepareDemoProjectResult =
  | { readonly ok: true; readonly project: ProjectV1 }
  | { readonly ok: false; readonly kind: "build" }
  | { readonly ok: false; readonly kind: "exception"; readonly detail: string };

/**
 * Rebuilds the shipped Demo project (catalog/preview changes always land)
 * and marks the shell tour seen so it cannot yank the visitor to Core Connections.
 */
export async function prepareDemoProject(): Promise<PrepareDemoProjectResult> {
  try {
    const ids = await projectRepository.listProjectIds();
    for (const rawId of ids) {
      const idResult = parseProjectId(rawId);
      if (!idResult.ok) continue;
      const loaded = await projectRepository.load(idResult.value);
      if (loaded.ok && loaded.value.name === DEMO_PROJECT_NAME) {
        await projectRepository.remove(idResult.value);
      }
    }
    const demo = buildDemoProject(DEMO_PROJECT_NAME);
    if (!demo) return { ok: false, kind: "build" };
    try {
      await projectRepository.save(demo);
    } catch {
      // Persistence is best-effort — demo-only can run entirely in memory.
    }
    try {
      await saveTourSeen(localStorageAdapter, true);
    } catch {
      // Same: skip the tour even if the flag cannot be written.
    }
    return { ok: true, project: demo };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "unknown error";
    return { ok: false, kind: "exception", detail };
  }
}
