#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <psa/internal_trusted_storage.h>

#include <zephyr/sys/util.h>

#include "wifi_profiles_internal.h"

#define SPAGHETTI_WIFI_PROFILE_RECORD_VERSION 1U
#define SPAGHETTI_WIFI_PROFILE_UID_BASE 0x00570000U
#define SPAGHETTI_WIFI_PREFERRED_UID 0x0057FFF0U
#define SPAGHETTI_WIFI_PROFILE_OFFSET_VERSION 0U
#define SPAGHETTI_WIFI_PROFILE_OFFSET_SECURITY 1U
#define SPAGHETTI_WIFI_PROFILE_OFFSET_SSID_SIZE 2U
#define SPAGHETTI_WIFI_PROFILE_OFFSET_PASSPHRASE_SIZE 3U
#define SPAGHETTI_WIFI_PROFILE_OFFSET_SSID 4U
#define SPAGHETTI_WIFI_PROFILE_OFFSET_PASSPHRASE \
	(SPAGHETTI_WIFI_PROFILE_OFFSET_SSID + SPAGHETTI_WIFI_SSID_SIZE - 1U)
#define SPAGHETTI_WIFI_PROFILE_RECORD_SIZE \
	(SPAGHETTI_WIFI_PROFILE_OFFSET_PASSPHRASE + \
	 SPAGHETTI_WIFI_PASSPHRASE_SIZE - 1U)
#define SPAGHETTI_WIFI_PREFERRED_RECORD_SIZE \
	(SPAGHETTI_WIFI_SSID_SIZE + 1U)

BUILD_ASSERT(SPAGHETTI_WIFI_PROFILE_RECORD_SIZE <=
	     CONFIG_SECURE_STORAGE_ITS_MAX_DATA_SIZE);
BUILD_ASSERT(SPAGHETTI_WIFI_PREFERRED_RECORD_SIZE <=
	     CONFIG_SECURE_STORAGE_ITS_MAX_DATA_SIZE);

static void wipe_sensitive(void *data, size_t data_size)
{
	volatile uint8_t *bytes = data;

	for (size_t byte_idx = 0U; byte_idx < data_size; ++byte_idx) {
		bytes[byte_idx] = 0U;
	}
}

static size_t bounded_string_size(const char *string, size_t capacity)
{
	const char *terminator = memchr(string, '\0', capacity);

	return (terminator != NULL) ? (size_t)(terminator - string) : capacity;
}

static psa_storage_uid_t profile_uid(size_t slot)
{
	return (psa_storage_uid_t)(SPAGHETTI_WIFI_PROFILE_UID_BASE + slot);
}

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

static int encode_security(enum spaghetti_wifi_security security,
			   uint8_t *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	switch (security) {
	case SPAGHETTI_WIFI_SECURITY_OPEN:
		*out = 0U;
		return 0;
	case SPAGHETTI_WIFI_SECURITY_WPA2_PSK:
		*out = 1U;
		return 0;
	default:
		return -EINVAL;
	}
}

static int decode_security(uint8_t encoded,
			   enum spaghetti_wifi_security *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	switch (encoded) {
	case 0U:
		*out = SPAGHETTI_WIFI_SECURITY_OPEN;
		return 0;
	case 1U:
		*out = SPAGHETTI_WIFI_SECURITY_WPA2_PSK;
		return 0;
	default:
		return -EBADMSG;
	}
}

int spaghetti_wifi_profiles_storage_read(
	size_t slot,
	struct spaghetti_wifi_profile_secret *out)
{
	uint8_t record[SPAGHETTI_WIFI_PROFILE_RECORD_SIZE];
	struct spaghetti_wifi_profile_secret decoded = {0};
	size_t record_size = 0U;
	psa_status_t status;
	int err;

	if ((slot >= CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT) || (out == NULL)) {
		return -EINVAL;
	}

	status = psa_its_get(profile_uid(slot), 0U, sizeof(record), record,
			     &record_size);
	if (status != PSA_SUCCESS) {
		wipe_sensitive(record, sizeof(record));
		return map_psa_status(status);
	}
	if ((record_size != sizeof(record)) ||
	    (record[SPAGHETTI_WIFI_PROFILE_OFFSET_VERSION] !=
	     SPAGHETTI_WIFI_PROFILE_RECORD_VERSION)) {
		err = -EBADMSG;
		goto out;
	}

	const size_t ssid_size =
		record[SPAGHETTI_WIFI_PROFILE_OFFSET_SSID_SIZE];
	const size_t passphrase_size =
		record[SPAGHETTI_WIFI_PROFILE_OFFSET_PASSPHRASE_SIZE];

	if ((ssid_size == 0U) ||
	    (ssid_size >= SPAGHETTI_WIFI_SSID_SIZE) ||
	    (passphrase_size >= SPAGHETTI_WIFI_PASSPHRASE_SIZE)) {
		err = -EBADMSG;
		goto out;
	}

	err = decode_security(
		record[SPAGHETTI_WIFI_PROFILE_OFFSET_SECURITY],
		&decoded.security);
	if (err < 0) {
		goto out;
	}
	if (((decoded.security == SPAGHETTI_WIFI_SECURITY_OPEN) &&
	     (passphrase_size != 0U)) ||
	    ((decoded.security == SPAGHETTI_WIFI_SECURITY_WPA2_PSK) &&
	     ((passphrase_size < 8U) || (passphrase_size > 64U)))) {
		err = -EBADMSG;
		goto out;
	}

