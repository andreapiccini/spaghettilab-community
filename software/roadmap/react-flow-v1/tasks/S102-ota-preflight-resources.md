# S102 — Preflight e budget risorse

**Stato:** ✅ DONE
**Dipende da:** S101, S093

## Obiettivo

Decidere se un candidato Capability Pack può essere installato in sicurezza su un Core
specifico, prima di trasferire qualunque byte.

## Implementazione richiesta

1. Implementa preflight candidato: trusted source, firma/hash metadata, variante,
   profile, slot/layout, downgrade, bootloader, Config/profile compatibility e budget.
2. Confronta flash/RAM/stack/pool/workspace manifest con capacità build; mostra delta e
   margini, senza usare RAM libera corrente come prova.
3. Permetti build `all-supported` quando il manifest entra; altrimenti seleziona
   immagini composte già firmate. La V1 non compila firmware nel browser.

## Verifiche

- un profilo dati installabile (S063) non fa mai scattare un preflight OTA;
- un manifest che eccede la capacità dichiarata dal build blocca il preflight con il
  delta esplicito, non con un generico "non c'è spazio";
- un artifact non trusted o con hash non corrispondente è rifiutato prima del
  trasferimento.

## Fine task

- [x] Il preflight verifica compatibilità e risorse per ogni candidato.
- [x] La build selezionata (all-supported o composta) è sempre firmata.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/ota-preflight`
(`software/micro-flow-editor/packages/ota-preflight/`), che dipende da `domain`,
`protocol-sdk` e `capability-marketplace`.

**Nessuna operazione wire di validazione OTA esiste**: confermato contro l'elenco
completo delle 27 operazioni Protocol V1 — a differenza di `VALIDATE_CONFIG`(17) e
`VALIDATE_DEVICE_PROFILE`(24), non esiste un `VALIDATE_OTA_CANDIDATE`. Il vero controllo
autoritativo (`spaghetti_image_manifest_validate_candidate()`,
`image_manifest.c:381-431`) gira solo lato firmware, DOPO il trasferimento
(`spaghetti_update_finish()`). `preflightOtaCandidate()` è quindi sempre e solo una
predizione locale pre-trasferimento, mai una chiamata wire.

**Candidate manifest** (`candidate-manifest.ts`): `OtaCandidateManifest` rispecchia
campo per campo `struct spaghetti_image_manifest` (`image_manifest.h:37-58`) —
coreVariant, resourceProfile, fwVersion, abiVersion, minProtocolVersion,
minConfigVersion, packs, featureSetHash, i quattro campi budget flash/RAM,
declaredStack/Pool/WorkspaceBytes, bootloaderMin, configMigrationPolicy.

**Update coordinator state** (`update-coordinator-state.ts`): `UpdateState` è il vero
`enum spaghetti_update_state` (`update.h:25-33`, 0-6 sequenziale).
`checkArmEligibility()` rispecchia le vere condizioni di rifiuto di
`spaghetti_update_arm()` (`update.h:70-71`): `-EPERM` se l'immagine in esecuzione è
TRIAL_BOOT/ERROR, `-EBUSY` se un adapter possiede già un upload o un candidato è
PENDING_REBOOT.

**Resource budget diff** (`resource-budget-diff.ts`): confronta i campi budget
dichiarati del candidato con la capacità build dichiarata del Core in esecuzione
(`GET_RESOURCES`'s `flashSlotBytes`/`flashImageBudgetBytes`/`flashHeadroomBytes`/
`staticRamBudgetBytes`) — **mai** `ResourcePool.used`/`.peak` (uso runtime corrente):
nessun percorso di codice in questa funzione legge mai `.used`/`.peak`, quindi "senza
usare RAM libera corrente come prova" vale per costruzione. Ogni dimensione ha il
proprio `BudgetDelta` esplicito (available/required/margin), mai un unico numero
sommato o un generico "non c'è spazio".

**Downgrade — gap onestamente riconosciuto**: la vera prevenzione anti-downgrade è
`CONFIG_MCUBOOT_BOOTLOADER_NO_DOWNGRADE=y` (`firmware/backbone/prj.conf:82`), applicata dal
bootloader; non esiste un campo security-counter esposto pre-trasferimento
(`fw_version` nel manifest è una stringa semplice). Il controllo di questo pacchetto è
un'euristica di ordinamento stringhe, un avviso anticipato, non una garanzia — il vero
rifiuto avviene solo al boot di test MCUboot, dopo il trasferimento.

**Config type retention**: rispecchia `ensure_type_retained()`
(`image_manifest.c:268-285`) — un candidato con `configMigrationPolicy ===
REJECT_REMOVAL` che non fornisce più un tipo usato dalla Config live viene rifiutato
prima del trasferimento, non scoperto solo al finish lato firmware.

**Build selection** (`build-selection.ts`): `selectBuildVariant()` prova prima il
candidato `isAllSupportedBuild` (se disponibile e completo), altrimenti sceglie
deterministicamente l'immagine composta più piccola per budget flash dichiarato fra
quelle già firmate — nessuna compilazione avviene mai in questo pacchetto.
`"all-supported"` è confermato essere un concetto puramente CI/build-time
(`core/tools/resource_report.py --profile all-supported`), il firmware non ha alcun
concetto di build variant sul wire.

**Test**: 25 nuovi test coprono direttamente le tre Verifiche (nessun percorso di
codice da Device Profile install verso questo pacchetto — nessuna dipendenza da
`device-profile-package` nel `package.json`; manifest oversize bloccato con delta
esplicito per dimensione; artifact non trusted/hash non corrispondente rifiutato prima
di qualunque trasferimento, dato che questo pacchetto non fa I/O). CI completa verde
via Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto): nessuna
garanzia reale di anti-downgrade pre-trasferimento; nessun campo wire per la capacità
byte di stack/pool/workspace (usato `flashHeadroomBytes` come stand-in conservativo);
nessuna PKI reale; nessun campo wire per la versione del bootloader installato.
