# TASK-120-01 — Implementare Runtime V0

**Stato:** ✅ DONE
**Fase:** 120 — Runtime V0

## Prima di scrivere: concetti Zephyr

### Implementare timer e semaforo del periodo

1. **Cos’è:** `k_timer` genera una scadenza periodica; `k_sem` è un semaforo che trasferisce il segnale a un thread autorizzato a bloccare ed eseguire I/O.
2. **A cosa serve:** La callback del timer resta breve e il lavoro I2C viene eseguito fuori dal contesto di scadenza.
3. **Quando viene usato:** Il timer chiama la callback alla scadenza; la callback esegue `k_sem_give()`, mentre il thread attende con `k_sem_take()`.
4. **Build-time o runtime:** Runtime.
5. **Collegamento con questo task:** Runtime deve campionare periodicamente senza eseguire Manager o I2C dentro la callback.
6. **File reali coinvolti:** `include/spaghetti/timer.h` e `subsys/services/timer/timer.c`.
7. **Cosa guardare nei file:** Controlla inizializzazione, periodo, start/stop, semaforo ricevuto e assenza di operazioni bloccanti nella callback.
8. **Cosa non modificare:** Non leggere sensori, non pubblicare su zbus e non chiamare Manager dalla callback di `k_timer`.

### Implementare il thread di campionamento Runtime

1. **Cos’è:** Un thread Zephyr è un contesto schedulabile con entry function, stack e priorità espliciti.
2. **A cosa serve:** Esegue il lavoro che può attendere o bloccare, come `k_sem_take()`, lettura I2C e pubblicazione del campione.
3. **Quando viene usato:** Viene creato/avviato secondo la scelta del task e resta in attesa del semaforo tra due campionamenti.
4. **Build-time o runtime:** Runtime.
5. **Collegamento con questo task:** È il proprietario del ciclo di campionamento che prima viveva in `main`.
6. **File reali coinvolti:** `subsys/runtime/runtime.c`; eventuali dimensione stack e priorità configurabili appartengono al Kconfig del componente.
7. **Cosa guardare nei file:** Individua entry function, stack, priorità, attesa, uscita/stop e gestione degli errori.
8. **Cosa non modificare:** Non scegliere priorità casuali, non usare busy-wait e non passare al thread puntatori con durata insufficiente.

## Perché lo facciamo

Timer e semaforo separano la scadenza breve dal thread che può bloccare su I2C e zbus.

## Implementazione guidata

### Passo 1 — Definire l’API del task di campionamento Runtime

`include/spaghetti/runtime.h`.

Definire `spaghetti_runtime_sampling_task` con l'ID del modulo, i millisecondi del
periodo e il flag abilitato. Dichiarare Runtime init, caricare, avviare e interrompere
solo le funzioni; non aggiungere un linguaggio di scripting.

L’ID è un handle runtime già risolto: la Config persistente conserva invece
`source_key` e, durante apply, chiama `spaghetti_module_manager_get_by_key()` per
ottenere questo ID. Runtime non cerca mai “il Module della Port”.

### Passo 2 — Implementare timer e semaforo del periodo

Crea `include/spaghetti/timer.h` e `subsys/services/timer/timer.c`. L'header è
pubblico perché Runtime e Timer sono componenti distinti; l'implementazione resta
privata nel proprio sottosistema.

Avvolgi una `k_timer`. La sua callback di scadenza deve segnalare solo una `k_sem`
fornita con `k_sem_give()`. Implementare le chiamate init/start/stop delimitate e
mantenere la callback senza operazioni I2C, Manager e Data.

### Passo 3 — Implementare il thread di campionamento Runtime

`subsys/runtime/runtime.c`.

Crea un semaforo limitato e uno Runtime thread dedicato. Il thread attende con
`k_sem_take()`, chiama `spaghetti_module_manager_read(task.module_id, &sample)`, copia
`sample.bus_voltage_microvolts`, `sample.current_microamps` e
`sample.power_microwatts` in `struct spaghetti_electrical_message`, aggiunge
`k_uptime_get()` e sequence, poi chiama
`spaghetti_data_publish_electrical(&message, K_NO_WAIT)`. Definisci esplicitamente la
dimensione dello stack e la priorità.

### Passo 4 — Implementare caricamento, avvio e arresto di Runtime

`subsys/runtime/runtime.c`.

Implementare la convalida e lo stato per init/load/start/stop. Rifiutare il periodo
zero, il modulo non valido, il doppio avvio e l'arresto prima dell'avvio. Avviare e
interrompere il servizio Timer senza lavorare nella callback timer.

### Passo 5 — Integrare Runtime con Core e Config

`CMakeLists.txt`, `subsys/core/core.c` e `subsys/config/config.c`.

Aggiungere sorgenti Runtime e Timer. Inizializzare Runtime da Core. Dopo l’applicazione di Config completa
l'assegnazione del modulo, risolvere l'ID del modulo, caricare l'attività di
campionamento 1000 ms e avviare Runtime. Propagare ogni guasto.

Risolvi esattamente la `sampling.source_key`; se Port 0 contiene INA219 `0x40` e
`0x41`, scegliere la Port non sarebbe sufficiente.

