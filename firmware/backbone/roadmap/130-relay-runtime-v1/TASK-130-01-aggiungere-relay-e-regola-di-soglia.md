# TASK-130-01 — Aggiungere Relay e la regola di soglia

**Stato:** ✅ DONE
**Fase:** 130 — Relay + Runtime V1

## Prima di scrivere: concetti Zephyr

### Valutare la corrente nel thread Runtime

1. **Cos’è:** `k_msgq` è una coda Zephyr a capacità e dimensione elemento fisse; copia ogni messaggio nel proprio buffer.
2. **A cosa serve:** Permette a un producer di consegnare dati a un thread consumer senza condividere memoria temporanea.
3. **Quando viene usato:** Il producer inserisce a runtime; il thread Runtime attende o estrae secondo il timeout scelto.
4. **Build-time o runtime:** Runtime.
5. **Collegamento con questo task:** Il message subscriber zbus consegna copie dei campioni elettrici al thread che valuta la soglia di corrente.
6. **File reali coinvolti:** `subsys/runtime/runtime.c` e le dichiarazioni zbus in `subsys/data/data.c`.
7. **Cosa guardare nei file:** Controlla dimensione elemento, profondità, timeout e comportamento quando la coda è piena.
8. **Cosa non modificare:** Non inserire puntatori a stack, non usare una coda non limitata e non comandare il Relay dalla callback zbus.

## Perché lo facciamo

Il relay resta un Module; Runtime applica una sola regola deterministica senza comandare direttamente l’hardware.

## Implementazione guidata

### Passo 1 — Definire il contratto dei comandi Relay

`spaghetti_modules/relay/relay.h` e `include/spaghetti/module_driver.h`.

Aggiungi alla tabella delle operazioni del driver soltanto
`command(module, command, value)`, necessaria per impostare un valore booleano. Definisci
i tipi minimi per comando e valore del relè. Polarità e configurazione hardware restano
private nel driver e devono riferirsi a una capacità reale della Port.

### Passo 2 — Implementare ciclo di vita e comando sicuro del Relay

`spaghetti_modules/relay/relay.c` e le API Port/GPIO verificate.

Implementa `init` in modo che il relè assuma subito lo stato sicuro verificato.
Implementa il comando ON/OFF e fai in modo che `deinit` ripristini lo stato sicuro.
Accedi all'hardware tramite Port, senza numeri GPIO specifici della scheda, e propaga
gli errori hardware reali.

Implementa anche `validate_config()` e `describe_endpoint()`. Se il Relay usa in modo
esclusivo la risorsa della Port, restituisci `SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE`; se la
Port espone linee indirizzabili, restituisci kind/value verificati. Il context Relay
proviene da uno slab statico tipizzato del driver, non dal Manager.

### Passo 3 — Registrare e compilare il driver Relay

`subsys/driver_registry/driver_registry.c` e `CMakeLists.txt`.

Aggiungi il descrittore immutabile del driver Relay al Registry e includi il relativo
sorgente in CMake. Estendi i controlli del Registry per rilevare duplicati e operazioni
mancanti nel percorso dei comandi, senza ridurre i controlli già previsti per INA219.

### Passo 4 — Instradare i comandi tramite Module Manager

`include/spaghetti/module_manager.h` e `subsys/module_manager/module_manager.c`.

Dichiara e implementa `spaghetti_module_manager_command()`. Prima di chiamare il driver,
verifica l'ID del modulo, lo stato READY, il supporto dell'operazione e la validità del
valore. Aggiungi il modulo Relay alla configurazione di test usando soltanto hardware
già verificato.

### Passo 5 — Definire una regola di soglia

`include/spaghetti/runtime.h`.

Definisci `spaghetti_runtime_threshold_rule` con modulo sorgente, soglie superiore e
inferiore in µA, ID del relè e stato da applicare sopra la soglia. Le due soglie creano
isteresi. Dichiara `spaghetti_runtime_load_threshold_rule()` e limita questa versione a
una sola regola.

Nel modello Config salva `source_key` e `relay_key`. Durante apply risolvile con
`spaghetti_module_manager_get_by_key()` e costruisci la struct Runtime con gli ID
correnti. Non salvare la sola Port come riferimento alla regola.

### Passo 6 — Valutare la corrente nel thread Runtime

`subsys/runtime/runtime.c` e `subsys/data/data.c`.

Fai ricevere al thread Runtime `struct spaghetti_electrical_message` tramite il message
subscriber zbus già creato. Nel thread valuta `current_microamps`: sopra 500000 µA
richiedi `relay_on_above`; sotto 450000 µA richiedi il valore opposto; tra le due soglie
mantieni l’ultimo stato. Chiama il Manager soltanto quando lo stato desiderato cambia.

### Passo 7 — Provare soglia e stato sicuro del Relay

L'hardware Relay reale, l'ingresso di test Runtime e la console seriale.

