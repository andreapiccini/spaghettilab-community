#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/settings/settings.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/identity.h>

extern const struct settings_handler_static settings_handler_spaghetti_identity;

static uint8_t fake_device_id[SPAGHETTI_DEVICE_ID_SIZE] = {
	0x11U, 0x22U, 0x33U, 0x44U, 0x55U, 0x66U, 0x77U, 0x88U,
};
static char stored_name[SPAGHETTI_DEVICE_NAME_SIZE];
static bool name_present;

ssize_t hwinfo_get_device_id(uint8_t *buffer, size_t length)
{
	size_t copy_size;

	if ((buffer == NULL) || (length == 0U)) {
		return -EINVAL;
	}
	copy_size = MIN(length, sizeof(fake_device_id));
	memcpy(buffer, fake_device_id, copy_size);
	if (copy_size < length) {
		memset(&buffer[copy_size], 0, length - copy_size);
	}
	return (ssize_t)copy_size;
}

static ssize_t fake_settings_read(void *cb_arg, void *data, size_t len)
{
	const size_t *available = cb_arg;

	if (len > *available) {
		return -EINVAL;
	}
	memcpy(data, stored_name, len);
	return (ssize_t)len;
}

int spaghetti_test_settings_subsys_init(void)
{
	return 0;
}

int spaghetti_test_settings_load_subtree(const char *subtree)
{
	size_t name_size;

	if (strcmp(subtree, "identity") != 0) {
		return -ENOENT;
	}
	if (!name_present) {
		return 0;
	}
	name_size = strlen(stored_name) + 1U;
	return settings_handler_spaghetti_identity.h_set(
		"name", name_size, fake_settings_read, &name_size);
}

int spaghetti_test_settings_save_one(const char *name, const void *value,
				     size_t val_len)
{
	if ((strcmp(name, "identity/name") != 0) || (value == NULL) ||
	    (val_len == 0U) || (val_len > sizeof(stored_name))) {
		return -EINVAL;
	}
	memset(stored_name, 0, sizeof(stored_name));
	memcpy(stored_name, value, val_len);
	name_present = true;
	return 0;
}

int spaghetti_test_settings_delete(const char *name)
{
	ARG_UNUSED(name);
	return -ENOENT;
}

ZTEST(identity, test_device_id_stable_and_name_bounds)
{
	struct spaghetti_identity first;
	struct spaghetti_identity second;
	char too_long[SPAGHETTI_DEVICE_NAME_SIZE + 1U];

	memset(too_long, 'a', sizeof(too_long) - 1U);
	too_long[sizeof(too_long) - 1U] = '\0';

	zassert_equal(spaghetti_identity_get(&first), -EACCES);
	zassert_ok(spaghetti_identity_init());
	zassert_equal(spaghetti_identity_init(), -EALREADY);
	zassert_ok(spaghetti_identity_get(&first));
	zassert_mem_equal(first.device_id, fake_device_id,
			  sizeof(fake_device_id));
	zassert_equal(first.device_name[0], '\0');

	zassert_equal(spaghetti_identity_set_name(NULL), -EINVAL);
	zassert_equal(spaghetti_identity_set_name(""), -EINVAL);
	zassert_equal(spaghetti_identity_set_name(too_long), -EINVAL);
	zassert_ok(spaghetti_identity_set_name("core-lab"));
	zassert_ok(spaghetti_identity_get(&second));
	zassert_mem_equal(second.device_id, first.device_id,
			  sizeof(first.device_id));
	zassert_equal(strcmp(second.device_name, "core-lab"), 0);
	/* Friendly name is not a credential and remains distinct from device_id. */
	zassert_true(memcmp(second.device_id, second.device_name,
			    sizeof(second.device_id)) != 0);
}

ZTEST_SUITE(identity, NULL, NULL, NULL, NULL, NULL);
