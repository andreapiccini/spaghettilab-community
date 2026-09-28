# TASK-140-01 — Aggiungere la comunicazione Shell

**Stato:** ✅ DONE
**Fase:** 140 — Communication

## Prima di scrivere: concetti Zephyr

### Abilitare Zephyr Shell

1. **Cos’è:** Zephyr Shell è un sottosistema che interpreta comandi testuali e chiama handler C registrati.
2. **A cosa serve:** Fornisce il primo trasporto locale per provare Communication senza introdurre subito rete o MQTT.
3. **Quando viene usato:** Kconfig include Shell nella build; a runtime il relativo thread riceve caratteri dalla console e invoca gli handler.
4. **Build-time o runtime:** Selezione a build-time, comandi a runtime.
5. **Collegamento con questo task:** Il task abilita l’infrastruttura; l’adattatore Spaghetti LAB viene implementato nel task successivo.
6. **File reali coinvolti:** `prj.conf` e l’overlay/configurazione della console già esistente.
7. **Cosa guardare nei file:** Controlla `CONFIG_SHELL`, backend seriale selezionato e device console effettivo.
8. **Cosa non modificare:** Non cambiare la console, non conservare `argv` dopo il ritorno dell’handler e non eseguire lavoro lungo o non limitato.

## Perché lo facciamo

Il dispatch è indipendente dalla Shell, così un trasporto futuro riusa gli stessi messaggi e la stessa validazione.

## Implementazione guidata

### Passo 1 — Definire messaggi Communication a dimensione limitata

`include/spaghetti/communication.h`.

Definire i tipi di richiesta e risposta limitati solo per `GET_STATUS` e `SET_CONFIG`.
Rappresentare SET_CONFIG payload come buffer di byte più lunghezza, non campi
analizzati, e definire le dimensioni massime esplicite.

### Passo 2 — Dichiarare e implementare il dispatch delle richieste

`include/spaghetti/communication.h` e `subsys/communication/communication.c`.

Dichiarare Communication init e handle-request API più una risposta limitata contratto
return/callback. Implementare l'invio per i segnaposto GET_STATUS e SET_CONFIG con
rigoroso comando, puntatore e convalida della lunghezza.

GET_STATUS non può mostrare “il Module della Port”. Per ogni Port chiama
`spaghetti_module_manager_list_by_port(port_id, NULL, 0U, &count)`, poi usa un array
bounded fino a `CONFIG_SPAGHETTI_MAX_MODULES` e restituisce key, runtime ID, type,
endpoint e stato di ogni snapshot.

### Passo 3 — Abilitare Zephyr Shell

`prj.conf` e `boards/esp32c3_devkitm_esp32c3.overlay`.

Abilita `CONFIG_SHELL=y` e verifica la shell scelta esistente UART rimane `usb_serial`.
Aggiungi solo le dipendenze richieste dalla shell riportate da Kconfig installata; non
cambiare il dispositivo di lavoro della console.

### Passo 4 — Implementare l’adattatore di trasporto Shell

Crea `subsys/communication/communication_shell.c`.

Registrare `spaghetti status` e comandi `spaghetti apply <hex>` limitati. Convalidare il
conteggio degli argomenti, anche la lunghezza esadecimale, la validità del carattere e
decodificare il massimo prima di costruire una richiesta Communication e chiamare
direttamente il gestore.

### Passo 5 — Inizializzare Communication da Core

`CMakeLists.txt`, `subsys/core/core.c` e `subsys/communication/communication.c`.

Aggiungi Communication e le sorgenti dell'adattatore di shell a CMake. Inizializza
Communication da Core dopo le dipendenze richieste state/config e propaga gli errori di
inizializzazione.

### Passo 6 — Provare stato e input Shell non valido

La shell seriale USB e la console seriale.

Eseguire `spaghetti status`, un sottocomando sconosciuto, argomenti mancanti, hex
dispari, hex non valido e un payload sovradimensionato. Confermare lo stato valido
restituisce dati limitati e ogni comando non valido restituisce senza cambiare Config.

### Contratti completi da scrivere

```c
#define SPAGHETTI_COMM_PAYLOAD_MAX 256U
enum spaghetti_request_type { SPAGHETTI_REQUEST_GET_STATUS, SPAGHETTI_REQUEST_SET_CONFIG };
struct spaghetti_request { uint32_t correlation_id; enum spaghetti_request_type type; size_t payload_size; uint8_t payload[SPAGHETTI_COMM_PAYLOAD_MAX]; };
struct spaghetti_response { uint32_t correlation_id; int status; size_t payload_size; uint8_t payload[SPAGHETTI_COMM_PAYLOAD_MAX]; };
int spaghetti_communication_init(void);
int spaghetti_communication_handle_request(const struct spaghetti_request *request,
					    struct spaghetti_response *response);
```

