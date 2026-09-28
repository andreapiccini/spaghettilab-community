# TASK-165-01 — Salvare e selezionare reti Wi-Fi

**Stato:** ✅ DONE
**Fase:** 165 — Profili Wi-Fi persistenti

## Cosa devo fare

Apri `include/spaghetti/wifi_profiles.h`: contiene la API pubblica già implementata.
`struct spaghetti_wifi_profile_config` possiede SSID, security, lunghezza e password;
il puntatore `const` passato a `spaghetti_wifi_profiles_set()` è prestato solo durante
la chiamata e viene copiato. `struct spaghetti_wifi_profile_summary` non contiene la
password ed è la sola forma restituita da `spaghetti_wifi_profiles_list()`.

Le firme complete sono:

```c
int spaghetti_wifi_profiles_init(void);
int spaghetti_wifi_profiles_set(
	const struct spaghetti_wifi_profile_config *config);
int spaghetti_wifi_profiles_remove(const char *ssid);
int spaghetti_wifi_profiles_set_preferred(const char *ssid);
int spaghetti_wifi_profiles_clear_preferred(void);
int spaghetti_wifi_profiles_list(
	struct spaghetti_wifi_profile_summary *out,
	size_t capacity,
	size_t *out_count);
int spaghetti_wifi_profiles_request_connect(void);
int spaghetti_wifi_profiles_get_status(
	struct spaghetti_wifi_profiles_status *out);
```

Apri poi `subsys/services/wifi_profiles/wifi_profiles.c`. Il `context` privato possiede
un array statico di slot: è bounded e vive per tutto il firmware. Il worker esegue:

1. copia in una snapshot solo le reti note;
2. chiede a Zephyr una scansione con `NET_REQUEST_WIFI_SCAN`;
3. mette prima la preferita, se visibile;
4. ordina le altre per RSSI decrescente;
5. carica un solo segreto, chiama `NET_REQUEST_WIFI_CONNECT`, quindi lo azzera;
6. prova il candidato successivo oppure ripete dopo il timeout Kconfig.

Apri `wifi_profiles_storage.c`: codifica campi espliciti, non salva una struct C grezza,
e usa `psa_its_set/get/remove`. Apri `communication_shell.c`: `wifi add` legge la
password con `shell_readline()` e `shell_obscure_set()`, mentre list/prefer/remove e
connect non ricevono segreti.

In `prj.conf`, `CONFIG_MAIN_STACK_SIZE=4096` riserva lo stack usato dal boot per
caricare e autenticare i record PSA. Non lasciare il default da 2048 byte: la catena
crittografica ESP32-C3 può oltrepassarlo e corrompere lo stack idle adiacente.

## Perché è fatto così

Zephyr `net_mgmt` è la API runtime che invia richieste al device Wi-Fi e notifica
scan, connessione e disconnessione. PSA ITS è la API runtime di Secure Storage: qui
trasforma ogni record con AES-GCM e lo salva tramite Settings/NVS. Il key provider
Zephyr 4.4 basato sul device ID non è una root hardware forte; non vengono bruciati
eFuse automaticamente perché l'operazione è irreversibile.

La Config dei Module rimane invariata: reti e password sono configurazione del Core,
non identificano un Module. Tutto il lavoro lento appartiene al worker, quindi seriale,
Runtime e MQTT mantengono il comportamento esistente.

## Come si usa

```text
spaghetti wifi add "Office" wpa2
Password (input is hidden):
spaghetti wifi add "Guest" open
spaghetti wifi prefer "Office"
spaghetti wifi unprefer
spaghetti wifi list
spaghetti wifi connect
spaghetti wifi remove "Guest"
```

Da codice, `spaghetti_core_init()` chiama `spaghetti_wifi_profiles_init()` dopo
Settings. La app futura usa le stesse funzioni pubbliche; non deve leggere NVS.

## Checklist di completamento

- [x] Più profili hanno capacità fissa e nessun heap.
- [x] La preferita vince solo quando è visibile.
- [x] Senza preferita visibile vince il profilo noto con RSSI più alto.
- [x] Password e record temporanei vengono azzerati dopo l'uso.
- [x] Lo stack main copre le letture PSA/AES-GCM eseguite durante il boot.
- [x] I comandi seriali precedenti sono rimasti invariati.

## Verifica e fine task

Esegui:

```sh
make validate
make pristine
docker compose run --rm dev west twister -T tests -p native_sim/native/64 \
  --inline-logs --no-clean
make flash
make monitor
```

Salva due reti, imposta la più debole come preferita e verifica con `spaghetti wifi
list` che venga scelta. Spegnila e richiedi `spaghetti wifi connect`: deve collegarsi
alla rete nota col RSSI maggiore. Riavvia e verifica che i profili siano ancora
presenti. `strings build/zephyr/zephyr.bin` non deve mostrare la password usata.
