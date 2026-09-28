# TASK-030-01 — Implementare Port 0

**Stato:** ✅ DONE
**Fase:** 030 — Port

## Prima di scrivere: concetti Zephyr

Zephyr crea un oggetto `struct device` per ogni periferica abilitata. Questo insieme di
oggetti è il **Device Model**: il driver Zephyr possiede e inizializza gli oggetti;
Spaghetti LAB conserva soltanto puntatori e usa le API del driver.

Un **node label** è il nome davanti ai due punti in un file Devicetree. Il controller
usato qui è dichiarato come `i2c0:` nei file DTS del SoC ESP32-C3 inclusi dalla board e
viene abilitato da `boards/esp32c3_devkitm_esp32c3.overlay`. Verificalo con:

```sh
rg -n "i2c0:|spaghetti_i2c0_default|status = \"okay\"" build/zephyr/zephyr.dts
```

Le due macro che userai hanno ruoli diversi:

- `DT_NODELABEL(i2c0)` produce a build-time l’identificatore del nodo chiamato `i2c0`;
- `DEVICE_DT_GET(...)` converte quell’identificatore nel puntatore al `struct device`
  statico creato da Zephyr;
- `device_is_ready(device)` controlla a runtime che il driver e le sue dipendenze
  siano stati inizializzati.

Usiamo `i2c0` perché la fase 020 ha verificato che gli Spaghetti Port sono collegati a
quel controller, con SDA su GPIO3 e SCL su GPIO4. Non creare una `struct device` e non
chiamare direttamente l’inizializzazione del driver Zephyr.

## Perché lo facciamo

Port nasconde i dettagli della board e presta descrittori immutabili ai driver senza allocazione dinamica.

## Implementazione guidata

### Passo 1 — Definire l’identificatore di Port

`include/spaghetti/port.h`.

Aggiungi una protezione di inclusione e lo standard minimo include, quindi definisci
`typedef uint8_t spaghetti_port_id_t;`. Non esporre un tipo ESP32 o un numero GPIO.

### Passo 2 — Definire le capacità di Port

`include/spaghetti/port.h`.

Definire `enum spaghetti_port_capability` con solo `SPAGHETTI_PORT_CAP_I2C = BIT(0)`.
Aggiungere solo l'inclusione richiesta per `BIT()`.

### Passo 3 — Dichiarare l’API pubblica di Port

`include/spaghetti/port.h`.

Dichiara in anticipo `struct spaghetti_port` e `struct device`. Dichiara
`spaghetti_port_init_all()`, `spaghetti_port_count()`, `spaghetti_port_get()`,
`spaghetti_port_has_capability()` e `spaghetti_port_i2c_device()` con le firme riportate nella sezione “Contratti completi da scrivere”.

### Passo 4 — Implementare il descrittore privato di Port

`subsys/port/port.c`.

Definire campi privati `struct spaghetti_port` `id`, `capabilities` e `const struct
device *i2c`. Creare un descrittore Port 0 fisso e implementare i controlli di
conteggio, ricerca e capacità con controllo dei puntatori nulli e limiti.

> [!ATTENZIONE]
> SCORCIATOIA TEMPORANEA
>
> Questo è intenzionalmente temporaneo e verrà rimosso in
  [TASK-180-05](../180-multi-core/TASK-180-01-supportare-piu-varianti-core.md).

### Passo 5 — Associare Port 0 al device I2C

`subsys/port/port.c`.

In `spaghetti_port_init_all()`, ottieni il controller con la riga esatta
`const struct device *i2c = DEVICE_DT_GET(DT_NODELABEL(i2c0));`, memorizzalo in Port 0
solo dopo il controllo di readiness e restituisci `-ENODEV`
quando `device_is_ready()` è falso. Implementa `spaghetti_port_i2c_device()` con
controlli null e funzionalità.

### Passo 6 — Aggiungere Port alla build CMake

`CMakeLists.txt`.

Aggiungere `subsys/port/port.c` all'elenco `target_sources(app PRIVATE ...)` esistente.
Non apportare altre modifiche al sistema di compilazione.

### Passo 7 — Inizializzare Port da Core

`subsys/core/core.c`.

Chiama `spaghetti_port_init_all()` da `spaghetti_core_init()`. Propaga un risultato
negativo prima di impostare Core READY. Al successo, registra il conteggio Port e se
Port 0 ha I2C.

### Passo 8 — Provare Port con ID validi e non validi

`subsys/port/port.c`, `subsys/core/core.c` e la console seriale.

Esegui una prova su Port 0 e un ID fuori intervallo attraverso l'API pubblica. Verificare Port 0 è
pronto e l'ID non valido restituisce `NULL` senza dereferenziarlo. Provare
temporaneamente il percorso di guasto del controller disabilitato senza effettuare il
test overlay cambiamento.

