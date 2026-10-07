#include <spaghetti/physical.h>

#include <errno.h>
#include <string.h>
#include <zephyr/devicetree.h>
#include <zephyr/kernel.h>
#include <zephyr/settings/settings.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/crc.h>
#include <zephyr/sys/util.h>
#include <spaghetti/nfc.h>
#include <spaghetti/port.h>
extern int spaghetti_usb_protocol_send_event(const uint8_t *, size_t);
#define PHYSICAL_TRACE(message) (void)spaghetti_usb_protocol_send_event((const uint8_t *)(message), sizeof(message)-1U)

#define SPAGHETTI_PHYSICAL_NODE DT_COMPAT_GET_ANY_STATUS_OKAY(spaghettilab_physical_backbone)
#define SPAGHETTI_PHYSICAL_CATALOG_MAX 16U
#define SPAGHETTI_PHYSICAL_ENTRY_SIZE 33U
#define SPAGHETTI_PHYSICAL_RECORD_SIZE \
	(26U + SPAGHETTI_PHYSICAL_CATALOG_MAX * SPAGHETTI_PHYSICAL_ENTRY_SIZE + 4U)
#define SPAGHETTI_PHYSICAL_SETTINGS_KEY "physical/layout"

#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_physical_backbone)
static uint8_t physical_record[SPAGHETTI_PHYSICAL_RECORD_SIZE] = {2U};
static uint8_t physical_source;
static uint8_t physical_identity[8];
K_MUTEX_DEFINE(physical_lock);

static spaghetti_port_id_t physical_user_port(void)
{
	return DT_REG_ADDR(DT_PHANDLE(SPAGHETTI_PHYSICAL_NODE, user_port));
}

static bool physical_function_tag(struct spaghetti_nfc_tag *out, uint8_t identity[8])
{
	struct spaghetti_nfc_tag tags[SPAGHETTI_NFC_TAGS_MAX];
	size_t count = 0U;

	memset(identity, 0, 8U);
	(void)spaghetti_nfc_copy_tags(tags, ARRAY_SIZE(tags), &count);
	for (size_t i = 0U; i < count; ++i) {
		if (tags[i].antenna == 2U) {
			*out = tags[i];
			sys_put_be16(out->registry_id, &identity[0]);
			sys_put_be16(out->vendor_id, &identity[2]);
			sys_put_be32(out->module_type_id, &identity[4]);
			return true;
		}
	}
	return false;
}

static int physical_catalog_index(const uint8_t identity[8])
{
	for (uint8_t i = 0U; i < SPAGHETTI_PHYSICAL_CATALOG_MAX; ++i) {
		const uint8_t *entry = &physical_record[26U + i * SPAGHETTI_PHYSICAL_ENTRY_SIZE];

		if (memcmp(entry, identity, 8U) == 0) {
			return i;
		}
	}
	return -ENOENT;
}

