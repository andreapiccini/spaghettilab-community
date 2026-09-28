# S093 — Stato, health e resource monitor

**Stato:** ✅ DONE
**Dipende da:** S091

## Obiettivo

Rendere leggibile lo stato interno del Core e l'uso reale delle sue risorse, con il
significato che ha per il firmware, non un riassunto generico.

## Implementazione richiesta

1. Implementa status per Module, schedule, Rule, Block, service, connectivity, health,
   reset cause, watchdog, audit e job.
2. Implementa resource monitor: flash/image headroom, RAM statica, pool/workspace/
   stack capacity-current-peak, allocation failures e limiti Config. Non mostrare una
   generica "RAM installabile".

## Verifiche

- il resource high-water aumenta correttamente e un reset diagnostico richiede
  autorizzazione esplicita;
- flash headroom, RAM statica e pool/stack sono mostrati come grandezze distinte, mai
  sommate in un unico numero fuorviante;
- una allocation failure passata è visibile anche dopo che la condizione è rientrata.

## Fine task

- [x] Ogni stato/diagnostica firmware previsto dalla V1 è leggibile.
- [x] La diagnostica risorse rispetta esattamente il significato dato dal firmware.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/core-status`
(`software/micro-flow-editor/packages/core-status/`), che dipende da `domain` e
`protocol-sdk`.

**Enum reali risolti da `firmware/backbone/include/spaghetti/{core,health,module}.h`**
(`status-labels.ts`): `spaghetti_core_state`, `spaghetti_core_mode`,
`spaghetti_core_image_state`, `spaghetti_health_state`, `spaghetti_module_state`,
`spaghetti_module_endpoint_kind` — prima lasciati come numeri grezzi in
`protocol-sdk`'s `status.ts` perché quel passaggio aveva solo i *nomi* degli enum, non
i valori interi. Un valore non riconosciuto diventa `"UNKNOWN(n)"`, mai un'eccezione.

**Watchdog**: non esiste un campo diretto sul wire — `hardware_watchdog_armed` è
calcolato internamente (`health.c`) ma mai serializzato. `HealthState.HEALTHY`
documenta "HW watchdog armato", `DEGRADED` "nessun HW WDT" (`health.h:24-29`): unico
segnale osservabile, quindi `watchdogInferenceOf()` è un'inferenza da `healthState`,
non un campo diretto.

**Reset cause e bit di servizio connectivity**: lasciati come bitmask grezze non
decodificate. `last_reset_cause` viene da `hwinfo_get_reset_cause()` di Zephyr
(`health.c:354`) e questo checkout non vendorizza l'albero sorgente Zephyr per
confermare la vera tabella bit→etichetta — decodificarla con una tabella indovinata
sarebbe peggio di un numero grezzo che fa comunque round-trip corretto.

**Schedule/Rule/Block**: nessuno dei tre ha un campo di stato runtime sul wire —
`execute_get_status` serializza solo i Module. `describeScheduleStatus()` usa lo stato
del Module campionato come proxy onesto (`"unknown"` se assente); Rule e Block hanno
solo `describeDeployedEntityStatus()`, che conferma la sola presenza nell'ultimo Config
deployato, mai uno stato di esecuzione inventato.

**Audit e job**: `describeAuditLog()` mappa `operationId` al vero nome dell'enum
`Operation`; `describeJobStatus()` etichetta `GET_JOB_STATUS` in modo generico per ogni
tipo di job (distinto da `core-actions`'s `interpretJobStatus`, che classifica
specificamente un job di discovery).

**Resource monitor** (`resource-monitor.ts`): i sei pool di `GET_RESOURCES`
(modules/rules/blocks/profiles/records/workspace) restano `{capacity, used, peak}`
distinti, mai sommati — rispecchia il commento già presente su `ResourcePool` in
`protocol-sdk`. `allocationFailures` è confermato monotono e sticky leggendo
`firmware/backbone/subsys/resources/resources.c`: `spaghetti_resources_note_failure()` lo
incrementa soltanto, `spaghetti_resources_reset_high_water()` lo lascia esplicitamente
intatto (`resources.h:96`) — si azzera solo con un reboot completo. Quindi "una
allocation failure passata è visibile anche dopo che la condizione è rientrata" vale
per costruzione. `highWaterRegressed()` permette di verificare che il high-water di un
pool non torni mai indietro fra osservazioni successive.

**Reset diagnostico**: verificato contro `firmware/backbone/include/spaghetti/factory_reset.h`
e `reset_ops.c` che `FACTORY_RESET`'s `scope` è una bitmask
(CONFIG/NETWORK/CREDENTIALS/BLE_BONDS/ALL), **non** un enum con un valore "diagnostico"
separato — il firmware controlla l'intera operazione con un solo permesso
(`SPAGHETTI_PERMISSION_PROVISION`), qualunque combinazione di bit. "Un reset diagnostico
richiede autorizzazione esplicita" è quindi una policy lato app, non una distinzione sul
wire: `requestFactoryReset()` richiede sempre lo scope `core.admin.factory-reset` di
`domain` prima di qualunque chiamata wire, per ogni combinazione di scope.

**Gap firmware scoperto e tracciato**: `struct spaghetti_resources_snapshot`
(`resources.h:45-70`) ha campi reali per flash headroom e RAM statica
(`flash_slot_bytes`, `flash_image_budget_bytes`, `flash_headroom_bytes`,
`static_ram_budget_bytes`), ma `execute_get_resources` (`resources_ops.c:36-72`) non li
serializza mai sul wire `GET_RESOURCES` — verificato direttamente contro il sorgente C.
Non tracciato altrove: aggiunta la fase Firmware
[392](../../../../firmware/backbone/roadmap/392-resources-flash-ram-wire-exposure/README.md)
per esporli. Finché non è chiusa, `ResourceMonitorView.flashAndStaticRam` è
`{ available: false, reason: "..." }` — mai un numero inventato né un'omissione
silenziosa.

**Test**: 25 nuovi test coprono direttamente le tre Verifiche (high-water mai
regredisce senza reset esplicito, reset diagnostico bloccato senza autorizzazione,
flash/RAM/pool mostrati come grandezze distinte, allocation failure passata resta
visibile). CI completa verde via Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto): reset cause e
bit di servizio connectivity restano bitmask grezze; flash headroom/RAM statica non
disponibili finché la fase Firmware 392 non chiude; Schedule/Rule/Block non hanno stato
runtime reale, solo proxy onesti; watchdog è un'inferenza, non un campo diretto.
