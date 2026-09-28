#include <spaghetti/storage.h>

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <sys/types.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>
#include <zephyr/sys/crc.h>

#include <spaghetti/config_codec.h>

#include "storage_legacy_v3.h"

LOG_MODULE_REGISTER(spaghetti_storage, CONFIG_SPAGHETTI_STORAGE_LOG_LEVEL);

#define SPAGHETTI_STORAGE_RECORD_MAGIC_V2 0x53504732U
#define SPAGHETTI_STORAGE_RECORD_VERSION_V2 1U

enum spaghetti_storage_state {
	SPAGHETTI_STORAGE_UNINITIALIZED,
	SPAGHETTI_STORAGE_INITIALIZING,
	SPAGHETTI_STORAGE_READY,
};

struct spaghetti_storage_record_v2 {
	uint32_t magic;
	uint16_t record_version;
	uint16_t payload_size;
	uint32_t payload_crc32;
	uint8_t payload[SPAGHETTI_CONFIG_CBOR_MAX_SIZE];
};

static enum spaghetti_storage_state storage_state =
	SPAGHETTI_STORAGE_UNINITIALIZED;
static struct spaghetti_storage_record_v2 loaded_record;
static struct spaghetti_storage_legacy_record legacy_record;
static bool record_present;
static bool legacy_pending;
static int record_load_error;
static bool maintenance_marker_present;
static bool maintenance_marker_corrupt;
K_MUTEX_DEFINE(storage_lock);

static int decode_v2_record(const struct spaghetti_storage_record_v2 *record,
			    struct spaghetti_config *out)
{
	uint32_t crc;

	if ((record->magic != SPAGHETTI_STORAGE_RECORD_MAGIC_V2) ||
	    (record->record_version != SPAGHETTI_STORAGE_RECORD_VERSION_V2) ||
	    (record->payload_size == 0U) ||
	    (record->payload_size > SPAGHETTI_CONFIG_CBOR_MAX_SIZE)) {
		return -EBADMSG;
	}

	crc = crc32_ieee(record->payload, record->payload_size);
	if (crc != record->payload_crc32) {
		return -EBADMSG;
	}

	return spaghetti_config_decode_cbor(record->payload,
					    record->payload_size, out);
}

static int encode_v2_record(const struct spaghetti_config *config,
			    struct spaghetti_storage_record_v2 *record)
{
	size_t written = 0U;
	int err;

	memset(record, 0, sizeof(*record));
	err = spaghetti_config_encode_cbor(config, record->payload,
					   sizeof(record->payload), &written);
	if (err < 0) {
		return err;
	}

	record->magic = SPAGHETTI_STORAGE_RECORD_MAGIC_V2;
	record->record_version = SPAGHETTI_STORAGE_RECORD_VERSION_V2;
	record->payload_size = (uint16_t)written;
	record->payload_crc32 = crc32_ieee(record->payload, written);
	return 0;
}

