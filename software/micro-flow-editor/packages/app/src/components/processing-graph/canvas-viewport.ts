import type { Viewport } from "@xyflow/react";

// Keep navigation state with the open project, never in graph coordinates.
const viewports = new WeakMap<object, Map<string, Viewport>>();
export function savedCanvasViewport(project: object, bindingId: string): Viewport | undefined {
  const viewport = viewports.get(project)?.get(bindingId);
  return viewport && { ...viewport };
}
export function saveCanvasViewport(project: object, bindingId: string, viewport: Viewport): void {
  let bindings = viewports.get(project);
  if (!bindings) { bindings = new Map(); viewports.set(project, bindings); }
  bindings.set(bindingId, { ...viewport });
}
