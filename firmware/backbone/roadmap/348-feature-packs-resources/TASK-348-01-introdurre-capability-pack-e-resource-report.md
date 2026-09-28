# TASK-348-01 — Introdurre Capability Pack, manifest e resource report

**Stato:** ✅ DONE
**Fase:** 348 — Capability Pack e osservabilità risorse

## Cosa devo fare

### 1. Definire Capability Pack compilabili

Crea `include/spaghetti/feature_pack.h`, `subsys/feature_registry/`, tooling di build e
`tests/feature_packs/`. Un pack raggruppa codice firmware correlato, per esempio:

```text
core-basic
transport-modbus
processing-basic
processing-kalman
device-profile-engine
```

Il manifest sorgente dichiara ID/versione, dipendenze e conflitti, Core/profile
compatibili, capability hardware richieste, Module/Rule/Block/operation/opcode forniti,
ABI e Protocol/Config minimi. Kconfig/CMake risolve il set a build-time e fallisce su
dipendenza assente, ID duplicato o combinazione incompatibile.

Il pack non è una libreria dinamica. Installarlo significa ricevere una nuova immagine
firmata MCUboot che lo contiene. Dopo il reboot i Registry enumerano i nuovi
descrittori; Config può istanziarli senza un altro update.

### 2. Incorporare un manifest immagine verificabile

Ogni artefatto firmware incorpora e rende leggibile prima del trial boot:

- Core variant, resource profile e layout/slot compatibili;
- versione firmware, ABI, Protocol e Config supportati;
- elenco ordinato pack ID/versione e `feature_set_hash`;
- capability fornite e richieste;
- flash image size e margine richiesto per header/trailer;
- RAM statica prevista, stack, pool e workspace massimi;
- versione minima di bootloader e policy downgrade;
- compatibilità/migrazione del Config persistito.

Update Coordinator verifica manifest, firma/header, variante, profilo, layout,
dipendenze e Config corrente prima di `PENDING_REBOOT`. Un candidato che rimuove un
tipo usato dal Config è rifiutato, salvo che contenga una migrazione esplicita e
transazionale. Fallimento e rollback conservano immagine confermata, Config e Device
Profile persistiti.

### 3. Esporre un resource report significativo

Crea `include/spaghetti/resources.h` e `subsys/resources/`. Separa valori immutabili di
build da utilizzo runtime:

```text
Build/image:
  flash_slot_bytes, image_bytes, image_headroom_bytes
  static_ram_bytes, declared_stack_bytes, declared_pool_bytes
  feature_set_hash, pack list

Runtime bounded owners:
  pool capacity/used/peak per Module, Rule, Block, profile e record
  shared workspace capacity/used/peak
  stack size e minimum-ever-unused per thread monitorabile
  system heap capacity/used/peak soltanto se realmente abilitato
  allocation failures e ultimo resource_exhausted owner
```

Snapshot è coerente, caller-owned e non alloca. Mantieni contatori high-water dal boot
e un reset diagnostico autorizzato che non cambia capacità. La misura non deve
abilitare thread analyzer o statistiche costose nei profili production senza una
scelta Kconfig esplicita; il catalogo dichiara quali metriche sono disponibili.

Non pubblicare una generica `free_ram` come promessa di installabilità. RAM libera in
un istante non include l'effetto della prossima immagine né i suoi picchi. La
compatibilità di un candidato è decisa dal suo manifest e dai gate di link/build; il
report runtime serve a osservare margini e high-water. `image_headroom_bytes` è invece
un margine flash dello slot corrente, non una garanzia che un pack non ancora
compilato abbia una certa dimensione.

### 4. Produrre report e gate automatici di build

Estendi i tool di build per produrre JSON canonico e report umano con:

- delta flash/RAM rispetto alla baseline e alla build precedente;
- top symbol/section, stack, slab/pool e workspace;
- headroom assoluto e percentuale per profilo;
- budget massimo configurato per ogni categoria;
- pack inclusi e contributo misurato quando isolabile;
- esito PASS/FAIL e motivazione.

Il gate fallisce se immagine/slot, RAM statica, stack, pool o workspace superano il
budget. Non riduce automaticamente capacità Kconfig. Prepara almeno build `minimal`,
`standard`, `all-supported` e build differenziali con Modbus e Kalman. Se
`all-supported` rispetta i margini stabiliti può diventare la distribuzione predefinita;
altrimenti restano immagini composte per set di pack.

### 5. Rendere il firmware marketplace-ready senza implementare la UI

Il catalogo firmware distingue:

- feature installate nell'immagine;
- tipi Module/Rule/Block/opcode forniti da ciascun pack;
- versioni e dipendenze;
- risorse e limiti effettivi del Core.

Non implementare store, pagamento, ricerca o interfaccia React Flow. Fornisci soltanto
manifest, catalogo, errori stabili e operazioni necessarie a un host futuro per
confrontare Config richiesta e feature installate, trasferire una signed image e
rileggere il catalogo dopo OTA.

### 6. Testare installazione, rimozione e pressione risorse

Prova immagini fake base, base+Kalman e base+Modbus. Verifica aggiunta pack, uso tramite
Config, fingerprint cambiato, rimozione non usata, rimozione usata rifiutata,
dipendenza/conflitto, ABI errata, board/profile/layout errati, rollback MCUboot,
Config preservato, pool esaurito, high-water e report deterministico.

## Perché è fatto così

Il catalogo dice cosa il firmware può fare; il Config decide cosa fa ora. La misura
separata di flash, RAM statica e picchi runtime permette di scegliere fra immagine
universale e pack opzionali con dati reali, senza affidarsi a una `free_ram` ambigua.

## Checklist di completamento

- [x] Pack e manifest sono versionati, deterministici e firmati con l'immagine.
- [x] Update rifiuta rimozione di feature richieste dal Config attivo/persistito.
- [x] Resource report separa capacità, uso corrente e high-water.
- [x] Build gate copre flash, RAM, stack, pool e workspace.
- [x] Catalogo collega ogni tipo compilato al pack proprietario.
- [x] Build `all-supported` determina con misure se distribuire tutte le feature.
- [x] Nessuna funzionalità React Flow/marketplace UI entra nel firmware.

## Verifica e fine task

```sh
make validate
make resource-report
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/feature_packs -T tests/resources \
   -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```

