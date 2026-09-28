import { checkPermission, domainError, type DomainError, type PermissionSet } from "@spaghettilab/domain";
import { CoreStatusErrorCode } from "./errors.js";

/**
 * `FACTORY_RESET`'s `scope` (op 15, `firmware/backbone/include/spaghetti/factory_reset.h:18-24`)
 * is a bitmask, not an enum with a distinct "diagnostic" value. There is no
 * separate diagnostic-reset scope in the firmware at all — confirmed
 * directly against `reset_ops.c`, which gates the whole operation with one
 * permission (`SPAGHETTI_PERMISSION_PROVISION`) regardless of which scope
 * bits are set. S093 § Verifiche's "un reset diagnostico richiede
 * autorizzazione esplicita" is therefore an app-side policy, not something
 * the wire distinguishes: this module requires `core.admin.factory-reset`
 * for every `FACTORY_RESET` call, any scope combination included, matching
 * what the firmware actually enforces rather than inventing a second
 * permission scope for a wire value that doesn't exist.
 */
export const FactoryResetScope = {
  CONFIG: 0x1,
  NETWORK: 0x2,
  CREDENTIALS: 0x4,
  BLE_BONDS: 0x8,
  ALL: 0x0f,
} as const;

export type FactoryResetWireClient = {
  factoryReset(req: { readonly scope: number }): Promise<void>;
};

export type FactoryResetOutcome =
  | { readonly kind: "SUCCESS" }
  | { readonly kind: "PERMISSION_DENIED"; readonly issue: DomainError }
  | { readonly kind: "REMOTE_ERROR"; readonly issue: DomainError };

/**
 * Requires `core.admin.factory-reset` (`@spaghettilab/domain`'s
 * `PermissionScope`) before calling the wire at all — denied means no
 * `FACTORY_RESET` request is ever sent, same pattern as every other
 * permission-gated call in this codebase (`@spaghettilab/core-actions`'s
 * `runCommand`/`requestScan`).
 */
export async function requestFactoryReset(
  client: FactoryResetWireClient,
  granted: PermissionSet,
  scope: number,
): Promise<FactoryResetOutcome> {
  const permission = checkPermission(granted, "core.admin.factory-reset");
  if (!permission.ok) {
    return { kind: "PERMISSION_DENIED", issue: permission.error };
  }

  try {
    await client.factoryReset({ scope });
    return { kind: "SUCCESS" };
  } catch (cause) {
    return {
      kind: "REMOTE_ERROR",
      issue: domainError({
        code: CoreStatusErrorCode.REMOTE_ERROR,
        path: ["core-status", "requestFactoryReset"],
        target: String(scope),
        remediation: "factoryReset failed on the wire — check the Core connection and retry.",
        cause,
      }),
    };
  }
}
