# TASK-230-01 — Attivare MCUboot e le immagini A/B firmate

**Stato:** ✅ DONE
**Fase:** 230 — MCUboot e A/B

## Cosa devo fare

La parte software è implementata. Resta soltanto il provisioning e la verifica sulla
scheda fisica.

Apri questi file:

- `sysbuild.conf`: include MCUboot nella stessa build dell'app, seleziona la firma
  ECDSA P-256 e `SB_CONFIG_MCUBOOT_MODE_SWAP_USING_MOVE=y`. Lo swap tramite move usa
  `image-0`, `image-1` e il trailer MCUboot per consentire un boot di prova e il
  rollback; la modalità overwrite-only predefinita di Espressif non lo consentirebbe.
- `sysbuild/mcuboot.conf`: abilita i log del bootloader e impedisce downgrade.
- `prj.conf`: collega l'app a MCUboot e abilita Image Manager e Stream Flash, che i
  task successivi useranno per scrivere una nuova immagine a blocchi.
- `Makefile`: `make signing-key` genera una sola volta la chiave privata; build e
  pristine usano sysbuild; validate opera sul dominio `app`.
- `tools/device.py`: legge `build/domains.yaml` e i `runners.yaml` generati, quindi
  passa a `esptool` MCUboot a `0x0` e l'app firmata a `0x20000` senza indirizzi
  duplicati nel codice host.
- `.gitignore`: esclude l'intera directory `.keys/`.

Sysbuild è il coordinatore build-time di Zephyr per più immagini. Qui crea due domini:
`mcuboot`, il bootloader che possiede la chiave pubblica, e `app`, il firmware Spaghetti
LAB firmato con la chiave privata. A runtime MCUboot verifica la firma prima di cedere
il controllo all'applicazione.

La chiave in `.keys/mcuboot-dev-ecdsa-p256.pem` è privata, appartiene allo sviluppatore
e vive finché esistono dispositivi provisionati con la relativa chiave pubblica. Non
viene letta dal firmware a runtime e non deve essere aggiunta a Git. Per la produzione
servirà una chiave custodita fuori dalla workstation e un processo di provisioning
dedicato.

Non viene aggiunta alcuna API C in questo task. Ricezione dell'immagine, richiesta di
boot di prova e conferma dell'immagine appartengono rispettivamente alle fasi 240–270.

## Perché è fatto così

La flash da 4 MiB della board contiene già `boot_partition` da 64 KiB, due slot da
1792 KiB, scratch da 124 KiB e storage da 192 KiB. La build verificata produce MCUboot
da 43.040 byte e un'app firmata da 745.346 byte: entrambi rientrano nelle partizioni
senza cambiare la mappa e senza spostare lo storage persistente.

Il primo provisioning deve usare USB perché il dispositivo precedente non possiede
ancora MCUboot. I successivi task scriveranno soltanto un candidato firmato in
`image-1`; fino ad allora non esiste ancora un comando OTA.

## Come si usa

Una sola volta per workstation:

```sh
make signing-key
```

Per costruire entrambi i domini:

```sh
make pristine
```

Gli artefatti importanti sono:

```text
build/mcuboot/zephyr/zephyr.bin
build/app/zephyr/zephyr.signed.bin
```

Per il primo provisioning collega una sola Core V1 via USB, chiudi il monitor e
controlla prima la porta con `make ports`. Poi esegui:

```sh
make flash PORT=/dev/cu.usbmodemXXXX
make monitor PORT=/dev/cu.usbmodemXXXX
```

Sostituisci il percorso con quello realmente mostrato da `make ports`. Il comando di
flash usa i metadati generati e scrive in un'unica operazione:

```text
0x00000  build/mcuboot/zephyr/zephyr.bin
0x20000  build/app/zephyr/zephyr.signed.bin
```

Non usare `erase-flash`: cancellerebbe anche Config e profili Wi-Fi nello storage.

## Checklist di completamento

- [x] Sysbuild costruisce MCUboot e applicazione insieme.
- [x] L'app è firmata con ECDSA P-256 e `imgtool verify` la accetta.
- [x] MCUboot usa swap tramite move e downgrade prevention.
- [x] Chiave privata e build sono ignorate da Git.
- [x] Bootloader e app firmata rientrano nelle rispettive partizioni.
- [x] `make flash` ricava ordine, indirizzi e file dai domini sysbuild.
- [x] Il provisioning USB avvia MCUboot e l'app senza perdere Config o profili Wi-Fi.

## Verifica e fine task

Esegui:

```sh
make validate
make pristine
docker compose run --rm --entrypoint imgtool dev verify \
  -k .keys/mcuboot-dev-ecdsa-p256.pem \
  build/app/zephyr/zephyr.signed.bin
```

Controlla che `build/domains.yaml` elenchi prima `mcuboot` e poi `app`, che la verifica
stampi `Image was correctly validated` e che nessun file sotto `.keys/` compaia in
`git status`.

Infine esegui il provisioning USB descritto sopra. Il log atteso mostra prima MCUboot,
poi il normale avvio di Spaghetti Core. Verifica con i comandi Shell che Config e
profili Wi-Fi preesistenti siano ancora presenti; solo allora seleziona l'ultima
checkbox, cambia lo stato in `✅ DONE` e apri il task 240.
