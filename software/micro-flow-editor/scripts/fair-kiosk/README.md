# Maker Faire: questionario e demo sul Raspberry

Il software resta sul branch `pi-demo`. L'installazione non cambia commit, firmware,
configurazioni hardware o progetti. Chromium usa il profilo già esistente e apre
la demo e un solo questionario, a tutto schermo; italiano è la lingua iniziale.

## Comandi dal Mac

Dalla cartella `software/micro-flow-editor`:

```sh
sh scripts/fair-kiosk/remote.sh italiano
sh scripts/fair-kiosk/remote.sh inglese
sh scripts/fair-kiosk/remote.sh demo
sh scripts/fair-kiosk/remote.sh questionario
sh scripts/fair-kiosk/remote.sh stato
```

`italiano` e `inglese` selezionano la lingua. Cambiare lingua sostituisce il
questionario precedente: farlo prima che il partecipante inizi a rispondere.
`demo` attiva solo la tab della demo: non avvia automaticamente l'hardware.
`questionario` torna alla stessa pagina aperta, senza modificarne URL, risposte o
posizione. I comandi confermano l'attivazione della tab, non il caricamento dei
servizi Google, che richiede Internet.

## Base della demo e partecipante successivo

1. Mostrare la demo, aprire il progetto desiderato e configurarlo.
2. Eseguire `sh scripts/fair-kiosk/remote.sh salva-base` una sola volta, o quando
   si vuole cambiare esplicitamente la base. Salva il progetto aperto e una copia
   iniziale separata, inclusi blocchi, collegamenti, moduli e impostazioni.
3. Usare `sh scripts/fair-kiosk/remote.sh ripristina` tra due partecipanti.
   Prima conferma lo Stop sulle Backbone connesse, poi ripristina il progetto e
   apre un questionario nuovo nella lingua selezionata. Se lo Stop fallisce, non
   ripristina il progetto e non sostituisce il questionario. Conserva anche una
   copia del progetto precedente in `spaghettilab.fair.previous.v1`.
4. Avviare e caricare il programma con i controlli normali dell'app.

`stop` usa lo stesso arresto del Flow dell'app, mantenendo il progetto a schermo.
Il ripristino non reinstalla firmware né fa pull o reset di Git. Per mantenere
la versione approvata durante la fiera non aggiornare il repository.
Al riavvio `?fair=1` prepara un canvas vuoto e mostra il questionario italiano.
Moduli e impostazioni hardware della base restano disponibili, senza caricare
blocchi o collegamenti. `ripristina` riapre esplicitamente la base salvata.

Usare i Form senza un account Google personale collegato al chiosco; verificare
le impostazioni di salvataggio delle bozze nei due Form prima della fiera.
Il controllo non compila, legge o invia risposte. Non invoca il pulsante Invia.
Chiudere il browser, riavviare il Raspberry o cambiare lingua durante la
compilazione può perdere la sessione del questionario.

## Installazione

Sul Raspberry, con Chromium e l'app già configurati:

```sh
cd ~/spaghettilab-community/software/micro-flow-editor
sh scripts/fair-kiosk/install.sh
```

Installa un servizio systemd **utente**, un'estensione Chromium e il comando
`~/.local/bin/spaghettilab-fiera`. Il controllo ascolta solo su `127.0.0.1:8767`,
usa un token locale e non occupa la porta USB delle Backbone. Non richiede nuove
dipendenze Python. Il servizio deve essere raggiungibile prima di inviare comandi.

Il browser non viene riavviato dall'installer: salvare prima i progetti aperti.
Dopo il riavvio l'estensione viene caricata dal launcher `microflow-kiosk`.
La copia precedente del launcher è `~/.local/bin/microflow-kiosk.before-fair`.

Per disattivare, ripristinare quel launcher e usare:

```sh
systemctl --user disable --now spaghettilab-kiosk.service
```

I questionari configurati sono:
- Italiano: https://forms.gle/9FZeA8Nia5YQjBG99
- Inglese: https://forms.gle/JYR3mTrTidfDf5E38

## Mostrare anche la dashboard

```sh
sh scripts/fair-kiosk/remote.sh dashboard
sh scripts/fair-kiosk/remote.sh demo
```

`dashboard` avvia su richiesta un server statico su `127.0.0.1:8080` nello stesso
piccolo processo Python del chiosco e apre una tab Chromium. Non avvia Docker,
Flutter, MQTT o collegamenti alle Backbone. Mostra la dashboard esistente con
FakeHost e dati simulati, saltando il login solo in questa build da presentazione.

`demo` torna al canvas senza ricaricarlo, chiude la tab della dashboard e ferma il
server statico. Anche passare a un questionario libera la dashboard. Se il cambio
di tab fallisce, la dashboard resta disponibile; `stato` riporta se il server è acceso.
La dashboard riparte dai dati demo quando viene riaperta: le modifiche fatte nella
presentazione non vengono conservate.

Per preparare o aggiornare la build, **sul computer di sviluppo**:

```sh
cd software/dashboard
sh scripts/build-fair-web.sh
```

Trasferire il contenuto di `app/build/web/` in
`~/.local/share/spaghettilab-kiosk/dashboard-web/` sul Raspberry. I sorgenti
`software/dashboard` devono restare nel repository per gli aggiornamenti, ma non
serve installare gli strumenti di sviluppo sul Raspberry.
