#include <spaghetti/mqtt_credentials.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

#include <spaghetti/maintenance_link.h>

#if IS_ENABLED(CONFIG_SECURE_STORAGE)
#include <psa/internal_trusted_storage.h>

#define SPAGHETTI_MQTT_CRED_UID_BASE ((psa_storage_uid_t)0x0057FFE8U)
#endif

#define SPAGHETTI_MQTT_CRED_MAGIC 0x53514D51U /* SQMQ */
#define SPAGHETTI_MQTT_CRED_VERSION 1U
#define SPAGHETTI_MQTT_CRED_SLOTS CONFIG_SPAGHETTI_MQTT_CREDENTIAL_SLOTS
#define SPAGHETTI_MQTT_CRED_CA_MAX CONFIG_SPAGHETTI_MQTT_CREDENTIAL_CA_MAX_SIZE
#define SPAGHETTI_MQTT_CRED_CERT_MAX \
	CONFIG_SPAGHETTI_MQTT_CREDENTIAL_CERT_MAX_SIZE
#define SPAGHETTI_MQTT_CRED_KEY_MAX \
	CONFIG_SPAGHETTI_MQTT_CREDENTIAL_KEY_MAX_SIZE
#define SPAGHETTI_MQTT_CRED_MATERIAL_MAX \
	(SPAGHETTI_MQTT_CRED_CA_MAX + SPAGHETTI_MQTT_CRED_CERT_MAX + \
	 SPAGHETTI_MQTT_CRED_KEY_MAX)

struct spaghetti_mqtt_credential_record {
	uint32_t magic;
	uint8_t version;
	uint8_t reserved;
	uint16_t credential_id;
	spaghetti_principal_id_t principal_id;
	uint16_t ca_size;
	uint16_t client_certificate_size;
	uint16_t private_key_size;
	uint16_t reserved2;
	uint8_t material[SPAGHETTI_MQTT_CRED_MATERIAL_MAX];
};

#if !IS_ENABLED(CONFIG_SECURE_STORAGE)
static struct spaghetti_mqtt_credential_record host_records[
	SPAGHETTI_MQTT_CRED_SLOTS];
static bool host_used[SPAGHETTI_MQTT_CRED_SLOTS];
#endif

K_MUTEX_DEFINE(mqtt_credentials_lock);

#if IS_ENABLED(CONFIG_SECURE_STORAGE)
BUILD_ASSERT(sizeof(struct spaghetti_mqtt_credential_record) <=
	     CONFIG_SECURE_STORAGE_ITS_MAX_DATA_SIZE);
#endif

static void wipe_sensitive(void *data, size_t data_size)
{
	volatile uint8_t *bytes = data;

	for (size_t byte_idx = 0U; byte_idx < data_size; ++byte_idx) {
		bytes[byte_idx] = 0U;
	}
}

static bool maintenance_active(void)
{
	return spaghetti_maintenance_link_get_state() ==
	       SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
}

static int slot_index(uint16_t credential_id)
{
	if ((credential_id == 0U) ||
	    (credential_id > SPAGHETTI_MQTT_CRED_SLOTS)) {
		return -EINVAL;
	}
	return (int)credential_id - 1;
}

#if IS_ENABLED(CONFIG_SECURE_STORAGE)
static int map_psa_status(psa_status_t status)
{
	switch (status) {
	case PSA_SUCCESS:
		return 0;
	case PSA_ERROR_DOES_NOT_EXIST:
		return -ENOENT;
	case PSA_ERROR_INSUFFICIENT_STORAGE:
		return -ENOSPC;
	case PSA_ERROR_INVALID_ARGUMENT:
		return -EINVAL;
	case PSA_ERROR_NOT_PERMITTED:
		return -EACCES;
	default:
		return -EIO;
	}
}

static psa_storage_uid_t credential_uid(uint16_t credential_id)
{
	return SPAGHETTI_MQTT_CRED_UID_BASE + credential_id;
}
#endif

static int read_record(uint16_t credential_id,
		       struct spaghetti_mqtt_credential_record *record)
{
	int index = slot_index(credential_id);

	if ((index < 0) || (record == NULL)) {
		return -EINVAL;
	}

#if IS_ENABLED(CONFIG_SECURE_STORAGE)
	size_t record_size = 0U;
	psa_status_t status = psa_its_get(credential_uid(credential_id), 0U,
					  sizeof(*record), record, &record_size);

	if (status != PSA_SUCCESS) {
		return map_psa_status(status);
	}
	if ((record_size != sizeof(*record)) ||
	    (record->magic != SPAGHETTI_MQTT_CRED_MAGIC) ||
	    (record->version != SPAGHETTI_MQTT_CRED_VERSION) ||
	    (record->credential_id != credential_id) ||
	    (record->principal_id == 0U) ||
	    (record->ca_size > SPAGHETTI_MQTT_CRED_CA_MAX) ||
	    (record->client_certificate_size > SPAGHETTI_MQTT_CRED_CERT_MAX) ||
	    (record->private_key_size > SPAGHETTI_MQTT_CRED_KEY_MAX) ||
	    (((size_t)record->ca_size + record->client_certificate_size +
	      record->private_key_size) > sizeof(record->material))) {
		wipe_sensitive(record, sizeof(*record));
		return -EBADMSG;
	}
	return 0;
#else
	if (!host_used[index]) {
		return -ENOENT;
	}
	*record = host_records[index];
	return 0;
#endif
}

