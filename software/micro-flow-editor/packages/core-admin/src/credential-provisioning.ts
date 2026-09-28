import { checkPermission, type DomainError, type PermissionSet } from "@spaghettilab/domain";

export type CredentialProvisioningOutcome =
  | { readonly kind: "PERMISSION_DENIED"; readonly issue: DomainError }
  | { readonly kind: "UNAVAILABLE_OVER_PROTOCOL_V1"; readonly remediation: string };

/**
 * There is no Protocol V1 wire operation for credential provisioning —
 * confirmed by an exhaustive search of every file under
 * `firmware/backbone/subsys/communication/operations/` (14 files, none named or
 * containing "provision"/"credential"). Real provisioning (Wi-Fi
 * SSID/password, MQTT credentials, OTA/remote-console secrets, BLE bonding)
 * only happens out-of-band over the Maintenance Link's local
 * UART/USB serial shell — SMP commands "add/update Wi-Fi" (id 2), "set
 * bootstrap key" (id 4), "set OTA credentials" (id 7), "set/clear
 * remote-console credential" (id 10/11), per
 * `firmware/backbone/subsys/services/maintenance_link/README.md:42-55` — never
 * reachable from this app's BLE/MQTT/WebSocket transports.
 *
 * So this function cannot call a wire operation that does not exist. It
 * still checks `core.admin.credential-provisioning` first — even the fact
 * that provisioning requires physical/serial access is information a
 * caller without the permission scope should not see — then reports
 * `UNAVAILABLE_OVER_PROTOCOL_V1` with the real remediation path, instead of
 * silently omitting the capability or fabricating a wire call that would
 * never work.
 */
export function checkCredentialProvisioningAvailability(granted: PermissionSet): CredentialProvisioningOutcome {
  const permission = checkPermission(granted, "core.admin.credential-provisioning");
  if (!permission.ok) return { kind: "PERMISSION_DENIED", issue: permission.error };

  return {
    kind: "UNAVAILABLE_OVER_PROTOCOL_V1",
    remediation:
      "Credential provisioning is not reachable over this app's transports — it requires a physical/serial Maintenance Link session on the Core.",
  };
}
