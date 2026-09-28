# TASK-270-01 — Aggiungere OTA Wi-Fi autenticato

**Stato:** ✅ DONE
**Fase:** 270 — OTA Wi-Fi

## Cosa devo fare

Il risultato è questo flusso:

```text
maintenance UART locale -> salva PSK + arma marker one-shot -> reboot NORMAL
Wi-Fi -> DTLS-PSK :1337 -> SMP Spaghetti -> Update -> image-1 -> MCUboot trial
```

Prima di scrivere il trasporto, verifica Zephyr 4.4. `smp_udp_open()` esiste, ma il
backend DTLS standard richiede certificato e chiave privata del server senza imporre
esplicitamente l'autenticazione del client. Non è sufficiente per il confine richiesto.
Usa quindi le API SMP Zephyr (`smp_transport_init()`, `smp_packet_alloc()`,
`smp_rx_req()`) sopra un socket UDP DTLS-PSK privato. PSK significa *pre-shared key*:
client e Core dimostrano entrambi di conoscere lo stesso segreto durante l'handshake.

Apri `include/spaghetti/ota.h` e definisci:

```c
#define SPAGHETTI_OTA_PSK_SIZE 32U
#define SPAGHETTI_OTA_IDENTITY_MAX_SIZE 32U

enum spaghetti_ota_state {
	SPAGHETTI_OTA_UNINITIALIZED,
	SPAGHETTI_OTA_CLOSED,
	SPAGHETTI_OTA_ARMED,
	SPAGHETTI_OTA_ERROR,
};

struct spaghetti_ota_status {
	enum spaghetti_ota_state state;
	uint16_t port;
	bool credentials_present;
	int last_error;
};
```

La struct è pubblica e copiata al chiamante. Non contiene il segreto: `state` descrive
il listener, `port` è la porta UDP, `credentials_present` dice solo se esiste un record
e `last_error` conserva l'ultimo errno. Tutti i campi vivono nella copia del chiamante.

Scrivi le firme pubbliche seguenti:

```c
int spaghetti_ota_init(void);
int spaghetti_ota_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size);
int spaghetti_ota_clear_credentials(void);
int spaghetti_ota_request_once(uint32_t timeout_ms);
int spaghetti_ota_arm(uint32_t timeout_ms);
int spaghetti_ota_cancel(void);
bool spaghetti_ota_is_transport(const struct smp_transport *transport);
int spaghetti_ota_get_status(struct spaghetti_ota_status *out);
void spaghetti_ota_cancel_after_response(void);
void spaghetti_ota_prepare_reboot(void);
```

`psk` e `identity` sono puntatori `const` perché il servizio legge memoria del
chiamante senza modificarla né conservarne il puntatore; le size sono per valore e
rendono i buffer verificabili. `timeout_ms` è per valore perché è un piccolo limite
copiato. `transport` è un'identità Zephyr presa in prestito e non modificata. `out` è
scrivibile, caller-owned e valido solo durante la chiamata. Gli `int` restituiscono
zero o errno negativo; il predicato e le due notifiche finali sono infallibili.

Apri `subsys/services/ota/ota.c`. Usa mutex, contesto statico e workqueue privata,
senza allocazioni heap dirette del servizio; socket/TLS usa il heap globale Zephyr con
numero di contesti e sessioni limitato da Kconfig. Implementa in ordine:

1. `set/clear_credentials()` accettano modifiche soltanto con Maintenance Link
   `ACTIVE`; il backend salva un record versionato in PSA ITS.
2. `request_once()` richiede Config persistente e credenziali, verifica
   `1..CONFIG_SPAGHETTI_OTA_MAX_WINDOW_MS` e salva un marker consumabile una volta.
3. `init()` viene chiamata solo nel boot `NORMAL`, consuma il marker e lascia il
   listener chiuso se manca. Un record corrotto viene eliminato senza bloccare il boot.
4. `arm()` arma prima Update e apre poi DTLS; se l'apertura fallisce cancella Update.
5. timeout, perdita Wi-Fi o `cancel()` chiudono il socket e cancellano solo `image-1`.
6. dopo l'ultimo chunk lascia partire la risposta SMP, poi chiudi il socket e riavvia
   senza cancellare il candidato `PENDING_REBOOT`.

Apri `subsys/services/ota/ota_dtls.c`. Il record privato contiene magic, versione,
marker/timeout, PSK di 32 byte e identity lunga al massimo 32 byte. Appartiene al
servizio per tutta la vita del dispositivo; una copia plaintext esiste in RAM solo
mentre il listener è aperto e viene azzerata alla chiusura. PSA ITS applica AEAD, ma
sull'ESP32-C3 attuale la chiave deriva dal device ID: protegge da letture accidentali,
non sostituisce Secure Boot/flash encryption contro un attaccante fisico.

