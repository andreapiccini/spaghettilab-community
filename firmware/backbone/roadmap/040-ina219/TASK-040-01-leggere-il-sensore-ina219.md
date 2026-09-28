# TASK-040-01 — Leggere il sensore INA219

**Stato:** ✅ DONE
**Fase:** 040 — Sezione verticale INA219

## Cosa devo fare

### 1. Verificare il supporto Zephyr 4.4

Apri `make shell`, poi consulta senza modificare:

- `$ZEPHYR_BASE/drivers/sensor/ti/ina219/ina219.c`;
- `$ZEPHYR_BASE/drivers/sensor/ti/ina219/Kconfig`;
- `$ZEPHYR_BASE/dts/bindings/sensor/ti,ina219.yaml`;
- `$ZEPHYR_BASE/samples/sensor/ina219/src/main.c`;
- `$ZEPHYR_BASE/boards/shields/adafruit_ina219/adafruit_ina219.overlay`.

Il Device Model di Zephyr possiede oggetti `struct device` che rappresentano driver e
hardware. Il binding `compatible = "ti,ina219"` seleziona il driver. Il macro
`DT_INST_FOREACH_STATUS_OKAY()` in fondo a `ina219.c` crea un device per ogni nodo
Devicetree INA219 abilitato: il driver standard richiede quindi un’istanza statica.

### 2. Aggiungere il nodo INA219 temporaneo

Apri `boards/esp32c3_devkitm_esp32c3.overlay`. Dentro `&i2c0` aggiungi:

```dts
	/* TEMPORARY SHORTCUT: rimosso in TASK-080-01. */
	ina219_test: ina219@40 {
		status = "okay";
		compatible = "ti,ina219";
		reg = <0x40>;
		shunt-milliohm = <100>;
		lsb-microamp = <200>;
	};
```

Questa baseline è per un INA219 con A0 e A1 a GND, quindi indirizzo I2C 7-bit `0x40`,
e shunt marcato `R100`, cioè 0,1 Ω = 100 mΩ. `lsb-microamp = <200>` è il valore usato
dallo shield INA219 incluso in Zephyr 4.4. Verifica questi fatti sul modulo reale; se
indirizzo o shunt differiscono, non indovinare e ricavali da schematico/datasheet.

Una node label è il nome prima dei due punti: `ina219_test:` permette al C di usare
`DT_NODELABEL(ina219_test)`. `reg` è l’indirizzo sul bus, non un registro interno.

> **TEMPORARY SHORTCUT:** nodo, Sensor API e wrapper vengono rimossi in
> [TASK-080-01](../080-runtime-removable-ina219/TASK-080-01-rendere-ina219-configurabile-a-runtime.md).

### 3. Abilitare il driver standard

Apri `prj.conf` e aggiungi:

```conf
CONFIG_SENSOR=y
```

Non forzare `CONFIG_INA219=y`: in Zephyr 4.4 ha `default y` quando esiste un nodo
`ti,ina219` abilitato e seleziona I2C. Dopo la build `.config` deve contenere entrambi.

### 4. Scrivere il wrapper temporaneo

Crea `spaghetti_modules/ina219/ina219.h` con:

```c
struct sensor_value;

int spaghetti_ina219_test_init(void);
int spaghetti_ina219_test_read(struct sensor_value *bus_voltage,
			       struct sensor_value *current,
			       struct sensor_value *power);
```

`init()` non riceve parametri perché usa l’unica istanza temporanea. La chiama `main()`
una volta dopo Core; restituisce `0` oppure `-ENODEV` e non modifica dati del chiamante.

I tre parametri di `read()` sono puntatori perché servono tre risultati oltre allo
status. Non sono `const` perché vengono scritti. Gli oggetti appartengono al chiamante,
devono essere validi per la chiamata e non vengono conservati. `read()` restituisce
`-EINVAL` per un output nullo e propaga gli errno delle API Sensor.

Crea `spaghetti_modules/ina219/ina219.c`. Prima delle funzioni definisci:

```c
static const struct device *const ina219_device =
	DEVICE_DT_GET(DT_NODELABEL(ina219_test));
```

