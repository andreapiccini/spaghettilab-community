# TASK-280-01 — Rendere make monitor multi-trasporto

**Stato:** ✅ DONE
**Fase:** 280 — Console remota

## Cosa devo fare

Apri `include/spaghetti/remote_console.h`: contiene il contratto pubblico per
inizializzare il servizio, impostare/cancellare la PSK locale e leggerne lo stato.
La PSK è esattamente 32 byte; `identity` è un buffer `const` lungo 1–32 byte perché il
chiamante ne mantiene ownership e l'implementazione ne salva una copia.

Apri `subsys/communication/remote_console.c`: applica la policy. Il Core chiama
`spaghetti_remote_console_init()` soltanto in modalità Normal; senza credenziale lo
stato è DISABLED, con credenziale apre il backend. Set e clear restituiscono
`-EACCES` fuori dalla Maintenance Link locale.

Apri `subsys/communication/remote_console_tls.c`: implementa un server TCP TLS 1.2
PSK sulla porta 1338, non Telnet. La credenziale dedicata è salvata in PSA ITS e non è
quella OTA. Il server accetta un client, chiude la sessione dopo cinque minuti e
inoltra soltanto:

```text
spaghetti status
spaghetti apply <config-cbor-hex>
maintenance reboot
help
```

Status e apply chiamano `spaghetti_communication_handle_request()`. Il reboot salva
prima il marker one-shot, risponde, poi usa un work ritardato. Il log backend copia
frammenti in 8 slot statici da 256 byte: se sono pieni elimina il più vecchio, quindi
Runtime non attende mai il client.

Apri `subsys/services/maintenance_link/maintenance_mgmt.c`: i command ID 10 e 11
impostano e cancellano la credenziale console via UART locale attiva. Apri anche
`subsys/communication/communication_shell.c`: per lo sviluppo, la USB fisica espone
lo stesso confine locale con `spaghetti maintenance reboot`, `spaghetti remote
provision <identity>`, `spaghetti remote clear` e `spaghetti remote status`. La PSK
viene letta con input nascosto e le API rifiutano la scrittura se la Maintenance
Link locale non è ACTIVE. Questi comandi non sono esposti dalla console TLS remota.
Apri `subsys/core/core.c`: Communication precede Remote Console e il listener non è
creato in Maintenance o Unprovisioned.

Apri `tools/device.py`: seriale e socket TLS alimentano lo stesso
`StyledSerialOutput`. Il file credenziali è JSON, deve avere permessi `0600` e contiene
identity più PSK esadecimale. Python 3.13+ autentica il dispositivo tramite handshake
PSK; non esiste un'opzione insecure.

```text
make monitor                         # auto/USB, comportamento attuale
make monitor TRANSPORT=serial PORT=/dev/...
make monitor TRANSPORT=network HOST=192.0.2.10 PORT=...
```

Ctrl+X chiude solo il monitor; Ctrl+C raggiunge la console scelta.

## Perché è fatto così

“Più canali” riguarda il trasporto, non una seconda implementazione dei comandi. Il
confine Communication mantiene lo stesso comportamento via USB e rete; cifratura e
autenticazione impediscono a un host nella LAN di ottenere una shell amministrativa.

## Come si usa

Genera una credenziale casuale locale. Il comando crea un file `0600`, non stampa la
PSK e non sovrascrive un file esistente:

```sh
make remote-console-credential \
  CREDENTIALS=.keys/core-v1-console.json IDENTITY=core-v1
make remote-console-provision PORT=/dev/cu.usbmodem1101 \
  CREDENTIALS=.keys/core-v1-console.json
```

Il secondo comando rileva la modalità corrente. Se è Normal, salva il marker
one-shot, riavvia in Maintenance, aspetta che la USB ricompaia e inserisce la PSK nel
prompt nascosto. In Maintenance o Unprovisioned la inserisce subito. Riavvia poi il
Core e trova soltanto i dispositivi che dimostrano di conoscere quella PSK:

```sh
make remote-console-list SUBNET=192.168.1.0/24 \
  CREDENTIALS=.keys/core-v1-console.json
make monitor TRANSPORT=network HOST=192.0.2.10 PORT=1338 \
  CREDENTIALS=.keys/core-v1-console.json
make remote-console-clear PORT=/dev/cu.usbmodem1101
```

La ricerca usa handshake TLS-PSK autenticati su un CIDR IPv4 esplicito: funziona
anche via VPN se quella subnet è instradata e non pubblica annunci non autenticati.

## Checklist di completamento

- [x] Serial e network condividono il formatter.
- [x] Una credenziale errata impedisce l'handshake.
- [x] Timeout e disconnessione liberano la sessione.
- [x] Log flood e client lento non bloccano il firmware.
- [x] USB di sviluppo e UART finale possono provisionare senza esporre la PSK.
- [x] La ricerca in rete restituisce solo console autenticate.

## Verifica e fine task

Esegui `make validate`, `make build` e la suite Twister. Prova poi USB, rete valida,
PSK errata, due client, perdita Wi-Fi e log flood. Il risultato atteso è una console
leggibile su entrambi i trasporti, un solo client remoto e nessun listener senza
credenziale o fuori dalla modalità Normal.
