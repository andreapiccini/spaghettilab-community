/** Shared by wire travel and destination glow so they stay synchronized. */
export const SIGNAL_TRAVEL_MS = 650;
export const SIGNAL_ACTIVITY_MS = SIGNAL_TRAVEL_MS + 1000;

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
