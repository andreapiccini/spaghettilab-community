# S094 — Operazioni amministrative autorizzate

**Stato:** ✅ DONE
**Dipende da:** S092

## Obiettivo

Esporre le operazioni amministrative sensibili del Core con conferme e permessi
adeguati alla loro natura distruttiva/irreversibile.

## Implementazione richiesta

1. Implementa operazioni autorizzate per connectivity policy, lease, maintenance,
   credential/provisioning e reset scope con conferme per mutazioni distruttive.

## Verifiche

- ogni operazione distruttiva richiede conferma esplicita con target visibile prima
  di eseguire;
- un permesso mancante impedisce l'operazione lato app, non solo lato firmware.

## Fine task

- [x] Le operazioni amministrative hanno confini netti rispetto a comandi e Config.
- [x] Ogni mutazione distruttiva richiede conferma esplicita con target visibile.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/core-admin`
(`software/micro-flow-editor/packages/core-admin/`), che dipende da `domain`,
`protocol-sdk` e `core-status`.

**Connectivity policy — non è un'operazione admin**: verificato contro
`connectivity_ops.c` che nessuna operazione Protocol V1 chiama
`spaghetti_connectivity_set_policy()` (esiste solo come API C interna). La policy è un
campo Config (`connectivity`, già modellato da `config-compiler`), applicato tramite la
pipeline di deploy esistente (S080) — nessuna nuova operazione aggiunta per questo.

**Lease** (`lease.ts`): confermato non distruttivo —
`spaghetti_connectivity_acquire_lease` ritorna `-EBUSY` se un'altra lease è attiva
invece di forzarne la rimozione, e la lease scade sempre da sola
(`connectivity.h:79`). `acquireLease()`/`releaseLease()` controllano solo il permesso
`core.admin.lease`, nessuna conferma distruttiva richiesta.

**Maintenance** (`maintenance.ts`): `OPEN_NETWORK_MAINTENANCE` ferma MQTT per l'intero
workspace e, su build `RESOURCE_PROFILE_MINIMAL`, disconnette il BLE
(`connectivity_ops.c`) — abbastanza distruttivo da richiedere sia il permesso
`core.admin.maintenance` sia una `DestructiveConfirmation` con target combaciante
prima di qualunque chiamata wire.

**Bug reale corretto in `protocol-sdk` (scoperto durante la ricerca per questo
task)**: `OPEN_NETWORK_MAINTENANCE` (op 13) e `OPEN_WIFI_UPDATE` (op 14) sono
`SERIALIZED_MUTATION` sul firmware, non `ASYNC_JOB` come documentato erroneamente in
`fields.ts`/`connectivity.ts`/`update.ts` — entrambi ritornano un handover
acknowledgment (`{address, port, leaseExpiresAtMs, reachedStateRaw}`, la funzione
`encode_handover_ack` di `connectivity_ops.c`), mai un `{jobId}`. Corretto
immediatamente (non rinviato) con un nuovo tipo condiviso `HandoverAckResponse` in
`fields.ts`, aggiornando entrambi gli operation file e i relativi test.

**Reset scope** (`reset-scope.ts`): `describeResetScope()` etichetta la bitmask di
`FACTORY_RESET` (`factory_reset.h`) in una stringa leggibile
(es. `"CONFIG+NETWORK"`, `"ALL"`) — il target visibile richiesto prima della
conferma. `requestFactoryResetWithConfirmation()` compone il
`requestFactoryReset()` di `core-status` (S093, già gate su
`core.admin.factory-reset`) con un controllo di conferma il cui target deve
coincidere esattamente con `describeResetScope(scope)`.

**Credential/provisioning** (`credential-provisioning.ts`): ricerca esaustiva di
`firmware/backbone/subsys/communication/operations/` (14 file) conferma che non esiste
alcuna operazione wire per il provisioning di credenziali — avviene solo fuori banda
via Maintenance Link seriale locale
(`firmware/backbone/subsys/services/maintenance_link/README.md:42-55`), mai raggiungibile
dai trasporti BLE/MQTT/WebSocket di questa app. `checkCredentialProvisioningAvailability()`
controlla comunque il permesso `core.admin.credential-provisioning` prima di
qualunque cosa, poi riporta `UNAVAILABLE_OVER_PROTOCOL_V1` con la remediation reale —
mai una chiamata wire inventata né una funzionalità omessa silenziosamente.

**`AUDIT_OPERATIONS` di `domain` esteso**: aggiunti `core.admin.maintenance` e
`core.admin.lease` al catalogo chiuso di S123 — mancavano nonostante gli scope di
permesso corrispondenti esistessero già da una fase precedente.

**Test**: 17 nuovi test coprono direttamente le due Verifiche (conferma esplicita con
target visibile bloccante prima di eseguire; permesso mancante blocca lato app senza
mai chiamare il wire) per lease/maintenance/reset-scope/credential-provisioning, più i
test aggiornati in `protocol-sdk` per la correzione dell'handover ack. CI completa
verde via Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto):
credential/provisioning non ha alcuna operazione wire da chiamare; gli scope di
permesso admin lato app restano più fini/grossolani dei 6 bit permesso del firmware
(già accettabile per policy documentata in S121); `OPEN_WIFI_UPDATE` non viene
avvolto qui (appartiene concettualmente a OTA, S101-S103), solo la correzione del
decoder lo tocca.
