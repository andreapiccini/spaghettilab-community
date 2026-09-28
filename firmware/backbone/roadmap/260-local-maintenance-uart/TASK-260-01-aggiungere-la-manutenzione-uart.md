# TASK-260-01 — Aggiungere provisioning e update UART dalla base

**Stato:** ✅ DONE
**Fase:** 260 — Manutenzione locale UART

## Cosa devo fare

Il risultato di questo task è un canale locale separato dalla console USB:

```text
Base -- UART 115200 8N1 --> Maintenance Link --> SMP Spaghetti --> Config / Wi-Fi / Update
                               GPIO scelti dalla board          --> MCUboot image-1
```

Prima di scrivere il codice, distingui tre concetti Zephyr usati qui:

- **Devicetree** descrive l'hardware a build-time. Il binding
  `dts/bindings/spaghetti/spaghettilab,maintenance-link.yaml` richiede il bus normale,
  la UART e la durata massima della probe. Il DTS generato da controllare è
  `build/app/zephyr/zephyr.dts`.
- **pinctrl** seleziona a runtime una configurazione di pin preparata a build-time.
  Lo stato `default` della UART abilita solo RX, così l'inizializzazione automatica non
  pilota un sensore; lo stato conservato `sleep` contiene RX+TX e viene applicato
  esplicitamente solo in maintenance. Il build rifiuta `CONFIG_PM_DEVICE=y`, perché
  il power management non deve applicare quello stato. `CONFIG_PINCTRL_DYNAMIC=y`
  permette al Maintenance Link di selezionare i due stati.
- **mcumgr/SMP** è il protocollo di management Zephyr. Il trasporto UART aggiunge
  framing Base64 e CRC; il gruppo custom Spaghetti decide quali operazioni sono
  ammesse. I gruppi generici Shell, File System, OS e Image non vanno abilitati perché
  aggirerebbero la policy del coordinatore Update.

Apri i file board:

- `boards/spaghettilab/spaghettilab_core_v1/spaghettilab_core_v1.dts`: aggiungi
  `maintenance_link0`, scegli `uart1` come `zephyr,uart-mcumgr` e mappa UART RX su
  GPIO3 e TX su GPIO4. Sono gli stessi segnali della Port 0 I2C, quindi non possono
  essere attivi contemporaneamente.
- `boards/spaghettilab/spaghettilab_core_v2_build_only/spaghettilab_core_v2_build_only.dts`:
  descrivi lo stesso contratto con RX GPIO5 e TX GPIO6. Questa variante serve a
  dimostrare che il codice comune non conosce i numeri dei pin.
- `dts/bindings/spaghetti/spaghettilab,maintenance-link.yaml`: dichiara i phandle
  `normal-bus`, `maintenance-uart` e l'intero `bootstrap-window-ms`.

Apri `include/spaghetti/maintenance_link.h` e scrivi gli enum e le firme:

```c
enum spaghetti_maintenance_entry_reason {
	SPAGHETTI_MAINTENANCE_CONFIG_ABSENT,
	SPAGHETTI_MAINTENANCE_BOOTSTRAP_FRAME,
	SPAGHETTI_MAINTENANCE_REBOOT_REQUEST,
};

enum spaghetti_maintenance_link_state {
	SPAGHETTI_MAINTENANCE_LINK_UNINITIALIZED,
	SPAGHETTI_MAINTENANCE_LINK_NORMAL,
	SPAGHETTI_MAINTENANCE_LINK_PROBING,
	SPAGHETTI_MAINTENANCE_LINK_ACTIVE,
	SPAGHETTI_MAINTENANCE_LINK_ERROR,
};

int spaghetti_maintenance_link_init(void);
int spaghetti_maintenance_link_probe(uint32_t timeout_ms, bool *requested);
int spaghetti_maintenance_link_enter(
	enum spaghetti_maintenance_entry_reason reason);
int spaghetti_maintenance_link_leave(void);
int spaghetti_maintenance_link_set_key(const uint8_t *key, size_t key_size);
enum spaghetti_maintenance_link_state spaghetti_maintenance_link_get_state(void);
```

`timeout_ms` è per valore perché è un piccolo limite numerico. `requested` è un
puntatore scrivibile a memoria del chiamante e non viene conservato. `reason` è per
valore perché il servizio ne copia soltanto il significato diagnostico. `key` è
`const` perché viene solo letta; è presa in prestito per la durata della chiamata e
deve contenere esattamente 32 byte. Gli `int` restituiscono `0` oppure errno negativi;
il getter restituisce direttamente un enum infallibile.

Apri `subsys/services/maintenance_link/maintenance_link.c`. Usa due device Zephyr
ottenuti dai phandle, una mutex statica e uno stato atomico; nessun heap. Implementa in
questo ordine:

1. `init()` controlla `device_is_ready()`, disabilita gli interrupt UART, applica il
   pinctrl I2C e passa a `NORMAL`.
2. `probe()` rifiuta finestre oltre `bootstrap-window-ms`, applica RX-only e legge al
   massimo 40 byte. Il frame è `SPLM`, versione 1, comando 1, due byte zero e 32 byte
   HMAC-SHA256 dell'header più il device ID restituito da `hwinfo_get_device_id()`.
   La chiave per-device arriva da PSA ITS. Timeout o frame errato ripristinano I2C;
   TX non viene mai abilitato.
3. `enter()` applica RX+TX e abilita la ricezione mcumgr solo se il Core non ha avviato
   l'Engine.
4. `leave()` disabilita UART e ripristina il pinctrl I2C.
5. `set_key()` accetta la chiave solo in `ACTIVE` e la salva con PSA ITS; non loggarla.

