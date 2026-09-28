# TASK-100-01 — Rendere Config persistente

**Stato:** ✅ DONE
**Fase:** 100 — Config persistente

## Prima di scrivere: concetti Zephyr

### Verificare e definire la partizione di storage

Le partizioni Flash sono un layout hardware di tempo di compilazione. Un offset errato
può sovrascrivere il firmware, quindi i confini di partizione e DTS generati devono
essere ispezionati prima dell'uso.

### Abilitare Zephyr Settings e il relativo backend

1. **Cos’è:** Settings è l’API key/value di Zephyr. NVS e ZMS sono backend che memorizzano quei valori su flash con organizzazioni diverse.
2. **A cosa serve:** Separa il contratto con cui Config salva un record dal formato fisico usato nella partizione.
3. **Quando viene usato:** Kconfig sceglie Settings e il backend durante la build; inizializzazione, lettura e scrittura avvengono a runtime.
4. **Build-time o runtime:** Selezione a build-time, persistenza a runtime.
5. **Collegamento con questo task:** La partizione `storage` è stata verificata nel task precedente; ora puoi collegarla a un backend reale.
6. **File reali coinvolti:** `prj.conf`; la partizione resta nel file Devicetree/partition già definito.
7. **Cosa guardare nei file:** Leggi l’help Kconfig delle opzioni `CONFIG_SETTINGS`, `CONFIG_SETTINGS_NVS` o dell’alternativa disponibile nella versione installata.
8. **Cosa non modificare:** Non abilitare contemporaneamente backend casuali, non cambiare la partizione e non salvare ancora storico misure o segreti.

## Perché lo facciamo

La persistenza salva il modello Config già validato; non introduce un secondo modello di configurazione.

Salva key, Port, type e driver config di ogni elemento. Non salva
`spaghetti_module_id_t`, puntatori context o l’idea di una sola istanza per Port.

## Implementazione guidata

### Passo 1 — Definire l’API di storage sincrono

Crea `include/spaghetti/storage.h`. L'header deve stare nell'area pubblica perché Core,
che è un altro componente, usa questa API. Il record fisico resta invece privato in
`subsys/services/storage/storage.c`.

Dichiara `spaghetti_storage_init()`, `spaghetti_storage_read_config()` e
`spaghetti_storage_write_config()` intorno a un record fisso versione. Definisci
proprietario buffer/snapshot esplicito e codici di ritorno realistici.

### Passo 2 — Implementare e provare il backend storage RAM

Crea `subsys/services/storage/storage.c`; usa `src/main.c` per la prova temporanea del
backend RAM.

Implementare un record fisso in-memory con il comportamento empty/not-found, limitato
copy-in/copy-out, la conservazione della versione e sovrascrivere la semantica. Non
aggiungere codice per la memoria flash in questo task.

### Passo 3 — Verificare e definire la partizione di storage

Apri in sola lettura `build/zephyr/zephyr.dts` e modifica
`boards/esp32c3_devkitm_esp32c3.overlay` soltanto se la partizione già ereditata dalla
board non coincide con i dati sotto.

Verifica nel DTS generato `storage_partition: partition@3b0000`, label `storage` e
`reg = <0x3b0000 0x30000>`. La flash è 4 MiB; questa regione termina a `0x3e0000`, dove
inizia la partizione scratch, quindi non si sovrappone. Se il DTS generato è diverso,
fermati: non aggiungere una seconda partizione e non inventare offset.

### Passo 4 — Abilitare Zephyr Settings e il relativo backend

`prj.conf`.

Abilitare `CONFIG_SETTINGS=y` e il backend non basato su filesystem verificato nella versione installata,
come `CONFIG_SETTINGS_NVS=y`, solo dopo l'esistenza della partizione di archiviazione.
Aggiungere solo le dipendenze backend richieste da Kconfig warnings/help.

### Passo 5 — Implementare il record persistente con Settings

`subsys/services/storage/storage.c` e `CMakeLists.txt`.

Registra un handler di Zephyr Settings. Nella callback, decodifica il record di
configurazione con versione fissa e caricalo nello stato privato del componente
Storage. Implementa il salvataggio tramite l'API Settings, aggiungi il sorgente a CMake
e propaga gli errori restituiti dal backend.

