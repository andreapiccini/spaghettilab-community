# TASK-355-01 — Definire identità, credenziali e reset

**Stato:** ✅ DONE
**Fase:** 355 — Identità, credenziali e reset

## Cosa devo fare

Crea `include/spaghetti/identity.h`, `subsys/services/identity/identity.c`,
`include/spaghetti/access_control.h`, `subsys/services/identity/access_control.c`,
`include/spaghetti/factory_reset.h`, `subsys/core/factory_reset.c` e relativi test.

```c
#define SPAGHETTI_DEVICE_ID_SIZE 32U
#define SPAGHETTI_DEVICE_NAME_SIZE 32U

struct spaghetti_identity {
	uint8_t device_id[SPAGHETTI_DEVICE_ID_SIZE];
	char device_name[SPAGHETTI_DEVICE_NAME_SIZE];
};

enum spaghetti_reset_scope {
	SPAGHETTI_RESET_CONFIG = BIT(0),
	SPAGHETTI_RESET_NETWORK = BIT(1),
	SPAGHETTI_RESET_CREDENTIALS = BIT(2),
	SPAGHETTI_RESET_BLE_BONDS = BIT(3),
	SPAGHETTI_RESET_ALL = 0x0f,
};

int spaghetti_identity_init(void);
int spaghetti_identity_get(struct spaghetti_identity *out);
int spaghetti_identity_set_name(const char *name);
int spaghetti_factory_reset(uint32_t scope);
```

`device_id` deriva una volta dall'identità hardware e non è modificabile; non usarlo
come segreto. `device_name` è configurabile, copied, UTF-8 bounded e non identifica
crittograficamente il peer. `scope` è una bitmask per valore. Factory reset è ammesso
solo da context locale Maintenance o da una sessione autenticata con permission
PROVISION; il Protocollo 360 applicherà questa regola prima di chiamarlo.

Il reset ferma Runtime e servizi, elimina soltanto i namespace richiesti, verifica ogni
delete, invalida sessioni, poi riavvia. Non cancella slot MCUboot né immagine confermata.
Un errore lascia il Core in Maintenance e riporta quali namespace non sono stati
rimossi. Aggiungi API interne `rotate`/`delete` ai vault Wi-Fi, MQTT, OTA e Remote
Console; la fase 365 collegherà bond e credenziale BLE.

### Principal, ruoli e permessi

Una credenziale dimostra chi è il peer; il principal descrive cosa può fare. Non usare
un singolo booleano `authenticated` per autorizzare tutte le operazioni. Scrivi:

```c
typedef uint16_t spaghetti_principal_id_t;

enum spaghetti_role {
	SPAGHETTI_ROLE_OBSERVER,
	SPAGHETTI_ROLE_OPERATOR,
	SPAGHETTI_ROLE_ADMINISTRATOR,
	SPAGHETTI_ROLE_PROVISIONER,
};

enum spaghetti_permission {
	SPAGHETTI_PERMISSION_READ = BIT(0),
	SPAGHETTI_PERMISSION_CONFIGURE = BIT(1),
	SPAGHETTI_PERMISSION_COMMAND = BIT(2),
	SPAGHETTI_PERMISSION_DISCOVER = BIT(3),
	SPAGHETTI_PERMISSION_UPDATE = BIT(4),
	SPAGHETTI_PERMISSION_PROVISION = BIT(5),
};

struct spaghetti_principal {
	spaghetti_principal_id_t id;
	enum spaghetti_role role;
	uint32_t permissions;
	bool enabled;
	char name[SPAGHETTI_DEVICE_NAME_SIZE];
};

struct spaghetti_audit_entry {
	uint32_t sequence;
	spaghetti_principal_id_t principal_id;
	uint16_t operation_id;
	int32_t internal_result;
	int64_t uptime_ms;
};

int spaghetti_principal_get(
	spaghetti_principal_id_t id,
	struct spaghetti_principal *out);
size_t spaghetti_principal_count(void);
int spaghetti_principal_get_by_index(
	size_t index,
	struct spaghetti_principal *out);
int spaghetti_principal_provision(
	spaghetti_principal_id_t id,
	enum spaghetti_role role,
	const char *name);
int spaghetti_principal_authorize(
	spaghetti_principal_id_t id,
	uint32_t required_permissions);
int spaghetti_principal_revoke(spaghetti_principal_id_t id);
int spaghetti_audit_record(
	spaghetti_principal_id_t principal_id,
	uint16_t operation_id,
	int internal_result);
int spaghetti_audit_get(
	uint32_t sequence,
	struct spaghetti_audit_entry *out);
```

La tabella è bounded da `CONFIG_SPAGHETTI_MAX_PRINCIPALS` del profilo 291. La struct
contiene soltanto metadata copied: non contiene PSK, certificati o chiavi. Ogni vault
lega la propria credenziale a un principal ID; dopo autenticazione l'adapter passa
quell'ID a Communication. `authorize()` restituisce `0`, `-ENOENT`, `-EACCES` o
`-EINVAL`. `count()` è infallibile e `get_by_index()` permette paginazione senza
esporre l'array interno. `provision()` copia `name`, rifiuta ID zero/duplicato e può
essere chiamata soltanto da Maintenance locale. I permessi non sono scelti dal peer:
Observer=READ; Operator=READ|COMMAND|DISCOVER;
Administrator=READ|CONFIGURE|COMMAND|DISCOVER|UPDATE;
Provisioner=tutti i permessi. `revoke()` disabilita il principal, elimina o rende inutilizzabili tutte le
credenziali collegate e chiude le sessioni attive; rotazione sostituisce la credenziale
senza cambiare ID o permessi.

Riserva un principal locale Maintenance creato dal firmware, non provisionabile dalla
rete. Factory reset completo e gestione dei principal richiedono PROVISION. La ring
audit è bounded dal profilo e possiede copie; `record()` riceve valori perché non
conserva indirizzi e viene chiamata da Communication dopo ogni operazione sensibile.
`get()` copia una entry caller-owned e restituisce `-ENOENT` se è stata sovrascritta.
Non registra payload o segreti; il Protocollo 360 traduce `internal_result` nello status
pubblico e mostra la ring soltanto ad Administrator/Provisioner.

## Perché è fatto così

Un SSID, un client ID MQTT e un indirizzo BLE non sono l'identità stabile del Core.
Reset separati evitano di cancellare firmware o configurazioni sane quando basta
revocare una rete o una credenziale.

## Come si usa

```c
struct spaghetti_identity identity;
(void)spaghetti_identity_get(&identity);
/* In Maintenance: */
(void)spaghetti_factory_reset(SPAGHETTI_RESET_NETWORK);
```

## Checklist di completamento

- [x] Device ID, nome e credenziali sono concetti distinti.
- [x] Ogni vault supporta elenco metadata, rotazione e revoca.
- [x] Ogni credenziale risolve un principal bounded con ruolo e permessi espliciti.
- [x] Revoca chiude le sessioni del principal senza cancellare gli altri peer.
- [x] Reset richiede autorizzazione e non cancella MCUboot.
- [x] Errore parziale entra in Maintenance.
- [x] Nessun segreto compare in log, argv o Config.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/identity -T tests/access_control \
  -T tests/factory_reset -T tests/storage \
  -p native_sim/native/64 --inline-logs --clobber-output'
```

Il test deve provare ogni scope separato, reset completo, delete fallita, reboot,
permessi insufficienti, rotazione e revoca di un peer senza invalidare gli altri.
