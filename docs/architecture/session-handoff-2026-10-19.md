# Ripresa lavoro — 19 ottobre 2026

## Stato salvato

Il lavoro successivo a `7b17a54` comprende catalogo moduli, driver buzzer,
stepper ULN2003 e sequenza, LED RGB configurabile, DHT22, notifiche/NFC,
revisione deploy e collegamenti fisici, visualizzatore dati e trigger manuale.
La Backbone master `90:70:69:e1:c5:2c` è stata aggiornata a **0.5.15+0**.
Il lettore NFC `90:70:69:e1:80:30` resta a 0.5.1+0.

Nel progetto locale `trest` è stato salvato il collegamento:
**Genera trigger → DHT22 / Leggi temperatura → Visualizza dati**.
Il progetto del browser e le associazioni della libreria locale non fanno parte
assicurata del repository Git.

Genera trigger invia LOW/HIGH/LOW su comando manuale, senza occupare GPIO.
I risultati dei comandi armati entrano nella coda runtime e vengono inoltrati
come record tipizzati su USB al PC. Caricamento e verifica del programma riusciti;
i record LOW/HIGH/LOW sono stati osservati realmente sul collegamento USB.
Trigger e visualizzatore sono stati compattati e il fit automatico limita lo zoom.

## DHT22: problema ancora aperto

Cablaggio confermato dall'utente: DATA A0, VCC A1, GND comune.
La lettura reale restituisce `MODULE_COMMAND / INVALID_ARGUMENT`, senza una
causa elettrica dimostrata. Il firmware raggruppa EINVAL ed ERANGE nello stesso
stato protocollo: non attribuire il problema automaticamente al sensore.
Il visualizzatore resta correttamente in attesa, senza valori inventati.
I test nativi del driver completo e della conversione float passano.
Il profilo installato `drv.2653ab41b082ffff` corrisponde al profilo atteso.
La correzione del rilascio HIGH prima dell'ACK DHT22 è installata, ma non ha
risolto la prova reale. Restano da qualificare alimentazione, risposta sul filo
e causa precisa dell'errore. Non dichiarare conclusa la lettura hardware.

## Prossimo modulo richiesto: DS18B20

L'utente possiede anche una schedina DS18B20 con resistenza R1 e LED.
Attualmente riferisce DATA A0 e VCC A1, come il DHT22.
Ha chiesto di aggiungerla con la stessa filosofia:
inizializzazione, azioni con passi, ingresso trigger e uscita temperatura
compatibile con Visualizza dati.
**Il modulo DS18B20 non è ancora implementato.**

Il DS18B20 supporta alimentazione parassita, diversamente dal DHT22, ma la
schedina con LED/R1 deve essere identificata prima di scegliere il circuito.
Non basta scollegare VCC: la modalità parassita richiede VDD a GND e il corretto
strong pull-up durante la conversione. Per ora mantenere il cablaggio esistente;
verificare tipo di schedina e collegamenti prima di proporre modifiche fisiche.

## Verifiche effettuate

- Frontend: build e TypeScript passati; verifica finale completa con
  1.273 test software passati in 198 file.
- Firmware 0.5.15 compilato e caricato; native_sim: runtime 3, protocollo 7,
  comunicazione 12, profili dispositivo 30 test passati.
- DHT22 fisico: nessun valore valido confermato.
- Non sono stati modificati PCB o schematici hardware.

L'utente ha chiesto commit e push e di riprendere domani; non è stata pianificata
alcuna automazione o modifica hardware aggiuntiva.

## Aggiornamento successivo: sensore identificato come DHT11

L'utente ha chiarito che il sensore precedentemente chiamato DHT22 è un DHT11.
Implementati il modello DHT11 (start 20 ms, decodifica distinta, temperatura e
umidità) e un modulo separato DS18B20 parassita (solo DATA, conversione asincrona
750 ms, strong pull-up software durante conversione, CRC scratchpad e Stop).
Il template DHT22 salvato viene migrato preservando identità, pin e collegamenti;
il vecchio wire format DHT22 resta supportato per i profili già installati.
DS18B20 è nel catalogo, con azione, inizializzazione e trigger/temperatura come
altri sensori. Non riserva A1 e dichiara un solo sensore per DATA.

Firmware **0.5.16+0** caricato sul master verificato `90:70:69:e1:c5:2c`, ora su
`/dev/cu.usbmodem101`. Online verificato nell'app. Test software: 1277; test nativi
profili dispositivo: 33, inclusi DHT11 temperatura/umidità e DS18B20 completo.
Lettura fisica non ancora qualificata dopo l'identificazione corretta del sensore.
Durante la verifica l'utente ha sostituito autonomamente il DHT11 nel canvas con
DS18B20 e collegato Genera trigger e Visualizza dati; preservare le sue modifiche.
È stata chiesta conferma del cablaggio attuale, perché la schedina R1/LED potrebbe
non supportare il parassita senza adattamento. Non assumere che VCC sia già a GND.


