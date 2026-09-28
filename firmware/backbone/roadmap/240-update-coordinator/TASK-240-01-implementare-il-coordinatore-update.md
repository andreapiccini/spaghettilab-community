# TASK-240-01 — Implementare il coordinatore sicuro degli aggiornamenti

**Stato:** ✅ DONE
**Fase:** 240 — Coordinatore aggiornamenti

## Cosa devo fare

Il task è implementato nei file seguenti:

- `include/spaghetti/update.h`: enum, snapshot e API pubblica;
- `subsys/services/update/update.c`: macchina a stati, mutex, timeout e policy;
- `subsys/services/update/update_mcuboot.c`: backend reale flash/MCUboot;
- `subsys/services/update/update_internal.h`: confine privato sostituito dai fake;
- `tests/update/`: test nativi senza flash fisica;
- `subsys/core/core.c`: inizializzazione Update posseduta dal Core.

Gli stati pubblici sono `IDLE`, `ARMED`, `RECEIVING`, `VERIFYING`,
`PENDING_REBOOT`, `TRIAL_BOOT` ed `ERROR`. `UART` e `UDP` sono valori piccoli passati
per copia; `NONE` indica che nessun adapter possiede la sessione. La snapshot contiene
soltanto stato, trasporto, millisecondi residui e ultimo errno: è copiata nel buffer
del chiamante e non espone firmware, URL o segreti.

Le firme implementate sono:

```c
int spaghetti_update_init(void);
int spaghetti_update_arm(uint32_t timeout_ms);
int spaghetti_update_begin(enum spaghetti_update_transport transport);
int spaghetti_update_finish(void);
int spaghetti_update_cancel(void);
int spaghetti_update_get_status(struct spaghetti_update_status *out);
```

`arm()` apre una finestra con deadline assoluta. `begin()` assegna la sessione a un
solo adapter ed elimina il vecchio contenuto di `image-1`. `finish()` controlla che lo
slot contenga un header MCUboot leggibile e chiama esclusivamente
`boot_request_upgrade(BOOT_UPGRADE_TEST)`. `cancel()` e il timeout cancellano soltanto
lo slot secondario. La cancellazione temporizzata gira su una workqueue statica Update,
così l'erase non blocca la workqueue di sistema. Non viene usato heap.

Zephyr 4.4 non espone all'applicazione una funzione pubblica per replicare l'intera
verifica ECDSA di MCUboot. La verifica crittografica definitiva avviene quindi nel
bootloader al riavvio: un candidato con firma errata non viene eseguito e il firmware
precedente resta avviabile. Gli adapter delle fasi 260 e 270 dovranno chiamare
`finish()` soltanto dopo che il proprio upload bounded risulta completo.

## Perché è fatto così

La macchina a stati separa la policy dai trasporti. UART e UDP sposteranno byte, ma non
potranno decidere slot, permanenza o concorrenza. Durante `TRIAL_BOOT` Update rifiuta
nuovi upload e `init()` non cancella `image-1`, perché quello slot può contenere
l'immagine necessaria al rollback.

## Come si usa

```c
struct spaghetti_update_status status;
int err = spaghetti_update_arm(60000U);

if (err == 0) {
	err = spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UART);
}
if (err == 0) {
	/* L'adapter riceve completamente il candidato nello slot assegnato. */
	err = spaghetti_update_finish();
}
if (spaghetti_update_get_status(&status) == 0) {
	/* status è una copia posseduta dal chiamante. */
}
```

## Checklist di completamento

- [x] Transizioni valide e invalide sono testate.
- [x] UART e UDP non possono possedere contemporaneamente la sessione.
- [x] Timeout e cancel scartano la secondaria incompleta.
- [x] Cleanup fallito conserva `ERROR` e permette un nuovo tentativo.
- [x] `finish()` usa sempre `BOOT_UPGRADE_TEST`, mai permanent.
- [x] Il Core inizializza Update senza cancellare lo slot al boot.

## Verifica e fine task

Comandi eseguiti:

```sh
./validator
./validator roadmap
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/update -p native_sim/native/64 \
  --inline-logs --outdir build/twister-update --clobber-output'
make build
```

Risultato atteso e ottenuto: validator senza finding, entrambe le configurazioni Update
(`IDLE` e `TRIAL_BOOT`) superate e build sysbuild completa di MCUboot più applicazione
firmata. La ricezione reale dei
byte non viene simulata come funzionalità disponibile: appartiene agli adapter UART e
Wi-Fi futuri.
