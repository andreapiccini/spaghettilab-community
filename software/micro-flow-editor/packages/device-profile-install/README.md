# @spaghettilab/device-profile-install

Brings a resolved Device Profile package to a real, installed Module (S063) — the wire
CBOR encoder, remote validate/install/remove workflow, catalog merge across sources, and
Module instantiation, built on `@spaghettilab/device-profile-authoring-model` (S061) and
`@spaghettilab/device-profile-package` (S062).

## Wire CBOR (`profile-cbor.ts`)

`encodeDeviceProfileCbor()`/`decodeDeviceProfileCbor()` produce and parse the exact
`profileCbor` bytes `VALIDATE_DEVICE_PROFILE`/`INSTALL_DEVICE_PROFILE` expect — the piece
every earlier package in this chain (S061, S062) explicitly deferred. There is no CDDL
file for Device Profiles; the map key order (0-13) and every op/field byte layout are
sourced directly from
`firmware/backbone/subsys/device_profiles/device_profile.c`'s `decode_profile_cbor`/
`decode_op`/`decode_fields`, read as the ground truth rather than guessed. The decoder
reads keys with `expect_key` sequentially — this is a strict-order sequence of pairs
inside a CBOR map, not a free-order map, and the encoder matches that exactly.

`fromRawOp()`/`toRawOp()` (added to `@spaghettilab/device-profile-authoring-model` in
this task, alongside a correction — see that package's README — to several opcode
operands that an earlier revision got wrong by trusting only the opcode enum's one-line
comments instead of the real executor) are what this encoder/decoder round-trips
through.

## Hash (`hash.ts`)

`struct spaghetti_device_profile.hash` is SHA-256 of the installed CBOR bytes —
unlike `@spaghettilab/device-profile-package`'s `contentHash` (an FNV-1a fingerprint
over JSON, explicitly documented there as not this hash), this package can finally
compute the real one, via the standard Web Crypto `SubtleCrypto` API (`crypto.subtle`,
available in every modern browser and in Node without any import — kept
runtime-agnostic the same way `@spaghettilab/domain`'s `hash.ts` avoids
`node:crypto`).

## Install workflow (`install-workflow.ts`)

`installProfile()` validates remotely, installs, then verifies the post-install hash
(S063 point 1) — comparing the SHA-256 this package computed locally against what a
fresh `getFullDeviceProfileList()` call reports for the matching `profileId`+`version`.
`VALIDATE_DEVICE_PROFILE` is a known stub in the firmware as implemented (see
`protocol-sdk`'s doc comment on it — always answers `valid: 1`), so it's called because
S063 point 1 asks for it, but only the post-install hash check is treated as a real
correctness signal.

"Un'installazione interrotta non cambia il catalogo" (S063 § Verifiche) holds by
construction: this package keeps no local catalog cache to roll back. Every catalog
fact `installProfile`/`removeProfile` report comes from a fresh wire call; if
`installDeviceProfile` itself fails, the function returns an error without ever having
claimed anything changed, and the firmware's own atomic-commit behavior (`decode →
validate → hash → publish`, never partial) guarantees nothing did.

`removeProfile()` refuses locally — no round trip — when the caller already knows a
Module in the current project references the profile. The Core-side half of "in use"
(a live or persisted Config elsewhere referencing it, which this package cannot know
locally) is enforced remotely: `REMOVE_DEVICE_PROFILE`'s `-EBUSY` surfaces as
`ProtocolStatus.BUSY` and is translated to the same `PROFILE_IN_USE` error. The
errno→status mapping used throughout (`BUSY`/`CONFLICT`/`RESOURCE_EXHAUSTED`/
`UNSUPPORTED`) is read directly from
`firmware/backbone/subsys/communication/protocol_status.c`'s
`spaghetti_protocol_status_from_errno`, not guessed.

## Catalog (`catalog.ts`)

`mergeProfileCatalog()` unifies built-in/local/marketplace sources (S063 point 3) into
one browsable list, precedence built-in > local > marketplace on an identity collision.
`ProfileSource` is a purely authoring-side, pre-install tag: `DeviceProfileSummary`
(what `LIST_DEVICE_PROFILES` actually returns) is `{profileId, version, hash}` alone —
nothing on the wire records where an installed profile came from. That absence is
exactly what makes "profili built-in, locali e da marketplace risultano indistinguibili
una volta installati" true — not extra code here, but the type shape itself: there is
no field to carry a source through post-install.

## Module instantiation (`module-instantiation.ts`)

`instantiateModuleFromProfile()` builds a `ModuleNodeData`
(`@spaghettilab/physical-composition-model`, S050) from a Core-confirmed installed
profile plus the Bay/rail/address a human chose (S063 point 2). `driverTypeId` is
always `"declarative-device"` — read from
`spaghetti_declarative_device_driver.type_id` in
`firmware/backbone/spaghetti_modules/declarative_device/declarative_device.c`, the one
generic Module Driver every Device Profile instance runs under. Label lives in
`AuthoringMetadata`, same as every other physical-composition entity, never a field
here. Pure construction — the caller adds the result to a graph via the existing
`addGraphNodeCommand` (`@spaghettilab/react-flow-adapter`); no new command type was
needed.

## Honest scope gaps

- **`VALIDATE_DEVICE_PROFILE` is a stub on the firmware side.** It cannot be relied on
  to catch a malformed profile before install — the post-install hash check is this
  package's real correctness signal.
- **Kconfig-tunable limits are not enforced here.** `CONFIG_SPAGHETTI_MAX_DEVICE_PROFILES`/
  `..._MAX_DEVICE_PROFILE_BYTES` (`device_profile.c`) are build settings, not wire data —
  a `-ENOSPC`/`-E2BIG` from the Core still surfaces as a structured error, just not
  predicted client-side in advance.
- **`removeProfile`'s local guard is only as good as the caller's `isReferencedLocally`.**
  This package has no independent way to scan a project for Module references — that
  check belongs to whatever owns the project graph (`@spaghettilab/physical-composition-model`
  callers).
