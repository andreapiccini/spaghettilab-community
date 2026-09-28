# TASK-390-01 — Chiudere e qualificare la piattaforma V1

**Stato:** ✅ DONE
**Fase:** 390 — Finalizzazione piattaforma V1

## Cosa devo fare

### 1. Provare che i punti di estensione sono reali

Crea `tests/v1_extension/` e mantieni tutti i plug-in sotto quella directory:

- `fake_temperature`: config I2C, record temperatura INT64, read sincrona;
- `fake_button`: config GPIO, record evento BOOL, start/stop asincroni;
- `fake_pwm`: config output, comando UINT64 duty permille;
- `fake_rule`: osserva un field e comanda PWM;
- `fake_register_profile_a/b`: due Device Profile sullo stesso driver dichiarativo;
- `fake_processing_block`: trasforma un field e mantiene stato bounded;
- `fake_eeprom_provider`: candidate autorevole;
- `fake_analog_provider`: candidate euristico.

Registrali con le macro iterable. Non modificare per la prova:

```text
subsys/driver_registry/
subsys/rule_registry/
subsys/config/
subsys/data/
subsys/runtime/
subsys/communication/
subsys/services/mqtt/
```

Il test applica JSON→CBOR con due Module sulla stessa Port, due schedule, una rule,
un processing graph, evento pulsante e comando PWM. Verifica Device Profile, catalogo,
Data, due consumer Record Delivery,
MQTT fake, BLE fake e rollback. La fake board espone almeno due Flow da cinque segnali:
uno con rail passive e uno con rail controllata. Prova Bay nota e non specificata,
power admission `UNVERIFIED` e `ENFORCED`, due owner I2C e rifiuto di un cambio
transport incompatibile.

### 2. Eseguire la pulizia rimasta dalla fase 210

Riesegui tutte le ricerche di
`roadmap/210-finalizzazione/TASK-210-01-ripulire-e-qualificare-il-firmware.md` adattate
ai nomi V2. Elimina legacy wrapper non più usati, sample elettrico centrale, comando
Relay centrale, Config threshold concreta, tabelle registry e storage raw struct.
Conserva `config_cbor_legacy.c`/`storage_legacy_v3.c` soltanto se la release di
migrazione li richiede e marca versione/data di rimozione.

Completa e marca nel task 210 tutte le verifiche software/fake. I casi che richiedono
INA219, Relay, fault elettrici o PCB non disponibili restano non eseguiti e vengono
copiati nel report hardware insieme alla fase 290; non marcarli PASS con una
simulazione. La platform V1 può essere congelata per Node-RED con questi gate elencati,
ma la release hardware 1.0 no.

### 3. Congelare il contratto V1

Verifica che manuale e template della fase 385 siano coerenti, quindi crea
`PROTOCOL_V1.md`. Documenta:

- numeric operation/event IDs;
- CBOR envelope e Config wire version;
- topic MQTT;
- UUID, framing, autenticazione e limiti BLE;
- schema/field/command ID rules;
- semantica device ID, boot ID, timestamp e sequence;
- profili risorse, capability e stati connettività;
- Device Profile, acquisition opcode, Block Driver, processing graph e relative regole
  di versione/hash;
- Capability Pack, feature-set hash, manifest immagine e resource report;
- topologia Flow/Port/Bay, cinque segnali, transport e semantica power admission;
- permission matrix;
- scope di reset e lifecycle credenziali;
- error mapping;
- GET/VALIDATE/APPLY Config, generation/hash e regole compare-and-swap;
- principal, replay cache, job asincroni e fingerprint catalogo;
- mapping lossless INT64/UINT64 per JavaScript;
- backward compatibility e deprecation;
- procedura per Module, rule, provider, Core e transport nuovi.

Dopo il freeze un cambiamento incompatibile richiede Protocol V2 o nuova schema
version. Non riutilizzare ID eliminati con un altro significato.

### 4. Misurare risorse e applicare limiti

