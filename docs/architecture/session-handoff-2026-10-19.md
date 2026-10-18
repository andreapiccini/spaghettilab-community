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
