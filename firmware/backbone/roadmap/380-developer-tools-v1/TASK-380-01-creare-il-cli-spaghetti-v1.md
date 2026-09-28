# TASK-380-01 — Creare il CLI Spaghetti V1

**Stato:** ✅ DONE
**Fase:** 380 — Tool sviluppatore V1

## Cosa devo fare

### 1. Creare un comando unico senza duplicare device.py

Crea `tools/spaghetti.py`, `tools/spaghetti_protocol.py` e
`tools/tests/test_spaghetti_cli.py`. `device.py` resta owner di seriale, TLS-PSK,
discovery porte e monitor; estrai helper riutilizzabili in `tools/transports.py` solo
quando entrambi i programmi li usano.

Aggiorna `tools/requirements.txt` con versioni bounded di `cbor2` e `paho-mqtt`.
`make host-tools` continua a creare `.venv`; nessuna installazione globale.

CLI:

```text
spaghetti catalog
spaghetti status
spaghetti capabilities
spaghetti topology
spaghetti connectivity status
spaghetti connectivity lease --services wifi --duration 120s
spaghetti connectivity release
spaghetti config get [--output <config.json>]
spaghetti config validate <config.json>
spaghetti config apply <config.json> [--expected-generation <n>]
spaghetti discovery scan --port <id> [--allow-state-changing]
spaghetti discovery list
spaghetti discovery accept <candidate> --key <key>
spaghetti module command <key> <command> [field=value ...]
spaghetti update uart <signed.bin>
spaghetti update wifi <host> <signed.bin>
spaghetti update ble <device-id> <signed.bin>
spaghetti factory-reset --scope <config|network|credentials|bonds|all>
```

Ogni comando accetta `--transport serial|network|mqtt|ble`, `--credentials` dove serve e
un timeout finito. Default `auto` è ammesso solo quando esiste una scelta univoca.

### 2. Usare il catalogo per trasformare JSON in field ID

Il file utente contiene nomi leggibili:

```json
{
  "modules": [
    {
      "key": 10,
      "port": 0,
      "bay": 0,
      "power_rail": 1,
      "type": "ina219",
      "properties": {
        "i2c_address": 64,
        "shunt_milliohm": 100,
        "current_lsb_microamp": 200
      }
    }
  ],
  "schedules": [
    {"source_key": 10, "period_ms": 1000, "enabled": true}
  ],
  "rules": []
}
```

Il CLI legge catalogo dal Core, verifica il fingerprint, risolve nome → field
ID/type/range, produce Config CBOR V2 e può salvarla con `--output`. Non possiede una
tabella INA219. Se il Core non conosce tipo/campo, termina prima di inviare. `validate`
chiama VALIDATE_CONFIG sul Core e non cambia dispositivo.

`topology` stampa Flow, direzione, Port, cinque segnali, Bay e rail. Mostra
esplicitamente `unverified/manual jumper` per rail passive e `enforced` solo per
backend controllati. `--json` conserva gli stessi campi stabili consumabili
dall'editor React Flow.

`config get` salva Config, generation e hash. `config apply` usa per default la
generation appena letta; con un file ottenuto in precedenza richiede la generation
associata. Su CONFLICT non forza l'apply: mostra che la Config è cambiata e chiede di
rileggere/mergiare. Un apply identico mostra `changed=false`.

Il JSON segue la regola della fase 310: INT64/UINT64 fuori dal range JavaScript sicuro
sono stringhe decimali e il catalogo conserva il tipo. Il CLI Python non deve
normalizzarle in float o produrre un JSON incompatibile con l'SDK della fase 378.

### 3. Uniformare request, response ed errori

`spaghetti_protocol.py` implementa envelope V1, correlation monotonic random-start,
paginazione catalog/status/discovery, invalidazione cache tramite fingerprint e mapping
status V1 → testo/exit code. Non espone errno Zephyr come API. Ogni transport invia gli
stessi byte. Retry conserva correlation e request identiche, così il Core riconosce la
duplicazione. Il CLI stampa tabelle Rich ma `--json` produce output macchina stabile e
`--quiet` restituisce soltanto exit status.

Credenziali e password non compaiono in argv quando possono essere lette da prompt/file
0600. Il log debug oscura payload sensibili.

### 4. Completare i client update già previsti dal firmware

UART usa framing SMP Zephyr e gruppo Spaghetti 64 sui pin/USB disponibili; Wi-Fi usa
DTLS-PSK UDP 1337; BLE usa service/framing della fase 365. Tutti:

1. verificano localmente `imgtool verify`/header/versione;
2. leggono status/offset;
3. inviano chunk ordinati bounded;
4. mostrano percentuale e throughput;
5. cancellano la sessione su Ctrl+C quando il link esiste;
6. finalizzano come trial, mai confirmed;
7. si riconnettono e verificano versione/slot/confirmed dopo il boot.

Il client non bypassa firma MCUboot e non contiene chiavi private. Un resume è ammesso
solo se device, hash, total size e sessione coincidono; altrimenti cancel e restart.

### 5. Aggiungere Makefile ergonomico

```make
spaghetti: host-tools
	@$(HOST_VENV_PYTHON) tools/spaghetti.py $(ARGS)

config-validate: host-tools
	@$(HOST_VENV_PYTHON) tools/spaghetti.py config validate "$(CONFIG)"

config-apply: host-tools
	@$(HOST_VENV_PYTHON) tools/spaghetti.py config apply "$(CONFIG)"
```

Documenta esempi in README senza inserire credenziali. `CONFIG` è un percorso locale;
non confonderlo con simboli Kconfig.

### 6. Testare senza dispositivi

Usa i golden vector CBOR della fase 378 e un fake transport in-memory con risposte
catalog paginato, status, candidate e update
offset. Copri JSON errato, campo sconosciuto, range, timeout, correlation sbagliata,
response duplicata, INT64/UINT64 oltre il safe range, fingerprint cambiato, Config
conflict/no-op, disconnect a varie percentuali, resume mismatch, file credential con
permessi insicuri e output `--json` stabile.

## Perché è fatto così

Il catalogo rende il tool indipendente dai Module compilati. JSON è l'interfaccia
umana; CBOR è quella macchina. Un solo CLI riduce la necessità di ricordare Shell,
hex, mcumgr e dettagli dei trasporti, mentre il monitor resta specializzato.

## Come si usa

```sh
make spaghetti ARGS='catalog --transport network --host 192.168.1.23'
make config-validate CONFIG=configs/lab.json
make config-apply CONFIG=configs/lab.json
```

Dopo questa fase lo stesso JSON può essere generato o inviato dal flow Node-RED.

## Checklist di completamento

- [x] CLI usa catalogo, non tabelle driver locali.
- [x] JSON viene validato sul Core prima dell'apply e conserva gli interi a 64 bit.
- [x] Config get/apply usa generation/hash e non forza i conflict.
- [x] Serial, TLS, MQTT e BLE trasportano lo stesso envelope.
- [x] UART/DTLS/BLE update mostrano progress e verificano trial.
- [x] CLI espone capability, lease e reset con conferma esplicita.
- [x] CLI topology espone Flow/Bay/rail e distingue power advisory da enforced.
- [x] Nessun segreto entra in argv/log/repository.
- [x] Fake coprono errori, reconnect e resume.
- [x] Python supera gli stessi golden vector CBOR dell'SDK JavaScript.

## Verifica e fine task

```sh
make host-tools
.venv/bin/python -m unittest discover -s tools/tests -v
make validate
make pristine
```

Il risultato atteso è configurare e comandare un fake Core da JSON senza costruire
manualmente CBOR o conoscere un driver concreto.
