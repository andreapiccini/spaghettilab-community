/** Shared by wire travel and destination glow so they stay synchronized. */
export const SIGNAL_TRAVEL_MS = 220;
export const SIGNAL_ACTIVITY_MS = SIGNAL_TRAVEL_MS + 400;

import type { RecordEventPayload } from "@spaghettilab/protocol-sdk";
export type EdgeActivityRoute = {
  edgeId: string;
  key: number;
  field: number;
  action?: number;
  schemaId?: string;
  kind: "trigger" | "data";
};
/** A zero-valued datum still travels; LOW reset records of manual triggers do not fire actions. */
export function activeEdgesForRecord(
  routes: readonly EdgeActivityRoute[],
  record: RecordEventPayload,
): EdgeActivityRoute[] {
  const matched = new Map<string, EdgeActivityRoute>();
  for (const route of routes) {
    if (
      route.key !== record.sourceKey ||
      (route.schemaId && route.schemaId !== record.schemaId) ||
      (route.action && route.action !== record.actionId)
    )
      continue;
    const value = record.fields?.[route.field];
    if (value === undefined) continue;
    if (route.kind === "trigger" && (value === false || value === 0 || value === 0n))
      continue;
    matched.set(route.edgeId, route);
  }
  return [...matched.values()];
}

/** Visual timing only. No values or hardware commands pass through this queue. */
export class SignalWavePlanner {
  private arrivals = new Map<string, number>();
  private occupied = new Map<string, number>();
  constructor(private edges: readonly { id: string; source: string; target: string }[]) {}
  plan(routes: readonly EdgeActivityRoute[], now: number) {
    const pending = new Map(routes.map(route => [route.edgeId, route]));
    const ordered: EdgeActivityRoute[] = [];
    const visiting = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) return; // Feedback loops never recurse indefinitely.
      const route = pending.get(id); if (!route) return;
      visiting.add(id);
      const edge = this.edges.find(edge => edge.id === id);
      if (edge) for (const input of this.edges.filter(input => input.target === edge.source)) visit(input.id);
      pending.delete(id); ordered.push(route);
    };
    for (const id of [...pending.keys()]) visit(id);
    return ordered.flatMap(route => {
      const edge = this.edges.find(edge => edge.id === route.edgeId);
      if (!edge || (this.occupied.get(edge.id) ?? 0) > now) return [];
      const start = Math.max(now, this.arrivals.get(edge.source) ?? now);
      // Coalesce busy streams instead of building an ever-growing visual backlog.
      if (start - now > 900) return [];
      const arrival = start + SIGNAL_TRAVEL_MS;
      this.occupied.set(edge.id, arrival + 70);
      this.arrivals.set(edge.target, Math.max(this.arrivals.get(edge.target) ?? 0, arrival + 40));
      return [{ route, delay: start - now }];
    });
  }
}
