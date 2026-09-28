# Backlog del firmware Spaghetti LAB

Questa cartella contiene i task eseguibili del firmware. Apri un solo task alla
volta, completa la relativa checklist e aggiorna lo stato.

> [!IMPORTANT]
> La relazione Port 1:N Module è implementata e verificata. Consulta il
> [report della migrazione](PORT-MODULE-1-N-MIGRATION.md) per contratti e test.

> [!NOTE]
> La prossima estensione low-energy è stata formalizzata nel
> [contratto connettività e risorse](../CONNECTIVITY_AND_RESOURCE_CONTRACT.md): BLE come
> trasporto normale quando richiesto, Wi-Fi on-demand, profili RAM per Core e rimozione
> dell'arena mbedTLS sempre residente. Le fasi 291–295 e 365–375 ne implementano il
> lifecycle senza cambiare il modello Port → Module → Runtime.

## Legenda degli stati

| Simbolo | Stato |
|:---:|---|
| ⬜ | TODO |
| 🟨 | IN PROGRESS |
| ✅ | DONE |
| ⛔ | BLOCKED |

## Coerenza fra stato e checkbox

Lo stato deriva dalle checkbox presenti in `## Checklist di completamento`:

| Checklist | Stato corretto |
|---|---|
| Nessuna voce selezionata | ⬜ TODO |
| Alcune voci selezionate | 🟨 IN PROGRESS |
| Tutte le voci selezionate | ✅ DONE |

Lo stato viene aggiornato manualmente. I task non fanno parte della compilazione e
quindi non vengono scanditi dal validator durante `make build`. Per controllarli usa
`./validator roadmap`; verrà mostrato un warning se stato e checkbox non coincidono.
Il validator non modifica mai i file. `⛔ BLOCKED` è un'eccezione manuale ammessa anche
con checklist incompleta.

La roadmap contiene un task autosufficiente per fase. Ogni task deve rispettare questo schema:

```text
roadmap/<NNN-nome-fase>/TASK-<stesso-NNN>-<NN>-nome-task.md
```

Devono coincidere:

- ID nel nome del file;
- ID nel titolo `# TASK-NNN-NN`;
- numero nella riga `**Fase:** NNN — ...`.

Il validator segnala `TASK001` se l'identità non coincide e `TASK002` se lo
stato non rispecchia le checkbox.

