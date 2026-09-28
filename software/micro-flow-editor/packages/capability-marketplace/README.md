# @spaghettilab/capability-marketplace

Marketplace catalog and dependency resolver for Capability Packs (S101) — knowing what
packs exist, what they require and whether they can coexist, before proposing any
installation.

## Three catalogs, kept distinguishable (S101 § Verifiche)

This package deliberately gives each of the three catalogs its own type, not shared
fields on one type:

- **`MarketplaceCatalog`** (`marketplace-catalog.ts`) — what's *available*, parsed from
  a local or HTTPS-fetched index. This package does no I/O itself — a caller decides
  whether the index came from a local file or an HTTPS-signed endpoint and hands the
  bytes to `parseMarketplaceIndexJson()`.
- **`@spaghettilab/catalog-model`'s `CapabilityPackIndex`** (S041, already existed) —
  what's *installed* on the Core, from `GET_FEATURES`.
- **`RequiredArtifact[]`** (`required-artifacts.ts`) — what the Project's Device
  Processing graph actually *needs*, computed by `computeRequiredArtifacts()`.

## Marketplace pack manifest (`manifest.ts`)

`MarketplacePackManifest` covers everything S101 point 1 asks for: pack id/version,
`dependencies`/`conflicts` (version ranges), `artifact` (URL + size), `hash`,
`signature`, `coreCompat` (variant/resource profile), `abiCompat` (protocol/Config wire
version — checked against real `GetCatalogResponse.protocolVersion`/`configVersion`),
`providedTypes` and a `resourceManifest` mirroring `GET_RESOURCES`'s pool shape. None of
this is observable on the Protocol V1 wire — there is no marketplace operation — so this
is a standalone document format, not a decoder for anything firmware sends.

## Trust (`trust.ts`) — caller-supplied, no PKI implemented here

No real signing/verification infrastructure exists in this codebase yet.
`checkPackTrust()` takes an optional `TrustVerifier` the caller supplies (e.g. WebCrypto
`verify()` against a pinned key set); omitting it makes every pack `"UNVERIFIABLE"`,
never a guessed `"TRUSTED"`.

## Required artifacts (`required-artifacts.ts`) — an honest wire-data gap

`computeRequiredArtifacts()` can only check `module-driver` usage against real wire
data — `@spaghettilab/catalog-model`'s `CatalogIndex`, from `GET_CATALOG`, genuinely
enumerates installed Module Driver `typeId`s. **`GET_FEATURES` (the installed
Capability Pack listing) only reports `moduleTypeCount` — a count, never the actual
Block/Rule `typeId`s a pack provides** — confirmed directly against
`firmware/backbone/subsys/communication/operations/features_ops.c` while building this
package, consistent with `catalog-model`'s own S041 README gap note ("no separate
Rule/Block/opcode/operation/schema/field/command listing" exists on the wire). So
`installedBlockRuleTypeIds` is caller-supplied and optional: without it, every
Block/Rule usage is conservatively treated as "not yet confirmed installed," never
silently assumed present.

## Dependency resolver (`dependency-resolver.ts`)

`resolveDependencies()` is deterministic and whole-plan-or-nothing: it computes the
full transitive closure of required packs up front, so "nessuna dipendenza implicita
scaricata dopo conferma" (S101 § Implementazione point 3) holds structurally — there is
no partial result a caller could act on and then discover more downloads are needed
later; a real download step (out of this package's scope, no I/O here) only ever
touches packs already in the returned plan.

Every candidate is checked in a fixed order — core/resource-profile compatibility, ABI
(protocol/Config wire version), trust — so the same catalog+context always produces the
same selection or the same conflict. Every `ResolvedPackSelection` carries a `reason`
string and every `ResolutionConflict` carries a `reason` string — S101 § Implementazione
point 3's "motivazione per ogni selezione, conflitto o incompatibilità" is not optional
metadata, it's a required field on both result shapes.

Conflict kinds: `NO_PROVIDER` (nothing in the marketplace provides the needed type —
the type-level equivalent of the missing-Kalman-Block scenario when the marketplace is
empty), `CORE_INCOMPATIBLE`, `ABI_INCOMPATIBLE`, `UNTRUSTED`, `MISSING_DEPENDENCY` (a
pack's declared dependency range has no satisfying version in the marketplace — the
Modbus-with-incompatible-dependency scenario), `MUTUAL_CONFLICT` (two selected packs
declare each other as conflicting in the selected version range).

## Honest scope gaps

- **No I/O anywhere in this package** — fetching an HTTPS index, downloading an
  artifact, and verifying a real signature are all caller responsibilities. This
  package only parses bytes already in hand and computes a plan from already-loaded
  catalogs.
- **`installedBlockRuleTypeIds` must be caller-supplied** — no wire operation
  enumerates installed Block/Rule types today (see `required-artifacts.ts` above).
- **No real PKI** — `TrustVerifier` is a caller-supplied function; this package
  implements no signature-checking algorithm itself.
