# TASK-020-01 — Verificare e abilitare I2C

**Stato:** ✅ DONE
**Fase:** 020 — Scheda attuale / I2C

## Prima di scrivere: concetti Zephyr

### Ispezionare il Devicetree generato

1. **Cos’è:** Il Devicetree è la descrizione gerarchica dell’hardware nota a Zephyr. I file `.dts` descrivono una board completa; i `.dtsi` sono frammenti inclusi e riutilizzati.
2. **A cosa serve:** Permette alla build di sapere quali periferiche esistono, indirizzi, pin, stato e collegamenti senza codificarli negli algoritmi C.
3. **Quando viene usato:** La board selezionata, i `.dtsi` del SoC e gli overlay dell’applicazione vengono uniti durante la build.
4. **Build-time o runtime:** Build-time; il risultato genera macro e oggetti device usati poi a runtime.
5. **Collegamento con questo task:** Prima di cambiare I2C devi vedere quale controller e quali label esistono davvero nella board ESP32-C3 selezionata.
6. **File reali coinvolti:** `build/zephyr/zephyr.dts` è il risultato finale; i sorgenti originali sono indicati nei commenti del file e nella directory board di Zephyr.
7. **Cosa guardare nei file:** Cerca `i2c`, `status`, le node label come `i2c0` e i riferimenti `pinctrl-*`.
8. **Cosa non modificare:** Non modificare `build/zephyr/zephyr.dts`, i `.dts` o `.dtsi` installati da Zephyr; in questo task devi soltanto ispezionarli.

### Abilitare I2C nell’overlay della scheda

1. **Cos’è:** Un overlay è un file che modifica il Devicetree della board selezionata senza cambiare i sorgenti Zephyr. Una node label, per esempio `i2c0`, permette di riferirsi a un nodo già definito. `pinctrl` descrive su quali GPIO viene instradata la periferica.
2. **A cosa serve:** Adatta controller e pin della board generica al cablaggio reale di Spaghetti LAB.
3. **Quando viene usato:** Zephyr unisce l’overlay al DTS della board durante la configurazione della build.
4. **Build-time o runtime:** Build-time.
5. **Collegamento con questo task:** Il controller I2C esiste già nel SoC; qui devi abilitarlo e associargli soltanto i pin verificati nel task precedente.
6. **File reali coinvolti:** `boards/esp32c3_devkitm_esp32c3.overlay`.
7. **Cosa guardare nei file:** Confronta le label e la sintassi `pinctrl` con `build/zephyr/zephyr.dts` e con i file board installati.
8. **Cosa non modificare:** Non inserire ancora il nodo INA219, un’identità di modulo rimovibile o numeri dei pin copiati da un’altra board.

### Abilitare il supporto I2C di Zephyr

`CONFIG_I2C=y` compila il generico Zephyr I2C API e il controller selezionato driver.
Non descrive pin e non è configurazione runtime.

## Perché lo facciamo

Controller e pin sono fatti hardware statici; descriverli nel Devicetree evita numeri GPIO nel codice C.

## Implementazione guidata

### Passo 1 — Verificare controller e pin I2C reali

Apri `boards/esp32c3_devkitm_esp32c3.overlay` e lo schematico della revisione hardware
fisicamente collegata. Lo schematico è l’unico input esterno: se non è disponibile,
marca il task BLOCKED.

Conferma i dati già presenti nell’overlay: controller `i2c0`, SDA GPIO3, SCL GPIO4,
open-drain e pull-up. Annota anche tensione e revisione. Se lo schematico non coincide,
usa i dati dello schematico e aggiorna coerentemente snippet e verifiche del task prima
di scrivere codice C.

### Passo 2 — Ispezionare il Devicetree generato

`build/zephyr/zephyr.dts` e le definizioni di ESP32-C3 DTS/pinctrl installate
all'interno di `make shell`.

Individuare l'etichetta del controller I2C verificata, il suo stato attuale e la
sintassi ESP32-C3 pinctrl installata. Registrare le etichette esatte dei nodi necessarie
per overlay; non modificare i file generati.

### Passo 3 — Abilitare I2C nell’overlay della scheda

`boards/esp32c3_devkitm_esp32c3.overlay`.

Aggiungi o mantieni questo blocco concreto:

```dts
&pinctrl {
	spaghetti_i2c0_default: spaghetti_i2c0_default {
		group1 {
			pinmux = <I2C0_SDA_GPIO3>, <I2C0_SCL_GPIO4>;
			bias-pull-up;
			drive-open-drain;
			output-high;
		};
	};
};

&i2c0 {
	status = "okay";
	clock-frequency = <I2C_BITRATE_STANDARD>;
	pinctrl-0 = <&spaghetti_i2c0_default>;
	pinctrl-names = "default";
};
```

### Passo 4 — Abilitare il supporto I2C di Zephyr

`prj.conf`.

Aggiungi `CONFIG_I2C=y`. Questo compila in modo permanente le API generiche del
controller I2C richieste dalle porte I2C.

### Passo 5 — Controllare la configurazione I2C generata

`build/zephyr/zephyr.dts` e `build/zephyr/.config`.

Dopo una build pulita, confermare che il controller selezionato è `okay`,
i pin generati corrispondono allo schema verificato, e `.config` contiene
`CONFIG_I2C=y`. Non modificare né il file generato.

### Passo 6 — Caricare e provare la baseline I2C

`README.md` e la console seriale.

Non aggiungere codice. Lanciare l'immagine generata dalla build pulita e verificare che il controller
non utilizzato non abbia rotto l'avvio o la console USB.

## Esempio d’uso

```sh
rg -n "i2c0|spaghetti_i2c0_default|I2C0_(SDA|SCL)" build/zephyr/zephyr.dts
rg -n "CONFIG_I2C=y" build/zephyr/.config
```

## Checklist di completamento

- [x] Verificare controller e pin I2C reali.
- [x] Ispezionare il Devicetree generato.
- [x] Abilitare I2C nell’overlay della scheda.
- [x] Abilitare il supporto I2C di Zephyr.
- [x] Controllare la configurazione I2C generata.
- [x] Caricare e provare la baseline I2C.

## Verifica finale

**Comandi**

```sh
make validate
make pristine
make flash
make monitor
```

**Controlla**

Esegui `make pristine`; controlla `i2c0`, pin e `status = "okay"` in `build/zephyr/zephyr.dts` e `CONFIG_I2C=y` in `.config`. Flasha: boot e console devono restare stabili.

**Risultato atteso**

Il DTS generato contiene `i2c0` su GPIO3/GPIO4 e `.config` contiene `CONFIG_I2C=y`.