`DT_NODELABEL()` risolve il nodo a build-time. `DEVICE_DT_GET()` restituisce il device
posseduto da Zephyr per tutto il firmware. Puntatore e oggetto sono `const` perché il
wrapper li usa ma non li possiede o modifica.

Implementa `read()` in questo ordine:

1. rifiuta output nulli con `-EINVAL`;
2. crea tre `struct sensor_value` locali;
3. chiama `sensor_sample_fetch(ina219_device)` una sola volta;
4. leggi `SENSOR_CHAN_VOLTAGE`, `SENSOR_CHAN_CURRENT` e `SENSOR_CHAN_POWER` con tre
   chiamate a `sensor_channel_get()`;
5. copia i locali negli output soltanto dopo il successo completo e restituisci `0`.

Il fetch avvia la misura e aggiorna la cache privata del driver; i tre get leggono la
stessa misura. Sono previsti errori I2C, `-ENOTSUP` per canale errato e warning di
overflow del current/power register.

### 5. Collegare e mostrare la lettura

Apri `CMakeLists.txt` e aggiungi `spaghetti_modules/ina219/ina219.c` alle sorgenti.
Apri `src/main.c`: dopo Core risolvi esplicitamente Port 0 e il suo controller, poi
chiama init:

```c
const struct spaghetti_port *port = spaghetti_port_get(0U);
const struct device *i2c = spaghetti_port_i2c_device(port);

if (i2c == NULL) {
	LOG_ERR("Port 0 has no ready I2C device");
	return -ENODEV;
}

int err = spaghetti_ina219_test_init();
```

`port` e `i2c` sono prestiti `const` con lifetime firmware; `main()` non li modifica e
non li libera. Nel loop chiama read ogni secondo:

```c
struct sensor_value bus_voltage;
struct sensor_value current;
struct sensor_value power;
err = spaghetti_ina219_test_read(&bus_voltage, &current, &power);

if (err == 0) {
	LOG_INF("INA219 bus=%lld mV current=%lld mA power=%lld mW",
		(long long)sensor_value_to_milli(&bus_voltage),
		(long long)sensor_value_to_milli(&current),
		(long long)sensor_value_to_milli(&power));
} else {
	LOG_ERR("INA219 read failed: %d", err);
}
```

Il flusso da verificare è:

```text
Port 0 -> spaghetti_port_i2c_device(port) -> i2c0 device
       -> INA219 device statico Zephyr -> sample -> LOG_INF
```

In questa fase il device INA219 è ancora statico; Port 0 conferma quale controller
fisico verrà usato nella versione rimovibile.

## Perché è fatto così

Il driver standard prova subito cablaggio, indirizzo, calibrazione e API Sensor. Non può
modellare inserimento/rimozione runtime perché il suo device nasce dal Devicetree. La
fase 080 conserva il controller statico della Port e sostituisce il sensore statico con
indirizzo runtime e transazioni I2C dirette.

La singola istanza statica verifica l’hardware ma non stabilisce una relazione Port
1:1 Module. La fase 080 proverà più address runtime sulla stessa Port.

## Come si usa

Bus voltage è espressa in V, current in A e power in W dentro `struct sensor_value`.
L’esempio converte soltanto il log in mV, mA e mW.

## Checklist di completamento

- [x] Il modulo è INA219 a `0x40` con shunt `R100`.
- [x] Il nodo temporaneo contiene le proprietà mostrate.
- [x] `.config` contiene `CONFIG_SENSOR=y` e `CONFIG_INA219=y`.
- [x] Un fetch alimenta i tre channel get.
- [x] Gli output restano invariati in caso di errore.

## Verifica e fine task

```sh
make validate
make pristine
rg -n "CONFIG_(SENSOR|INA219)=y" build/zephyr/.config
rg -n "ina219_test|ti,ina219|shunt-milliohm|lsb-microamp" build/zephyr/zephyr.dts
make flash
make monitor
```

Controlla dieci righe con bus voltage stabile e current che cambia applicando un carico
noto entro i limiti del modulo. Scollegando INA219 devi vedere un errore controllato,
senza crash. Il risultato finale è:

```text
ESP32-C3 -> Port 0 -> I2C -> INA219 -> bus voltage/current/power -> LOG_INF
```
