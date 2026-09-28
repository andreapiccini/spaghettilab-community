import type { PackArtifact, PackSignature } from "@spaghettilab/capability-marketplace";

/** `enum spaghetti_config_migration_policy`, `firmware/backbone/include/spaghetti/image_manifest.h:29-32`. */
export enum ConfigMigrationPolicy {
  REJECT_REMOVAL = 0,
  EXPLICIT = 1,
}

export type FeaturePackRef = { readonly packId: string; readonly version: number };

/**
 * Declared ahead of transfer by the marketplace/CI that built and signed
 * this candidate image — mirrors `struct spaghetti_image_manifest`
 * (`image_manifest.h:37-58`) field-for-field, but this is **not** the wire
 * struct itself: the real manifest only exists embedded in the image bytes
 * and is validated firmware-side, after transfer, by
 * `spaghetti_image_manifest_validate_candidate()`
 * (`spaghetti_update_bind_candidate_manifest()`/`finish()`,
 * `image_manifest.c:381-431`) — there is no Protocol V1 operation to
 * validate a candidate before transfer (no `VALIDATE_OTA_CANDIDATE`
 * exists, unlike `VALIDATE_CONFIG`/`VALIDATE_DEVICE_PROFILE`). Everything
 * this package checks is therefore a **prediction** of that later
 * firmware-side check, run locally against declared metadata, never a
 * substitute for it.
 */
export type OtaCandidateManifest = {
  readonly coreVariant: string;
  /** `spaghetti_resource_profile` — MINIMAL=0, STANDARD=1, EXTENDED=2 (`capabilities.h:19-22`). */
  readonly resourceProfile: number;
  readonly fwVersion: string;
  readonly abiVersion: number;
  readonly minProtocolVersion: number;
  readonly minConfigVersion: number;
  readonly packs: readonly FeaturePackRef[];
  readonly featureSetHash: string;
  readonly flashSlotBytes: number;
  readonly flashImageBudgetBytes: number;
  readonly flashHeadroomBytes: number;
  readonly staticRamBudgetBytes: number;
  readonly declaredStackBytes: number;
  readonly declaredPoolBytes: number;
  readonly declaredWorkspaceBytes: number;
  readonly bootloaderMin: string;
  readonly configMigrationPolicy: ConfigMigrationPolicy;
  readonly artifact: PackArtifact;
  /** Declared SHA-256 hex of the artifact bytes. */
  readonly hash: string;
  readonly signature: PackSignature;
  /**
   * Union of every composed pack's `providedTypes` (block/rule/module-driver
   * type ids) — the real check firmware runs at finish time
   * (`ensure_type_retained()`, `image_manifest.c:268-285`) is "does the
   * candidate's pack list still provide every type the live Config uses,
   * unless `configMigrationPolicy` is `EXPLICIT`". Aggregated here from the
   * marketplace pack manifests this candidate was composed from — a
   * caller-supplied set of `@spaghettilab/capability-marketplace`
   * `ProvidedTypes` values union'd together, not invented.
   */
  readonly providedTypeIds: ReadonlySet<string>;
  /**
   * Whether this candidate is the fixed `"all-supported"` CI build variant
   * (`core/tools/resource_report.py`'s `--profile all-supported`, a Kconfig
   * overlay baked in at build time) or a smaller composed image. Purely a
   * marketplace/CI-side label — the firmware has no wire concept of build
   * variants at all, it only ever reports what's already compiled into the
   * running image (`GET_CAPABILITIES`/`GET_FEATURES`).
   */
  readonly isAllSupportedBuild: boolean;
};
