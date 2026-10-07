#include <errno.h>
#include <string.h>
#include <zephyr/settings/settings.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/crc.h>
#include <zephyr/ztest.h>
#include <spaghetti/nfc.h>
#include <spaghetti/physical.h>
#include <spaghetti/port.h>

extern const struct settings_handler_static settings_handler_spaghetti_physical;

static uint8_t stored[558];
static uint8_t applied[4];
static uint8_t applied_config[20];
static uint8_t applied_speed;
static int hardware_error;
static int save_error;
static int save_count;
static bool tag_present;
static struct spaghetti_nfc_tag tag;

static ssize_t test_read(void *arg, void *data, size_t length)
{
	ARG_UNUSED(arg);
	memcpy(data, stored, length);
	return length;
}

int spaghetti_test_settings_subsys_init(void)
{
	return 0;
}

int spaghetti_test_settings_load_subtree(const char *subtree)
{
	zassert_equal(strcmp(subtree, "physical"), 0);
	return settings_handler_spaghetti_physical.h_set("layout", sizeof(stored), test_read, NULL);
}

int spaghetti_test_settings_save_one(const char *name, const void *value, size_t length)
{
	zassert_equal(strcmp(name, "physical/layout"), 0);
	zassert_equal(length, sizeof(stored));
	if (save_error != 0) {
		return save_error;
	}
	memcpy(stored, value, length);
	save_count++;
	return 0;
}

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	zassert_equal(id, 0U);
	return (const struct spaghetti_port *)&applied;
}

uint32_t spaghetti_port_capabilities(const struct spaghetti_port *port)
{
	ARG_UNUSED(port);
	return 25U;
}

int spaghetti_port_copy_user_map(spaghetti_port_id_t id, uint8_t modes[4], uint8_t *speed)
{
	zassert_equal(id, 0U);
	memcpy(modes, applied, 4U);
	*speed = applied_speed;
	return 0;
}

int spaghetti_port_apply_user_map(spaghetti_port_id_t id, const uint8_t modes[4], uint8_t speed)
{
	zassert_equal(id, 0U);
	if (hardware_error != 0) {
		return hardware_error;
	}
	memcpy(applied, modes, 4U);
	applied_speed = speed;
	return 0;
}

int spaghetti_nfc_copy_tags(struct spaghetti_nfc_tag *out, size_t max, size_t *count)
{
	zassert_true(max > 0U);
	*count = tag_present ? 1U : 0U;
	if (tag_present) {
		out[0] = tag;
	}
	return 0;
}

static void expected_tag(uint8_t expected[20], bool automatic)
{
	memset(expected, 0, 20U);
	sys_put_be16(tag.registry_id, &expected[0]);
	sys_put_be16(tag.vendor_id, &expected[2]);
	sys_put_be32(tag.module_type_id, &expected[4]);
	expected[8] = tag.uid_len;
	memcpy(&expected[9], tag.uid, tag.uid_len);
	expected[19] = automatic ? 1U : 0U;
}

static void before(void *fixture)
{
	ARG_UNUSED(fixture);
	memset(stored, 0, sizeof(stored));
	stored[0] = 2U;
	sys_put_le32(crc32_ieee(stored, sizeof(stored) - 4U), &stored[sizeof(stored) - 4U]);
	memset(applied, 0, sizeof(applied));
	memset(applied_config, 0, sizeof(applied_config));
	applied_speed = 0U;
	hardware_error = 0;
	save_error = 0;
	save_count = 0;
	tag_present = false;
	memset(&tag, 0, sizeof(tag));
	tag.antenna = 2U;
	tag.registry_id = 1U;
	tag.vendor_id = 1U;
	tag.module_type_id = 2001U;
	tag.uid_len = 4U;
	tag.uid[0] = 0x44U;
	zassert_ok(spaghetti_physical_init());
}

ZTEST(physical, test_descriptor_and_manual_persistence)
{
	uint8_t descriptor[SPAGHETTI_PHYSICAL_SIZE];
	const uint8_t modes[4] = {1U, 2U, 3U, 0U};

	zassert_ok(spaghetti_physical_describe(descriptor));
	zassert_equal(descriptor[1], 1U);
	zassert_equal(descriptor[2], 2U);
	zassert_equal(descriptor[3], 1U);
	zassert_equal(descriptor[5], 25U);
	zassert_ok(spaghetti_physical_apply(modes, 0U));
	zassert_equal(save_count, 1);
	memset(applied, 0, sizeof(applied));
	zassert_ok(spaghetti_physical_init());
	zassert_mem_equal(applied, modes, 4U);
}

