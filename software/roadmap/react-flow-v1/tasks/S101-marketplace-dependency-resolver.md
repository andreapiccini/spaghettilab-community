# S101 — Marketplace catalog e dependency resolver

**Stato:** ✅ DONE
**Dipende da:** S063, S080

## Obiettivo

Sapere quali Capability Pack esistono, cosa richiedono e se possono coesistere, prima
di proporre qualunque installazione.

## Implementazione richiesta

1. Implementa provider marketplace V1 da indice locale o HTTPS firmato. Il modello
   contiene pack ID/versione, dipendenze/conflitti, artifact, hash, firma/trust,
   Core/profile/layout, ABI/Protocol/Config, tipi forniti e resource manifest.
2. Mantieni separati marketplace available catalog, Core installed feature catalog e
   Project required artifacts.
3. Implementa dependency resolver deterministico con motivazione per ogni selezione,
   conflitto o incompatibilità; nessuna dipendenza implicita scaricata dopo conferma.

## Verifiche

- un Block Kalman assente risolve al pack/artifact corretto con motivazione esplicita;
- un pack Modbus con dipendenza incompatibile fallisce la risoluzione prima di
  qualunque trasferimento;
- available catalog, installed feature catalog e required artifacts restano
  distinguibili in ogni stato.

## Fine task

- [x] Il marketplace funzionale copre discovery e resolution dei pack.
- [x] Il resolver è deterministico e motiva ogni esito.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/capability-marketplace`
(`software/micro-flow-editor/packages/capability-marketplace/`), che dipende da
`domain`, `protocol-sdk` e `catalog-model`.

**Tre cataloghi, tipi distinti**: `MarketplaceCatalog` (disponibile, da un indice
locale/HTTPS — nessun I/O in questo pacchetto, il chiamante decide la sorgente e passa
i byte a `parseMarketplaceIndexJson()`), `CapabilityPackIndex` di `catalog-model`
(installato, già esistente da S041, da `GET_FEATURES`), `RequiredArtifact[]`
(richiesto dal Project, `computeRequiredArtifacts()`). Tipi separati, non solo campi
diversi sullo stesso tipo, per rispettare "restare distinguibili in ogni stato".

**Manifest** (`manifest.ts`): copre pack id/versione, dependencies/conflicts (range di
versione), artifact, hash, signature, coreCompat, abiCompat (confrontato contro i
valori reali `GetCatalogResponse.protocolVersion`/`configVersion`), providedTypes e un
resourceManifest che rispecchia la forma dei pool di `GET_RESOURCES`. Nessuno di questi
campi è osservabile sul wire Protocol V1 — non esiste un'operazione marketplace — è un
formato documento standalone.

**Trust** (`trust.ts`): nessuna infrastruttura di firma/PKI reale esiste in questo
codebase. `checkPackTrust()` prende un `TrustVerifier` fornito dal chiamante; senza di
esso ogni pack è `"UNVERIFIABLE"`, mai un `"TRUSTED"` indovinato.

**Gap wire reale confermato durante l'implementazione**: `GET_FEATURES` riporta solo
`moduleTypeCount` (un conteggio) per ogni Capability Pack installato, mai i veri
`typeId` di Block/Rule forniti — verificato contro
`firmware/backbone/subsys/communication/operations/features_ops.c`, coerente con il gap già
documentato nel README di S041/`catalog-model`. `computeRequiredArtifacts()` può
verificare solo i Module Driver contro dati wire reali (`GET_CATALOG`); Block/Rule
richiedono un set installato fornito dal chiamante, opzionale — senza di esso ogni uso
di Block/Rule è trattato conservativamente come "richiesto", mai assunto presente.

**Resolver** (`dependency-resolver.ts`): `resolveDependencies()` è deterministico e
whole-plan-or-nothing — calcola la chiusura transitiva completa prima di restituire
qualunque risultato, quindi "nessuna dipendenza implicita scaricata dopo conferma" vale
per costruzione (nessun I/O in questo pacchetto). Ogni candidato è controllato in un
ordine fisso (compatibilità Core/resource-profile, ABI, trust); ogni selezione e ogni
conflitto porta sempre un campo `reason` non opzionale.

**Test**: 20 nuovi test coprono direttamente le tre Verifiche (Block Kalman assente
risolto con motivazione esplicita; pack Modbus con dipendenza incompatibile fallisce
con `MISSING_DEPENDENCY` prima di qualunque trasferimento — nessun I/O esiste comunque
in questo pacchetto; determinismo su run ripetute con lo stesso input) più
NO_PROVIDER/UNTRUSTED/MUTUAL_CONFLICT. CI completa verde via Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto): nessun I/O
(fetch HTTPS, download artifact, verifica firma reale) — tutto compito del chiamante;
`installedBlockRuleTypeIds` deve essere fornito dal chiamante per il gap wire sopra
descritto; nessuna PKI reale implementata.