### Contratti completi da scrivere

In `include/spaghetti/port.h` usa le firme letterali seguenti:

```c
typedef uint8_t spaghetti_port_id_t;
enum spaghetti_port_capability { SPAGHETTI_PORT_CAP_I2C = BIT(0) };
struct spaghetti_port;
struct device;
int spaghetti_port_init_all(void);
size_t spaghetti_port_count(void);
const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t port_id);
bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				    enum spaghetti_port_capability capability);
const struct device *spaghetti_port_i2c_device(const struct spaghetti_port *port);
```

`port_id` e `capability` sono piccoli valori copiati. `port` è un prestito in sola
lettura: Port possiede l’oggetto fino allo spegnimento. Il device restituito appartiene
al Device Model e ha la stessa lifetime statica. `get()` restituisce `NULL` per ID fuori
intervallo; `has_capability()` restituisce `false` per `NULL`; `i2c_device()` restituisce
`NULL` per `NULL` o capacità assente. `init_all()` restituisce `0` oppure `-ENODEV`.

In `subsys/port/port.c` aggiungi prima la definizione privata:

```c
struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
	const struct device *i2c;
};

static struct spaghetti_port ports[] = {
	{
		.id = 0U,
		.capabilities = SPAGHETTI_PORT_CAP_I2C,
		.i2c = NULL,
	},
};
```

- `id` identifica la Port ed è separato dall’indice per rendere esplicito il contratto;
- `capabilities` è una bitmask perché una Port potrà supportare più funzionalità
  contemporaneamente;
- `i2c` è un puntatore perché il device è posseduto dal Device Model; il tipo puntato è
  `const` perché Spaghetti LAB non deve modificare l’oggetto Zephyr;
- `ports` è `static`: Port ne possiede storage e lifetime fino allo spegnimento;
- `.i2c = NULL` distingue il catalogo dichiarato dal catalogo inizializzato.

Implementa le funzioni in quest’ordine:

1. `spaghetti_port_count()` restituisce `ARRAY_SIZE(ports)`. Non riceve parametri, non
   modifica stato e non può fallire.
2. `spaghetti_port_get(port_id)` controlla prima `port_id >= ARRAY_SIZE(ports)`; in tal
   caso restituisce `NULL`, altrimenti `&ports[port_id]`. L’ID è passato per valore
   perché occupa un byte; il puntatore restituito è `const` e preso in prestito.
3. `spaghetti_port_has_capability(port, capability)` restituisce `false` se `port` è
   `NULL`; altrimenti valuta `(port->capabilities & capability) != 0U`. Entrambi gli
   input sono in sola lettura.
4. `spaghetti_port_i2c_device(port)` restituisce `NULL` se `port` è nullo, non possiede
   la capability I2C o non è inizializzato; altrimenti restituisce `port->i2c`.
5. `spaghetti_port_init_all()` ottiene `i2c0`, chiama `device_is_ready()`, restituisce
   `-ENODEV` senza modificare `ports[0].i2c` se il controllo fallisce, assegna il
   puntatore e restituisce `0` se riesce. La chiama Core una volta durante il boot.

## Esempio d’uso

Port 0 rappresenta il controller/collegamento condiviso, non uno slot occupabile. Più
Module potranno conservare lo stesso puntatore `const struct spaghetti_port *`; la
serializzazione riguarderà le singole transazioni I2C, non l’intera lifetime Module.

```c
const struct spaghetti_port *port = spaghetti_port_get(0U);
if ((port == NULL) ||
    !spaghetti_port_has_capability(port, SPAGHETTI_PORT_CAP_I2C)) {
	return -ENOTSUP;
}
const struct device *i2c = spaghetti_port_i2c_device(port);
```

## Checklist di completamento

- [x] Definire l’identificatore di Port.
- [x] Definire le capacità di Port.
- [x] Dichiarare l’API pubblica di Port.
- [x] Implementare il descrittore privato di Port.
- [x] Associare Port 0 al device I2C.
- [x] Aggiungere Port alla build CMake.
- [x] Inizializzare Port da Core.
- [x] Provare Port con ID validi e non validi.
- [x] Port non contiene owner Module o flag occupied.

## Verifica finale

**Comandi**

```sh
make validate
make pristine
make flash
make monitor
```

**Controlla**

Esegui validator e build. Prova count=1, Port 0 valido, ID 1 nullo, capacità I2C vera e device pronto; prova anche il percorso `-ENODEV`. Fine dopo flash stabile.

**Risultato atteso**

Esiste un solo Port I2C pronto; ID o puntatori invalidi producono i valori documentati senza crash.