ZTEST(physical, test_catalog_applies_after_reboot_and_removal)
{
	uint8_t expected[20];
	uint8_t descriptor[SPAGHETTI_PHYSICAL_SIZE];
	const uint8_t modes[4] = {4U, 5U, 1U, 0U};
	const uint8_t safe[4] = {0};

	tag_present = true;
	expected_tag(expected, true);
	zassert_ok(spaghetti_physical_apply_checked(modes, 1U, expected));
	zassert_ok(spaghetti_physical_describe(descriptor));
	zassert_equal(descriptor[12], 2U);
	zassert_equal(spaghetti_physical_apply_checked(modes, 1U,
		(uint8_t[20]){0}), -ESTALE);
	expected[19] = 0U;
	zassert_equal(spaghetti_physical_apply_checked(modes, 1U, expected), -EACCES);
	tag_present = false;
	zassert_ok(spaghetti_physical_refresh());
	zassert_mem_equal(applied, safe, 4U);
	zassert_ok(spaghetti_physical_init());
	tag_present = true;
	zassert_ok(spaghetti_physical_refresh());
	zassert_mem_equal(applied, modes, 4U);
	zassert_equal(applied_speed, 1U);
}

ZTEST(physical, test_changed_tag_and_busy_hardware_do_not_persist)
{
	uint8_t expected[20];
	const uint8_t modes[4] = {4U, 5U, 0U, 0U};

	tag_present = true;
	expected_tag(expected, true);
	tag.uid[0]++;
	zassert_equal(spaghetti_physical_apply_checked(modes, 0U, expected), -ESTALE);
	zassert_equal(save_count, 0);
	expected_tag(expected, true);
	hardware_error = -EBUSY;
	zassert_equal(spaghetti_physical_apply_checked(modes, 0U, expected), -EBUSY);
	zassert_equal(save_count, 0);
}

ZTEST(physical, test_storage_failure_rolls_back)
{
	const uint8_t modes[4] = {1U, 2U, 0U, 0U};
	const uint8_t safe[4] = {0};

	save_error = -EIO;
	zassert_equal(spaghetti_physical_apply(modes, 0U), -EIO);
	zassert_mem_equal(applied, safe, 4U);
	zassert_equal(save_count, 0);
}

ZTEST(physical, test_catalog_capacity_and_malformed_snapshot)
{
	uint8_t expected[20];
	const uint8_t modes[4] = {4U, 5U, 0U, 0U};

	tag_present = true;
	for (uint32_t i = 1U; i <= 16U; ++i) {
		tag.module_type_id = i;
		expected_tag(expected, true);
		zassert_ok(spaghetti_physical_apply_checked(modes, 0U, expected));
	}
	tag.module_type_id = 17U;
	expected_tag(expected, true);
	zassert_equal(spaghetti_physical_apply_checked(modes, 0U, expected), -ENOSPC);
	expected[8] = 11U;
	zassert_equal(spaghetti_physical_apply_checked(modes, 0U, expected), -EINVAL);
	zassert_equal(save_count, 16);
}

ZTEST(physical, test_generic_tag_remains_manually_configurable)
{
	uint8_t expected[20];
	const uint8_t modes[4] = {1U, 0U, 0U, 0U};

	tag_present = true;
	tag.registry_id = 0U;
	tag.vendor_id = 0U;
	tag.module_type_id = 0U;
	expected_tag(expected, true);
	zassert_equal(spaghetti_physical_apply_checked(modes, 0U, expected), -EINVAL);
	expected[19] = 0U;
	zassert_ok(spaghetti_physical_apply_checked(modes, 0U, expected));
	zassert_ok(spaghetti_physical_refresh());
	zassert_mem_equal(applied, modes, 4U);
}

ZTEST(physical, test_extended_settings_survive_reboot)
{
	const uint8_t modes[4] = {7U, 12U, 6U, 1U};
	const uint8_t config[20] = {1,0,225,0,0,64,66,15,0,220,5,0,0,8,2,2,3,1,1,0};
	uint8_t descriptor[SPAGHETTI_PHYSICAL_SIZE];
	zassert_ok(spaghetti_physical_apply_config(modes, 0U, (uint8_t[20]){0}, config));
	memset(applied_config, 0, sizeof(applied_config));
	zassert_ok(spaghetti_physical_init());
	zassert_ok(spaghetti_physical_describe(descriptor));
	zassert_equal(descriptor[0], 2U);
	zassert_mem_equal(&descriptor[7], modes, 4U);
	zassert_mem_equal(&descriptor[13], config, 20U);
}

ZTEST_SUITE(physical, NULL, NULL, before, NULL, NULL);

int spaghetti_port_copy_user_config(spaghetti_port_id_t id, uint8_t config[20]) { ARG_UNUSED(id); memcpy(config, applied_config, 20U); return 0; }
int spaghetti_port_apply_user_config(spaghetti_port_id_t id, const uint8_t modes[4], uint8_t speed, const uint8_t config[20]) { int err = spaghetti_port_apply_user_map(id, modes, speed); if (!err) { if (config) memcpy(applied_config, config, 20U); else memset(applied_config, 0, 20U); } return err; }