### Passo 6 — Rimuovere il loop da main e verificare la cadenza

`src/main.c` e la console seriale.

Rimuovi da `main` la lettura tramite Manager, la pubblicazione tramite Data e l'attesa
periodica. Lascia soltanto l'avvio del Core e la gestione degli errori. Esegui il flash,
osserva sequenza e timestamp di almeno dieci campioni, quindi verifica che lo stop
impedisca la produzione di nuovi campioni.

### Contratti completi da scrivere

```c
struct spaghetti_runtime_sampling_task {
	spaghetti_module_id_t module_id;
	uint32_t period_ms;
	bool enabled;
};
int spaghetti_runtime_init(void);
int spaghetti_runtime_load(const struct spaghetti_runtime_sampling_task *task);
int spaghetti_runtime_start(void);
int spaghetti_runtime_stop(k_timeout_t timeout);
```

La struct è pubblica e copiata da Runtime: `module_id` è la sorgente, `period_ms` è un
periodo non nullo in millisecondi, `enabled` decide se schedularla. `task` è un prestito
`const` valido per la chiamata. `timeout` limita l’attesa dello stop. Init crea risorse
e stato STOPPED; load valida/copia solo da fermo; start rifiuta task assente o doppio
avvio; stop impedisce nuove scadenze e attende il thread. Usa `-EINVAL`, `-ENOENT`,
`-EALREADY`, `-EBUSY` e `-ETIMEDOUT`.

In `timer.h` dichiara `int spaghetti_timer_init(struct k_sem *tick_sem);`,
`int spaghetti_timer_start(uint32_t period_ms);` e `int spaghetti_timer_stop(void);`.
Il semaforo è prestato ma deve avere lifetime firmware perché la callback lo conserva.
La callback fa soltanto `k_sem_give()`. Il thread Runtime possiede lettura, costruzione
messaggio e publish; stack e priorità sono costanti Kconfig documentate.

Sequenza delle API Runtime:

1. `spaghetti_runtime_init()` è chiamata da Core al boot. Inizializza semaforo, timer,
   stato privato e thread; non avvia il periodo. Restituisce `0` o `-EIO`.
2. `spaghetti_runtime_load(task)` è chiamata da Config mentre Runtime è fermo. Valida
   puntatore, ID, periodo ed enabled, quindi copia l’intera struct; usa `-EINVAL`,
   `-ENOENT` e `-EBUSY`.
3. `spaghetti_runtime_start()` non riceve parametri: usa la copia caricata, avvia timer
   e imposta RUNNING. Restituisce `-ENOENT` senza task e `-EALREADY` se già attivo.
4. `spaghetti_runtime_stop(timeout)` ferma nuove scadenze e aspetta la conferma del
   thread per non restituire durante un’I/O. `timeout` è per valore e limita l’attesa;
   usa `-ETIMEDOUT` se il thread non si ferma.

Lo stato privato contiene la copia del task, enum STOPPED/RUNNING/STOPPING, `k_sem`,
`k_timer` e flag di uscita. Runtime possiede questi oggetti per tutto il firmware.

Il collegamento timer → semaforo deve avere questa forma:

```c
K_SEM_DEFINE(runtime_tick_sem, 0, 1);

static void runtime_timer_expiry(struct k_timer *timer)
{
	ARG_UNUSED(timer);
	k_sem_give(&runtime_tick_sem);
}

K_TIMER_DEFINE(runtime_timer, runtime_timer_expiry, NULL);
```

Il count massimo 1 fonde due scadenze se il thread è ancora occupato, evitando una
coda illimitata. La callback non chiama I2C, Manager o Data. Il thread esegue
`k_sem_take(&runtime_tick_sem, K_FOREVER)`, poi read e publish.

## Esempio d’uso

```c
const struct spaghetti_runtime_sampling_task task = {
	.module_id = module_id,
	.period_ms = 1000U,
	.enabled = true,
};
int err = spaghetti_runtime_load(&task);
if (err == 0) {
	err = spaghetti_runtime_start();
}
```

## Checklist di completamento

- [x] Definire l’API del task di campionamento Runtime.
- [x] Implementare timer e semaforo del periodo.
- [x] Implementare il thread di campionamento Runtime.
- [x] Implementare caricamento, avvio e arresto di Runtime.
- [x] Integrare Runtime con Core e Config.
- [x] Risolvere la sorgente per key e non con get-by-port.
- [x] Rimuovere il loop da main e verificare la cadenza con test nativi.

## Verifica finale

**Comandi**

```sh
make validate
make pristine
make flash
make monitor
```

**Controlla**

Flasha e misura timestamp di almeno dieci campioni: periodo 1000 ms entro la tolleranza documentata. Stop deve fermare nuovi campioni; callback timer senza I/O verificata staticamente.

**Risultato atteso**

Runtime produce un campione ogni 1000 ms e stop termina la produzione entro il timeout.

**Verifica eseguita:** validator senza errori, build pristine ESP32-C3 riuscita e
test nativi Runtime/Config superati. La verifica `flash`/`monitor` su INA219 reale
resta manuale perché richiede hardware collegato e una Config persistita.