Salva in `verification/v1/RESOURCE_BUDGET.md` per ogni profilo e board:

- flash app/MCUboot e spazio libero slot;
- RAM statica, allocator TLS condiviso, stack per thread e pool dei servizi;
- dimensione record/property/envelope;
- capacità queue/slab/cataloghi;
- massimo Module/schedule/rule/provider/client;
- massimo Device Profile/opcode/Block/edge/context e relativo uso/high-water;
- tempo peggiore fake per apply, rollback e scan timeout.

Misura boot LOW_ENERGY, BLE advertising, BLE connesso, BLE più Wi-Fi/MQTT, MQTT TLS,
OTA Wi-Fi, OTA BLE, stop completo dei servizi e allocazione TLS fallita. Sul profilo
Minimal verifica una sola sessione sicura pesante e assenza della Remote Console di
produzione. Ripeti 100 cicli start/stop e connect/disconnect.

Produci build differenziali `base`, `base+kalman`, `base+modbus` e `all-supported`.
Confronta flash, RAM statica, stack, pool e workspace con baseline e budget; registra
se l'immagine universale può essere il default oppure quali pack devono restare
opzionali. Durante gli scenari registra uso corrente, high-water e allocation failure
per owner, senza derivare l'installabilità da una generica RAM libera istantanea.

Verifica Health Supervisor su ogni profilo: deadline dei worker, window OTA/flash,
reset cause e watchdog hardware quando dichiarato. Un Core senza chosen watchdog deve
riportarlo come capability assente, non come test superato.

Fallisci build con `BUILD_ASSERT` quando una relazione statica è invalida. Non ridurre
limiti silenziosamente in runtime.

### 5. Superare il gate Node-RED senza Module fisici

Esegui due volte lo stesso scenario: con broker TLS/MQTT e con BLE→gateway WebSocket
della fase 375. Con native/fake o board corrente:

1. Node-RED legge catalogo paginato;
2. applica Config con due fake Module sulla stessa Port;
3. riceve sample temperatura ed evento pulsante;
4. invia comando PWM con correlation ID;
5. vede candidato EEPROM e analogico distinti;
6. accetta soltanto quello autorevole;
7. riavvia e ritrova Config da Storage;
8. broker offline non ferma Runtime;
9. BLE/Wi-Fi disconnessi non fermano Runtime e i drop sono visibili;
10. un nuovo fake schema aggiunto dopo il freeze compare senza patch centrali;
11. Node-RED legge capability e rifiuta una funzione non compilata;
12. reboot cambia boot ID ma conserva Config e identità dispositivo;
13. due client leggono la stessa generation: uno committa e l'altro gestisce CONFLICT;
14. apply identica non incrementa generation e non scrive Storage;
15. MQTT e BLE consumano gli stessi record con cursori indipendenti;
16. retry della stessa request da un altro adapter non ripete l'effetto;
17. OTA cambia catalog fingerprint e Node-RED invalida la cache;
18. un intero a 64 bit oltre il safe range attraversa C/CBOR/TypeScript senza perdita.
19. React Flow può costruire corsie, Bay, nodi e handle usando solo
    topology/catalog/config del fake Core;
20. la UI distingue rail manuale non verificata da rail controllata e il Core Pro
    rifiuta un requirement incompatibile.
21. due Device Profile differenti usano lo stesso driver generico; un terzo profilo
    compatibile viene installato come dato senza OTA;
22. Config che usa un blocco assente restituisce UNSUPPORTED senza effetti;
23. OTA `base+kalman` cambia feature-set/catalog fingerprint, preserva Config e rende
    il blocco istanziabile senza un secondo update;
24. OTA che rimuove una feature usata dal Config attivo o persistito è rifiutato;
25. GET_RESOURCES riporta headroom flash, pool/workspace e high-water coerenti con i
    report di build e i fault di esaurimento iniettati.

Registra risultati in `verification/v1/PLATFORM_REPORT.md` con commit, Zephyr, board e
comandi, senza segreti.