## DS18B20: selezione alimentazione (0.5.17)

Aggiungi al canvas offre Parassita (DATA A0) e Da GPIO (DATA A0, POWER A1). La modalità è salvata nel deviceDraft della singola istanza e determina segnali, mappa fisica, inizializzazione e safe-stop. Sostituire un modulo alimentato con quello parassita libera POWER senza cancellare assegnazioni di altri moduli. Il protocollo resta 1-Wire. DS18B20_SETUP usa imm2=0 per parassita (retrocompatibile), powerChannel+1 per GPIO. GPIO: 1 s di avvio, DATA rilasciato durante conversione; parassita: DATA sostenuto HIGH durante 750 ms. Entrambi attendono senza bloccare USB.

Firmware 0.5.17 compilato e caricato via USB, hash verificato. Suite native device_profiles passata; suite software e build passate, test aggiuntivi coprono codec/persistenza modalità e rilascio A1. Nessuna lettura parassita qualificata su banco. Il cablaggio precedentemente dichiarato resta DATA A0 / VCC A1 / GND. Non basta rimuovere A1: sul sensore VDD deve andare a GND, DATA deve avere pull-up esterno a 3.3 V; controllare/adattare R1 e LED della schedina perché R1 potrebbe essere collegata a VCC. Nessun modulo del progetto è stato sostituito automaticamente durante la verifica UI.


## DS18B20 timing audit / firmware 0.5.18

The previous bus code called gpio_pin_configure twice per bit; ESP32 pad reconfiguration added uncontrolled latency to the 15 us read window. Transactions now configure input+open-drain+pull-up once at reset and use raw level writes for slots. Read requests LOW 2 us, samples after another 10 us, completes a 70 us slot. Write LOW is 6/60 us. Reset LOW 480 us, presence sample 70 us after release, recovery 410 us. Idle LOW and missing presence are distinguished. Push-pull HIGH is restricted to parasite conversion. Actual edge timing has not been measured with an oscilloscope; native simulation validates software sequencing, not GPIO/CPU latency.

Added six tests executing the shared wire implementation with an expensive fake pad configuration: LSB reads, sample timing, write pulse widths, strong-pullup placement, presence/stuck-line detection, error unlock. Six wire tests + existing device_profiles suite pass; backbone build succeeds. Firmware 0.5.18+0 flashed to MAC 90:70:69:e1:c5:2c, verified through GET_STATUS. Scratchpad decode failures now produce a bounded hex warning in firmware logs. USB shell log retrieval was unavailable, so no raw scratchpad was recovered.

Bench verification remains FAILED with DATA A0, VCC A1, GND: a diagnostic temporarily disabled schedules, waited for power warm-up, sent action 1 (BUSY/EAGAIN indicates conversion queued), waited 900 ms, then action 1 returned MALFORMED_REQUEST; original config was restored in finally. This response does not by itself distinguish scratchpad CRC/reserved-byte rejection from a later record-validation error. Do not claim a CRC-specific hardware diagnosis without raw bytes. Previous handoff wording about corrupted data should be read with this limitation. No valid temperature record/display qualified; no proof GPIO supply alone is responsible.


## RESOLVED: DS18B20 CRC-valid vendor bytes + runtime stack (0.5.21)

This supersedes the earlier failed-read diagnosis. A temporary diagnostic profile (DS18B20_READ imm1=1) recovered all nine bytes without decoding them. Three captured scratchpads included `74 01 00 00 7f e1 3c aa 72` and `73 01 00 00 7f e1 3c aa a2`. Dallas CRC8 matches 0x72 / 0xa2 exactly; temperatures are 23.25 / 23.1875 C. Firmware rejected these ONLY because reserved bytes 5/7 differ from expected 0xff/0x10. No proof of a defective sensor or GPIO voltage fault. The normal decoder now validates CRC, config bits and temperature range, but accepts CRC-covered vendor-specific reserved bytes. Regression tests use these captured frames and reject corruption/all-zero/all-FF input. Raw diagnostic mode is optional; ordinary installed profiles remain decoded/validated. Profile validation rejects raw-mode flags above 1. Codec roundtrip test added. The diagnostic profile was removed and original runtime config restored in finally.

