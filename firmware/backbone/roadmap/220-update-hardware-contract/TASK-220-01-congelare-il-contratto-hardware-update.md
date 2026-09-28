# TASK-220-01 — Definire il contratto astratto del Maintenance Link

**Stato:** ✅ DONE
**Fase:** 220 — Contratto astratto Maintenance Link

## Cosa devo fare

Non modificare ancora `.c`, `.h`, DTS, Kconfig o CMake. Crea
`UPDATE_HARDWARE_CONTRACT.md` nella root e definisci il Maintenance Link come capability
fornita dalla variante Core. Il firmware comune deve vedere operazioni logiche, mai
numeri GPIO:

```c
int spaghetti_maintenance_link_init(void);
int spaghetti_maintenance_link_probe(uint32_t timeout_ms, bool *requested);
int spaghetti_maintenance_link_enter(
	enum spaghetti_maintenance_entry_reason reason);
int spaghetti_maintenance_link_leave(void);
```

`probe()` ascolta un payload di ingresso bounded senza trasmettere. `enter()` rende
disponibile il canale locale dopo avere escluso il bus normale. `leave()` ripristina il
bus normale ed è idempotente. `reason` distingue Config assente, frame di bootstrap e
richiesta one-shot, ma non sceglie pin.

Per Core V1 documenta GPIO3 come I2C SDA/UART RX e GPIO4 come I2C SCL/UART TX. Questa
mappatura appartiene esclusivamente a DTS e pinctrl. Una nuova Core deve fornire lo
stesso contratto tramite il proprio overlay, anche usando pin o controller differenti.

Definisci tre ingressi:

1. Config assente o invalida: maintenance locale immediata, senza Wi-Fi;
2. Config valida: breve probe RX al boot; solo un payload valido entra in maintenance;
3. comando autenticato in esecuzione: salva `maintenance/boot_once` e riavvia; Core
   consuma il marker prima di entrare, così non crea un boot loop.

Maintenance non scrive automaticamente firmware. Config/provisioning e Image
Management restano comandi successivi e separati.

## Perché è fatto così

Il driver I2C ESP32-C3 di Zephyr 4.4 non supporta la modalità target e `mcumgr` non ha
un trasporto I2C. Il backend può però riutilizzare SDA/SCL come UART dopo avere fermato
I2C. L'astrazione permette a una Core diversa di realizzare la stessa funzione senza
modificare Update, Core o Communication.

## Come si usa

Il documento prodotto è il contratto usato dai task 250 e 260. Senza Config la base
trova direttamente UART locale. Con Config invia il frame durante la finestra iniziale
oppure richiede un reboot one-shot attraverso un canale già autenticato.

## Checklist di completamento

- [x] Le API comuni non contengono GPIO o controller concreti.
- [x] Core V1 mappa la capability su GPIO3/GPIO4 solo nella descrizione board.
- [x] Config assente entra direttamente in maintenance locale.
- [x] Payload al boot e reboot one-shot non persistono come stato Update.
- [x] Il passaggio I2C → UART → I2C ha ownership e rollback definiti.

## Verifica e fine task

Esegui `./validator roadmap` e controlla che `UPDATE_HARDWARE_CONTRACT.md` non assegni
GPIO alle API comuni. Il task termina quando una nuova Core può cambiare mappatura
modificando board/overlay senza cambiare il coordinatore Update.
