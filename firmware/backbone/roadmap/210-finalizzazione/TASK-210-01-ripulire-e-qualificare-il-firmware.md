# TASK-210-01 — Ripulire e qualificare il firmware completo

**Stato:** 🟨 IN PROGRESS
**Fase:** 210 — Finalizzazione

## Cosa devo fare

### 1. Eliminare gli artefatti temporanei, uno per uno

Apri questi file e rimuovi soltanto le scorciatoie indicate:

- `src/main.c`: nessun include INA219/Relay, chiamata Manager diretta, sample loop,
  `k_sleep()` o Config hard-coded; deve restare il main del task 200;
- `boards/esp32c3_devkitm_esp32c3.overlay` e le board Spaghetti LAB: nessun nodo,
  alias o `compatible` INA219 rimovibile; devono restare controller e Port fisici;
- `spaghetti_modules/ina219/ina219.c` e `.h`: elimina
  `spaghetti_ina219_test_init()`, `spaghetti_ina219_test_read()` e ogni accesso
  `sensor_*`/`DEVICE_DT_GET()` a un’istanza statica; conserva soltanto il descrittore
  `spaghetti_ina219_driver` e le ops I2C runtime;
- `subsys/services/storage/storage.c`: elimina il backend RAM di bring-up quando il
  backend Settings reale è attivo; conserva i fake soltanto sotto `tests/`;
- `subsys/services/mqtt/mqtt.c`: elimina broker, topic e credenziali fissi; usa solo la
  copia di `spaghetti_mqtt_config`;
- `subsys/core/core.c`: elimina Config INA219 automatica, chiamate di prova Registry,
  letture sensore e loop; conserva soltanto la Config vuota e l’orchestrazione;
- `subsys/config/config.c`: elimina union/campi concreti INA219 o Relay; conserva il
  payload driver bounded del task 200;
- `include/spaghetti/module_manager.h` e `subsys/module_manager/module_manager.c`:
  elimina `get_by_port()` singolare, controlli Port occupied e
  `SPAGHETTI_MODULE_CONTEXT_SIZE`; conserva get-by-key/list-by-port e soli slot Module;
- `prj.conf`: rimuovi `CONFIG_SENSOR=y` se nessun driver rimasto usa la Sensor API e
  rimuovi opzioni abilitate soltanto da harness eliminati;
- `CMakeLists.txt`: rimuovi sorgenti temporanee/duplicate, ma conserva ogni componente
  raggiunto dal bootstrap finale.

Non cancellare test utili, driver reali, log di errore o configurazioni opzionali
selezionabili. Sposta un fake riutilizzabile sotto `tests/`; non lasciarlo nella build
firmware di produzione.

### 2. Verificare automaticamente che non restino scorciatoie

Esegui dalla root `firmware/backbone`:

```sh
rg -n "TEMPORARY|SCORCIATOIA TEMPORANEA|spaghetti_.*_test_|sensor_sample_fetch|sensor_channel_get|SPAGHETTI_MODULE_CONTEXT_SIZE" \
	--glob '!roadmap/**' --glob '!tests/**' .
rg -n "ina219|ti,ina219" boards --glob '*.dts' --glob '*.dtsi' --glob '*.overlay'
rg -n "0x40|1883|electrical" src subsys/core subsys/config subsys/services/mqtt
```

Il primo e il secondo comando non devono trovare codice attivo. Per il terzo esamina
ogni risultato: `0x40` è ammesso nel codec/test INA219 ma non in Core; `1883` e il topic
sono ammessi come valori di una Config di test ma non come impostazioni private MQTT.

### 3. Provare l’estensione senza toccare il centro

Crea soltanto sotto `tests/module_extension/` un fake driver con:

```c
static int fake_validate_config(const void *config, size_t config_size);
static int fake_describe_endpoint(const void *config, size_t config_size,
				  struct spaghetti_module_endpoint *out);
static int fake_init(struct spaghetti_module *module,
		     const void *config, size_t config_size);
static int fake_read(struct spaghetti_module *module,
		     struct spaghetti_sample *out);
static int fake_deinit(struct spaghetti_module *module);

extern const struct spaghetti_module_driver spaghetti_fake_driver;
```

`module` è uno slot prestato dal Manager e modificabile perché init/deinit aggiornano il
context; `config` è un buffer `const` valido solo durante init e va copiato; `out` è del
chiamante e cambia solo al successo. Il descrittore è `const` e vive per tutto il
firmware di test. Le ops restituiscono `0`, `-EINVAL` per argomenti errati e `-EIO` nel
caso di errore iniettato.

