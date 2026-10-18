# Moduli e driver ULN2003 / 28BYJ-48

Implementazione del 18 ottobre 2026.

## Moduli

La voce laterale Moduli riunisce i driver GPIO/I²C compatibili con il runtime: ULN2003, Relè, Buzzer attivo e driver pronti salvati dall’utente nel progetto o nella libreria NFC. Istantanee di singole unità installate non diventano nuovi modelli del catalogo.

L’inserimento propone la mappatura prima di modificare il progetto. GPIO singolo usa il primo canale, I²C SDA/SCL i primi due, ULN2003 i quattro canali runtime. Le etichette seguono il connettore v1/v2 riconosciuto. Un conflitto mostra i moduli coinvolti: Mantieni esistenti annulla l’importazione; Usa il nuovo modulo rimuove i moduli incompatibili e i loro collegamenti dal canvas, conservando i driver in libreria. L’operazione sul progetto è annullabile tramite il normale storico.

Con master collegato si interrompe il runtime, si rispetta l’intervallo fra scritture Config e si applicano i pin. Durante questa operazione il polling NFC è sospeso; una scrittura NFC già attiva impedisce di iniziare l’importazione. La topologia viene riletta prima dell’applicazione e, se i conflitti sono cambiati, occorre rivedere la proposta. Offline si salva soltanto la proposta con `applied: false`: Module Function deve essere applicato dopo il collegamento, prima del deploy. Non viene simulata una conferma hardware.

## Motore

Driver `uln2003-28byj48`, per il classico 28BYJ-48 da 5 V e scheda ULN2003. Sequenza IN1–IN4 a mezzo passo: 1,3,2,6,4,12,8,9. Quattro uscite predefinite 0–3 del Function connector, a livello basso all’inizializzazione.

- Start: rotazione continua in avanti.
- Stop: arresta la sequenza mantenendo le bobine energizzate per la coppia di mantenimento.
- Vai a posizione: ingresso intero 0–360°, percorso più breve rispetto alla posizione stimata corrente. 360° corrisponde a 0°. Valori fuori intervallo e non interi vengono rifiutati.
- Stop generale, rimozione e riconfigurazione: annullano il lavoro differito prima di rilasciare tutte le bobine.

Il driver parte fermo. Lo zero è la posizione assunta all’attivazione del driver, anche dopo un nuovo deploy. Non esiste homing né misura assoluta: dopo spegnimenti, movimenti manuali o passi persi la posizione meccanica può differire da quella stimata. 4096 mezzi passi/giro e intervallo 3 ms sono valori nominali; la riduzione effettiva va calibrata per la precisione necessaria. [Datasheet di riferimento 28BYJ-48](https://download.mikroe.com/documents/datasheets/step-motor-5v-28byj48-datasheet.pdf).

Ogni blocco del modulo conserva la normale selezione di una sola azione. Start/Stop scelgono di default il trigger Esegui; Vai a posizione sceglie l’ingresso numerico. Più blocchi dello stesso modulo condividono un’unica istanza motore. Start e Stop non richiedono la ricezione preventiva della posizione.

## Firmware

Master 0.5.5, opcode STEPPER 34, opcode vocabulary 6. Il comando ritorna subito: la workqueue di sistema esegue una sola transizione per callback. Nessun thread/stack aggiuntivo. Un solo motore per MCU, con proprietà esclusiva della porta; il backend GPIO attuale supporta i primi quattro segnali. Non è un generatore di moto hard real-time. I comandi non permettono di cambiare mappa dei pin o passi/giro su un’istanza già attiva.

L’immagine firmata 0.5.5+0 è stata caricata sul master MAC 90:70:69:e1:c5:2c, sola applicazione a 0x20000, con verifica hash e successiva identificazione tramite USB. Prima dell’aggiornamento il runtime è risultato già fermo; una copia della configurazione è stata salvata negli artefatti della sessione. Il lettore NFC non è stato aggiornato.

DRAM statica del master: 383080 / 384256 byte, margine linker 1176 byte. Il margine linker non rappresenta l’heap libero.

## Verifica e limiti

428 test applicazione, 61 test modello profili e 22 test codec/installazione superati; typecheck, build e lint dei nuovi componenti Moduli superati. 17 test firmware device_profiles superati, inclusi movimento non bloccante, arrivo alla posizione, Stop, rilascio alla rimozione e proprietà esclusiva dei quattro pin. Build ESP32-S3 riuscita.

Prova UI su build di produzione e progetto demo separato: importazione offline, selezione azione/ingresso, popup di conflitto. Non è stato avviato il motore fisico: cablaggio, verso e precisione meccanica richiedono ancora una prova sul banco. Il firmware è installato, ma i test software non costituiscono una qualificazione del motore collegato.

### Continuous cadence correction (firmware 0.5.7)

Motor phases now run from a periodic kernel timer, using the ESP32 GPIO driver's nonblocking raw register writes. They no longer share the system work queue with NFC RF polling and synchronous CAN discovery. A spinlock serializes phase updates and Stop/release; no additional worker stack is allocated. The regression test deliberately blocks the system work queue, checks that phases still advance, and checks that no writes occur after release. Native device-profile suite: 18 passed. Physical smoothness still requires observation of the motor.