static int physical_settings_set(const char *name, size_t length,
				 settings_read_cb read_cb, void *argument)
{
	uint8_t candidate[SPAGHETTI_PHYSICAL_RECORD_SIZE];

	if ((name == NULL) || strcmp(name, "layout") != 0) {
		return -ENOENT;
	}
	if ((length != sizeof(candidate) && length != 218U) || read_cb == NULL) return -EINVAL;
	memset(candidate, 0, sizeof(candidate));
	if (read_cb(argument, candidate, length) != (ssize_t)length) return -EINVAL;
	if (crc32_ieee(candidate, length - 4U) != sys_get_le32(&candidate[length - 4U])) return -EBADMSG;
	if (length == 218U && candidate[0] == 1U) {
		uint8_t legacy[218]; memcpy(legacy, candidate, 218U); memset(candidate, 0, sizeof(candidate)); candidate[0] = 2U;
		memcpy(&candidate[1], &legacy[1], 5U);
		for (uint8_t i = 0; i < SPAGHETTI_PHYSICAL_CATALOG_MAX; ++i) memcpy(&candidate[26U + i * 33U], &legacy[6U + i * 13U], 13U);
	} else if (candidate[0] != 2U) return -EBADMSG;
	memcpy(physical_record, candidate, sizeof(candidate));
	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(spaghetti_physical, "physical", NULL,
			       physical_settings_set, NULL, NULL);
#endif

int spaghetti_physical_init(void)
{
#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_physical_backbone)
	int err = settings_subsys_init();

	if (err != 0) {
		return err;
	}
	err = settings_load_subtree("physical");
	if (err != 0) {
		return err;
	}
	err = spaghetti_port_apply_user_config(physical_user_port(), &physical_record[1],
		physical_record[5], physical_record[6] ? &physical_record[6] : NULL);
	if (err == 0) {
		physical_source = (physical_record[1] || physical_record[2] ||
			physical_record[3] || physical_record[4]) ? 1U : 0U;
	}
	return err;
#else
	return -ENOTSUP;
#endif
}

int spaghetti_physical_refresh(void)
{
#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_physical_backbone)
	struct spaghetti_nfc_tag tag;
	uint8_t identity[8];
	int err = 0;
	const bool present = physical_function_tag(&tag, identity);

	if (k_mutex_lock(&physical_lock, K_MSEC(100)) != 0) {
		return -EBUSY;
	}
	const int index = present && tag.registry_id && tag.vendor_id && tag.module_type_id
		? physical_catalog_index(identity) : -ENOENT;
	if ((index >= 0) && ((physical_source != 2U) ||
	    (memcmp(identity, physical_identity, 8U) != 0))) {
		const uint8_t *entry = &physical_record[26U + index * SPAGHETTI_PHYSICAL_ENTRY_SIZE];

		err = spaghetti_port_apply_user_config(physical_user_port(), &entry[8], entry[12], entry[13] ? &entry[13] : NULL);
		if (err == 0) {
			physical_source = 2U;
			memcpy(physical_identity, identity, 8U);
		}
	} else if ((index < 0) && (physical_source == 2U)) {
		const uint8_t disconnected[4] = {0};

		err = spaghetti_port_apply_user_map(physical_user_port(), disconnected, 0U);
		if (err == 0) {
			physical_source = 0U;
			memset(physical_identity, 0, 8U);
		}
	}
	k_mutex_unlock(&physical_lock);
	return err;
#else
	return -ENOTSUP;
#endif
}

int spaghetti_physical_describe(uint8_t out[SPAGHETTI_PHYSICAL_SIZE])
{
	if (out == NULL) {
		return -EINVAL;
	}
	memset(out, 0, SPAGHETTI_PHYSICAL_SIZE);
#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_physical_backbone)
	const uint8_t port_id = DT_REG_ADDR(DT_PHANDLE(SPAGHETTI_PHYSICAL_NODE, user_port));
	const uint32_t caps = spaghetti_port_capabilities(spaghetti_port_get(port_id));
	out[0] = 2U;
	out[1] = DT_PROP(SPAGHETTI_PHYSICAL_NODE, mcu_id);
	out[2] = DT_PROP(SPAGHETTI_PHYSICAL_NODE, nfc_antennas);
	out[3] = DT_PROP(SPAGHETTI_PHYSICAL_NODE, layout_version);
	out[4] = port_id;
	out[5] = (uint8_t)caps;
	out[6] = (uint8_t)(caps >> 8);
	if (k_mutex_lock(&physical_lock, K_MSEC(100)) != 0) {
		return -EBUSY;
	}
	const int err = spaghetti_port_copy_user_map(port_id, &out[7], &out[11]);
	out[12] = physical_source;
	(void)spaghetti_port_copy_user_config(port_id, &out[13]);
	k_mutex_unlock(&physical_lock);
	return err;
#else
	return -ENOTSUP;
#endif
}

int spaghetti_physical_apply(const uint8_t modes[4], uint8_t speed)
{
	const uint8_t expected[SPAGHETTI_PHYSICAL_EXPECTED_SIZE] = {0};

	return spaghetti_physical_apply_checked(modes, speed, expected);
}

int spaghetti_physical_apply_checked(const uint8_t modes[4], uint8_t speed, const uint8_t expected[20])
{
	return spaghetti_physical_apply_config(modes, speed, expected, NULL);
}

int spaghetti_physical_apply_config(const uint8_t modes[4], uint8_t speed,
		const uint8_t expected[SPAGHETTI_PHYSICAL_EXPECTED_SIZE], const uint8_t config[20])
{
#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_physical_backbone)
	struct spaghetti_nfc_tag tag;
	uint8_t identity[8];
	uint8_t candidate[SPAGHETTI_PHYSICAL_RECORD_SIZE];
	uint8_t old_modes[4];
	uint8_t old_speed;
	uint8_t old_config[20];
	uint8_t next_config[20];
	int err;

	if ((modes == NULL) || (expected == NULL) || (expected[8] > 10U) ||
	    (expected[19] > 1U) || (speed > 1U)) {
		return -EINVAL;
	}
	PHYSICAL_TRACE("physical:start");
	if (k_mutex_lock(&physical_lock, K_MSEC(100)) != 0) {
		return -EBUSY;
	}
	PHYSICAL_TRACE("physical:locked");
	const bool present = physical_function_tag(&tag, identity);
	if (memcmp(identity, expected, 8U) != 0 ||
	    (present && ((tag.uid_len != expected[8]) ||
	     (memcmp(tag.uid, &expected[9], tag.uid_len) != 0)))) {
		err = -ESTALE;
		goto unlock_physical;
	}
	const bool automatic = expected[19] != 0U;
	if (automatic && (!present || !tag.registry_id || !tag.vendor_id || !tag.module_type_id)) {
		err = -EINVAL;
		goto unlock_physical;
	}
	if (!automatic && present && tag.registry_id && tag.vendor_id && tag.module_type_id &&
	    (physical_catalog_index(identity) >= 0)) {
		err = -EACCES;
		goto unlock_physical;
	}
	PHYSICAL_TRACE("physical:tag");
	memcpy(candidate, physical_record, sizeof(candidate));
	if (automatic) {
		int index = physical_catalog_index(identity);

		if (index < 0) {
			const uint8_t empty_identity[8] = {0};

			index = physical_catalog_index(empty_identity);
		}
		if (index < 0) {
			err = -ENOSPC;
			goto unlock_physical;
		}
		uint8_t *entry = &candidate[26U + index * SPAGHETTI_PHYSICAL_ENTRY_SIZE];

		memcpy(entry, identity, 8U);
		memcpy(&entry[8], modes, 4U);
		entry[12] = speed;
	} else {
		memcpy(&candidate[1], modes, 4U);
		candidate[5] = speed;
	}
	err = spaghetti_port_copy_user_config(physical_user_port(), old_config);
	if (err) goto unlock_physical;
	err = spaghetti_port_copy_user_map(physical_user_port(), old_modes, &old_speed);
	if (err != 0) {
		goto unlock_physical;
	}
	PHYSICAL_TRACE("physical:hardware");
	err = spaghetti_port_apply_user_config(physical_user_port(), modes, speed, config);
	PHYSICAL_TRACE("physical:hardware-done");
	if (err != 0) {
		if (err != -EBUSY) (void)spaghetti_port_apply_user_config(physical_user_port(), old_modes, old_speed, old_config[0] ? old_config : NULL);
		goto unlock_physical;
	}
	(void)spaghetti_port_copy_user_config(physical_user_port(), next_config);
	if (automatic) { const int index = physical_catalog_index(identity); const uint8_t empty[8] = {0}; const int target = index >= 0 ? index : physical_catalog_index(empty); memcpy(&candidate[26U + target * 33U + 13U], next_config, 20U); }
	else memcpy(&candidate[6], next_config, 20U);
	sys_put_le32(crc32_ieee(candidate, sizeof(candidate) - 4U),
		&candidate[sizeof(candidate) - 4U]);
	if (memcmp(candidate, physical_record, sizeof(candidate)) != 0) {
		PHYSICAL_TRACE("physical:save");
		err = settings_save_one(SPAGHETTI_PHYSICAL_SETTINGS_KEY, candidate,
			sizeof(candidate));
		if (err != 0) {
			(void)spaghetti_port_apply_user_config(physical_user_port(), old_modes,
				old_speed, old_config[0] ? old_config : NULL);
			goto unlock_physical;
		}
		memcpy(physical_record, candidate, sizeof(candidate));
	}
	PHYSICAL_TRACE("physical:done");
	physical_source = automatic ? 2U : 1U;
	memcpy(physical_identity, identity, 8U);
unlock_physical:
	k_mutex_unlock(&physical_lock);
	return err;
#else
	ARG_UNUSED(modes);
	ARG_UNUSED(speed);
	ARG_UNUSED(expected);
	ARG_UNUSED(config);
	return -ENOTSUP;
#endif
}