Apri un socket `NET_IPPROTO_DTLS_1_2`, forza
`TLS_PSK_WITH_AES_128_GCM_SHA256`, ruolo server e porta 1337. Il thread riceve al
massimo 512 byte, copia indirizzo peer nei `user_data` del `net_buf` e consegna il
pacchetto al worker SMP. La risposta usa lo stesso indirizzo. Registra gli eventi
Zephyr di perdita IPv4/disconnessione Wi-Fi per avviare la cancellazione.

Apri `subsys/services/maintenance_link/maintenance_mgmt.c`. Mantieni il solo gruppo
Spaghetti 64; non abilitare i gruppi generici Image, Shell, FS o OS. Aggiungi:

| ID | Accesso | Richiesta |
|---:|---|---|
| 7 | solo UART locale | `{"psk": bstr(32), "identity": tstr(1..32)}` |
| 8 | solo UART locale | `{"timeout_ms": uint}`; salva marker e riavvia |
| 9 | solo UART locale | mappa vuota; elimina credenziali |

Su DTLS autenticato ammetti soltanto stato (ID 0), upload (ID 5) e cancel (ID 6).
Il primo chunk prende Update con `SPAGHETTI_UPDATE_TRANSPORT_UDP`; chunk successivi
devono avere stesso trasporto, `total` e offset contigui. Prima di scrivere confronta
`total` con:

```c
int spaghetti_update_get_capacity(size_t *out_size);
```

`out_size` è memoria del chiamante scritta sincronicamente. Il backend apre
`image-1` e usa `boot_get_trailer_status_offset(area->fa_size)`: così il limite è la
capacità reale prima del trailer MCUboot, non un numero duplicato.

Apri `subsys/core/core.c`: dopo `spaghetti_wifi_profiles_init()` nel solo ramo
`NORMAL`, chiama `spaghetti_ota_init()`. I rami `UNPROVISIONED` e `MAINTENANCE`
rimangono offline e non aprono mai la porta. MCUboot continua a rifiutare downgrade e
firma non valida; DTLS autentica il peer, non l'immagine.

## Perché è fatto così

Una porta sempre aperta aumenta la superficie di attacco e consente consumo di CPU e
flash. Qui sono necessarie tre autorizzazioni separate: presenza del marker one-shot,
possesso della PSK e firma MCUboot. Nessun client di rete può cambiare Config, Wi-Fi,
chiavi o confermare definitivamente un'immagine. Timeout e perdita rete non toccano
l'immagine attiva, Config o profili Wi-Fi.

## Come si usa

Durante una maintenance UART locale, la base genera una PSK casuale da 32 byte e invia
prima il comando ID 7, poi ID 8 con un timeout massimo di 300000 ms. Il Core riavvia in
`NORMAL`, si collega a una rete nota e apre UDP 1337 una sola volta. Il client DTLS usa
la stessa PSK/identity, legge lo stato con ID 0 e invia l'immagine firmata con ID 5:

```c
spaghetti_ota_init();
spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UDP);
spaghetti_update_write(offset, chunk, chunk_size, last);
spaghetti_update_finish();
```

Queste chiamate mostrano il flusso interno: il client esterno invia frame SMP, non
chiama direttamente C. Dopo il reboot il candidato parte trial; Core lo conferma solo
dopo la health window. Fuori dalla finestra UDP 1337 resta chiusa.

## Checklist di completamento

- [x] Credenziali e armamento sono modificabili solo dalla maintenance UART locale.
- [x] Il listener DTLS-PSK è chiuso al boot normale senza marker.
- [x] L'OTA riusa il gruppo SMP ristretto e il coordinatore Update esclusivo.
- [x] Dimensione, offset, trasporto, timeout e capacità `image-1` sono bounded.
- [x] Timeout/perdita rete eliminano solo il candidato incompleto.
- [x] Core non avvia OTA nei modi unprovisioned o maintenance.

## Verifica e fine task

Esegui:

```sh
make build
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests -p native_sim/native/64 --inline-logs \
  --outdir build/twister-all --clobber-output'
./validator
./validator roadmap
```

La build V1 firmata deve terminare senza errori; tutti i test, incluso
`spaghetti.ota.policy`, devono passare; entrambi i validator devono riportare zero
errori. Le prove fisiche con PSK errata, rete/power loss, downgrade, firma alterata e
rollback restano nella matrice hardware del task 290.
