# Piano OTA e manutenzione senza USB

[← Indice roadmap](README.md)

**Stato:** 🟨 READY FOR HARDWARE QUALIFICATION

## Decisioni verificate su Zephyr 4.4 e Core V1

- La flash ESP32-C3 da 4 MiB è già divisa in `image-0` e `image-1`, entrambe da
  1792 KiB, più `image-scratch`: la base fisica per un aggiornamento A/B esiste.
- Sysbuild costruisce MCUboot e l'applicazione firmata ECDSA P-256. MCUboot usa lo
  swap tramite move, quindi il rollback è disponibile; la fase 250 ha aggiunto la
  conferma applicativa dopo una health window.
- Zephyr 4.4 include Image Management di `mcumgr`, trasporto SMP UART e trasporto SMP
  UDP. Non include un trasporto SMP I2C.
- Il driver `i2c_esp32.c` installato espone controller/initiator, ma non le callback
  target/slave. Core V1 non può quindi presentarsi alla base come periferica I2C usando
  l'API Zephyr standard.
- GPIO3 e GPIO4 sono oggi SDA/SCL di Port 0 e verranno riutilizzati come RX/TX UART
  soltanto dal backend Core V1. Il firmware comune userà una capability dichiarata dal
  Devicetree e non conoscerà questi numeri.
- La Shell Telnet di Zephyr è in chiaro e non offre autenticazione. Rimane utile solo
  come esperimento di laboratorio; non è il backend scelto per il prodotto.

## Comportamento finale richiesto

La modalità operativa del firmware è sempre una fra:

1. `UNPROVISIONED`: Config assente; il Core entra direttamente in maintenance UART
   locale. Niente Runtime, MQTT, scansione Wi-Fi automatica o listener OTA di rete.
2. `NORMAL`: Config valida; Engine e Module usano normalmente le Port. I trasporti di
   aggiornamento sono chiusi.
3. `MAINTENANCE`: modalità richiesta da marker one-shot o probe valido; Runtime e rete
   restano spenti. La fase 260 ha collegato questa policy al pinmux UART e al gruppo
   SMP Spaghetti reale.

La macchina Update può separatamente essere `ARMED` o `RECEIVING`. Lo stato immagine
può essere `TRIAL` in qualunque modalità operativa: MCUboot avvia il candidato e Core lo
conferma soltanto dopo i controlli di salute. Un reset precedente lascia possibile il
rollback. Nessuno di questi stati viene salvato nella Config.

Un trasferimento interrotto non marca mai l'immagine come pending. Alla scadenza il
coordinatore chiude il trasporto, azzera lo stato di upload ed elimina la secondaria
incompleta. Nessun record Config persistente può impostare direttamente `RECEIVING` o
`TRIAL_BOOT`.

## Ordine dei task

1. [220 — Definire il contratto astratto del Maintenance Link](220-update-hardware-contract/README.md)
2. [230 — Attivare MCUboot e le immagini A/B firmate](230-mcuboot-ab/README.md)
3. [240 — Implementare il coordinatore sicuro degli aggiornamenti](240-update-coordinator/README.md)
4. [250 — Definire il boot sicuro con e senza Config](250-safe-boot-mode/README.md)
5. [260 — Aggiungere provisioning e update locale dalla base](260-local-maintenance-uart/README.md)
6. [270 — Aggiungere OTA Wi-Fi autenticato](270-wifi-ota/README.md)
7. [280 — Rendere `make monitor` multi-trasporto](280-remote-console/README.md)
8. [290 — Qualificare interruzioni, rollback e recovery](290-update-qualification/README.md)

Non iniziare un task se il precedente non è completato. Le fasi 220–280 hanno fissato
il confine hardware, predisposto bootloader/firma A/B, implementato il coordinatore,
la maintenance locale e l'adapter OTA DTLS-PSK. Pin e controller restano proprietà
della board/overlay. Tool, report e matrice della fase 290 sono pronti; mancano le
prove fisiche documentate prima di poter dichiarare completo il piano.
