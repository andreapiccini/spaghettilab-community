#include <spaghetti/identity.h>

#include <errno.h>
#include <string.h>

#include <zephyr/drivers/hwinfo.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>

LOG_MODULE_REGISTER(spaghetti_identity, CONFIG_SPAGHETTI_IDENTITY_LOG_LEVEL);

#define SPAGHETTI_IDENTITY_NAME_KEY "identity/name"

static bool identity_ready;
static struct spaghetti_identity current_identity;
K_MUTEX_DEFINE(identity_lock);

static size_t bounded_name_size(const char *name)
{
	const char *terminator = memchr(name, '\0', SPAGHETTI_DEVICE_NAME_SIZE);

	return (terminator != NULL) ? (size_t)(terminator - name) :
				      SPAGHETTI_DEVICE_NAME_SIZE;
}

static int identity_settings_set(const char *name, size_t len,
				 settings_read_cb read_cb, void *cb_arg)
{
	char loaded_name[SPAGHETTI_DEVICE_NAME_SIZE];
	ssize_t bytes_read;

	if ((name == NULL) || (strcmp(name, "name") != 0)) {
		return -ENOENT;
	}
	if ((read_cb == NULL) || (len == 0U) ||
	    (len >= SPAGHETTI_DEVICE_NAME_SIZE)) {
		return -EINVAL;
	}

	memset(loaded_name, 0, sizeof(loaded_name));
	bytes_read = read_cb(cb_arg, loaded_name, len);
	if (bytes_read != (ssize_t)len) {
		return -EIO;
	}
	if (memchr(loaded_name, '\0', len + 1U) == NULL) {
		loaded_name[len] = '\0';
	}
	if (bounded_name_size(loaded_name) == 0U) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&identity_lock, K_FOREVER);
	memcpy(current_identity.device_name, loaded_name,
	       SPAGHETTI_DEVICE_NAME_SIZE);
	k_mutex_unlock(&identity_lock);
	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(spaghetti_identity, "identity", NULL,
			       identity_settings_set, NULL, NULL);

int spaghetti_identity_init(void)
{
	ssize_t device_id_size;
	uint8_t hardware_id[SPAGHETTI_DEVICE_ID_SIZE];
	int err;

	err = k_mutex_lock(&identity_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (identity_ready) {
		k_mutex_unlock(&identity_lock);
		return -EALREADY;
	}

	memset(&current_identity, 0, sizeof(current_identity));
	memset(hardware_id, 0, sizeof(hardware_id));
	device_id_size = hwinfo_get_device_id(hardware_id, sizeof(hardware_id));
	if (device_id_size <= 0) {
		k_mutex_unlock(&identity_lock);
		LOG_ERR("hardware identity unavailable");
		return -EIO;
	}
	memcpy(current_identity.device_id, hardware_id, sizeof(hardware_id));
	k_mutex_unlock(&identity_lock);

	err = settings_subsys_init();
	if (err < 0) {
		return err;
	}
	err = settings_load_subtree("identity");
	if (err < 0) {
		return err;
	}

	(void)k_mutex_lock(&identity_lock, K_FOREVER);
	identity_ready = true;
	k_mutex_unlock(&identity_lock);
	LOG_INF("identity ready");
	return 0;
}

int spaghetti_identity_get(struct spaghetti_identity *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&identity_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!identity_ready) {
		k_mutex_unlock(&identity_lock);
		return -EACCES;
	}

	*out = current_identity;
	k_mutex_unlock(&identity_lock);
	return 0;
}

int spaghetti_identity_set_name(const char *name)
{
	size_t name_size;
	char stored_name[SPAGHETTI_DEVICE_NAME_SIZE];
	int err;

	if (name == NULL) {
		return -EINVAL;
	}
	name_size = bounded_name_size(name);
	if ((name_size == 0U) || (name_size >= SPAGHETTI_DEVICE_NAME_SIZE)) {
		return -EINVAL;
	}

	memset(stored_name, 0, sizeof(stored_name));
	memcpy(stored_name, name, name_size);

	err = k_mutex_lock(&identity_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!identity_ready) {
		k_mutex_unlock(&identity_lock);
		return -EACCES;
	}

	err = settings_save_one(SPAGHETTI_IDENTITY_NAME_KEY, stored_name,
				name_size + 1U);
	if (err == 0) {
		memcpy(current_identity.device_name, stored_name,
		       sizeof(stored_name));
	}
	k_mutex_unlock(&identity_lock);
	return err;
}
