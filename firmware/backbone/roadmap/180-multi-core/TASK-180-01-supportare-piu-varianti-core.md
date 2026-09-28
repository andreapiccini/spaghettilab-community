# TASK-180-01 — Supportare più varianti Core

**Stato:** ✅ DONE
**Fase:** 180 — Varianti Core multiple

## Prima di scrivere: concetti Zephyr

### Definire il binding Spaghetti Port

1. **Cos’è:** Un binding YAML definisce lo schema dei nodi con un determinato `compatible`: proprietà ammesse, tipi, obbligatorietà e significato.
2. **A cosa serve:** Permette agli strumenti Devicetree di validare ogni Spaghetti Port e generare macro C coerenti.
3. **Quando viene usato:** Il binding viene letto durante la build quando un nodo usa `compatible = "spaghettilab,port"`.
4. **Build-time o runtime:** Build-time.
5. **Collegamento con questo task:** Dopo aver provato Port sul C3, puoi descrivere in modo portabile i Port fisici delle board Spaghetti LAB.
6. **File reali coinvolti:** `dts/bindings/spaghetti/spaghettilab,port.yaml` e `dts/bindings/spaghetti/README.md`.
7. **Cosa guardare nei file:** Definisci `compatible`, proprietà `reg` e soltanto riferimenti hardware già giustificati; documenta tipo e vincoli.
8. **Cosa non modificare:** Non inserire identità di moduli rimovibili, valori runtime, proprietà speculative o sintassi non presente nei binding Zephyr installati.

### Convalidare il binding di Port

I legami sono schemi YAML usati al momento della compilazione per convalidare i nodi DTS
e generare macro C. Devono descrivere l'hardware statico Core, non l'identità del modulo
runtime.

### Creare la prima definizione board Spaghetti LAB

1. **Cos’è:** Una board definition è l’insieme di metadati, DTS, Kconfig e runner con cui Zephyr riconosce un target hardware. Il `defconfig` contiene i default Kconfig specifici della board.
2. **A cosa serve:** Consente a `west build -b <board>` di scegliere SoC, hardware statico e metodo di flash senza rami nel codice applicativo.
3. **Quando viene usato:** West e CMake scoprono la board all’inizio della build; DTS e defconfig vengono poi uniti alla configurazione.
4. **Build-time o runtime:** Build-time.
5. **Collegamento con questo task:** Questa è la prima board Spaghetti LAB reale che sostituisce il target generico ESP32-C3.
6. **File reali coinvolti:** `boards/spaghettilab/spaghettilab_core_v1/board.yml`, `spaghettilab_core_v1.dts`, `spaghettilab_core_v1_defconfig` e `Kconfig.spaghettilab_core_v1`.
7. **Cosa guardare nei file:** Controlla `board.yml`, DTS della board, file Kconfig/defconfig, qualifier e runner richiesti dalla versione installata.
8. **Cosa non modificare:** Non inventare varianti, revisioni o runner; non copiare una board di una versione Zephyr diversa e non spostare logica runtime nel DTS.

## Perché lo facciamo

Il Devicetree di ciascuna board contiene i fatti fisici; i livelli comuni interrogano capacità e non nomi di board.

## Implementazione guidata

### Passo 1 — Definire il binding Spaghetti Port

Crea `dts/bindings/spaghetti/spaghettilab,port.yaml` e consulta
`dts/bindings/spaghetti/README.md`.

Definire `spaghettilab,port` compatibile, richiesto `reg`, e solo riferimenti
bus/power/capability reali giustificati dallo schema. Non aggiungere una proprietà di
tipo modulo rimovibile.

### Passo 2 — Convalidare il binding di Port

`dts/bindings/spaghetti/spaghettilab,port.yaml` e un nodo di prova minimo nell'apposita
board/test DTS.

Eseguire una configurazione pulita con un nodo valido, quindi verificare le
proprietà richieste mancanti e le referenze non valide falliscono la convalida
Devicetree. Rimuovere qualsiasi nodo di prova deliberatamente non valido dopo il
controllo.

### Passo 3 — Creare la prima definizione board Spaghetti LAB

Crea `boards/spaghettilab/spaghettilab_core_v1/board.yml`,
`spaghettilab_core_v1.dts`, `spaghettilab_core_v1_defconfig` e
`Kconfig.spaghettilab_core_v1`. Aggiungi file runner/qualifier solo se la board
ESP32-C3 installata usa gli stessi file: copiane la struttura, non i dati hardware.

Aggiungi solo i metadati verificati `board.yml`, board DTS, `Kconfig.<board>`, defconfig
e necessari qualifier/runner. Usa le convenzioni Zephyr 4.4 installate e nessuna
variante speculativa.

### Passo 4 — Spostare i dati hardware verificati nel DTS della board

`boards/spaghettilab/spaghettilab_core_v1/spaghettilab_core_v1.dts` e gli eventuali
file `.dtsi` inclusi dalla stessa directory.

Descrivi la MCU verificata, la console, il controller I2C, i nodi Port fisici, i
riferimenti di capacità e il vero cablaggio power/presence. Mantieni le assegnazioni
runtime INA219/Relay fuori dal DTS.

Non aggiungere proprietà `occupied`, `module-count` o identità Module ai nodi Port. Un
solo nodo Port I2C può sostenere molti endpoint runtime; il catalogo DTS limita le
connessioni fisiche, non il numero di Module.

