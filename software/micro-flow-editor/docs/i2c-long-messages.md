# Messaggi I²C lunghi

Un passo **Scrivi** accetta fino a 2048 byte effettivi, includendo l'espansione dei riferimenti alle variabili. Non richiede una modalità di trasferimento. Il runtime invia un solo `i2c_msg`, con STOP esclusivamente alla fine; l'alimentazione della FIFO è gestita dal controller ESP32. Due passi restano due transazioni distinte. Non vengono aggiunti indirizzi o prefissi ai dati.

Richiede firmware 0.3.7 o successivo con opcode set 5 / profili wire 3. I profili esistenti wire 1 e 2 rimangono supportati. Il combinato scrittura-lettura conserva per ora il limite di 32 byte TX / 8 RX; questa modifica riguarda il passo Scrivi.

Il compilatore conserva i byte costanti nel profilo e usa MESSAGE_LOAD, eventuali MESSAGE_PATCH dalle variabili, e I2C_MESSAGE_WRITE. I normali otto temporanei rimangono da 32 byte. I template identici vengono riutilizzati; il limite aggregato dei dati distinti di un profilo è 3072 byte, con un CBOR massimo di 4096 byte. Questi limiti sono verificati prima dell'esecuzione e non comportano troncamenti.

La memoria viene allocata secondo necessità:

- Un workspace da 2048 byte soltanto durante l'esecuzione di un piano con messaggi lunghi; protetto da un lock con attesa limitata e liberato anche dopo errori I²C.
- Il CBOR di ogni profilo installato, nella sua dimensione effettiva, con quota aggregata di 16384 byte e controllo degli errori dell'allocatore. I riferimenti ai template puntano alla copia posseduta dal catalogo, mai al pacchetto di installazione temporaneo.
- Un'area temporanea per il caricamento di un profilo, grande quanto il profilo stesso; liberata al completamento, in caso di errore del proprietario o dopo 60 secondi d'inattività.

Il protocollo di comunicazione conserva il suo limite di pacchetto: il client SDK carica i profili grandi in blocchi da 400 byte usando i campi opzionali offset, totale e token delle operazioni VALIDATE/INSTALL_DEVICE_PROFILE. Il Core verifica proprietario, tipo di operazione, ordine e dimensione; valida o installa solo dopo aver ricevuto tutti i dati. La frammentazione riguarda il caricamento del profilo, non il trasferimento I²C.

Il timeout del messaggio ha un minimo calcolato a 100 kHz con margine e tiene conto di un eventuale timeout maggiore esplicito. Non introduce tentativi automatici di scrittura, che potrebbero duplicare gli effetti sul dispositivo. La lettura e l'installazione dei vecchi profili non richiedono migrazioni.
