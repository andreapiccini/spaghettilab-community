import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import { domainError, err, ok, type DomainError, type Result } from "@spaghettilab/domain";
import type { DeviceProfileSummary } from "@spaghettilab/protocol-sdk";
import { DeviceProfileInstallErrorCode } from "./errors.js";
import { bytesEqual, sha256 } from "./hash.js";
import { encodeDeviceProfileCbor } from "./profile-cbor.js";

/**
 * The narrow slice of `@spaghettilab/protocol-sdk`'s `SpaghettiClient` this
 * workflow actually calls — a real `SpaghettiClient` instance satisfies this
 * structurally with no adapter needed; tests use a small hand-written fake
 * instead of the full client/transport harness, since the surface used here
 * is this small.
 */
export type DeviceProfileWireClient = {
  validateDeviceProfile(req: { readonly profileCbor: Uint8Array }): Promise<{ readonly valid: number }>;
  installDeviceProfile(req: { readonly profileCbor: Uint8Array }): Promise<void>;
  removeDeviceProfile(req: { readonly idBytes: Uint8Array; readonly version: number }): Promise<void>;
  getFullDeviceProfileList(): Promise<DeviceProfileSummary[]>;
};

/** A structural stand-in for `@spaghettilab/protocol-sdk`'s `SpaghettiClientError` — checked by shape, not `instanceof`, so this package doesn't need a hard dependency on that class for a single field read. */
type WireError = { readonly code?: string; readonly status?: number };

function isProtocolError(e: unknown): e is WireError & { code: "PROTOCOL_ERROR"; status: number } {
  return typeof e === "object" && e !== null && (e as WireError).code === "PROTOCOL_ERROR" && typeof (e as WireError).status === "number";
}

/**
 * `firmware/backbone/subsys/communication/protocol_status.c`'s
 * `spaghetti_protocol_status_from_errno` — the real errno→`ProtocolStatus`
 * mapping, read directly rather than guessed. Only the entries relevant to
 * Device Profile install/remove are named here; every other status still
 * produces a structured error, just without a specific label.
 */
const STATUS_CONFLICT = 4; // -EEXIST: same id+version already installed with a different hash
const STATUS_BUSY = 5; // -EBUSY: profile still referenced by a live or persisted Config
const STATUS_RESOURCE_EXHAUSTED = 8; // -ENOSPC: no free profile slot
const STATUS_UNSUPPORTED = 2; // -ENOTSUP: unsupported wire version or opcode

function wireFailure(operation: string, cause: unknown): DomainError {
  if (isProtocolError(cause)) {
    if (cause.status === STATUS_BUSY) {
      return domainError({
        code: DeviceProfileInstallErrorCode.PROFILE_IN_USE,
        path: ["device-profile-install", operation],
        target: "status=BUSY",
        remediation: "the Core reports this profile is still referenced by a live or persisted Config — it cannot be removed or replaced",
        cause,
      });
    }
    if (cause.status === STATUS_CONFLICT) {
      return domainError({
        code: DeviceProfileInstallErrorCode.REMOTE_VALIDATION_FAILED,
        path: ["device-profile-install", operation],
        target: "status=CONFLICT",
        remediation: "same profileId+version is already installed with a different hash",
        cause,
      });
    }
    if (cause.status === STATUS_RESOURCE_EXHAUSTED) {
      return domainError({
        code: DeviceProfileInstallErrorCode.REMOTE_VALIDATION_FAILED,
        path: ["device-profile-install", operation],
        target: "status=RESOURCE_EXHAUSTED",
        remediation: "the Core has no free profile slot",
        cause,
      });
    }
    if (cause.status === STATUS_UNSUPPORTED) {
      return domainError({
        code: DeviceProfileInstallErrorCode.REMOTE_VALIDATION_FAILED,
        path: ["device-profile-install", operation],
        target: "status=UNSUPPORTED",
        remediation: "the Core rejected the wire version or an opcode this profile uses",
        cause,
      });
    }
  }
  return domainError({
    code: DeviceProfileInstallErrorCode.REMOTE_VALIDATION_FAILED,
    path: ["device-profile-install", operation],
    target: operation,
    remediation: "the remote call failed",
    cause,
  });
}

export type InstallProfileResult = {
  readonly summary: DeviceProfileSummary;
};

