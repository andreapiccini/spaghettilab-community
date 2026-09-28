# Change contract: profili Wi-Fi persistenti e selezione automatica

## Scope

- Task: salvare profili Wi-Fi nel dispositivo, scegliere una rete preferita e usare
  come fallback la rete conosciuta visibile con RSSI maggiore.
- Required observable outcome: dopo un reboot il Core prova prima la rete preferita,
  se visibile, altrimenti ordina le reti conosciute visibili per RSSI; la seriale
  permette add, list, prefer, remove e connect senza mettere password nella history.
- Explicitly excluded behavior: WPA Enterprise, provisioning remoto, modifica della
  Config dei Module, disabilitazione della seriale, programmazione automatica eFuse,
  Secure Boot e Flash Encryption.
- Component that owns the change: `Wi-Fi Profiles`.
- Files allowed to change: API e sorgenti del nuovo componente, adapter Shell,
  bootstrap Core, CMake/Kconfig/prj.conf, test, README e roadmap collegati.

## API

- Public header: `include/spaghetti/wifi_profiles.h`.
- Public operations: init, set, remove, set/clear preferred, list, request connect e
  get status.
- Return type: `int`, perché storage, stato, capacità e rete possono fallire.
- Inputs: SSID testuale da 1 a 32 byte; security open o WPA2-PSK; password da 8 a 64
  byte per WPA2 e zero byte per open.
- Ownership: ogni input è prestato solo durante la chiamata e copiato; list/status
  scrivono snapshot caller-owned solo su successo; nessun output espone password.
- Errors: `-EINVAL`, `-EACCES`, `-EALREADY`, `-ENOENT`, `-ENOSPC`, `-ENOTSUP`,
  `-EBUSY` e `-EIO` secondo il contratto di ogni funzione.
- Timeout: il prompt password attende al massimo 60 secondi; scan, connect e
  disconnect hanno timeout Kconfig bounded.
- Thread safety: un mutex serializza profili, Secure Storage e snapshot; callback di
  rete usano solo snapshot immutabili, atomiche e semafori.

## Data and ownership

- New mutable object: massimo `CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT` metadati e
  uno stato di connessione.
- Owner: `subsys/services/wifi_profiles/wifi_profiles.c`.
- Lifetime: dal primo init fino al reboot.
- Secret lifetime: la password cifrata resta in PSA ITS; compare in RAM solo durante
  set/decrypt/connect e il buffer viene azzerato prima del ritorno o del prossimo wait.
- Persistence: record byte-oriented versionati, uno per slot, più un record separato
  per la preferenza; nessuna serializzazione diretta di struct o enum C.
- Allocation: array, stack, thread e semafori statici; nessun heap nel codice
  Spaghetti. PSA Crypto e il driver ESP32 conservano le proprie allocazioni Zephyr.
- Failure state: un write fallito non aggiorna la cache; un profilo corrotto viene
  ignorato; rete assente lascia il servizio retryable senza fermare Core o MQTT.

## Execution

- Invocation context: init dal boot thread, mutazioni dalla shell thread, politica di
  rete da una thread Wi-Fi Profiles dedicata, eventi da callback `net_mgmt`.
- Blocking: set/remove/prefer possono fare flash I/O; la worker può attendere soltanto
  entro timeout configurati; i producer Runtime/Data non chiamano il componente.
- Mechanism: chiamate dirette per storage/query, semafori per eventi, una worker per
  possedere scan/connect/retry.
- Queue/full policy: non c'è una coda di password; richieste connect multiple vengono
  coalesciate in un semaforo binario.
- Logging: un solo modulo `spaghetti_wifi_profiles`; SSID ammessi nei log, password e
  record cifrati mai registrati.

## Configuration and hardware

- Devicetree: usa l'interfaccia Wi-Fi station già fornita dalla board ESP32-C3; non
  aggiunge pin o partizioni.
- Kconfig: capacità profili, stack/priorità e timeout bounded; Secure Storage ITS con
  AES-GCM e backend Settings sulla partizione `storage_partition` esistente.
- Security boundary: il provider Zephyr 4.4 disponibile usa un hash dell'identità
  dispositivo e dichiara di non essere una root key sicura contro attacco fisico. Le
  eFuse non vengono bruciate implicitamente. Secure Boot/root key hardware restano una
  procedura production esplicita.
- Runtime Config: i segreti non entrano in `struct spaghetti_config` o CBOR.
- CMake: compila i due sorgenti del servizio e l'adapter Shell esistente.

## Verification

- Success: add/list/prefer/remove e reload da ITS.
- Invalid input: SSID/password/security e puntatori invalidi.
- Boundary: capacità piena, SSID 32 byte e password 64 byte.
- Policy: preferita visibile prima; preferita assente usa RSSI massimo; fallimento passa
  al candidato successivo.
- Build: `make validate`, Twister completo e `make pristine`.
- Hardware: inserimento password oscurato, reboot, auto-connect, AP preferito assente,
  fallback RSSI, rimozione profilo e seriale ancora disponibile.