Le due callback pure validano una config fake contenente endpoint kind/value. Configura
tre key sulla stessa Port con value diversi e una collisione negativa. Il fake context
usa uno slab statico tipizzato; non reintroduce un buffer nel Manager.

Registra `&spaghetti_fake_driver` soltanto nella build di test. Invia una
`spaghetti_module_request` con type `"fake"`, Port e config bounded, poi verifica
configure/read/remove. Prima e dopo la prova, controlla con `git diff` che non siano
stati modificati:

```text
subsys/core/core.c
subsys/module_manager/module_manager.c
subsys/runtime/runtime.c
subsys/data/data.c
```

Il Registry è l’unico elenco compilato che deve conoscere il nuovo descrittore. Il
codec deve conoscere il nuovo formato esterno soltanto quando vuoi ricevere quel tipo
via CBOR; il modello Config interno resta invariato.

### 4. Eseguire la matrice end-to-end

Usa la Shell e hardware reale per eseguire nell’ordine:

1. boot senza moduli e senza record: Core RUNNING, Shell disponibile, Runtime idle;
2. payload CBOR malformato: risposta negativa e snapshot immutato;
3. Config INA219 senza sensore: `-ENODEV`, nessun Module parziale e Shell ancora viva;
4. collega INA219 e riapplica: Module READY e campioni elettrici;
5. cambia periodo: nuova cadenza senza reboot;
6. Config che omette key 11: relativo `deinit()` chiamato, key 10 ancora READY sulla
   stessa Port; Config vuota successiva rimuove anche key 10;
7. riaggiungi INA219 e riavvia: Config caricata da Storage;
8. scollega INA219 durante le letture: errore osservabile senza crash o blocco di
   Communication; la rimozione automatica avviene solo se esiste un provider presenza
   reale, altrimenti invia una Config vuota;
9. broker assente e coda piena: Runtime continua; quando il broker torna MQTT recupera;
10. build della seconda Core variant: nessun ramo sul nome della board nel C comune.

La fase Power si prova sull’hardware solo se esiste davvero una rail controllabile;
altrimenti il backend fake e la build con Power disabilitato sono il risultato corretto.

## Perché è fatto così

La pulizia finale rimuove il codice usato per osservare una fase intermedia, non le
funzionalità. La prova fake dimostra il punto di estensione reale: un nuovo tipo porta
driver, descrittore e codec/config specifica, mentre ownership e lifecycle rimangono in
Registry e Manager. I test senza hardware verificano rollback; quelli reali verificano
cablaggio e protocolli.

## Come si usa

Al termine il normale flusso utente è: accendi il Core, attendi RUNNING, invia una
Config bounded tramite Communication, osserva lo stato e i dati, poi invia una nuova
Config per aggiungere, cambiare o rimuovere Module. Per un nuovo modulo copia la forma
di un Module Driver esistente, assegna un `type_id` unico, registra il descrittore e
aggiungi la sua rappresentazione al codec del protocollo usato.

## Checklist di completamento

- [x] Tutti gli artefatti temporanei elencati sono rimossi dalla build finale.
- [x] Le ricerche non trovano shortcut attivi o configurazioni fisse nascoste.
- [x] Il fake driver attraversa Registry/Manager senza modificare i livelli centrali.
- [x] Due endpoint sulla stessa Port convivono e una rimozione non tocca il fratello.
- [x] Boot vuoto, Config valida/non valida, rollback, remove e reboot sono provati.
- [x] Disconnessione hardware e servizi assenti non bloccano Communication. *(fake/native)*
- [x] Le build delle Core variant e la configurazione Power applicabile sono verificate. *(build-only / fake power)*
- [x] Documentazione, validator e build pristine sono puliti.
- [ ] Matrice hardware INA219/Relay/fault/PCB — **OPEN**, copiata in `verification/v1/PLATFORM_REPORT.md` e fase 290; non PASS via simulazione.

Hardware 2026-08-14 on Core V1 (no INA219 attached): steps 1–2 PASS in
unprovisioned/reduced mode; steps 3–9 N/A until a physical INA219 (and optional
broker) are on Port 0. Do not boot this board to Normal just to force those
rows.

## Verifica e fine task

software/fake items above are DONE as of platform V1 finalization (TASK-390).
Legacy migration sources retained with removal date **2026-12-31**:

- `subsys/config/config_cbor_legacy.c`
- `subsys/services/storage/storage_legacy_v3.c`