	memcpy(decoded.ssid,
	       &record[SPAGHETTI_WIFI_PROFILE_OFFSET_SSID], ssid_size);
	decoded.ssid[ssid_size] = '\0';
	memcpy(decoded.passphrase,
	       &record[SPAGHETTI_WIFI_PROFILE_OFFSET_PASSPHRASE],
	       passphrase_size);
	decoded.passphrase_size = passphrase_size;
	*out = decoded;
	err = 0;

out:
	wipe_sensitive(&decoded, sizeof(decoded));
	wipe_sensitive(record, sizeof(record));
	return err;
}

int spaghetti_wifi_profiles_storage_write(
	size_t slot,
	const struct spaghetti_wifi_profile_config *config)
{
	uint8_t record[SPAGHETTI_WIFI_PROFILE_RECORD_SIZE] = {0};
	uint8_t security;
	size_t ssid_size;
	psa_status_t status;
	int err;

	if ((slot >= CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT) ||
	    (config == NULL)) {
		return -EINVAL;
	}

	ssid_size = bounded_string_size(config->ssid, sizeof(config->ssid));
	if ((ssid_size == 0U) || (ssid_size >= sizeof(config->ssid)) ||
	    (config->passphrase_size >= sizeof(config->passphrase))) {
		return -EINVAL;
	}

	err = encode_security(config->security, &security);
	if (err < 0) {
		return err;
	}

	record[SPAGHETTI_WIFI_PROFILE_OFFSET_VERSION] =
		SPAGHETTI_WIFI_PROFILE_RECORD_VERSION;
	record[SPAGHETTI_WIFI_PROFILE_OFFSET_SECURITY] = security;
	record[SPAGHETTI_WIFI_PROFILE_OFFSET_SSID_SIZE] = (uint8_t)ssid_size;
	record[SPAGHETTI_WIFI_PROFILE_OFFSET_PASSPHRASE_SIZE] =
		(uint8_t)config->passphrase_size;
	memcpy(&record[SPAGHETTI_WIFI_PROFILE_OFFSET_SSID], config->ssid,
	       ssid_size);
	memcpy(&record[SPAGHETTI_WIFI_PROFILE_OFFSET_PASSPHRASE],
	       config->passphrase, config->passphrase_size);

	status = psa_its_set(profile_uid(slot), sizeof(record), record,
			     PSA_STORAGE_FLAG_NONE);
	wipe_sensitive(record, sizeof(record));
	return map_psa_status(status);
}

int spaghetti_wifi_profiles_storage_remove(size_t slot)
{
	if (slot >= CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT) {
		return -EINVAL;
	}

	return map_psa_status(psa_its_remove(profile_uid(slot)));
}

int spaghetti_wifi_profiles_storage_read_preferred(
	char out_ssid[SPAGHETTI_WIFI_SSID_SIZE])
{
	uint8_t record[SPAGHETTI_WIFI_PREFERRED_RECORD_SIZE];
	char decoded[SPAGHETTI_WIFI_SSID_SIZE] = {0};
	size_t record_size = 0U;
	psa_status_t status;
	int err = 0;

	if (out_ssid == NULL) {
		return -EINVAL;
	}

	status = psa_its_get((psa_storage_uid_t)SPAGHETTI_WIFI_PREFERRED_UID,
			     0U, sizeof(record), record, &record_size);
	if (status != PSA_SUCCESS) {
		return map_psa_status(status);
	}
	if ((record_size != sizeof(record)) ||
	    (record[0] != SPAGHETTI_WIFI_PROFILE_RECORD_VERSION) ||
	    (record[1] == 0U) || (record[1] >= SPAGHETTI_WIFI_SSID_SIZE)) {
		err = -EBADMSG;
		goto out;
	}

	memcpy(decoded, &record[2], record[1]);
	decoded[record[1]] = '\0';
	memcpy(out_ssid, decoded, sizeof(decoded));

out:
	wipe_sensitive(decoded, sizeof(decoded));
	wipe_sensitive(record, sizeof(record));
	return err;
}

int spaghetti_wifi_profiles_storage_write_preferred(const char *ssid)
{
	uint8_t record[SPAGHETTI_WIFI_PREFERRED_RECORD_SIZE] = {0};
	size_t ssid_size;
	psa_status_t status;

	if (ssid == NULL) {
		return -EINVAL;
	}

	ssid_size = bounded_string_size(ssid, SPAGHETTI_WIFI_SSID_SIZE);
	if ((ssid_size == 0U) || (ssid_size >= SPAGHETTI_WIFI_SSID_SIZE)) {
		return -EINVAL;
	}

	record[0] = SPAGHETTI_WIFI_PROFILE_RECORD_VERSION;
	record[1] = (uint8_t)ssid_size;
	memcpy(&record[2], ssid, ssid_size);
	status = psa_its_set((psa_storage_uid_t)SPAGHETTI_WIFI_PREFERRED_UID,
			     sizeof(record), record, PSA_STORAGE_FLAG_NONE);
	wipe_sensitive(record, sizeof(record));
	return map_psa_status(status);
}

int spaghetti_wifi_profiles_storage_remove_preferred(void)
{
	return map_psa_status(psa_its_remove(
		(psa_storage_uid_t)SPAGHETTI_WIFI_PREFERRED_UID));
}
