# @spaghettilab/ota-preflight

OTA candidate preflight and build selection (S102) — decides whether a Capability Pack
candidate image can install safely on a specific Core, before transferring a single
byte.

## Why this is entirely a local prediction

Protocol V1 has no `VALIDATE_OTA_CANDIDATE`-style operation — unlike `VALIDATE_CONFIG`
(op 17) and `VALIDATE_DEVICE_PROFILE` (op 24), confirmed by the full 27-operation list
in `envelope.ts`. The only real, authoritative check happens firmware-side, in
`spaghetti_image_manifest_validate_candidate()`
(`firmware/backbone/subsys/feature_registry/image_manifest.c:381-431`), and it only runs
**after** the candidate has already been transferred (`spaghetti_update_finish()`).
`preflightOtaCandidate()` predicts that later check locally, from data already read
(`GET_CAPABILITIES`, `GET_RESOURCES`, `GET_UPDATE_STATUS`) plus the candidate's own
declared manifest — it cannot make the transfer step unnecessary, only reduce how often
a caller pays for one that was always going to fail.

## Candidate manifest (`candidate-manifest.ts`)

`OtaCandidateManifest` mirrors `struct spaghetti_image_manifest`
(`image_manifest.h:37-58`) field-for-field: `coreVariant`, `resourceProfile`,
`fwVersion`, `abiVersion`, `minProtocolVersion`, `minConfigVersion`, `packs`,
`featureSetHash`, the four flash/RAM budget fields, `declaredStackBytes`/
`declaredPoolBytes`/`declaredWorkspaceBytes`, `bootloaderMin`, and
`configMigrationPolicy` (`SPAGHETTI_CONFIG_MIGRATION_REJECT_REMOVAL=0`/`EXPLICIT=1`).
This is **not** the wire struct — the real one only exists embedded in the image
bytes — it's what a marketplace/CI system declares ahead of transfer, describing what
will be found inside once uploaded.

## Update coordinator state (`update-coordinator-state.ts`)

`UpdateState` is `enum spaghetti_update_state` (`update.h:25-33`, sequential 0-6:
`IDLE`/`ARMED`/`RECEIVING`/`VERIFYING`/`PENDING_REBOOT`/`TRIAL_BOOT`/`ERROR`).
`checkArmEligibility()` mirrors `spaghetti_update_arm()`'s real refusal conditions
(`update.h:70-71`): `-EPERM` while the running image is `TRIAL_BOOT`/`ERROR` (confirm or
roll back before a new OTA), `-EBUSY` while an adapter already owns an upload or a
candidate is `PENDING_REBOOT`.

## Resource budget diff (`resource-budget-diff.ts`)

`compareResourceBudget()` compares the candidate's declared budget fields against the
running Core's declared build capacity — both sides from **build-time manifests**
(`GET_RESOURCES`'s `flashSlotBytes`/`flashImageBudgetBytes`/`flashHeadroomBytes`/
`staticRamBudgetBytes`, sourced from `spaghetti_image_manifest_get()`,
`resources.c:172-175`), **never** `ResourcePool.used`/`.peak` (current runtime usage).
S102 § Implementazione point 2 is explicit — "senza usare RAM libera corrente come
prova" — and this function has no code path that reads `.used`/`.peak` at all, so that
rule holds structurally. Every dimension gets its own `BudgetDelta` (`availableBytes`,
`requiredBytes`, `marginBytes`); a rejection always names which dimension(s) failed and
by how many bytes, never a generic "non c'è spazio."

`declaredStackBytes`/`declaredPoolBytes`/`declaredWorkspaceBytes` have no dedicated
"available capacity" figure on the wire today — compared against `flashHeadroomBytes`
as a conservative stand-in unless the caller supplies real per-dimension figures via
`buildCapacityOverrides`.

## Preflight (`preflight.ts`)

`preflightOtaCandidate()` runs checks in a fixed order — trust, hash, core variant,
resource profile, coordinator/slot state, downgrade, bootloader, protocol/Config
version floors, Config type retention, then budget — stopping at the first failure,
each with an explicit `reason`.

**Downgrade**: real anti-downgrade enforcement is `CONFIG_MCUBOOT_BOOTLOADER_NO_DOWNGRADE=y`
(`firmware/backbone/prj.conf:82`), a bootloader-level Kconfig gate — there is no app-visible
security-counter field to compare pre-transfer (`image_manifest.h`'s `fw_version` is a
plain string, no numeric floor). This package's downgrade check is a **string-sort
heuristic warning**, not a guarantee — real rejection only happens at MCUboot swap time,
after transfer.

**Config type retention**: mirrors `ensure_type_retained()`
(`image_manifest.c:268-285`) — a candidate with `configMigrationPolicy ===
REJECT_REMOVAL` that no longer provides a type the live Config uses (`core.usedTypeIds`,
caller-supplied, same conservative-when-absent pattern as
`@spaghettilab/capability-marketplace`'s `computeRequiredArtifacts`) is rejected before
transfer, not discovered at firmware-side finish time.

## Build selection (`build-selection.ts`)

`selectBuildVariant()` tries the `isAllSupportedBuild` candidate first (S102 §
Implementazione point 3: "Permetti build all-supported quando il manifest entra"),
falling back to composed candidates ordered smallest-declared-flash-budget-first. Every
candidate is already signed and pre-built — **this package never compiles firmware**;
"La V1 non compila firmware nel browser" holds by construction, there is no code path
here that builds an image. `"all-supported"` itself is confirmed to be a pure CI/build
concept (`core/tools/resource_report.py --profile all-supported`, a Kconfig overlay
baked in offline) — the firmware has no wire concept of build variants at all.

## S102 § Verifiche

- **"un profilo dati installabile (S063) non fa mai scattare un preflight OTA"** — holds
  structurally: this package's `package.json` does not depend on
  `@spaghettilab/device-profile-package`, and `preflightOtaCandidate()`'s signature only
  accepts an `OtaCandidateManifest` — there is no code path from Device Profile install
  (`resolveProfileInstall()`, S062, a completely separate flow) into anything here.
- **"un manifest che eccede la capacità dichiarata dal build blocca il preflight con il
  delta esplicito"** — see `resource-budget-diff.ts` above; `REJECTED_BUDGET_EXCEEDED`
  always carries `budgetDeltas`.
- **"un artifact non trusted o con hash non corrispondente è rifiutato prima di
  qualunque trasferimento"** — trust and hash are the first two checks in
  `preflightOtaCandidate()`, and this package performs no I/O at all (no download step
  exists here), so "before any transfer" holds by construction, not by ordering
  convention alone.

## Honest scope gaps

- **No real downgrade guarantee pre-transfer** — string-sort heuristic only; the real
  gate is MCUboot's, post-transfer.
- **No wire figure for stack/pool/workspace byte capacity** — `flashHeadroomBytes` used
  as a conservative stand-in unless the caller supplies better data.
- **No real PKI** — `OtaTrustVerifier` is caller-supplied, same stance as
  `@spaghettilab/capability-marketplace`'s `TrustVerifier`.
- **No bootloader-version wire field** — `currentBootloaderVersion` must be
  caller-supplied; omitting it skips that check.
