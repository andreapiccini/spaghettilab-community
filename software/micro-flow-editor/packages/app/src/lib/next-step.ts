import type { ProjectV1 } from "@spaghettilab/domain";

/**
 * Which LeftRail zone the user hasn't touched yet, in the order the shell
 * tour presents them — `null` once there's nothing left to honestly point
 * at. Derived only from real project state (no invented "has deployed"
 * flag: nothing in `ProjectV1` tracks that today, so the chain stops at
 * Processing Graph rather than guessing).
 */
export function nextStepTarget(project: ProjectV1 | null): string | null {
  if (!project) return null;
  if (project.coreBindings.length === 0) return "rail-core-connections";
  if (!project.deviceGraphs.some((g) => g.nodes.length > 0)) return "rail-processing-graph";
  return null;
}