L'estensione
[Markdown Checkbox Preview](https://marketplace.visualstudio.com/items?itemName=GSejas.markdown-checkbox-preview)
permette di selezionare le checkbox con il mouse. Dopo averle modificate,
aggiorna anche la riga `**Stato:**`.

## Regola obbligatoria per i concetti Zephyr

Un task che introduce per la prima volta un concetto specifico di Zephyr deve
spiegarlo **prima** della procedura. La sezione di orientamento deve indicare:

1. cos'è;
2. a cosa serve;
3. quando viene usato;
4. se opera a build-time o runtime;
5. come si collega al task;
6. qual è il file reale coinvolto;
7. cosa cercare dentro quel file;
8. cosa non modificare.

La spiegazione deve essere breve e riferita ai file reali di Spaghetti LAB.
Termini come “aggiungi il nodo”, “abilita il driver” o “usa il Device Model”
non sono istruzioni sufficienti se il concetto non è stato ancora spiegato.

## Fasi

| Stato | Fase | Risultato visibile |
|:---:|---|---|
| ✅ | [000 — Baseline](000-baseline/README.md) | Il firmware Zephyr iniziale viene compilato, caricato e osservato sulla console. |
| ✅ | [010 — Core](010-core/README.md) | `main` avvia Core e la console mostra log strutturati. |
| ✅ | [020 — Scheda attuale / I2C](020-board-i2c/README.md) | Il DTS generato contiene il controller I2C reale e abilitato. |
| ✅ | [030 — Port](030-port/README.md) | Port 0 espone la capacità I2C e possiede un device Zephyr pronto. |
| ✅ | [040 — Sezione verticale INA219](040-ina219/README.md) | Bus voltage, current e power reali compaiono nei log. |
| ✅ | [050 — Module + Module Driver](050-module-driver/README.md) | Module distingue key, ID runtime, Port ed endpoint; INA219 usa la operation table. |
| ✅ | [060 — Driver Registry](060-driver-registry/README.md) | La ricerca di `ina219` riesce e un tipo sconosciuto fallisce correttamente. |
| ✅ | [070 — Module Manager](070-module-manager/README.md) | Il Manager gestisce più endpoint simultanei sulla stessa Port. |
| ✅ | [080 — INA219 rimovibile a runtime](080-runtime-removable-ina219/README.md) | Due INA219 condividono Port 0 con address e context runtime distinti. |
| ✅ | [090 — Config interna](090-config/README.md) | Config riconcilia Module per key e accetta Port ripetute con endpoint distinti. |
| ✅ | [100 — Config persistente](100-storage/README.md) | La configurazione sopravvive al riavvio. |
| ✅ | [110 — Data / zbus](110-data-zbus/README.md) | Bus voltage/current/power raggiungono due consumer. |
| ✅ | [120 — Runtime V0](120-runtime-v0/README.md) | Runtime campiona ogni secondo mentre `main` esegue soltanto il boot. |
| ✅ | [130 — Relay + Runtime V1](130-relay-runtime-v1/README.md) | Una soglia di corrente con isteresi comanda il relay configurato. |
| ✅ | [140 — Communication](140-communication/README.md) | Un comando Shell locale legge lo stato e invia configurazioni. |
| ✅ | [150 — CBOR](150-cbor/README.md) | Un payload CBOR viene decodificato e applicato a Config. |
| ✅ | [160 — MQTT](160-mqtt/README.md) | Il campione elettrico raggiunge il topic MQTT configurato. |
| ✅ | [165 — Wi-Fi sicuro](165-secure-wifi/README.md) | Più reti note persistono e vengono selezionate senza esporre password sulla seriale. |
| ✅ | [170 — Discovery](170-discovery/README.md) | Discovery emette più risultati per Port e invalida una key alla volta. |
| ✅ | [180 — Varianti Core multiple](180-multi-core/README.md) | Gli stessi livelli applicativi funzionano su due varianti Core. |
| ✅ | [190 — Power](190-power/README.md) | Reference counting e rollback sono verificati; Core V1 lascia Power disabilitato perché non espone una rail controllabile. |
| ✅ | [200 — Engine completo](200-engine/README.md) | Il Core carica Config, avvia i componenti e accetta riconfigurazioni senza reboot. |
| 🟨 | [210 — Finalizzazione](210-finalizzazione/README.md) | Nessuna scorciatoia temporanea rimane e il sistema completo supera la matrice end-to-end. |
| ✅ | [220 — Contratto Maintenance Link](220-update-hardware-contract/README.md) | Board/overlay scelgono pin e controller; il firmware comune usa un'API astratta. |
| ✅ | [230 — MCUboot e A/B](230-mcuboot-ab/README.md) | Bootloader e applicazione firmata usano gli slot primario e secondario. |
| ✅ | [240 — Coordinatore update](240-update-coordinator/README.md) | Timeout e cancel scartano il candidato senza toccare il firmware attivo. |
| ✅ | [250 — Boot sicuro](250-safe-boot-mode/README.md) | Boot senza Config resta sicuro; modalità operativa e trial sono visibili e indipendenti. |
| ✅ | [260 — Manutenzione locale UART](260-local-maintenance-uart/README.md) | La base configura e aggiorna il Core usando i pin condivisi in una finestra sicura. |
| ✅ | [270 — OTA Wi-Fi](270-wifi-ota/README.md) | Un peer autenticato carica una signed image durante una finestra esplicita. |
| ✅ | [280 — Console remota](280-remote-console/README.md) | `make monitor` usa USB o un canale di rete autenticato. |
| 🟨 | [290 — Qualificazione update](290-update-qualification/README.md) | Tool e matrice sono pronti; le prove fisiche devono ancora produrre evidenze. |
| ✅ | [291 — Profili risorse](291-resource-profiles/README.md) | Ogni Core compila limiti e capability coerenti con il proprio budget. |
| ✅ | [292 — Connectivity Manager](292-connectivity-manager/README.md) | LOW_ENERGY, ONLINE e lease temporanee hanno un solo owner. |
| ✅ | [293 — Workspace TLS](293-secure-workspace/README.md) | TLS/DTLS usa memoria condivisa bounded invece dell'arena privata da 60 KiB. |
| ✅ | [294 — Lifecycle servizi](294-service-lifecycle/README.md) | Servizi opzionali rilasciano stack, socket e code quando vengono arrestati. |
| ✅ | [295 — Low-energy power](295-low-energy-power/README.md) | Radio e PM seguono una policy verificabile senza fermare Runtime. |
| ✅ | [296 — Health supervisor](296-health-supervisor/README.md) | Heartbeat e watchdog rilevano worker bloccati e rendono visibile la causa del reset. |
| ✅ | [297 — Topologia Flow](297-flow-topology/README.md) | Il Core descrive Flow, Function Bay ordinate e connettori uniformi da cinque segnali. |
| ✅ | [300 — Port e trasporti V1](300-port-transport-v1/README.md) | Port espone bus differenti e serializza controller condivisi senza hardware inventato. |
| ✅ | [305 — Power topology](305-power-topology/README.md) | Rail passive o controllate applicano admission coerente senza fingere limiti non noti. |
| ✅ | [310 — Schemi e valori V1](310-schema-values-v1/README.md) | Config, record e comandi usano proprietà tipizzate e descrittori enumerabili. |
| ✅ | [320 — Module Driver V2](320-module-driver-v2/README.md) | Un driver porta schema e operazioni e si registra senza tabelle centrali. |
| ✅ | [325 — Profili dispositivo](325-declarative-device-profiles/README.md) | Registri e transazioni diventano profili dichiarativi installabili senza ricompilare un driver per sensore. |
| ✅ | [330 — Config e wire V2](330-config-wire-v2/README.md) | Config e Storage usano CBOR canonico generico e versionato. |
| ✅ | [340 — Data, Runtime e regole V2](340-data-runtime-rules-v2/README.md) | Record, schedule e rule plug-in non dipendono da INA219 o Relay. |
| ✅ | [342 — Blocchi elaborazione](342-processing-blocks/README.md) | Pipeline bounded collegano blocchi firmware catalogati usando soltanto Config. |
| ✅ | [345 — Consegna record](345-record-delivery/README.md) | Ogni adapter ha un cursore indipendente e perdite/reboot restano espliciti. |
| ✅ | [348 — Capability Pack e risorse](348-feature-packs-resources/README.md) | Immagini componibili dichiarano feature installate e misurano flash, RAM, pool e stack. |
| ✅ | [350 — Discovery multi-provider V1](350-discovery-providers-v1/README.md) | Manuale, EEPROM, probe, analogico e 1-Wire convivono come strategie opzionali. |
| ✅ | [355 — Identità e reset](355-identity-security-lifecycle/README.md) | Identità, principal, permessi, credenziali, revoca e reset hanno ownership definita. |
| ✅ | [360 — Communication Protocol V1](360-communication-protocol-v1/README.md) | Envelope CBOR, Config CAS, errori stabili, replay e job sono comuni a ogni adapter. |
| 🟨 | [365 — Protocollo BLE](365-ble-protocol/README.md) | BLE trasporta envelope V1 autenticati con framing bounded. |
| ✅ | [366 — OTA BLE](366-ble-ota/README.md) | BLE alimenta Update Coordinator senza duplicare flash o rollback. |
| ✅ | [367 — Handover BLE/Wi-Fi](367-ble-wifi-handover/README.md) | Un peer BLE apre lease, manutenzione o OTA Wi-Fi separatamente. |
| ✅ | [370 — MQTT per Node-RED V1](370-mqtt-node-red-v1/README.md) | Node-RED riceve record e invia richieste con risposta correlata. |
| ✅ | [375 — Gateway BLE Node-RED](375-node-red-ble-gateway/README.md) | Node-RED usa BLE direttamente o tramite gateway senza MQTT sul Core. |
| ✅ | [378 — SDK host e Node-RED](378-host-sdk-node-red/README.md) | TypeScript condivide codec/transport e coordina la Config senza lost update. |
| ✅ | [380 — Tool sviluppatore V1](380-developer-tools-v1/README.md) | Un CLI JSON nasconde CBOR, trasporti e aggiornamenti. |
| ✅ | [385 — Manuale developer](385-developer-handbook/README.md) | Guide e template V1 coprono Module, Core, rule, provider e transport. |
| ✅ | [390 — Finalizzazione piattaforma V1](390-v1-finalization/README.md) | Contratti, SDK, watchdog, fuzz ed estensioni fake superano il gate Node-RED. |
| ✅ | [391 — Validazione remota reale dei Device Profile](391-device-profile-remote-validation/README.md) | `VALIDATE_DEVICE_PROFILE` esegue il validatore reale invece di rispondere sempre `valid: 1`. |
| ✅ | [392 — Flash headroom e RAM statica su GET_RESOURCES](392-resources-flash-ram-wire-exposure/README.md) | `GET_RESOURCES` espone flash headroom e RAM statica come campi distinti, non solo i pool. |
| ✅ | [393 — Trasporti Port nei Device Profile](393-device-profile-port-transports/README.md) | 1-Wire + UART_READ + SPI mode + WAIT_GPIO; i chip restano profili, non driver compilati. |

## Da dove iniziare

La fase 290 e le prove fisiche della fase 210 restano aperte finché è disponibile
l'hardware adatto; non devono essere dichiarate superate con fake. Per continuare ora
senza Module esterni, segui il
[piano di chiusura della piattaforma V1](V1-PLATFORM-CLOSURE.md) e apri
[TASK-291-01 — Introdurre profili di risorse e capability](291-resource-profiles/TASK-291-01-introdurre-profili-risorse-e-capability.md).

La fase 390 riesegue la pulizia software 210 sul modello definitivo e registra
separatamente ogni gate fisico rinviato. La fase 290 rimane obbligatoria prima della
release hardware 1.0, ma può procedere in parallelo ai contratti 291–390 verificati con
fake e `native_sim`.

Follow-up software post-freeze (senza hardware): [391](391-device-profile-remote-validation/README.md)
(`VALIDATE_DEVICE_PROFILE` reale),
[392](392-resources-flash-ram-wire-exposure/README.md) (flash/RAM su `GET_RESOURCES`) e
[393](393-device-profile-port-transports/README.md) (1-Wire nei profili; le altre
famiglie Port sono già nell'interprete).