After decoder fix 0.5.20, direct normal command returned 22.8125 C and the app displayed 22.5 C, but repeated manual triggers could still hang USB. Static disassembly found runtime_worker_entry reserving 1344 bytes and process_event 688 bytes, on the 3072-byte runtime stack, before nested driver execution. Moved worker-only event and record scratch into lifetime-owned allocations from the existing heap (retry before processing, no per-record allocation). No extra static DRAM; first static-buffer attempt exceeded DRAM and was replaced. Final compiled frames: worker 48 bytes, process_event 32 bytes. The failed-build flash attempt only reflashed the existing 0.5.20 signed image; final successful 0.5.21 build/flash verified separately.

Qualification on 0.5.21: 8 consecutive LOW/HIGH/LOW triggers, 8 temperature records delivered over USB, GET_STATUS successful after every cycle; values 23.1875–23.25 C. App reconnected on 0.5.21 and displayed 23.19 C via its manual-trigger button. GPIO wiring remains DATA A0 / VCC A1 / GND. Parasite operation has NOT been requalified; do not infer it from these powered tests. Temporary bridge TX/RX instrumentation was removed (no bridge source diff remains). USB transient observed before stack change is not a long-duration reliability qualification; tests cover repeated short runs.

Validation: device_profiles 36 tests + real wire algorithm 6 tests, runtime suite 3 tests, frontend typecheck and full software tests/build pass. Existing large dirty working tree remains; no commit/push requested for this turn.

## Schedule e prove one-shot (revisione richiesta dall'utente)

- Schedule è un contenitore disponibile senza una Porta fisica. Il pallino «Trigger Schedule» espone un trigger compatibile con gli ingressi delle azioni. Intervallo in secondi e opzione attivo nell'ispettore; inserimento anche con clic nella palette.
- Genera trigger resta manuale: non viene trasformato in timer quando si trova nel riquadro. Rimossi i collegamenti automatici Schedule→Genera trigger della prima proposta. Le connessioni manuale→azione e Schedule→stessa azione possono coesistere; ingressi a variabile restano a sorgente singola.
- Run Deploy confermato imposta la modalità continua: indicatore nel canvas, pulsanti manuali grigi/disabilitati. Stop prepara la modalità one-shot e conserva i collegamenti del progetto.
- Stop rimuove il runtime, attende il gap di scrittura e ricarica i driver senza ripetizioni. Serve a rieseguire l'inizializzazione dopo safe-stop (che spegne anche l'alimentazione GPIO dei sensori). I profili installati restano disponibili.
- La modalità one-shot mantiene esclusivamente i monitor di completamento dei profili DS18B20/DHT/stepper/RGB. Questi non iniziano nuove letture: completano conversioni già richieste o pubblicano stato/completamento. Disabilitarli insieme agli Schedule utente lasciava la conversione DS18B20 pendente dopo il primo clic.
- Prova reale FW 0.5.21: Schedule 2 s e trigger manuale collegati entrambi a Leggi temperatura DS18B20; valore continuo 24→24,13 °C, comando manuale disabilitato. Dopo Stop corretto, un clic produce 26,31 °C senza riavviare le ripetizioni. Nessun nuovo flash firmware necessario per questa funzione.
- Verifiche: typecheck, suite software completa e build riuscite. Nessun commit/push richiesto.

### Revisione successiva: il trigger è contenuto nello Schedule

L'ultima richiesta sostituisce la disposizione precedente: Genera trigger si inserisce nel riquadro Schedule e mantiene la sua uscita collegata al dispositivo esterno. L'app conserva la sorgente manuale per la modalità one-shot e compila una seconda attivazione dal clock dello Schedule verso la stessa azione. Non schedula la rappresentazione grafica del blocco. In continuo il pulsante interno resta grigio; dopo Stop torna utilizzabile nello stesso riquadro.

La relazione di appartenenza è esplicita nel grafo, nascosta nel disegno; non trascina nel contenitore sensori o visualizzatori a valle. Il pallino di ingresso precedente è nascosto quando contiene il generatore. Il riquadro cresce per contenere tutta la scheda. Spostamento da mouse e tastiera condividono la finalizzazione dell'inserimento; è gestito anche il rilascio senza un ultimo evento di posizione. Estraendo il trigger si rimuove solo l'appartenenza, conservando il filo verso il dispositivo. Collegamenti diretti legacy dello stesso Schedule vengono rimossi durante l'inserimento e deduplicati nel compilatore.

Prova reale: trigger inserito nello Schedule 2 s → DS18B20 → visualizzatore, caricamento confermato, temperatura 23,5 °C e comando manuale grigio. Dopo Stop, un clic sullo stesso pulsante interno restituisce 23,69 °C. Nessun flash firmware aggiuntivo.