static int write_record(const struct spaghetti_mqtt_credential_record *record)
{
	int index;

	if (record == NULL) {
		return -EINVAL;
	}
	index = slot_index(record->credential_id);
	if (index < 0) {
		return -EINVAL;
	}

#if IS_ENABLED(CONFIG_SECURE_STORAGE)
	return map_psa_status(psa_its_set(credential_uid(record->credential_id),
					  sizeof(*record), record,
					  PSA_STORAGE_FLAG_NONE));
#else
	host_records[index] = *record;
	host_used[index] = true;
	return 0;
#endif
}

static int remove_record(uint16_t credential_id)
{
	int index = slot_index(credential_id);

	if (index < 0) {
		return -EINVAL;
	}

#if IS_ENABLED(CONFIG_SECURE_STORAGE)
	return map_psa_status(psa_its_remove(credential_uid(credential_id)));
#else
	if (!host_used[index]) {
		return -ENOENT;
	}
	wipe_sensitive(&host_records[index], sizeof(host_records[index]));
	host_used[index] = false;
	return 0;
#endif
}

static int principal_is_usable(spaghetti_principal_id_t principal_id)
{
	struct spaghetti_principal principal;
	int err;

	if (principal_id == 0U) {
		return -EINVAL;
	}
	err = spaghetti_principal_get(principal_id, &principal);
	if (err < 0) {
		return err;
	}
	if (!principal.enabled) {
		return -ENOENT;
	}
	return 0;
}

int spaghetti_mqtt_credentials_set(
	uint16_t credential_id,
	spaghetti_principal_id_t principal_id,
	const uint8_t *ca,
	size_t ca_size,
	const uint8_t *client_certificate,
	size_t client_certificate_size,
	const uint8_t *private_key,
	size_t private_key_size)
{
	struct spaghetti_mqtt_credential_record record;
	size_t offset = 0U;
	int err;

	if ((credential_id == 0U) || (principal_id == 0U) ||
	    (ca_size > SPAGHETTI_MQTT_CRED_CA_MAX) ||
	    (client_certificate_size > SPAGHETTI_MQTT_CRED_CERT_MAX) ||
	    (private_key_size > SPAGHETTI_MQTT_CRED_KEY_MAX) ||
	    ((ca_size > 0U) && (ca == NULL)) ||
	    ((client_certificate_size > 0U) && (client_certificate == NULL)) ||
	    ((private_key_size > 0U) && (private_key == NULL))) {
		return -EINVAL;
	}
	if (!maintenance_active()) {
		return -EACCES;
	}

	err = principal_is_usable(principal_id);
	if (err < 0) {
		return err;
	}

	memset(&record, 0, sizeof(record));
	record.magic = SPAGHETTI_MQTT_CRED_MAGIC;
	record.version = SPAGHETTI_MQTT_CRED_VERSION;
	record.credential_id = credential_id;
	record.principal_id = principal_id;
	record.ca_size = (uint16_t)ca_size;
	record.client_certificate_size = (uint16_t)client_certificate_size;
	record.private_key_size = (uint16_t)private_key_size;
	if (ca_size > 0U) {
		memcpy(&record.material[offset], ca, ca_size);
		offset += ca_size;
	}
	if (client_certificate_size > 0U) {
		memcpy(&record.material[offset], client_certificate,
		       client_certificate_size);
		offset += client_certificate_size;
	}
	if (private_key_size > 0U) {
		memcpy(&record.material[offset], private_key, private_key_size);
	}

	err = k_mutex_lock(&mqtt_credentials_lock, K_FOREVER);
	if (err < 0) {
		wipe_sensitive(&record, sizeof(record));
		return err;
	}
	err = write_record(&record);
	k_mutex_unlock(&mqtt_credentials_lock);
	wipe_sensitive(&record, sizeof(record));
	return err;
}

