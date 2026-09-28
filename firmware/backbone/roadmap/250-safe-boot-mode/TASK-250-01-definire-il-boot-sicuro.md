# TASK-250-01 — Definire il boot sicuro con e senza Config

**Stato:** ✅ DONE
**Fase:** 250 — Boot sicuro

## Cosa devo fare

Il task è implementato nei file seguenti:

- `include/spaghetti/core.h`: modalità operativa, stato dell'immagine e snapshot Core;
- `subsys/core/core.c`: selezione della modalità, avvio selettivo dei servizi e health
  window del trial;
- `subsys/core/core_boot_internal.h` e `subsys/core/core_boot_backend.c`: confine privato
  per probe di bootstrap e reboot, sostituibile dai test;
- `include/spaghetti/storage.h` e `subsys/services/storage/storage.c`: marker maintenance
  one-shot persistente;
- `include/spaghetti/update.h`, `subsys/services/update/update.c` e
  `subsys/services/update/update_mcuboot.c`: slot attivo, conferma MCUboot e relativo stato;
- `include/spaghetti/communication.h`, `subsys/communication/communication.c` e
  `subsys/communication/communication_shell.c`: stato di boot visibile con
  `spaghetti status`;
- `tests/core/`, `tests/storage/`, `tests/update/` e `tests/communication/`: scenari fake
  deterministici senza flash o MCUboot reali.

La decisione importante è separare due dimensioni indipendenti:

```c
enum spaghetti_core_mode {
	SPAGHETTI_CORE_MODE_UNPROVISIONED,
	SPAGHETTI_CORE_MODE_NORMAL,
	SPAGHETTI_CORE_MODE_MAINTENANCE,
};

enum spaghetti_core_image_state {
	SPAGHETTI_CORE_IMAGE_CONFIRMED,
	SPAGHETTI_CORE_IMAGE_TRIAL,
};
```

`mode` decide quali servizi possono partire. `image_state` dice invece se MCUboot può
ancora ripristinare il firmware precedente. Per esempio, un firmware appena aggiornato
può essere contemporaneamente `NORMAL + TRIAL`; dopo i controlli diventa
`NORMAL + CONFIRMED`. `TRIAL` non è quindi una quarta modalità operativa.

Lo snapshot pubblico è:

```c
struct spaghetti_core_info {
	enum spaghetti_core_state state;
	enum spaghetti_core_mode mode;
	enum spaghetti_core_image_state image_state;
	uint8_t active_slot;
	bool image_confirmed;
	char version[SPAGHETTI_CORE_VERSION_SIZE];
};

int spaghetti_core_get_info(struct spaghetti_core_info *out);
```

`out` è un puntatore perché la funzione deve copiare più valori in memoria del
chiamante; non è `const` perché viene scritto. Core non conserva il puntatore e la
struttura appartiene al chiamante. La funzione restituisce `0`, `-EINVAL` se `out` è
`NULL` e `-EAGAIN` se la policy di boot non è ancora disponibile. Communication la
chiama durante `GET_STATUS`; la Shell stampa mode, image, slot, conferma e versione.

Storage espone:

```c
int spaghetti_storage_request_maintenance_once(void);
int spaghetti_storage_consume_maintenance_once(bool *requested);
```

La prima funzione salva il byte `maintenance/boot_once` con Zephyr Settings. La
chiamerà un futuro adapter autenticato prima del reboot. La seconda viene chiamata una
sola volta da Core: cancella il marker prima di restituire `true`, così un crash in
maintenance non crea un boot loop. `requested` è un output posseduto dal chiamante e
non viene trattenuto. Un marker assente o malformato produce `false`; un errore di
cancellazione viene propagato e impedisce un boot ambiguo.

Update espone:

```c
int spaghetti_update_confirm_trial(void);
```

Core è l'unico chiamante. La funzione è valida soltanto nello stato
`SPAGHETTI_UPDATE_TRIAL_BOOT`, chiama `boot_write_img_confirmed()` e torna a `IDLE`
solo dopo il successo. Non è esposta come comando Shell: un client esterno non può
rendere permanente un firmware non sano.