/**
 * Validates remotely, installs, and verifies the post-install hash (S063
 * point 1) — in that order, from local data derived by
 * `encodeDeviceProfileCbor` (S063) only.
 *
 * "Un'installazione interrotta non cambia il catalogo" (S063 § Verifiche)
 * holds by construction, not by any rollback logic here: this function
 * never maintains a local catalog cache — every catalog fact it returns
 * comes from a fresh `getFullDeviceProfileList()` call. If `installDeviceProfile`
 * itself throws (interrupted), this function returns an error without ever
 * having claimed anything changed, and the firmware's own atomic-commit
 * behavior (`spaghetti_device_profile_install`: "staging never becomes
 * visible on truncated input... or validation failure") guarantees nothing
 * did.
 *
 * `VALIDATE_DEVICE_PROFILE` is a known stub in the firmware as implemented
 * (see `@spaghettilab/protocol-sdk`'s `ValidateDeviceProfileResponse` doc
 * comment — it only checks the request is non-empty and always answers
 * `valid: 1`) — this call is still made because S063 point 1 asks for it,
 * but its result is not treated as a real correctness signal; only the
 * post-install hash check is.
 */
export async function installProfile(client: DeviceProfileWireClient, draft: DeviceProfileDraft): Promise<Result<InstallProfileResult, DomainError>> {
  const profileCbor = encodeDeviceProfileCbor(draft);

  try {
    await client.validateDeviceProfile({ profileCbor });
  } catch (cause) {
    return err(wireFailure("validateDeviceProfile", cause));
  }

  try {
    await client.installDeviceProfile({ profileCbor });
  } catch (cause) {
    return err(wireFailure("installDeviceProfile", cause));
  }

  const expectedHash = await sha256(profileCbor);

  let installed: readonly DeviceProfileSummary[];
  try {
    installed = await client.getFullDeviceProfileList();
  } catch (cause) {
    return err(wireFailure("getFullDeviceProfileList", cause));
  }

  const match = installed.find((p) => p.profileId === draft.profileId && p.version === draft.version);
  if (!match) {
    return err(
      domainError({
        code: DeviceProfileInstallErrorCode.NOT_FOUND_AFTER_INSTALL,
        path: ["device-profile-install", "installProfile"],
        target: `${draft.profileId}@${draft.version}`,
        remediation: "INSTALL_DEVICE_PROFILE returned success but the profile does not appear in a subsequent catalog listing",
      }),
    );
  }
  if (!bytesEqual(match.hash, expectedHash)) {
    return err(
      domainError({
        code: DeviceProfileInstallErrorCode.HASH_VERIFICATION_FAILED,
        path: ["device-profile-install", "installProfile"],
        target: `${draft.profileId}@${draft.version}`,
        remediation: "the Core's reported SHA-256 does not match the SHA-256 of the bytes this package sent",
      }),
    );
  }

  return ok({ summary: match });
}

/**
 * Removes an installed profile, refusing when the caller already knows a
 * local Module references it (`isReferencedLocally`) — a fast, no-round-trip
 * guard for the project-local half of "un profilo in uso non può essere
 * rimosso" (S063 § Verifiche). The Core-side half — a live or persisted
 * Config elsewhere referencing it, which this package cannot know locally —
 * is still enforced remotely: `REMOVE_DEVICE_PROFILE`'s `-EBUSY` surfaces as
 * `ProtocolStatus.BUSY`, translated to the same `PROFILE_IN_USE` error.
 */
export async function removeProfile(
  client: DeviceProfileWireClient,
  profileId: string,
  version: number,
  options: { readonly isReferencedLocally: boolean },
): Promise<Result<void, DomainError>> {
  if (options.isReferencedLocally) {
    return err(
      domainError({
        code: DeviceProfileInstallErrorCode.PROFILE_IN_USE,
        path: ["device-profile-install", "removeProfile"],
        target: `${profileId}@${version}`,
        remediation: "at least one Module in the current project references this profile — remove or reassign it first",
      }),
    );
  }
  try {
    await client.removeDeviceProfile({ idBytes: new TextEncoder().encode(profileId), version });
    return ok(undefined);
  } catch (cause) {
    return err(wireFailure("removeProfile", cause));
  }
}
