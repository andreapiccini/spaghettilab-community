import type { DomainError, PermissionSet } from "@spaghettilab/domain";
import { checkPermission } from "@spaghettilab/domain";
import { CoreActionsErrorCode, classifyWireError, wireFailure } from "./wire-error.js";

export type ScanWireClient = {
  scanDiscovery(req: { readonly portId: number; readonly allowStateChanging?: boolean }): Promise<{ readonly jobId: number }>;
};

export const ScanOutcomeKind = {
  STARTED: "STARTED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  QUEUE_FULL: "QUEUE_FULL",
  TIMEOUT: "TIMEOUT",
  REMOTE_ERROR: "REMOTE_ERROR",
} as const;
export type ScanOutcomeKind = (typeof ScanOutcomeKind)[keyof typeof ScanOutcomeKind];

export type ScanOutcome = {
  readonly kind: ScanOutcomeKind;
  readonly jobId?: number;
  readonly issues: readonly DomainError[];
};

/**
 * Starts a discovery scan — `invasive: true` maps to `SCAN_DISCOVERY`'s real
 * `allowStateChanging` field (`@spaghettilab/protocol-sdk`'s
 * `ScanDiscoveryRequest`), and requires the `"core.discovery.invasive-scan"`
 * permission scope *before this function ever calls the wire* (S092 §
 * Verifiche: "una scan invasiva richiede l'autorizzazione esplicita prevista
 * dalla policy") — a non-invasive scan needs no such grant.
 */
export async function requestScan(
  client: ScanWireClient,
  granted: PermissionSet,
  req: { readonly portId: number; readonly invasive: boolean },
): Promise<ScanOutcome> {
  if (req.invasive) {
    const permission = checkPermission(granted, "core.discovery.invasive-scan");
    if (!permission.ok) {
      return { kind: ScanOutcomeKind.PERMISSION_DENIED, issues: [permission.error] };
    }
  }

  try {
    const response = await client.scanDiscovery({ portId: req.portId, allowStateChanging: req.invasive });
    return { kind: ScanOutcomeKind.STARTED, jobId: response.jobId, issues: [] };
  } catch (cause) {
    const classified = classifyWireError(cause);
    if (classified === "PERMISSION_DENIED" || classified === "QUEUE_FULL" || classified === "TIMEOUT" || classified === "REMOTE_ERROR") {
      return { kind: ScanOutcomeKind[classified], issues: [wireFailure(CoreActionsErrorCode[classified], ["core-actions", "requestScan"], String(req.portId), `scanDiscovery failed: ${classified}`, cause)] };
    }
    return { kind: ScanOutcomeKind.REMOTE_ERROR, issues: [wireFailure(CoreActionsErrorCode.REMOTE_ERROR, ["core-actions", "requestScan"], String(req.portId), "scanDiscovery failed", cause)] };
  }
}

/** `spaghetti_job_state` (`firmware/backbone/subsys/communication/communication.c`), mirrored in `@spaghettilab/protocol-sdk`'s `JobState`. */
export const JobProgressOutcomeKind = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  TIMEOUT: "TIMEOUT",
  UNKNOWN: "UNKNOWN",
} as const;
export type JobProgressOutcomeKind = (typeof JobProgressOutcomeKind)[keyof typeof JobProgressOutcomeKind];

export type JobStatusLike = { readonly jobId: number; readonly state: number; readonly progress: number };

/**
 * Classifies a `GET_JOB_STATUS` response into one of the distinct outcomes
 * S092 § Verifiche asks for — `JobState.EXPIRED` (6) becomes `"TIMEOUT"`
 * explicitly, never lumped in with `"FAILED"`. `JobState.FREE` (0) means the
 * slot has nothing to report (never issued, or already reclaimed) —
 * `"UNKNOWN"`, not silently treated as any of the real terminal states.
 */
export function interpretJobStatus(status: JobStatusLike): { readonly kind: JobProgressOutcomeKind; readonly progress: number } {
  const kindByState: Readonly<Record<number, JobProgressOutcomeKind>> = {
    0: JobProgressOutcomeKind.UNKNOWN,
    1: JobProgressOutcomeKind.PENDING,
    2: JobProgressOutcomeKind.RUNNING,
    3: JobProgressOutcomeKind.COMPLETED,
    4: JobProgressOutcomeKind.FAILED,
    5: JobProgressOutcomeKind.CANCELLED,
    6: JobProgressOutcomeKind.TIMEOUT,
  };
  return { kind: kindByState[status.state] ?? JobProgressOutcomeKind.UNKNOWN, progress: status.progress };
}
