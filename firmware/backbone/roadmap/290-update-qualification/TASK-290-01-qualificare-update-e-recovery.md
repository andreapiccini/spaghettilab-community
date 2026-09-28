# TASK-290-01 — Qualificare interruzioni, rollback e recovery

**Stato:** 🟨 IN PROGRESS
**Fase:** 290 — Qualificazione update e recovery

## Cosa devo fare

La parte repository è implementata. Apri questi file:

- `verification/update/QUALIFICATION_REPORT.md`: report versionato con 38 casi,
  risultato atteso, stato ed evidenza;
- `verification/update/README.md`: procedura operativa e regole per non salvare
  segreti;
- `tools/update_qualification.py`: legge header pubblico MCUboot, calcola hash e
  dimensioni, registra Git/board/device e controlla la completezza del report;
- `tools/tests/test_update_qualification.py`: verifica parser e controllo stati;
- `VERSION`: assegna all'app la prima versione Zephyr qualificabile `0.1.0+0`, così
  una build firmata con versione inferiore può provare il rifiuto del downgrade;
- `Makefile`: espone `update-qualification-manifest` e
  `update-qualification-check`.

La matrice copre per UART e Wi-Fi:

1. immagine valida completa;
2. immagine con firma, header o hash errati;
3. immagine più grande dello slot;
4. downgrade vietato;
5. disconnessione a 0%, 1%, 25%, 50%, 99% e prima del comando finale;
6. perdita di alimentazione durante scrittura e durante cambio stato;
7. reboot prima e dopo `BOOT_UPGRADE_TEST`;
8. crash, deadlock simulato e watchdog durante `TRIAL_BOOT`;
9. Config assente, Config corrotta e Storage temporaneamente illeggibile;
10. perdita Wi-Fi e console remota durante l'upload.
11. Config assente: UART maintenance attiva, rete spenta e nessun upload automatico;
12. Config valida con bootstrap assente, frame invalido e frame valido;
13. `maintenance reboot`: marker consumato una volta e nessun boot loop.

Per ogni prova registra versione iniziale/finale, slot attivo, swap type MCUboot,
conferma, stato Update, Config preservata e motivo dell'esito. Il manifest non legge valori segreti: segnala
soltanto nomi sospetti tracciati da Git e permessi locali non sicuri sotto `.keys/`.
Credenziali DTLS, password Wi-Fi e chiave privata non devono entrare nel report, nei
log o negli artefatti pubblicati.

La procedura di produzione deve distinguere: provisioning iniziale via USB che installa
MCUboot; aggiornamento locale dalla base; OTA Wi-Fi; recovery dalla base; eventuale
recovery fisica di fabbrica. Le operazioni eFuse/Secure Boot Espressif restano una
procedura separata e richiedono approvazione esplicita perché possono essere
irreversibili.

## Perché è fatto così

Una build riuscita non dimostra un aggiornamento sicuro. La proprietà importante è che
ogni interruzione lasci avviabile l'immagine precedente oppure una recovery locale
documentata.

## Come si usa

Costruisci e congela il candidato:

```sh
make pristine
make update-qualification-manifest \
  QUALIFICATION_BOARD_REVISION=core-v1-rev-a \
  QUALIFICATION_DEVICE_SERIAL=prototype-001
```

Copia il JSON stampato nella sezione Candidate del report. Deve mostrare
`git_dirty: false`, gli SHA-256 dell'app firmata e di MCUboot, zero file segreti
sospetti e zero permessi insicuri. Esegui poi ogni riga `Q-*` sull'hardware reale e
sostituisci `NOT RUN` con `PASS`, `FAIL` o un `N/A` motivato. Conserva sotto
`verification/update/` log e misure senza segreti.

Il client/base esterno invia il gruppo SMP Spaghetti 64. Nei test UART scollega la
USB dopo il provisioning iniziale; nei test Wi-Fi arma prima la finestra OTA dalla
Maintenance locale. Usa un interruttore di alimentazione controllabile per tagliare
power nei punti richiesti. Dopo ogni fault leggi `spaghetti status` e confronta
versione, slot, `confirmed`, stato Update e Config con il valore precedente.

## Checklist di completamento

- [x] Report, manifest, gate e test host sono implementati.
- [x] Tutti i fault richiesti hanno un caso e un risultato atteso esplicito.
- [ ] Tutta la matrice è eseguita e ripetibile su hardware.
- [ ] Nessun caso lascia entrambi gli slot non avviabili.
- [ ] Config e credenziali restano coerenti dopo rollback.
- [ ] Recovery dalla base funziona con USB non accessibile.
- [ ] La console remota non indebolisce autenticazione o firma OTA.

## Verifica e fine task

Esegui validator, test host, Twister completo e build pristine sysbuild. Dopo la
matrice hardware esegui:

```sh
make update-qualification-check
```

Il comando deve riportare 38 risultati finali, zero pending e zero failure. Oggi
termina intenzionalmente con codice 1 perché i casi fisici sono ancora `NOT RUN`: il
piano OTA diventa completo soltanto dopo evidenze reali di interruzione e recovery.

Prequalifica software eseguita: validator sorgenti e roadmap senza finding, 6 test
host superati, Twister completo con 24/24 configurazioni e 28/28 casi superati, build
pristine completata e `imgtool verify` riuscito sull'immagine firmata `0.1.0+0`.