Inietta 449999, 450000, 475000, 500000 e 500001 µA. Verifica i confronti stretti,
l’isteresi, l’assenza di comandi duplicati, lo stato sicuro durante init/deinit e un
errore controllato quando il Relay non è disponibile. Usa il carico reale soltanto se
500 mA è entro i limiti elettrici verificati; la prova logica può usare messaggi fake.

### Contratti completi da scrivere

```c
enum spaghetti_command_type { SPAGHETTI_COMMAND_RELAY_SET };
struct spaghetti_command { enum spaghetti_command_type type; bool relay_on; };
struct spaghetti_relay_config { bool active_high; bool safe_on; };
int spaghetti_module_manager_command(spaghetti_module_id_t id,
				     const struct spaghetti_command *command);
struct spaghetti_runtime_threshold_rule {
	spaghetti_module_id_t source_id;
	int32_t lower_current_microamps;
	int32_t upper_current_microamps;
	spaghetti_module_id_t relay_id;
	bool relay_on_above;
};
int spaghetti_runtime_load_threshold_rule(
	const struct spaghetti_runtime_threshold_rule *rule);
```

Command e config sono pubblici e copiabili; i bool sono valori logici indipendenti
dalla polarità elettrica. `command` e `rule` sono prestiti `const` validi durante la
chiamata e vengono copiati se conservati. Manager valida ID/READY/ops e inoltra al
driver. Il context Relay privato conserva config e ultimo stato noto per la lifetime
dello slot. Init porta subito l’uscita a `safe_on`; command traduce stato logico e
polarità e aggiorna la cache solo dopo GPIO riuscito; deinit ripristina lo stato sicuro.

Runtime possiede una sola copia della regola. Richiede
`0 <= lower_current_microamps < upper_current_microamps`. Per ogni messaggio della
sorgente usa `>` sulla soglia alta e `<` sulla soglia bassa; nell’intervallo mantiene
l’ultimo comando. Non valuta bus voltage o power in questa regola V1.

Dettaglio campi:

- `command.type` distingue SET da futuri comandi senza interpretare un bool isolato;
- `relay_on` è lo stato logico richiesto, indipendente dal livello GPIO;
- `active_high` traduce ON nel livello elettrico corretto;
- `safe_on` decide lo stato imposto durante init, deinit ed errori;
- `source_id` e `relay_id` legano regola e istanze Manager;
- `lower_current_microamps` e `upper_current_microamps` usano la stessa unità del
  messaggio Data e impediscono commutazioni rapide vicino alla soglia;
- `relay_on_above` decide l’azione nel ramo strettamente sopra soglia.

`spaghetti_module_manager_command(id, command)` è chiamata dal thread Runtime; valida
puntatore, ID, READY e callback, poi inoltra sincronicamente. L’ID è per valore, il
comando è un prestito `const` e non viene conservato. `load_threshold_rule(rule)` è
chiamata da Config solo a Runtime fermo; valida entrambi i Module e copia la struct.
Entrambe restituiscono `0` o errno negativi precisi (`-EINVAL`, `-ENOENT`, `-ENOTSUP`,
`-EBUSY` e errori GPIO/driver).

## Esempio d’uso

```c
const struct spaghetti_runtime_threshold_rule rule = {
	.source_id = ina219_module_id,
	.lower_current_microamps = 450000,
	.upper_current_microamps = 500000,
	.relay_id = relay_module_id,
	.relay_on_above = true,
};
int err = spaghetti_runtime_load_threshold_rule(&rule);
```

## Checklist di completamento

- [x] Definire il contratto dei comandi Relay.
- [x] Implementare ciclo di vita e comando sicuro del Relay.
- [x] Descrivere endpoint e usare un context slab per-driver.
- [x] Registrare e compilare il driver Relay.
- [x] Instradare i comandi tramite Module Manager.
- [x] Definire una regola di soglia.
- [x] Risolvere source/relay key nei rispettivi runtime ID.
- [x] Valutare la corrente nel thread Runtime.
- [x] Provare soglia e stato sicuro del Relay con GPIO fake.

## Verifica finale

**Comandi**

```sh
make validate
make pristine
make flash
make monitor
```

**Controlla**

Con fake GPIO prova safe state, polarità, deinit ed errori; poi verifica i cinque valori
di corrente indicati. Nessun comando duplicato e rollback sempre sicuro.

**Risultato atteso**

Il relay parte/termina sicuro e segue le soglie 450/500 mA con isteresi deterministica.

**Verifica eseguita:** validator e build pristine ESP32-C3 superati; test nativi
Relay, Runtime, Config e Module Manager superati. La prova su Relay reale resta
volutamente sospesa: l'overlay ESP32-C3 corrente non dichiara una Port GPIO verificata
e non è stato inventato un pin. Il driver restituisce `-ENOTSUP` su Port 0.