Apri `include/spaghetti/update.h`, `subsys/services/update/update.c` e
`subsys/services/update/update_mcuboot.c` e aggiungi:

```c
int spaghetti_update_write(uint32_t offset, const uint8_t *data,
			   size_t data_size, bool last);
```

`offset` è per valore ed è l'inizio assoluto del chunk; `data` è un buffer caller-owned
preso in prestito e non modificato; `data_size` è per valore; `last` forza il flush
dell'ultimo blocco. Lo chiama solo un adapter che possiede lo stato `RECEIVING`.
Internamente verifica stato e timeout sotto mutex, poi il backend usa
`flash_img_buffered_write()`. Offset non contigui, puntatore nullo e chunk vuoti danno
`-EINVAL`; sessione scaduta dà `-ETIMEDOUT`; un errore flash porta a `ERROR`.

Apri `subsys/services/maintenance_link/maintenance_mgmt.c`. Registra il solo gruppo
SMP Spaghetti con ID 64 e buffer firmware massimi di 192 byte:

| ID | Operazione | Richiesta CBOR |
|---:|---|---|
| 0 | stato | mappa vuota in lettura |
| 1 | salva Config | `{"data": bstr}` |
| 2 | salva rete | `{"ssid": tstr, "security": uint, "passphrase": bstr}` |
| 3 | elimina rete | `{"ssid": tstr}` |
| 4 | salva chiave probe | `{"key": bstr(32)}` |
| 5 | scrive firmware | `{"offset": uint, "total": uint, "data": bstr}` |
| 6 | cancella firmware | mappa vuota |

Ogni handler controlla prima che il link sia `ACTIVE`. La Config viene decodificata e
validata prima di `spaghetti_storage_write_config()`. I profili usano il servizio
esistente e i buffer con password vengono azzerati. Il primo chunk firmware chiama
`arm()` e `begin(UART)`; ogni chunk chiama `write()`; l'ultimo chiama `finish()` e
programma il reboot 500 ms dopo, così la risposta può uscire prima del reset.

Apri `include/spaghetti/wifi_profiles.h` e
`subsys/services/wifi_profiles/wifi_profiles.c` e aggiungi:

```c
int spaghetti_wifi_profiles_init_offline(void);
```

Core la chiama in modalità `UNPROVISIONED` o `MAINTENANCE`. Carica e modifica i profili
persistenti, ma non registra callback, non avvia scan/worker e rende
`spaghetti_wifi_profiles_request_connect()` non supportata. In questo modo la base può
provisionare le credenziali senza accendere la rete.

Infine apri `subsys/core/core.c`: inizializza Maintenance Link prima delle Port; con
Config valida esegui la probe RX-only. In `NORMAL` inizializza Engine e Wi-Fi normali;
negli altri due modi inizializza i profili offline e chiama `enter(reason)`. Module e
Runtime non sono ancora partiti, quindi la Port è esclusiva durante il cambio pinmux.

## Perché è fatto così

Il firmware comune conosce ruoli logici, non GPIO. Una nuova Core cambia soltanto
DTS/pinctrl. Il gruppo SMP ristretto riusa il framing affidabile di Zephyr senza
esporre comandi capaci di scrivere o confermare immagini fuori dal coordinatore.
L'immagine va sempre in `image-1` e viene richiesta come `BOOT_UPGRADE_TEST`: MCUboot
verifica firma e integrità al riavvio e conserva il firmware confermato per rollback.

UART non offre un segnale portabile “cavo scollegato”. Se il trasferimento si interrompe,
il timeout assoluto Update elimina la secondaria incompleta; la maintenance resta in
ascolto fino al reset. La qualificazione elettrica e delle interruzioni è il task 290.

## Come si usa

Senza Config il boot mostra `mode=unprovisioned` e UART1 è subito disponibile sulla
base a 115200 8N1. Con Config valida, la base deve inviare nella finestra da 500 ms il
frame HMAC documentato in `subsys/services/maintenance_link/README.md`, oppure un
canale già autenticato può salvare il marker one-shot e riavviare.

Esempio logico di upload:

```c
spaghetti_update_arm(300000U);
spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UART);
spaghetti_update_write(0U, first_chunk, first_size, false);
spaghetti_update_write(first_size, last_chunk, last_size, true);
spaghetti_update_finish();
```

La base deve invece inviare gli stessi dati come comandi SMP ID 5; non deve chiamare
direttamente queste API C. Collegamento Core V1: TX base → GPIO3/RX Core, RX base ←
GPIO4/TX Core e massa comune. `make monitor` continua a usare USB e mostra i log, non
è il canale SMP condiviso.

## Checklist di completamento

- [x] GPIO e controller sono definiti soltanto nei DTS/pinctrl delle board.
- [x] La probe è RX-only, bounded e autenticata con chiave per-device.
- [x] Config assente avvia UART ma non Engine, scan Wi-Fi o listener di rete.
- [x] Config, credenziali e firmware usano handler bounded senza loggare segreti.
- [x] Tutti i byte firmware passano dal coordinatore Update e soltanto da esso.
- [x] Un upload interrotto scade, cancella `image-1` e conserva l'immagine attiva.

## Verifica e fine task

Esegui:

```sh
make build
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests -p native_sim/native/64 --inline-logs \
  --outdir build/twister-all --clobber-output'
./validator
./validator roadmap
```

Controlla in `build/app/zephyr/.config` che `CONFIG_MCUMGR_TRANSPORT_UART=y` e in
`build/app/zephyr/zephyr.dts` che `zephyr,uart-mcumgr` punti a UART1. La build deve
terminare senza errori, tutti i test native devono passare e i validator devono
riportare zero errori. La prova fisica di cavo interrotto, boot trial e rollback resta
esplicitamente nella matrice hardware del task 290.