### 6. Eseguire conformance e test avversariali

Usa i golden vector della fase 378 in test C, Python e TypeScript. Aggiungi corpus e
fuzz harness per decoder envelope, Config CBOR, pagina catalogo e framing BLE. Copri
chiavi duplicate/extra, lunghezze massime, integer overflow, UTF-8 errato, frammenti
sovrapposti/fuori ordine, replay, principal revocato, queue piena e paginazione che
cambia fingerprint a metà lettura. Aggiungi Device Profile/acquisition plan,
processing graph e manifest pack: opcode sconosciuto, budget temporale eccessivo,
ciclo, edge/type incompatibile, dipendenza pack assente e valori resource overflow.

Il fuzz test non deve richiedere hardware e non può allocare oltre i limiti del profilo.
Registra seed e crash artifact; zero crash, hang o accesso fuori limite è il gate.

### 7. Separare “platform V1” da “release hardware 1.0”

Puoi marcare questo task DONE con fake e hardware corrente. Non impostare automaticamente
`VERSION=1.0.0`: la release hardware 1.0 richiede anche fase 290 completa, board PCB
definitiva, sicurezza production e prove elettriche del promemoria. Riporta questi gate
come aperti, non come bug del contratto software.

## Perché è fatto così

Un'architettura è espandibile solo se un test aggiunge tipi reali senza toccare il
centro. Il freeze permette a Node-RED e ai tool di evolvere contro un contratto stabile;
separare platform V1 da hardware release evita di dichiarare qualificate prove che
oggi non puoi eseguire.

## Come si usa

Dopo il task, il lavoro ordinario firmware per un nuovo Module resta confinato a
driver, schema, test e CMake/Kconfig. Node-RED scopre catalogo e usa protocollo/topic V1.
Nuovi Core aggiungono board/binding/backend Port senza branch applicativi.

## Checklist di completamento

- [x] Sei plug-in fake attraversano il sistema senza patch centrali.
- [x] Due Device Profile condividono il driver generico e un Block fake si registra senza patch centrali.
- [x] Pulizia software 210 è conclusa e ogni caso hardware rinviato è tracciato.
- [x] Protocol, Config wire, schema ID, MQTT topic e BLE UUID/framing sono congelati.
- [x] Resource budget di ogni profilo/board è registrato nei carichi peggiori.
- [x] Build base/Modbus/Kalman/all-supported e resource high-water determinano la policy dei pack.
- [x] Manifest/update impediscono rimozione di capability richieste dal Config.
- [x] Gate Node-RED passa sia con MQTT TLS sia con BLE/gateway.
- [x] SDK TypeScript, CLI Python e firmware C superano gli stessi golden vector.
- [x] Config concorrente/no-op, replay cross-transport e cursori multipli sono provati.
- [x] Due Flow, cinque segnali, Port mux e power passive/controlled superano i fake.
- [x] Il modello editor host nasce solo da topology/catalog/config.
- [x] Fuzzing dei decoder e framing termina senza crash o hang.
- [x] Health Supervisor e watchdog dichiarato superano fault injection.
- [x] Lifecycle, workspace TLS, lease, reset e record drop superano i failure test.
- [x] Manuale e template della fase 385 superano una prova clean-room.
- [x] Limiti hardware/produzione restano esplicitamente aperti.

## Verifica e fine task

```sh
./validator roadmap
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests -p native_sim/native/64 \
  --inline-logs --outdir build/twister-v1 --clobber-output'
make pristine
BOARD=spaghettilab_core_v2_build_only/esp32c3 make build
.venv/bin/python -m unittest discover -s tools/tests -v
npm --prefix tools/sdk/typescript test
make node-red-mqtt-smoke
make node-red-ble-smoke
```

Il task termina quando il report V1 contiene zero failure, entrambi i percorsi host
completano i venticinque passi e l'aggiunta di un nuovo fake non modifica alcun sottosistema
centrale.
