# UI-S090 — Runtime & Diagnostics

[← Roadmap](../README.md) · [UX-S090](../../ux-v1/tasks/UX-S090-runtime-diagnostics.md) ·
[visual.md](../../../ux/screens/S090-runtime-diagnostics/visual.md) ·
[ui-behavior.md](../../../ux/screens/S090-runtime-diagnostics/ui-behavior.md) ·
[backend-behavior.md](../../../ux/screens/S090-runtime-diagnostics/backend-behavior.md)

**Stato: ✅ DONE**

Cinque tab (Telemetria/Comandi/Discovery/Stato & Risorse/Amministrazione) su un
Core selezionato fra quelli connessi e pronti (READY), cablati su
`@spaghettilab/telemetry-buffer` (S091), `@spaghettilab/core-actions` (S092),
`@spaghettilab/core-status` (S093) e `@spaghettilab/core-admin` (S094) — tutti e
quattro reali, contrariamente alla nota "⬜ TODO" stantia dei `backend-behavior.md`
di questi screen (scritti prima che il backend fosse costruito, stesso pattern già
visto per S040/S050/S060/S070/S080).

## Implementazione

- `RuntimeDiagnosticsScreen.tsx` — header, selettore Core a pillola (solo Core
  READY, stesso pattern di Deploy & Diff) e barra tab; ogni tab riceve
  `key={bindingId}` così lo stato locale riparte pulito ad ogni cambio di Core
  senza bisogno di effetti di reset.
- `TelemetryTab.tsx` — sottoscrive `CoreSession.onRecordEvent()`, alimenta un
  `TelemetryBufferStore` per-Core istanziato lato UI (boot-epoch tracking via
  `observeBootId(getLastBootId())`, gap di sequenza rilevati confrontando la
  sequenza precedente per `(sourceKey, schemaId)`), righe stream + righe gap.
  **Ogni record è trattato come `pushUnknownSchema`**, mai `pushDecoded` — vedi gap.
- `CommandsTab.tsx` — form Module key + command ID (nessun catalogo comandi, vedi
  gap), checkbox "richiede argomenti", `runCommand()` reale con badge per ciascun
  `CommandOutcomeKind` distinto (SUCCESS/PERMISSION_DENIED/QUEUE_FULL/TIMEOUT/
  UNSUPPORTED_ARGUMENTS/REMOTE_ERROR).
- `DiscoveryTab.tsx` — form Port ID + checkbox scan invasiva, `requestScan()` reale
  con polling `getJobStatus()`/`interpretJobStatus()` ogni 1.5s fino a stato
  terminale; lista candidati via `listDiscoveryCandidates()` (già cablato per S050)
  con link a Physical Composition per l'accept vero e proprio (vedi gap).
- `StatusResourcesTab.tsx` — chip di stato/modo/immagine/health/watchdog via
  `describeCoreStatus()` (status/capabilities/resources letti da
  `CoreSession.lastKnownSnapshot`, nessuna nuova chiamata wire), griglia resource
  pool + flash/RAM via `describeResourceMonitor()`, connectivity status on-demand
  via `getConnectivityStatus()`/`describeConnectivityStatus()`.
- `AdminTab.tsx` — righe Connectivity lease (`acquireLease`/`releaseLease`, nessuna
  conferma distruttiva — operazione non distruttiva e auto-reversibile),
  Manutenzione di rete e Factory reset (entrambe dietro un `ConfirmDialog` che
  richiede di ridigitare esattamente il target mostrato, backed da
  `checkDestructiveConfirmation()` via i workflow già gated in `CoreSession`),
  Provisioning credenziali (mostrato onestamente come non disponibile, vedi gap),
  Audit log on-demand via `getAuditLog()`/`describeAuditEntry()`.
- `permission-placeholder.ts` — `PLACEHOLDER_GRANTED_ALL: PermissionSet` con tutti
  gli scope di `PERMISSION_SCOPES` concessi, documentato come placeholder
  temporaneo (vedi gap).
- `core-session.ts`: aggiunti nove metodi wrapper (`runCommand`, `requestScan`,
  `getJobStatus`, `getConnectivityStatus`, `getAuditLog`, `acquireLease`,
  `releaseLease`, `openNetworkMaintenance`, `requestFactoryReset`) più
  `onRecordEvent()`/`lastBootId` per il fan-out degli eventi `RECORD` — estende lo
  stesso `for await` che già consuma `STATUS` (`EventStream` è un consumer unico,
  una seconda iterazione indipendente avrebbe smistato gli eventi in modo
  imprevedibile fra due consumer in competizione).
