import { checkPermission, domainError, type DomainError, type PermissionSet } from "@spaghettilab/domain";
import { CoreAdminErrorCode } from "./errors.js";

/**
 * `enum spaghetti_connectivity_service` (`firmware/backbone/include/spaghetti/connectivity.h:21-26`) —
 * a bitmask, combinable (e.g. `WIFI | REMOTE_CONSOLE`).
 */
export const ConnectivityService = {
  BLE: 1,
  WIFI: 2,
  MQTT: 4,
  REMOTE_CONSOLE: 8,
} as const;

export type LeaseWireClient = {
  acquireConnectivityLease(req: { readonly services: number; readonly durationMs: number }): Promise<void>;
  releaseConnectivityLease(): Promise<void>;
};

export type LeaseOutcome = { readonly kind: "SUCCESS" } | { readonly kind: "PERMISSION_DENIED"; readonly issue: DomainError } | { readonly kind: "REMOTE_ERROR"; readonly issue: DomainError };

/**
 * A connectivity lease is a bounded, self-reversing reservation — acquiring
 * it never forcibly evicts another principal (`spaghetti_connectivity_acquire_lease`
 * returns `-EBUSY` if one is already active rather than preempting it,
 * `connectivity.h:79`), and it auto-expires. Not destructive, so unlike
 * `requestFactoryReset`/`openNetworkMaintenance` in this package, no
 * `DestructiveConfirmation` is required here — only the `core.admin.lease`
 * permission, checked locally before any wire call.
 */
export async function acquireLease(client: LeaseWireClient, granted: PermissionSet, services: number, durationMs: number): Promise<LeaseOutcome> {
  const permission = checkPermission(granted, "core.admin.lease");
  if (!permission.ok) return { kind: "PERMISSION_DENIED", issue: permission.error };

  try {
    await client.acquireConnectivityLease({ services, durationMs });
    return { kind: "SUCCESS" };
  } catch (cause) {
    return { kind: "REMOTE_ERROR", issue: remoteError("acquireLease", String(services), cause) };
  }
}

export async function releaseLease(client: LeaseWireClient, granted: PermissionSet): Promise<LeaseOutcome> {
  const permission = checkPermission(granted, "core.admin.lease");
  if (!permission.ok) return { kind: "PERMISSION_DENIED", issue: permission.error };

  try {
    await client.releaseConnectivityLease();
    return { kind: "SUCCESS" };
  } catch (cause) {
    return { kind: "REMOTE_ERROR", issue: remoteError("releaseLease", "current-lease", cause) };
  }
}

function remoteError(fn: string, target: string, cause: unknown): DomainError {
  return domainError({
    code: CoreAdminErrorCode.REMOTE_ERROR,
    path: ["core-admin", fn],
    target,
    remediation: "The wire call failed — check the Core connection and retry.",
    cause,
  });
}