static int storage_settings_set(const char *name, size_t len,
				settings_read_cb read_cb, void *read_cb_arg)
{
	uint8_t raw[(sizeof(struct spaghetti_storage_record_v2) >
		     sizeof(struct spaghetti_storage_legacy_record)) ?
			    sizeof(struct spaghetti_storage_record_v2) :
			    sizeof(struct spaghetti_storage_legacy_record)];
	ssize_t bytes_read;
	int err;

	if ((name != NULL) && (name[0] != '\0')) {
		return -ENOENT;
	}

	err = k_mutex_lock(&storage_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	record_present = false;
	legacy_pending = false;
	record_load_error = 0;
	memset(&loaded_record, 0, sizeof(loaded_record));
	memset(&legacy_record, 0, sizeof(legacy_record));
	if ((read_cb == NULL) || (len == 0U) || (len > sizeof(raw))) {
		record_load_error = -EBADMSG;
		k_mutex_unlock(&storage_lock);
		return 0;
	}

	memset(raw, 0, sizeof(raw));
	bytes_read = read_cb(read_cb_arg, raw, len);
	if (bytes_read < 0) {
		record_load_error = (int)bytes_read;
		k_mutex_unlock(&storage_lock);
		return 0;
	}
	if ((size_t)bytes_read != len) {
		record_load_error = -EBADMSG;
		k_mutex_unlock(&storage_lock);
		return 0;
	}

	if (len >= sizeof(uint32_t)) {
		uint32_t magic;

		memcpy(&magic, raw, sizeof(magic));
		if (magic == SPAGHETTI_STORAGE_RECORD_MAGIC_V2) {
			if (len != sizeof(loaded_record)) {
				record_load_error = -EBADMSG;
				k_mutex_unlock(&storage_lock);
				return 0;
			}
			memcpy(&loaded_record, raw, sizeof(loaded_record));
			record_present = true;
			k_mutex_unlock(&storage_lock);
			return 0;
		}
		if (magic == SPAGHETTI_STORAGE_RECORD_MAGIC_V3) {
			if (len != sizeof(legacy_record)) {
				record_load_error = -EBADMSG;
				k_mutex_unlock(&storage_lock);
				return 0;
			}
			memcpy(&legacy_record, raw, sizeof(legacy_record));
			legacy_pending = true;
			record_present = true;
			k_mutex_unlock(&storage_lock);
			return 0;
		}
	}

	record_load_error = -EBADMSG;
	k_mutex_unlock(&storage_lock);
	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(spaghetti_storage,
			       SPAGHETTI_STORAGE_CONFIG_KEY,
			       NULL, storage_settings_set, NULL, NULL);

static int maintenance_settings_set(const char *name, size_t len,
				    settings_read_cb read_cb, void *read_cb_arg)
{
	uint8_t marker = 0U;
	ssize_t bytes_read;
	int err;

	if ((name == NULL) || (strcmp(name, "boot_once") != 0)) {
		return -ENOENT;
	}

	err = k_mutex_lock(&storage_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	maintenance_marker_present = false;
	maintenance_marker_corrupt = false;
	if ((read_cb == NULL) || (len != sizeof(marker))) {
		maintenance_marker_corrupt = true;
		k_mutex_unlock(&storage_lock);
		return 0;
	}

	bytes_read = read_cb(read_cb_arg, &marker, sizeof(marker));
	if ((bytes_read != (ssize_t)sizeof(marker)) || (marker != 1U)) {
		maintenance_marker_corrupt = true;
		k_mutex_unlock(&storage_lock);
		return 0;
	}

	maintenance_marker_present = true;
	k_mutex_unlock(&storage_lock);
	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(spaghetti_maintenance,
			       "maintenance", NULL, maintenance_settings_set,
			       NULL, NULL);

int spaghetti_storage_init(void)
{
	bool is_record_present;
	int err = k_mutex_lock(&storage_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}

	if (storage_state == SPAGHETTI_STORAGE_READY) {
		k_mutex_unlock(&storage_lock);
		return -EALREADY;
	}
	if (storage_state == SPAGHETTI_STORAGE_INITIALIZING) {
		k_mutex_unlock(&storage_lock);
		return -EBUSY;
	}

	storage_state = SPAGHETTI_STORAGE_INITIALIZING;
	record_present = false;
	legacy_pending = false;
	record_load_error = 0;
	maintenance_marker_present = false;
	maintenance_marker_corrupt = false;
	memset(&loaded_record, 0, sizeof(loaded_record));
	memset(&legacy_record, 0, sizeof(legacy_record));
	k_mutex_unlock(&storage_lock);

	err = settings_subsys_init();
	if (err == 0) {
		err = settings_load_subtree(SPAGHETTI_STORAGE_CONFIG_KEY);
	}
	if (err == 0) {
		err = settings_load_subtree("maintenance");
	}

	(void)k_mutex_lock(&storage_lock, K_FOREVER);
	storage_state = (err == 0) ? SPAGHETTI_STORAGE_READY :
		SPAGHETTI_STORAGE_UNINITIALIZED;
	is_record_present = record_present;
	k_mutex_unlock(&storage_lock);
	if (err < 0) {
		return err;
	}

	LOG_INF("ready: config=%s", is_record_present ? "present" : "absent");
	return 0;
}

int spaghetti_storage_probe_config(void)
{
	int err = k_mutex_lock(&storage_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (storage_state != SPAGHETTI_STORAGE_READY) {
		err = -EACCES;
		goto unlock;
	}
	if (record_load_error < 0) {
		err = record_load_error;
		goto unlock;
	}
	err = record_present ? 0 : -ENOENT;

unlock:
	k_mutex_unlock(&storage_lock);
	return err;
}

int spaghetti_storage_read_config(struct spaghetti_config *out)
{
	struct spaghetti_storage_record_v2 migrated;
	bool should_persist = false;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&storage_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	if (storage_state != SPAGHETTI_STORAGE_READY) {
		err = -EACCES;
		goto unlock;
	}
	if (record_load_error < 0) {
		err = record_load_error;
		goto unlock;
	}
	if (!record_present) {
		err = -ENOENT;
		goto unlock;
	}

	if (legacy_pending) {
		err = spaghetti_storage_legacy_v3_convert(
			(const uint8_t *)&legacy_record, sizeof(legacy_record),
			out);
		if (err < 0) {
			goto unlock;
		}
		err = encode_v2_record(out, &migrated);
		if (err < 0) {
			goto unlock;
		}
		loaded_record = migrated;
		legacy_pending = false;
		should_persist = true;
	} else {
		err = decode_v2_record(&loaded_record, out);
	}

unlock:
	k_mutex_unlock(&storage_lock);
	if ((err == 0) && should_persist) {
		const int persist_error = settings_save_one(
			SPAGHETTI_STORAGE_CONFIG_KEY, &migrated,
			sizeof(migrated));

		if (persist_error < 0) {
			LOG_WRN("legacy Config migrated in RAM; persist failed: err=%d",
				persist_error);
		} else {
			LOG_INF("legacy Config migrated to V2");
		}
	}
	return err;
}

int spaghetti_storage_write_config(const struct spaghetti_config *config)
{
	struct spaghetti_storage_record_v2 record;
	int err;

	if (config == NULL) {
		return -EINVAL;
	}

	err = encode_v2_record(config, &record);
	if (err < 0) {
		return err;
	}

	err = k_mutex_lock(&storage_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	if (storage_state != SPAGHETTI_STORAGE_READY) {
		k_mutex_unlock(&storage_lock);
		return -EACCES;
	}

	err = settings_save_one(SPAGHETTI_STORAGE_CONFIG_KEY, &record,
				sizeof(record));
	if (err == 0) {
		loaded_record = record;
		legacy_pending = false;
		record_present = true;
		record_load_error = 0;
	}
	k_mutex_unlock(&storage_lock);

	if (err == 0) {
		LOG_INF("Config persisted: modules=%u",
			(uint32_t)config->module_count);
	}
	return err;
}

int spaghetti_storage_delete_config(void)
{
	int err = k_mutex_lock(&storage_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (storage_state != SPAGHETTI_STORAGE_READY) {
		k_mutex_unlock(&storage_lock);
		return -EACCES;
	}
	if (!record_present && (record_load_error == 0)) {
		k_mutex_unlock(&storage_lock);
		return -ENOENT;
	}

	err = settings_delete(SPAGHETTI_STORAGE_CONFIG_KEY);
	if (err == 0) {
		memset(&loaded_record, 0, sizeof(loaded_record));
		legacy_pending = false;
		record_present = false;
		record_load_error = 0;
	}
	k_mutex_unlock(&storage_lock);

	if (err == 0) {
		LOG_INF("Config deleted");
	}
	return err;
}

int spaghetti_storage_request_maintenance_once(void)
{
	const uint8_t marker = 1U;
	int err = k_mutex_lock(&storage_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (storage_state != SPAGHETTI_STORAGE_READY) {
		err = -EACCES;
		goto unlock;
	}

	err = settings_save_one(SPAGHETTI_STORAGE_MAINTENANCE_BOOT_ONCE_KEY,
				&marker, sizeof(marker));
	if (err == 0) {
		maintenance_marker_present = true;
		maintenance_marker_corrupt = false;
	}

unlock:
	k_mutex_unlock(&storage_lock);
	return err;
}

int spaghetti_storage_consume_maintenance_once(bool *requested)
{
	bool marker_exists;
	bool marker_valid;
	int err;

	if (requested == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&storage_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (storage_state != SPAGHETTI_STORAGE_READY) {
		k_mutex_unlock(&storage_lock);
		return -EACCES;
	}

	marker_exists = maintenance_marker_present ||
			maintenance_marker_corrupt;
	marker_valid = maintenance_marker_present &&
		       !maintenance_marker_corrupt;
	if (!marker_exists) {
		k_mutex_unlock(&storage_lock);
		*requested = false;
		return 0;
	}

	err = settings_delete(SPAGHETTI_STORAGE_MAINTENANCE_BOOT_ONCE_KEY);
	if (err == 0) {
		maintenance_marker_present = false;
		maintenance_marker_corrupt = false;
	}
	k_mutex_unlock(&storage_lock);
	if (err < 0) {
		return err;
	}

	*requested = marker_valid;
	return 0;
}
