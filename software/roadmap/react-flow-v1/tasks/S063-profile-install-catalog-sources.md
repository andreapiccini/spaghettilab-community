# S063 — Installazione, catalogo e sorgenti profilo

**Stato:** ✅ DONE
**Dipende da:** S062

## Obiettivo

Portare un profilo risolto fino a un Module realmente istanziabile sul Core, da
qualunque sorgente provenga.

## Implementazione richiesta

1. Implementa validate remota, installazione atomica, verifica hash post-install e
   rimozione; impedisci rimozione/sostituzione quando Config live o progetto lo usa.
2. Dopo installazione aggiorna catalogo e permette di istanziare il profilo come Module
   con address/Bay/label/calibrazione specifici.
3. Supporta profili built-in, locali e da marketplace index con stessa semantica.

## Verifiche

- un'installazione interrotta non cambia il catalogo;
- un profilo in uso non può essere rimosso o sostituito;
- profili built-in, locali e da marketplace risultano indistinguibili una volta
  installati.

## Fine task

- [x] Un dispositivo compatibile viene aggiunto end-to-end senza modificare sorgenti o
      fare OTA.
- [x] Installazione interrotta e rimozione di profilo in uso sono gestite in sicurezza.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/device-profile-install`
(`software/micro-flow-editor/packages/device-profile-install/`), che dipende da
`domain`, `protocol-sdk`, `device-profile-authoring-model` (S061),
`device-profile-package` (S062) e `physical-composition-model` (S050).

**Encoder/decoder wire CBOR** (`profile-cbor.ts`): produce e legge esattamente i byte
`profileCbor` attesi da `VALIDATE_DEVICE_PROFILE`/`INSTALL_DEVICE_PROFILE` — il pezzo
che ogni pacchetto precedente della catena (S061, S062) aveva esplicitamente rimandato.
Non esiste un file CDDL per i Device Profile: l'ordine delle chiavi della mappa (0-13)
e il layout byte di ogni op/field sono presi direttamente da
`firmware/backbone/subsys/device_profiles/device_profile.c`'s `decode_profile_cbor`/
`decode_op`/`decode_fields`, letti come verità di base invece che indovinati. Il
decoder legge le chiavi con `expect_key` in sequenza stretta — non è una mappa a
ordine libero nonostante il wire type. Aggiunta `fromRawOp()` (inversa di `toRawOp()`)
a `device-profile-authoring-model` per completare la bidirezionalità di quel modulo,
oltre a una correzione ad alcuni operandi di opcode che una prima revisione di S061
aveva sbagliato fidandosi solo dei commenti dell'enum invece dell'eseguitore reale (vedi
nota di correzione nel task S061).

**Hash reale** (`hash.ts`): `struct spaghetti_device_profile.hash` è SHA-256 dei byte
CBOR installati — a differenza del `contentHash` di S062 (impronta FNV-1a su JSON, mai
lo stesso hash), questo pacchetto può finalmente calcolare quello vero, via Web Crypto
`SubtleCrypto` (disponibile in Node senza import, stesso approccio runtime-agnostico di
`domain`'s `hash.ts`).

**Workflow di installazione** (`install-workflow.ts`): `installProfile()` valida da
remoto, installa, poi verifica l'hash post-install confrontando lo SHA-256 calcolato
localmente con quello che una `getFullDeviceProfileList()` fresca riporta per
profileId+version corrispondenti. `VALIDATE_DEVICE_PROFILE` è uno stub noto lato
firmware (risponde sempre `valid:1`) — chiamato perché il punto 1 del task lo richiede,
ma solo il controllo hash post-install è trattato come segnale di correttezza reale.
"Un'installazione interrotta non cambia il catalogo" vale per costruzione: questo
pacchetto non mantiene alcuna cache locale di catalogo da far tornare indietro — ogni
fatto sul catalogo viene da una chiamata wire fresca. `removeProfile()` rifiuta
localmente, senza round-trip, quando il chiamante sa già che un Module del progetto
corrente referenzia il profilo; il lato Core ("Config live altrove lo referenzia", che
questo pacchetto non può sapere in locale) resta applicato da remoto: `-EBUSY` diventa
`ProtocolStatus.BUSY` (mappatura errno→status presa da
`firmware/backbone/subsys/communication/protocol_status.c`, non indovinata) e viene
tradotto nello stesso errore `PROFILE_IN_USE`.

**Catalogo** (`catalog.ts`): `mergeProfileCatalog()` unifica sorgenti built-in/locali/
marketplace (punto 3) con precedenza built-in > locale > marketplace su collisione di
identità. `ProfileSource` è un tag solo authoring, pre-installazione: `DeviceProfileSummary`
(quello che `LIST_DEVICE_PROFILES` restituisce davvero) è `{profileId, version, hash}`
soltanto — nessun campo per la sorgente. Questa assenza è esattamente ciò che rende vero
"profili built-in, locali e da marketplace risultano indistinguibili una volta
installati" — non per codice aggiunto qui, ma per la forma del tipo stesso.

**Istanziazione Module** (`module-instantiation.ts`): `instantiateModuleFromProfile()`
costruisce un `ModuleNodeData` (S050) da un profilo confermato dal Core più
Bay/rail/indirizzo scelti da un umano (punto 2). `driverTypeId` è sempre
`"declarative-device"` — preso da `spaghetti_declarative_device_driver.type_id` in
`firmware/backbone/spaghetti_modules/declarative_device/declarative_device.c`, l'unico
driver generico su cui gira ogni istanza di Device Profile. Costruzione pura, nessun
nuovo tipo di comando: il chiamante aggiunge il risultato al grafo con
`addGraphNodeCommand` già esistente (`react-flow-adapter`).

**Test**: 18 nuovi test in 4 file più 12 nuovi test in `device-profile-authoring-model`
(round-trip `toRawOp`/`fromRawOp`, rifiuto opcode sconosciuto). CI completa verde via
Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto):
`VALIDATE_DEVICE_PROFILE` resta uno stub firmware, non affidabile per catturare un
profilo malformato prima dell'installazione; i limiti Kconfig-tunable
(`CONFIG_SPAGHETTI_MAX_DEVICE_PROFILES`/`..._MAX_DEVICE_PROFILE_BYTES`) non sono
previsti lato client, solo tradotti se il Core li rifiuta; la guardia locale di
`removeProfile` vale solo quanto il caller le fornisce (`isReferencedLocally`) — questo
pacchetto non ha modo indipendente di scansionare un progetto per riferimenti a Module.