### Passo 5 — Enumerare i Port dal Devicetree

`subsys/port/port.c`.

Sostituire il descrittore hardcoded singolo e il riferimento `DT_NODELABEL(i2c...)` con
l'enumerazione dei tempi di compilazione delle istanze `spaghettilab,port` abilitate.
Popolare i descrittori fissi dalle proprietà generate ed eliminare il momentaneo codice
Port 0.

### Passo 6 — Compilare e provare la prima board Core reale

I file di `boards/spaghettilab/spaghettilab_core_v1/`,
`build/zephyr/zephyr.dts`, `build/zephyr/.config` e la board V1 collegata.

Selezionare la nuova scheda attraverso il percorso `BOARD` environment/configuration
esistente, eseguire una build pristine, ispezionare i nodi Port generati,
flash, e ripetere i percorsi INA219/Relay senza modifiche di livello superiore.

### Passo 7 — Compilare una seconda variante Core

Crea `boards/spaghettilab/spaghettilab_core_v2_build_only/` con gli stessi quattro
tipi di file della V1 e dati hardware esplicitamente simulati.

Descrivi un set Port diverso verificato o esplicitamente simulato. Costruisci Core
immutato, Manager, Runtime, Dati e codice modulo; sostituisci qualsiasi ramo di
nome-board con query di capacità.

### Contratto Devicetree e strutture private

In `dts/bindings/spaghetti/spaghettilab,port.yaml` usa `compatible:
"spaghettilab,port"`, `reg` obbligatorio come ID logico e `i2c` obbligatorio come
phandle al controller quando il Port offre I2C. Non inserire tipo o indirizzo del modulo
rimovibile. Ogni board reale dichiara i nodi figli con `reg` univoco e riferimenti ai
device fisici verificati.

In Zephyr 4.4 `base.yaml` definisce già `reg` come array di celle: il binding lo marca
obbligatorio senza sovrascriverne il tipo. `DT_REG_ADDR()` estrae poi la prima cella
come ID logico.

In `port.c` mantieni privata la stessa `struct spaghetti_port` della fase 030; sostituisci
l’elemento hardcoded con un array statico generato a build-time tramite
`DT_FOREACH_STATUS_OKAY(spaghettilab_port, ...)`. Ogni elemento copia ID e capability e
prende in prestito il device indicato dal phandle, che resta di proprietà Zephyr per il
firmware. `spaghetti_port_init_all()` verifica ogni device prima di rendere disponibile
il catalogo. Nessun `#ifdef` sul nome board è ammesso.

Template minimo del binding:

```yaml
description: Physical Spaghetti LAB Port
compatible: "spaghettilab,port"
properties:
  reg:
    required: true
  i2c:
    type: phandle
    required: true
```

`reg` è l’ID logico copiato in `spaghetti_port.id`; `i2c` è un phandle perché collega
il Port a un nodo controller già posseduto da Zephyr. Nella board V1 dichiara Port 0
con `reg = <0>` e `i2c = <&i2c0>`. La seconda variante build-only usa il nome concreto
`spaghettilab_core_v2_build_only` e deve avere almeno un catalogo Port diverso.

In `subsys/port/port.c` usa:

```c
#define SPAGHETTI_PORT_DEFINE(node_id) { \
	.id = DT_REG_ADDR(node_id), \
	.capabilities = SPAGHETTI_PORT_CAP_I2C, \
	.i2c = DEVICE_DT_GET(DT_PHANDLE(node_id, i2c)), \
},

static struct spaghetti_port ports[] = {
	DT_FOREACH_STATUS_OKAY(spaghettilab_port, SPAGHETTI_PORT_DEFINE)
};
```

`node_id` è un token build-time. `DT_REG_ADDR` legge `reg`; `DT_PHANDLE` segue `i2c`;
`DEVICE_DT_GET` produce il puntatore runtime. `FOREACH` ripete l’inizializzatore per
ogni nodo enabled compatibile.

## Esempio d’uso

```c
for (spaghetti_port_id_t id = 0U; id < spaghetti_port_count(); ++id) {
	const struct spaghetti_port *port = spaghetti_port_get(id);
	/* Usa le capability; non controllare il nome della board. */
}
```

## Checklist di completamento

- [x] Definire il binding Spaghetti Port.
- [x] Convalidare il binding di Port.
- [x] Creare la prima definizione board Spaghetti LAB.
- [x] Spostare i dati hardware verificati nel DTS della board.
- [x] Enumerare i Port dal Devicetree.
- [x] Verificare che il catalogo non codifichi cardinalità Module.
- [x] Compilare la prima board Core reale.
- [x] Compilare una seconda variante Core build-only.

## Verifica finale

**Comandi**

```sh
make validate
make pristine
docker compose run --rm --entrypoint sh dev -lc \
  'west build -p always -b spaghettilab_core_v2_build_only/esp32c3 -d build-v2 .'
```

**Controlla**

Esegui build pristine per entrambe le board e controlla i nodi Port generati. Esegui
`make flash` e `make monitor` soltanto con Core V1; la V2 contiene pin simulati. Prova
INA219 su Port 0 della V1. Il Relay richiede una futura Port con output fisico verificato
e non viene inventato in questo task. La ricerca di nomi board nel C comune deve essere
vuota.

**Risultato atteso**

Entrambe le board compilano dallo stesso C e generano il proprio catalogo Port dal Devicetree.
