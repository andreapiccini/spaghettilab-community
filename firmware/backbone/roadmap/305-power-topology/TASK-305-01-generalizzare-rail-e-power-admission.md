# TASK-305-01 — Generalizzare rail e Power admission

**Stato:** ✅ DONE
**Fase:** 305 — Power topology e admission

## Cosa devo fare

Le tre rail raggiungono ogni Function Bay separatamente dai cinque segnali. Nella
versione base un jumper seleziona fisicamente la rail e il firmware non può leggerlo
né cambiarlo; una futura versione Pro potrà usare switch, misura e limiti noti. Il
contratto deve accettare entrambi i casi senza fingere sicurezza sulla base passiva.

Apri `include/spaghetti/power.h`, `subsys/power/power.c`, crea il binding
`dts/bindings/spaghetti/spaghettilab,power-rail.yaml` e amplia `tests/power/`.
Mantieni le API acquire/release della fase 190 per l'ownership elettrica e aggiungi:

```c
#define SPAGHETTI_POWER_RAIL_UNSPECIFIED UINT8_MAX

typedef uint8_t spaghetti_power_rail_id_t;

enum spaghetti_power_assurance {
	SPAGHETTI_POWER_UNMANAGED,
	SPAGHETTI_POWER_SWITCHED,
	SPAGHETTI_POWER_SWITCHED_AND_MEASURED,
};

struct spaghetti_power_rail_descriptor {
	spaghetti_power_rail_id_t id;
	enum spaghetti_power_assurance assurance;
	uint32_t min_microvolts;
	uint32_t max_microvolts;
	uint32_t max_total_microamps;
};

struct spaghetti_module_power_requirement {
	bool declared;
	uint32_t min_microvolts;
	uint32_t max_microvolts;
	uint32_t max_microamps;
};

struct spaghetti_power_binding {
	spaghetti_flow_id_t flow_id;
	spaghetti_bay_id_t bay_id;
	spaghetti_power_rail_id_t rail_id;
};

struct spaghetti_bay_power_descriptor {
	spaghetti_flow_id_t flow_id;
	spaghetti_bay_id_t bay_id;
	uint32_t available_rail_mask;
};

enum spaghetti_power_admission_state {
	SPAGHETTI_POWER_ADMISSION_NOT_REQUIRED,
	SPAGHETTI_POWER_ADMISSION_UNVERIFIED,
	SPAGHETTI_POWER_ADMISSION_ENFORCED,
};

size_t spaghetti_power_rail_count(void);
const struct spaghetti_power_rail_descriptor *spaghetti_power_rail_get(
	spaghetti_power_rail_id_t id);
int spaghetti_power_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_power_descriptor *out);
int spaghetti_power_validate_binding(
	const struct spaghetti_power_binding *binding,
	const struct spaghetti_module_power_requirement *requirement,
	enum spaghetti_power_admission_state *out_state);
int spaghetti_power_attach(
	const struct spaghetti_power_binding *binding,
	spaghetti_power_owner_id_t owner,
	const struct spaghetti_module_power_requirement *requirement,
	enum spaghetti_power_admission_state *out_state);
int spaghetti_power_detach(
	const struct spaghetti_power_binding *binding,
	spaghetti_power_owner_id_t owner);
```

Descrittori e requirement sono borrowed; `out_state` è caller-owned. Voltage/current
sono interi in micro-unità per evitare float. Zero in un limite del descrittore
significa **sconosciuto**, non zero volt o zero ampere. `declared=false` significa che
il driver non offre dati verificabili e deve produrre `UNVERIFIED`, non un errore.

`available_rail_mask` indica quali rail sono fisicamente portate a quella Bay; il bit
`1U << rail_id` è valido solo con `rail_id < 32`. `bay_get()` copia il descrittore
caller-owned e restituisce `-ENOENT` se la board non dichiara quel collegamento.

Per una rail `UNMANAGED`, `validate_binding()` controlla esistenza di Flow, Bay, rail
e relativo bit nella mask, quindi restituisce `UNVERIFIED`: non rifiuta una
configurazione per tensione/corrente,
non sostiene di conoscere il jumper e non aziona hardware. Per rail controllate, se
requirement e limiti sono dichiarati, verifica intervallo di tensione e somma bounded
delle correnti già ammesse; incompatibilità restituisce `-ERANGE` o `-ENOSPC` prima di
abilitare. `attach()` abilita la rail al primo owner solo per backend realmente
presente e fa rollback su errore. `detach()` rimuove l'owner e porta il backend nel
safe state all'ultimo owner. Restituisci anche `-EINVAL`, `-ENOENT`, `-EALREADY`,
`-ENOMEM`, `-ENOTSUP` e gli errori backend originali.

Il binding dichiara ID, assurance e limiti opzionali. GPIO di enable, ADC di misura e
power switch sono proprietà opzionali della board; non inserire valori fittizi nella
board corrente. La base con jumper dichiara rail `UNMANAGED` solo quando lo schema
elettrico ne conferma l'esistenza; lascia limiti a zero finché tensione massima,
corrente totale e corrente per Bay non sono congelate.

Esempio d'uso che verrà inserito nel Module Manager dal task 320:

```c
enum spaghetti_power_admission_state state;
int err = spaghetti_power_attach(&request->power, module->id,
				 &module->driver->power_requirement, &state);

if (err == 0 && state == SPAGHETTI_POWER_ADMISSION_UNVERIFIED) {
	LOG_WRN("module=%u uses an unmanaged power selection", module->key);
}
```

In questa fase prova la sequenza con un owner fake. Il task 320 farà eseguire al
Manager attach prima di `driver->ops->init()` e detach dopo `deinit()` o nel rollback;
il task 330 userà `validate_binding()` durante Config validate. Nessun driver chiama
direttamente Power.

## Perché è fatto così

Il modello base deve rimanere economico e utilizzabile, ma non deve presentare un
jumper come protezione firmware. La stessa API diventa rigida automaticamente su un
Core Pro solo quando board e Module dichiarano dati verificabili. I limiti non ancora
decisi restano esplicitamente sconosciuti.

## Come si usa

Un driver dichiara i propri requisiti una volta. Config sceglie Bay e rail. Su base
passiva React Flow mostra “unverified/manual jumper”; su hardware controllato il Core
rifiuta prima dell'attivazione una combinazione incompatibile e pubblica lo stato
`ENFORCED`.

## Checklist di completamento

- [x] Rail passive, switched e measured usano lo stesso contratto.
- [x] Ogni Bay espone una mask bounded delle rail realmente raggiungibili.
- [x] Zero significa limite sconosciuto e non produce falsa sicurezza.
- [x] Base passiva accetta Module non dichiarati e segnala `UNVERIFIED`.
- [x] Backend controllato applica tensione/corrente solo con dati completi.
- [x] Attach/detach e rollback backend hanno ordine verificato con owner fake.
- [x] Test coprono jumper passivo, Pro rigido, overcurrent e backend assente.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/power -p native_sim/native/64 \
  --inline-logs --clobber-output'
make pristine
```

Il risultato atteso è che la stessa Config sia advisory su una base passiva e venga
validata rigidamente su un fake Core Pro, senza numeri elettrici inventati.