- `core-sessions-context.tsx`: esposti tutti i passthrough corrispondenti, stesso
  pattern `useCallback((bindingId, ...) => sessionsRef.current.get(bindingId)?.…)`
  già usato per ogni metodo precedente.

## Gap dichiarati

- **Nessun valore di campo telemetria è mai disponibile su questi transport.**
  Ricerca esaustiva confermata: non esiste un'operazione wire `GET_RECORD` né un
  decoder CBOR del payload MQTT raggiungibile da WebSocket/USB-seriale in tutto il
  codebase — la consegna reale dei record (`struct spaghetti_record`) avviene
  fuori banda solo per i consumer MQTT/BLE (`spaghetti_record_delivery_peek/ack`).
  Ogni notifica `RECORD` ricevuta da questa app porta solo
  `{sourceKey, sequence, schemaId, schemaVersion}`, mai byte/valori — il tab
  Telemetria mostra quindi sempre "nessun valore decodificato disponibile", mai
  campi inventati.
- **Nessun catalogo comandi guidato dal catalogo firmware.** `ModuleDriverEntry`
  (`catalog-model`) espone solo `{typeId, commandCount}`, nessun metadato per
  singolo comando — stesso genere di gap già documentato per Rule/Block in
  UI-S040/UI-S060/UI-S070. Il form Comandi richiede Module key e command ID
  inseriti manualmente.
- **Provisioning credenziali non raggiungibile da questa app.** Ricerca esaustiva
  di tutti i 14 file sotto `firmware/backbone/subsys/communication/operations/`: nessuna
  operazione wire per credenziali/provisioning. Il provisioning reale avviene solo
  fuori banda sul Maintenance Link fisico/seriale (comandi SMP). Il tab
  Amministrazione mostra questo come indisponibilità onesta con la remediation
  reale, non come azione disabilitata senza spiegazione.
- **Nessun sistema di permessi reale esiste ancora in questa app.** Non c'è
  login/auth/multi-principal (materia di UI-S120/`ecosystem-access-v1`). Ogni
  chiamata gated in questo screen usa `PLACEHOLDER_GRANTED_ALL` (tutti gli scope
  concessi) invece di un set vuoto — un set vuoto avrebbe reso l'intera superficie
  interattiva dello screen permanentemente disabilitata e non verificabile. Da
  sostituire integralmente quando UI-S120 introduce una sorgente reale di
  `PermissionSet`.
- **Discovery: l'accept di un candidato non è duplicato qui.** Accettare un
  candidato richiede `TopologyIndex`/nodi esistenti (bay/rail) — dati propri di
  Physical Composition (S050). Il tab Discovery qui mostra la lista raw dei
  candidati e rimanda a Physical Composition per l'accept vero e proprio, invece di
  reimplementare un secondo flusso di accept parziale.
- **`lastResetCauseRaw`, `policyRaw`/`activeServicesRaw`/`leasedServicesRaw` restano
  bitmask non decodificati** — nessuna tabella bit→nome confermata contro il
  firmware reale per questi campi (nessun albero sorgente Zephyr vendorizzato in
  questo checkout); mostrarli come esadecimale grezzo è più corretto di una tabella
  di label inventata.
- **Watchdog "armato"/"non armato" è un'inferenza**, non un campo diretto — deriva
  da `healthState` (`HealthState.HEALTHY`→armato, `DEGRADED`→non armato,
  altrimenti sconosciuto), documentato come tale nell'etichetta stessa.
- **Verifica dal vivo limitata dall'assenza di un Core reale raggiungibile** in
  questo ambiente sandboxed (stesso limite di UI-S040/S050/S060/S070/S080):
  verificato lo stato vuoto (nessun Core pronto) su tutti i tab, navigazione dal
  left rail senza crash, console pulita. La logica dei singoli tab è stata
  verificata per lettura del codice + gli unit test già esistenti di
  `telemetry-buffer`/`core-actions`/`core-status`/`core-admin` (non riscritti qui)
  + il nuovo test `CoreSession.onRecordEvent()`.

## Verifica

- `docker compose run --rm micro-flow-editor npm run ci` — verde (typecheck, lint 0
  errori/7 warning pre-esistenti, test — incluso il nuovo test
  `CoreSession.onRecordEvent()` in `core-session` — build).
- Verificato dal vivo nel browser: navigazione dal left rail a "Runtime &
  Diagnostics", stato "Nessun Core connesso e pronto" senza crash, console senza
  errori.
