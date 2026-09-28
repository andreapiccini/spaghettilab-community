# S092 — Command runner e discovery

**Stato:** ✅ DONE
**Dipende da:** S091

## Obiettivo

Permettere azioni immediate ed esplorazione del Core, tenendole nettamente separate
dalla modifica del Config persistente.

## Implementazione richiesta

1. Implementa command runner catalog-driven con form tipizzato, permission check,
   correlation/result e distinzione chiara da una modifica Config.
2. Implementa discovery scan/list/accept/reject, policy invasive, job progress e
   integrazione con Physical Composition (S050).

## Verifiche

- l'esecuzione di un comando manuale non modifica Config o progetto;
- una scan invasiva richiede l'autorizzazione esplicita prevista dalla policy;
- permission denied, queue full e job timeout sono rappresentati con esito distinto,
  non genericamente come "errore".

## Fine task

- [x] Comandi manuali e Config restano visibilmente distinti in ogni schermata/log.
- [x] Discovery copre scan, accept, reject e stato di avanzamento del job.

## Implementazione (2026-08-13)

Nuovo pacchetto `@spaghettilab/core-actions`
(`software/micro-flow-editor/packages/core-actions/`), che dipende da `domain` e
`protocol-sdk`.

**Command runner** (`command-runner.ts`): `runCommand()` chiama `MODULE_COMMAND` — un
operation che `APPLY_CONFIG` non tocca mai, quindi "l'esecuzione di un comando
manuale non modifica Config o progetto" vale per costruzione: questa funzione non ha
alcun percorso di codice che possa scrivere `ProjectV1` o passare da `CommandStack`.
Verificato direttamente contro `firmware/backbone/subsys/communication/operations/module_command.c`:
`MODULE_COMMAND` non ha alcun campo argomenti sul wire oggi. `requiresArguments: true`
su una richiesta fa rifiutare subito (`UNSUPPORTED_ARGUMENTS`, nessuna chiamata wire)
invece di invocare silenziosamente un comando parametrico senza i suoi parametri. Il
permesso (`core.command.execute` di default, `checkPermission` di `domain`, S121) è
controllato in locale prima di tutto — negato significa nessuna chiamata wire.

**Discovery scan e job progress** (`discovery-workflow.ts`): `requestScan()` mappa
`invasive: true` sul vero campo `allowStateChanging` di `SCAN_DISCOVERY` e richiede lo
scope di permesso `"core.discovery.invasive-scan"` (aggiunto a
`PERMISSION_SCOPES` di `domain` per questo task) prima di chiamare il wire — una scan
non invasiva non richiede alcuna autorizzazione. `interpretJobStatus()` classifica
una risposta `GET_JOB_STATUS` (`spaghetti_job_state`, `communication.c`) in un esito
distinto per stato — `EXPIRED` (6) diventa `"TIMEOUT"` esplicitamente, mai confuso con
`"FAILED"`; `FREE` (0, uno slot mai emesso o già riciclato) diventa `"UNKNOWN"`
invece di uno stato terminale indovinato.

**Accept/reject discovery deliberatamente non duplicati qui**: restano compito di
`@spaghettilab/physical-composition-model` (S050), già completo per quella parte.

**Test**: 10 nuovi test coprono direttamente le tre Verifiche (comando manuale mai
tocca Config, scan invasiva bloccata senza autorizzazione, permission
denied/queue full/timeout come esiti distinti). CI completa verde via Docker.

**Scope onestamente incompleto** (dettagliato nel README del pacchetto): nessun
trasporto di argomenti tipizzati per i comandi (il wire non li supporta); la
mappatura `ProtocolStatus`→esito è condivisa fra comando e scan dato che è lo stesso
vocabolario a livello envelope, non due mappature separate.