La sequenza implementata in `spaghetti_core_init()` è:

1. inizializza Storage e Update, poi legge conferma e slot attivo da MCUboot;
2. inizializza l'infrastruttura minima Port, Registry, Manager, Data e Config;
3. legge e valida la Config persistente;
4. consuma il marker one-shot;
5. sceglie `UNPROVISIONED` senza Config valida, `MAINTENANCE` con marker/probe valido,
   altrimenti `NORMAL`;
6. soltanto in `NORMAL` inizializza Runtime, MQTT, Discovery e Wi-Fi Profiles;
7. inizializza Communication in ogni modalità e pubblica lo snapshot Core;
8. scrive un log unico `boot: mode=... image=... slot=... confirmed=... version=...`.

`spaghetti_core_start()` applica la Config soltanto in `NORMAL`. Se l'immagine è
`TRIAL`, mantiene il Core in esecuzione per `CONFIG_SPAGHETTI_TRIAL_HEALTH_MS`, verifica
che sia ancora `RUNNING` e la conferma. Se la conferma fallisce, porta Core in `FAILED`
e richiede `sys_reboot(SYS_REBOOT_WARM)`: l'immagine resta non confermata e MCUboot può
fare rollback.

Il probe produzione è intenzionalmente un confine che oggi restituisce `false`: il
pinmux UART sui pin condivisi, il frame autenticato e il trasporto locale reale sono
implementati nel task 260. In questa fase `UNPROVISIONED` e `MAINTENANCE` mantengono
disponibile la Shell seriale già esistente senza avviare l'Engine o la rete.

## Perché è fatto così

La Config descrive il comportamento desiderato dell'Engine, non uno stato transitorio
di aggiornamento. Separare modalità e stato immagine evita che `TRIAL` nasconda se il
dispositivo debba eseguire l'Engine oppure attendere manutenzione. Il marker one-shot è
persistente quanto basta per attraversare un reboot, ma viene consumato prima
dell'ingresso per non bloccare definitivamente il dispositivo.

MCUboot possiede gli slot e la permanenza dell'immagine; Core decide soltanto quando i
controlli applicativi sono sufficienti per chiamare la conferma. Non viene usato heap:
snapshot, marker e stato sono bounded e posseduti staticamente dai componenti.

## Come si usa

Dopo il flash apri la seriale:

```sh
make monitor
```

Il log espone entrambe le dimensioni, per esempio:

```text
boot: mode=unprovisioned image=trial slot=0 confirmed=0 version=0.0.0+0
```

Dopo la health window lo stesso firmware è confermato. Per leggere lo snapshot:

```text
uart:~$ spaghetti status
```

Da codice:

```c
struct spaghetti_core_info info;
int err = spaghetti_core_get_info(&info);

if ((err == 0) && (info.mode == SPAGHETTI_CORE_MODE_NORMAL)) {
	/* La copia locale info resta valida dopo la chiamata. */
}
```

## Checklist di completamento

- [x] Modalità operativa e stato trial sono due proprietà indipendenti.
- [x] Config assente non avvia Runtime, Wi-Fi, MQTT o Discovery.
- [x] Marker valido viene cancellato prima di entrare in maintenance.
- [x] Boot normale non apre una sessione Update.
- [x] Trial sano viene confermato soltanto dopo la health window.
- [x] Stato Shell include mode, image, slot, conferma e versione.
- [x] Test coprono Config assente, marker, probe, normal e trial.

## Verifica e fine task

Comandi eseguiti:

```sh
./validator
./validator roadmap
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests -p native_sim/native/64 --inline-logs \
  --outdir build/twister-all --clobber-output'
make build
git diff --check
```

Risultato atteso: validator senza errori, tutti i test nativi superati e build sysbuild
completa di MCUboot e applicazione firmata. Su hardware, `spaghetti status` deve
mostrare la modalità selezionata e il passaggio da trial a confirmed. Il trasferimento
UART sui pin condivisi non è simulato come già disponibile: è il risultato del task
260.
