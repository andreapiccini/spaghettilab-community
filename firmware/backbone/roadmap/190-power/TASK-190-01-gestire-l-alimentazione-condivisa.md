# TASK-190-01 — Gestire l’alimentazione condivisa

**Stato:** ✅ DONE

**Fase:** 190 — Power

## Cosa devo fare

Prima verifica i file hardware reali:

- `boards/spaghettilab/spaghettilab_core_v1/spaghettilab_core_v1.dts`;
- `dts/bindings/spaghetti/spaghettilab,port.yaml`;
- lo schema elettrico della revisione fisica.

Core V1 espone I2C su GPIO3/GPIO4, ma nei file verificati non esiste un segnale enable
per una rail. Non aggiungere un `power-gpios` immaginario: polarità, pin e safe state
sarebbero dati hardware non dimostrati. Per questa board Power deve rimanere disabilitato
con `CONFIG_SPAGHETTI_POWER=n`.

Apri `include/spaghetti/power.h` e definisci questi tipi pubblici:

```c
typedef uint8_t spaghetti_power_resource_id_t;
typedef uint8_t spaghetti_power_owner_id_t;

#define SPAGHETTI_POWER_OWNER_INVALID UINT8_MAX

enum spaghetti_power_state {
	SPAGHETTI_POWER_OFF,
	SPAGHETTI_POWER_STARTING,
	SPAGHETTI_POWER_ON,
	SPAGHETTI_POWER_STOPPING,
	SPAGHETTI_POWER_ERROR,
};

struct spaghetti_power_status {
	enum spaghetti_power_state state;
	uint16_t reference_count;
	int last_error;
};
```

`resource_id` identifica una futura rail fisica. `owner_id` identifica un Module vivo,
non una Port: due Module I2C sulla stessa Port sono proprietari distinti. I due ID sono
passati per valore perché sono interi piccoli. `spaghetti_power_status` è pubblica e
contiene una snapshot copiata; il chiamante possiede la propria copia.

Scrivi le API:

```c
int spaghetti_power_init(void);
int spaghetti_power_acquire(spaghetti_power_resource_id_t id,
			    spaghetti_power_owner_id_t owner);
int spaghetti_power_release(spaghetti_power_resource_id_t id,
			    spaghetti_power_owner_id_t owner);
int spaghetti_power_get_status(spaghetti_power_resource_id_t id,
			       struct spaghetti_power_status *out);
```

- `spaghetti_power_init()` porta ogni risorsa compilata nello stato sicuro OFF. Core la
  chiamerà al boot soltanto su una board che abilita Power. Restituisce `0`,
  `-EALREADY` oppure l’errore del backend.
- `spaghetti_power_acquire(id, owner)` viene chiamata dal Manager prima di inizializzare
  il driver. Accende soltanto sul passaggio da zero a un owner, poi registra l’owner.
  Restituisce `-ENOENT`, `-EALREADY`, `-ENOSPC` o l’errore di accensione quando serve.
- `spaghetti_power_release(id, owner)` viene chiamata dopo `deinit()` o nel rollback.
  Spegne soltanto all’ultimo owner. Se lo spegnimento fallisce non elimina owner e count,
  così la chiamata può essere ripetuta.
- `spaghetti_power_get_status(id, out)` copia stato, count ed errore in `out`. Il
  puntatore è modificabile perché la funzione deve scriverci; memoria e lifetime sono
  del chiamante. Restituisce `-EINVAL` se è `NULL`.

Apri `subsys/power/power.c`. Crea una struct privata per risorsa con ID, stato, array
fisso di otto owner, count, ultimo errore e `k_mutex`. Power possiede questi oggetti per
tutta la vita del firmware. Non usare heap. Sotto mutex implementa questa sequenza:

1. valida inizializzazione, resource ID e owner;
2. rifiuta un owner duplicato e il nono owner;
3. su acquire 0→1 chiama il backend ON e registra l’owner solo dopo il successo;
4. sugli acquire intermedi aggiorna soltanto array e count;
5. su release intermedie elimina soltanto l’owner richiesto;
6. su release 1→0 chiama il backend OFF e cancella l’owner solo dopo il successo;
7. conserva `SPAGHETTI_POWER_ERROR` e `last_error` quando una transizione fallisce.

Il `k_mutex` è una primitive Zephyr runtime che serializza thread concorrenti. Queste
API sono quindi thread-only: non chiamarle da ISR.

Apri `subsys/power/power_internal.h`. Dichiara il solo hook del test quando
`CONFIG_SPAGHETTI_POWER_FAKE_BACKEND=y`:

```c
int spaghetti_power_backend_set(spaghetti_power_resource_id_t id, bool enabled);
```

Il test possiede l’implementazione fake dell’hook. Non esiste alcun backend GPIO nella
build reale finché una futura board non dichiara un controllo verificato.

Apri `Kconfig` e aggiungi `SPAGHETTI_POWER`, disabilitato di default, più l’opzione
interna `SPAGHETTI_POWER_FAKE_BACKEND`. Apri `CMakeLists.txt` e compila
`subsys/power/power.c` solo con `CONFIG_SPAGHETTI_POWER=y`.

Apri `tests/power/src/main.c` e prova una risorsa fake con due owner Module `10` e `11`.
Verifica entrambi gli ordini, duplicato, owner assente, limite di otto, fallimento ON e
fallimento OFF. Il test deve dimostrare che count e ownership restano coerenti dopo gli
errori. Gli altri file del test sono `tests/power/CMakeLists.txt`, `Kconfig`, `prj.conf`
e `testcase.yaml`.

Non modificare `subsys/module_manager/module_manager.c` su Core V1: non esiste una
risorsa reale da associare a una Port o a un Module. Una futura board con rail
controllabile aggiungerà il descrittore hardware e solo allora Manager userà il Module
ID come owner prima di `driver->ops->init()` e lo rilascerà dopo `deinit()` o rollback.

## Perché è fatto così

Il reference counting impedisce che un Module spenga una rail ancora usata da un altro.
La tabella fissa rende memoria e limite deterministici. Commit dopo successo e rollback
esplicito impediscono che lo stato software dichiari una transizione hardware mai
avvenuta. Lasciare Power disabilitato su Core V1 evita di trasformare un’ipotesi sullo
schema in codice capace di pilotare il pin sbagliato.

## Come si usa

Su una futura board che dichiara la risorsa `0`, Manager userà una sequenza equivalente:

```c
int err = spaghetti_power_acquire(0U, module->id);

if (err == 0) {
	err = module->driver->ops->init(module, config, config_size);
	if (err < 0) {
		(void)spaghetti_power_release(0U, module->id);
	}
}
```

`module->id` distingue due INA219 sulla stessa Port; `0U` identifica la rail condivisa,
non il bus né il Module. Questo esempio documenta l’integrazione futura e non è attivo
su Core V1.

## Checklist di completamento

- [x] Verificato che Core V1 non dichiara una rail controllabile.
- [x] Definiti API, stati, owner distinti e contratto errno.
- [x] Implementato reference counting deterministico senza heap.
- [x] Provati due owner sulla stessa Port, limiti e rollback con backend fake.
- [x] Power disabilitato nella build reale finché manca hardware verificato.
- [x] Backend GPIO e integrazione Manager non applicabili a Core V1 e non inventati.

## Verifica e fine task

Esegui:

```sh
./validator
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/power -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```

Il validator deve terminare senza errori. Twister deve eseguire una configurazione e un
test con risultato `passed`. La build Core V1 deve riuscire con
`CONFIG_SPAGHETTI_POWER` non impostato e non deve contenere un falso controllo GPIO.
