# TASK-385-01 — Completare la guida developer

**Stato:** ✅ DONE
**Fase:** 385 — Manuale per sviluppatori

## Cosa devo fare

Aggiorna `EXTENDING_SPAGHETTI_LAB.md`, `spaghetti_modules/README.md`,
`boards/spaghettilab/README.md`, `templates/firmware/`, `FILE_MAP.md` e i README dei
sottosistemi. Non documentare più Registry centrali o struct V0 eliminate.

La guida deve offrire percorsi eseguibili e template copiabili per:

1. nuovo Module Driver sincrono e asincrono;
2. nuovo Rule Driver;
3. nuovo Discovery Provider;
4. nuova variante Core/board;
5. nuovo adapter di trasporto;
6. nuova operation Protocol V1 compatibile.
7. nuovo nodo Node-RED basato sull'SDK host, distinguendo orchestrazione host da logica
   hardware/real-time che deve restare in Zephyr.
8. nuovo layout Core con più Flow, Bay e rail passive/controllate, senza cambiare il
   protocollo o l'editor host.
9. nuovo Device Profile dichiarativo senza sorgenti C o OTA;
10. nuovo Block Driver e relativo Capability Pack opzionale;
11. composizione, misura e pubblicazione di una variante firmware con feature-set e
    resource report.

Per ogni percorso indica file esatti, header pubblico, `.c` privato, schema, iterable
macro, context slab, CMake, Kconfig, Devicetree/binding/overlay, Config JSON/CBOR, test
native fake, build hardware e comando di verifica. Ogni template deve compilare in un
test dedicato: non lasciare pseudo-codice non verificato.

Aggiungi una sezione “Caveat Spaghetti LAB” che spieghi almeno:

- Port 1:N Module ed endpoint/collisioni;
- Flow contro Port contro Bay: topologia fisica, terminazione firmware e posizione;
- connettore uniforme da cinque segnali e indici 0–4 contro numeri GPIO MCU;
- pinctrl/transport supportati dalla board contro selezione runtime della Config;
- power `UNVERIFIED` su jumper passivo contro `ENFORCED` su backend controllato;
- limiti elettrici sconosciuti rappresentati da zero e mai inventati dal firmware;
- key persistente contro ID runtime;
- ownership e lifetime di device Zephyr, descriptor, property e context;
- nessun puntatore in Config/record persistenti;
- callback timer/ISR senza I/O bloccante;
- lock posseduto dalla Port, non dal driver;
- start/stop e cleanup inverso;
- iterable sections e rischio di descriptor eliminato dal linker;
- versionamento schema/field/operation e ID mai riutilizzati;
- uptime/boot ID, queue drop e assenza di storico flash V1;
- cursori Record Delivery distinti: un ACK transport non consuma gli altri;
- Config generation/hash, validate senza effetti, apply compare-and-swap e no-op flash;
- status Protocol V1 contro errno interno e replay centralizzato;
- principal/ruoli/permessi contro semplice link autenticato;
- INT64/UINT64 lossless fra C, CBOR, Python e JavaScript;
- catalog fingerprint e invalidazione cache dopo OTA;
- profili risorse, stack misurati e workspace TLS;
- Device Profile dati contro opcode/driver compilati e revisione/hash riferita;
- Block graph aciclico, budget CPU/RAM e stato soltanto per istanze attive;
- Capability Pack come immagine firmata, mai libreria dinamica runtime;
- flash headroom contro RAM statica, pool/workspace, uso corrente e high-water;
- heartbeat, watchdog e finestre bounded per Update/flash;
- capability reali contro feature teoriche del SoC;
- field semantic/reference group come contratto UI-neutral per React Flow;
- credenziali fuori da Config, log, argv e repository;
- Maintenance, connectivity policy e image trial come stati distinti;
- `make pristine`, DTS generato, `.config`, linker error e validator CMake-aware.

## Perché è fatto così

Le guide attuali descrivono correttamente la V0, ma dopo Module Driver V2 e Protocol V1
alcuni esempi diventano obsoleti. Aggiornarle dopo il freeze evita che un nuovo Module
reintroduca dipendenze centrali o errori di ownership difficili da diagnosticare.

## Come si usa

Un developer sceglie il percorso, copia il template, rinomina ID/schema e completa
soltanto backend hardware e test. Non deve modificare Config, Registry, Runtime,
Communication o MQTT per far comparire il nuovo tipo nel catalogo.

## Checklist di completamento

- [x] Undici percorsi hanno file, template e comandi completi.
- [x] Template compilano nei test.
- [x] Guida non contiene API V0 o Registry centrali.
- [x] Caveat collega diario problemi e guida implementativa.
- [x] Nuovo Module/Core può essere aggiunto senza decisioni implicite.

## Verifica e fine task

```sh
./validator EXTENDING_SPAGHETTI_LAB.md templates/firmware roadmap/385-developer-handbook
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/templates -p native_sim/native/64 --inline-logs --clobber-output'
```

Il task termina quando una prova “clean room” aggiunge un fake Module, un Device
Profile, un Block Driver/pack e una fake board con due Flow seguendo soltanto la guida,
senza patch ai sottosistemi centrali.