Le struct sono pubbliche, limitate e possedute dal chiamante. `request` è un prestito
`const`; `response` è output non `const`, riempito solo dopo validazione. La funzione
restituisce `0` se ha prodotto una risposta, `-EINVAL` per puntatori/lunghezze,
`-EMSGSIZE` per payload eccessivo e `-ENOTSUP` per comando sconosciuto. GET_STATUS
legge Core; SET_CONFIG inoltra i bytes al decoder senza interpretarli.

Abilita Shell in `prj.conf`. L’adattatore `communication_shell.c` registra il comando
`spaghetti status` e `spaghetti apply <hex>`; valida una lunghezza pari, converte al
massimo 256 byte, costruisce request sullo stack e stampa status/correlation ID. Non
mettere logica Config nel callback Shell.

Significato dei campi:

- `correlation_id`: viene copiato nella risposta per associare richiesta e risultato;
- `type`: seleziona l’unico handler ammesso, senza confrontare stringhe nel dominio;
- `payload_size`: dichiara quanti byte iniziali dell’array sono validi;
- `payload`: array interno, quindi la richiesta non dipende dalla lifetime di `argv`;
- `status`: contiene l’errno dell’operazione richiesta, separato dall’errno del dispatch.

`spaghetti_communication_init()` è chiamata da Core dopo Config; inizializza contatori
e adattatore Shell e restituisce `0` o l’errno dell’adattatore. `handle_request()` è
chiamata dal thread Shell: azzera una risposta temporanea, valida request/type/size,
copia correlation ID, esegue GET_STATUS o SET_CONFIG, poi copia la risposta completa
nell’output. Non conserva nessun puntatore.

In `communication_shell.c` usa handler con la firma Zephyr
`static int cmd_status(const struct shell *shell, size_t argc, char **argv)` e analoga
per `cmd_apply`. `shell` è prestato da Zephyr; `argv` e le stringhe valgono solo durante
la callback. Registra i comandi con `SHELL_STATIC_SUBCMD_SET_CREATE` e
`SHELL_CMD_REGISTER`; gli handler costruiscono request locali e non chiamano Manager.

```c
SHELL_STATIC_SUBCMD_SET_CREATE(
	spaghetti_subcommands,
	SHELL_CMD(status, NULL, "Mostra lo stato", cmd_status),
	SHELL_CMD(apply, NULL, "Applica CBOR esadecimale", cmd_apply),
	SHELL_SUBCMD_SET_END
);
SHELL_CMD_REGISTER(spaghetti, &spaghetti_subcommands,
		   "Comandi Spaghetti LAB", NULL);
```

Il primo argomento di `SHELL_CMD` è il testo digitato e l’ultimo è la callback. Il
comando root non esegue lavoro proprio, quindi il suo handler è `NULL`.

## Esempio d’uso

```c
struct spaghetti_request request = {
	.correlation_id = 1U,
	.type = SPAGHETTI_REQUEST_GET_STATUS,
	.payload_size = 0U,
};
struct spaghetti_response response;
int err = spaghetti_communication_handle_request(&request, &response);
```

## Checklist di completamento

- [x] Definire messaggi Communication a dimensione limitata.
- [x] Dichiarare e implementare il dispatch delle richieste.
- [x] GET_STATUS rappresenta zero o più Module per Port.
- [x] Abilitare Zephyr Shell.
- [x] Implementare l’adattatore di trasporto Shell.
- [x] Inizializzare Communication da Core.
- [x] Provare stato e input Shell non valido con test nativo.

## Verifica finale

**Comandi**

```sh
make validate
make pristine
make flash
make monitor
```

**Controlla**

Dalla Shell prova status, comando sconosciuto, hex dispari/non valido e payload oltre 256 byte. Input errato non modifica Config; una richiesta valida produce correlation ID e stato coerenti.

**Risultato atteso**

La Shell produce risposte limitate e nessun input malformato modifica Config.

**Verifica eseguita:** validator e build pristine ESP32-C3 superati; test nativo
Communication/Shell superato. `SET_CONFIG` restituisce intenzionalmente
`response.status = -ENOTSUP` fino al task 150, che introduce il decoder CBOR; in
questa fase nessun payload opaco viene interpretato o applicato.
