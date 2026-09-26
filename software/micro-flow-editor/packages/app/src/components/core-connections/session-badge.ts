import type { SessionState, SyncRelationship } from "@spaghettilab/core-session";
import { CircleCheck, GitFork, PenLine, RotateCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { coreConnectionsCopy, type RowActionId } from "../../lib/core-connections-copy.js";
import type { LocaleId } from "../../lib/locale.js";

export type { RowActionId };

/** `ux/screens/S030-core-connections/visual.md` § Badge stato sessione — color + whether the dot pulses (transitional states only). */
export function sessionBadgeStyle(state: SessionState): { readonly colorVar: string; readonly pulsing: boolean; readonly label: string } {
  switch (state) {
    case "DISCONNECTED":
      return { colorVar: "var(--color-ink-faint)", pulsing: false, label: "DISCONNECTED" };
    case "CONNECTING":
    case "AUTHENTICATING":
    case "SYNCHRONIZING":
      return { colorVar: "var(--color-info)", pulsing: true, label: state };
    case "READY":
      return { colorVar: "var(--color-success)", pulsing: false, label: "READY" };
    case "VALIDATING":
    case "APPLYING":
    case "UPDATING":
    case "REBOOTING":
    case "TRIAL":
      return { colorVar: "var(--color-warning)", pulsing: true, label: state };
    case "CONFLICT":
    case "ERROR":
    case "ROLLED_BACK":
      return { colorVar: "var(--color-error)", pulsing: false, label: state };
    default:
      return { colorVar: "var(--color-ink-faint)", pulsing: false, label: state };
  }
}

/** `ux/screens/S030-core-connections/visual.md` § Badge relazione progetto/dispositivo. */
export function syncBadge(relationship: SyncRelationship, locale: LocaleId): { readonly icon: LucideIcon; readonly colorVar: string; readonly label: string } {
  const copy = coreConnectionsCopy(locale);
  switch (relationship) {
    case "IN_SYNC":
      return { icon: CircleCheck, colorVar: "var(--color-success)", label: "IN_SYNC" };
    case "PROJECT_DIRTY":
      return { icon: PenLine, colorVar: "var(--color-warning)", label: copy.sync.projectDirty };
    case "DEVICE_CHANGED":
      return { icon: RotateCw, colorVar: "var(--color-info)", label: copy.sync.deviceChanged };
    case "DIVERGED":
      return { icon: GitFork, colorVar: "var(--color-error)", label: copy.sync.diverged };
    case "INCOMPATIBLE":
      return { icon: TriangleAlert, colorVar: "var(--color-error)", label: copy.sync.incompatible };
  }
}

/**
 * `ux/screens/S030-core-connections/ui-behavior.md` § Azione per riga secondo lo stato.
 * `hasError` is not in that table: it covers a case the table doesn't model — a
 * `connect()` attempt that failed before a `CoreSession` ever reached `READY`
 * (e.g. the WebSocket itself refused), so there is no session-state transition to
 * `ERROR` to key off of. Without this, a failed attempt looked identical to "never
 * tried" — a real bug found wiring this screen up live.
 */
export function rowActionId(state: SessionState, stale: boolean, relationship: SyncRelationship | null, hasError = false): RowActionId | null {
  if (state === "DISCONNECTED" && hasError) return "review-error";
  if (state === "DISCONNECTED") return stale ? "reconnect" : "connect";
  if (state === "CONNECTING" || state === "AUTHENTICATING" || state === "SYNCHRONIZING") return "cancel";
  if (state === "READY") {
    switch (relationship) {
      case "PROJECT_DIRTY":
        return "send-to-core";
      case "DEVICE_CHANGED":
        return "review-changes";
      case "DIVERGED":
        return "compare-reconcile";
      case "INCOMPATIBLE":
        return "incompatibility-details";
      default:
        return null;
    }
  }
  if (state === "CONFLICT" || state === "ERROR") return "review-error";
  if (state === "ROLLED_BACK") return "see-what-changed";
  return null;
}

export function rowActionLabel(id: RowActionId, locale: LocaleId): string {
  return coreConnectionsCopy(locale).actions[id];
}