### Passo 6 — Caricare Config all’avvio e provare la persistenza

`subsys/core/core.c`, `subsys/config/config.c` e la console seriale.

Inizializzare Archiviazione prima di Config, caricare l'istantanea salvata, convalidarla
e applicala. Definisci in modo esplicito il comportamento al primo avvio, quando non
esiste ancora una configurazione salvata. Scrivi uno snapshot
valido cambiato, riavviare e confermare lo stesso ritorno dell'assegnazione; i dati
corrupt/version-mismatch devono ripiegare in modo sicuro.

Nel round-trip positivo usa due elementi con la stessa Port 0, key 10/address `0x40` e
key 11/address `0x41`. Dopo reboot gli ID runtime possono essere diversi, ma le key e i
due endpoint devono essere ricostruiti.

### Contratti completi da scrivere

In `include/spaghetti/storage.h` dichiara:

```c
#define SPAGHETTI_STORAGE_CONFIG_KEY "config"
int spaghetti_storage_init(void);
int spaghetti_storage_read_config(struct spaghetti_config *out);
int spaghetti_storage_write_config(const struct spaghetti_config *config);
```

In `subsys/services/storage/storage.c` definisci il record privato:

```c
struct spaghetti_storage_record {
	uint32_t magic;
	uint32_t version;
	struct spaghetti_config config;
};
```

Il record è privato di Storage, copiabile e valido solo durante read/write; `magic` e
`version` rifiutano dati incompatibili. `out` appartiene al chiamante, è non `const`
perché viene scritto e cambia solo dopo una lettura completa valida. `config` è un
prestito `const`, copiato sincronicamente. Le funzioni restituiscono `0`; read usa
`-ENOENT` per record assente, `-EBADMSG` per record corrotto e propaga errori backend.

Implementa prima un backend RAM privato con `bool present` e una copia del record, poi
sostituiscilo con Zephyr Settings mantenendo le firme. In `prj.conf` abilita Settings e
il backend flash realmente supportato; nel DTS usa una sola partizione verificata e non
sovrapposta. Core inizializza Storage, tratta `-ENOENT` come primo avvio, altrimenti
valida/applica Config. Scrivi solo dopo apply riuscito.

Campi e funzioni, senza scelte lasciate aperte:

- `magic`: usa una costante a 32 bit documentata per distinguere il record da bytes
  casuali; non cambia tra due build compatibili;
- `version`: deve coincidere con `SPAGHETTI_CONFIG_VERSION`;
- `config`: snapshot completo posseduto dal record, senza puntatori esterni.

La versione del record cambia se cambia il layout di key/config. Non serializzare
padding non inizializzato: azzera il record prima di copiarvi lo snapshot.

`spaghetti_storage_init()` è chiamata da Core al boot; inizializza Settings, registra
l’handler e carica il subtree `SPAGHETTI_STORAGE_CONFIG_KEY`. Restituisce `0` o propaga
l’errno backend. `read_config(out)` valida `out`, controlla record presente, magic e
versione, poi copia Config; usa `-EINVAL`, `-ENOENT` e `-EBADMSG`. `write_config(config)`
valida il puntatore, costruisce un record locale e chiama `settings_save_one()`; il
puntatore `const` non viene conservato.

## Esempio d’uso

```c
struct spaghetti_config config;
int err = spaghetti_storage_read_config(&config);
if (err == -ENOENT) {
	config = default_config;
}
```

## Checklist di completamento

- [x] Definire l’API di storage sincrono.
- [x] Implementare e provare il backend storage RAM.
- [x] Verificare e definire la partizione di storage.
- [x] Abilitare Zephyr Settings e il relativo backend.
- [x] Implementare il record persistente con Settings.
- [x] Caricare Config all’avvio e provare la persistenza.
- [x] Ripristinare due Module sulla stessa Port usando key, non vecchi runtime ID.

## Verifica finale

**Comandi**

```sh
make validate
make pristine
make flash
make monitor
```

**Controlla**

Prova backend RAM con record assente, round-trip e versione errata. Poi build pristine, verifica partizione, salva, spegni/riaccendi e controlla Config applicata; corruzione deve essere deterministica.

**Risultato atteso**

La Config valida sopravvive al power-cycle; record assente, incompatibile o corrotto è gestito.