int spaghetti_mqtt_credentials_clear(uint16_t credential_id)
{
	int err;

	if (credential_id == 0U) {
		return -EINVAL;
	}
	if (!maintenance_active()) {
		return -EACCES;
	}

	err = k_mutex_lock(&mqtt_credentials_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	err = remove_record(credential_id);
	k_mutex_unlock(&mqtt_credentials_lock);
	return err;
}

int spaghetti_mqtt_credentials_exists(
	uint16_t credential_id,
	bool *out_exists)
{
	struct spaghetti_mqtt_credential_record record;
	int err;

	if ((credential_id == 0U) || (out_exists == NULL)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&mqtt_credentials_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	err = read_record(credential_id, &record);
	if (err == -ENOENT) {
		*out_exists = false;
		k_mutex_unlock(&mqtt_credentials_lock);
		return 0;
	}
	if (err < 0) {
		k_mutex_unlock(&mqtt_credentials_lock);
		return err;
	}
	wipe_sensitive(&record, sizeof(record));
	*out_exists = true;
	k_mutex_unlock(&mqtt_credentials_lock);
	return 0;
}

int spaghetti_mqtt_credentials_resolve_principal(
	uint16_t credential_id,
	spaghetti_principal_id_t *out_principal_id)
{
	struct spaghetti_mqtt_credential_record record;
	spaghetti_principal_id_t principal_id;
	int err;

	if ((credential_id == 0U) || (out_principal_id == NULL)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&mqtt_credentials_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	err = read_record(credential_id, &record);
	if (err < 0) {
		k_mutex_unlock(&mqtt_credentials_lock);
		return err;
	}
	principal_id = record.principal_id;
	wipe_sensitive(&record, sizeof(record));
	k_mutex_unlock(&mqtt_credentials_lock);

	err = principal_is_usable(principal_id);
	if (err < 0) {
		return err;
	}
	*out_principal_id = principal_id;
	return 0;
}

int spaghetti_mqtt_credentials_load_tls(
	uint16_t credential_id,
	uint8_t *ca,
	size_t ca_capacity,
	size_t *ca_size,
	uint8_t *client_certificate,
	size_t client_certificate_capacity,
	size_t *client_certificate_size,
	uint8_t *private_key,
	size_t private_key_capacity,
	size_t *private_key_size)
{
	struct spaghetti_mqtt_credential_record record;
	size_t offset = 0U;
	int err;

	if ((credential_id == 0U) || (ca_size == NULL) ||
	    (client_certificate_size == NULL) || (private_key_size == NULL) ||
	    ((ca_capacity > 0U) && (ca == NULL)) ||
	    ((client_certificate_capacity > 0U) &&
	     (client_certificate == NULL)) ||
	    ((private_key_capacity > 0U) && (private_key == NULL))) {
		return -EINVAL;
	}

	err = k_mutex_lock(&mqtt_credentials_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	err = read_record(credential_id, &record);
	if (err < 0) {
		k_mutex_unlock(&mqtt_credentials_lock);
		return err;
	}
	if ((record.ca_size > ca_capacity) ||
	    (record.client_certificate_size > client_certificate_capacity) ||
	    (record.private_key_size > private_key_capacity)) {
		wipe_sensitive(&record, sizeof(record));
		k_mutex_unlock(&mqtt_credentials_lock);
		return -EMSGSIZE;
	}

	if (record.ca_size > 0U) {
		memcpy(ca, &record.material[offset], record.ca_size);
		offset += record.ca_size;
	}
	if (record.client_certificate_size > 0U) {
		memcpy(client_certificate, &record.material[offset],
		       record.client_certificate_size);
		offset += record.client_certificate_size;
	}
	if (record.private_key_size > 0U) {
		memcpy(private_key, &record.material[offset],
		       record.private_key_size);
	}
	*ca_size = record.ca_size;
	*client_certificate_size = record.client_certificate_size;
	*private_key_size = record.private_key_size;
	wipe_sensitive(&record, sizeof(record));
	k_mutex_unlock(&mqtt_credentials_lock);
	return 0;
}

int spaghetti_mqtt_credentials_erase_all(void)
{
	int first_error = 0;

	(void)k_mutex_lock(&mqtt_credentials_lock, K_FOREVER);
	for (uint16_t credential_id = 1U;
	     credential_id <= SPAGHETTI_MQTT_CRED_SLOTS; ++credential_id) {
		const int err = remove_record(credential_id);

		if ((err < 0) && (err != -ENOENT) && (first_error == 0)) {
			first_error = err;
		}
	}
	k_mutex_unlock(&mqtt_credentials_lock);
	return first_error;
}

int spaghetti_mqtt_credentials_delete_for_principal(
	spaghetti_principal_id_t principal_id)
{
	bool deleted = false;
	int first_error = 0;

	if (principal_id == 0U) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&mqtt_credentials_lock, K_FOREVER);
	for (uint16_t credential_id = 1U;
	     credential_id <= SPAGHETTI_MQTT_CRED_SLOTS; ++credential_id) {
		struct spaghetti_mqtt_credential_record record;
		int err = read_record(credential_id, &record);

		if (err == -ENOENT) {
			continue;
		}
		if (err < 0) {
			if (first_error == 0) {
				first_error = err;
			}
			continue;
		}
		if (record.principal_id != principal_id) {
			wipe_sensitive(&record, sizeof(record));
			continue;
		}
		wipe_sensitive(&record, sizeof(record));
		err = remove_record(credential_id);
		if (err == 0) {
			deleted = true;
		} else if ((err != -ENOENT) && (first_error == 0)) {
			first_error = err;
		}
	}
	k_mutex_unlock(&mqtt_credentials_lock);

	if (first_error < 0) {
		return first_error;
	}
	return deleted ? 0 : -ENOENT;
}
