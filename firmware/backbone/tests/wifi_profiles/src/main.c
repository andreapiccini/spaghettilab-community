#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/ztest.h>
#include <zephyr/sys/util.h>

#include <spaghetti/wifi_profiles.h>

#include "wifi_profiles_internal.h"

static struct spaghetti_wifi_profile_secret
	stored_profiles[CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT];
static bool stored_profile_used[CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT];
static char stored_preferred[SPAGHETTI_WIFI_SSID_SIZE];

int spaghetti_wifi_profiles_storage_read(
	size_t slot,
	struct spaghetti_wifi_profile_secret *out)
{
	if ((slot >= ARRAY_SIZE(stored_profiles)) || (out == NULL)) {
		return -EINVAL;
	}
	if (!stored_profile_used[slot]) {
		return -ENOENT;
	}

	*out = stored_profiles[slot];
	return 0;
}

int spaghetti_wifi_profiles_storage_write(
	size_t slot,
	const struct spaghetti_wifi_profile_config *config)
{
	if ((slot >= ARRAY_SIZE(stored_profiles)) || (config == NULL)) {
		return -EINVAL;
	}

	stored_profiles[slot] = (struct spaghetti_wifi_profile_secret) {
		.security = config->security,
		.passphrase_size = config->passphrase_size,
	};
	memcpy(stored_profiles[slot].ssid, config->ssid,
	       sizeof(stored_profiles[slot].ssid));
	memcpy(stored_profiles[slot].passphrase, config->passphrase,
	       config->passphrase_size);
	stored_profile_used[slot] = true;
	return 0;
}

int spaghetti_wifi_profiles_storage_remove(size_t slot)
{
	if (slot >= ARRAY_SIZE(stored_profiles)) {
		return -EINVAL;
	}
	if (!stored_profile_used[slot]) {
		return -ENOENT;
	}

	memset(&stored_profiles[slot], 0, sizeof(stored_profiles[slot]));
	stored_profile_used[slot] = false;
	return 0;
}

int spaghetti_wifi_profiles_storage_read_preferred(
	char out_ssid[SPAGHETTI_WIFI_SSID_SIZE])
{
	if (out_ssid == NULL) {
		return -EINVAL;
	}
	if (stored_preferred[0] == '\0') {
		return -ENOENT;
	}

	memcpy(out_ssid, stored_preferred, sizeof(stored_preferred));
	return 0;
}

int spaghetti_wifi_profiles_storage_write_preferred(const char *ssid)
{
	if (ssid == NULL) {
		return -EINVAL;
	}

	memset(stored_preferred, 0, sizeof(stored_preferred));
	strncpy(stored_preferred, ssid, sizeof(stored_preferred) - 1U);
	return 0;
}

int spaghetti_wifi_profiles_storage_remove_preferred(void)
{
	if (stored_preferred[0] == '\0') {
		return -ENOENT;
	}

	memset(stored_preferred, 0, sizeof(stored_preferred));
	return 0;
}

static struct spaghetti_wifi_profile_config make_wpa2_profile(
	const char *ssid,
	const char *passphrase)
{
	struct spaghetti_wifi_profile_config profile = {
		.security = SPAGHETTI_WIFI_SECURITY_WPA2_PSK,
	};

	strncpy(profile.ssid, ssid, sizeof(profile.ssid) - 1U);
	profile.passphrase_size = strlen(passphrase);
	memcpy(profile.passphrase, passphrase, profile.passphrase_size);
	return profile;
}

ZTEST(wifi_profiles, test_persistence_contract_and_selection_policy)
{
	struct spaghetti_wifi_profile_summary summaries[4];
	struct spaghetti_wifi_profiles_status status;
	size_t ordered[4];
	size_t count;
	struct spaghetti_wifi_profile_config office =
		make_wpa2_profile("Office", "office-password");
	struct spaghetti_wifi_profile_config lab =
		make_wpa2_profile("Lab", "lab-password");

	zassert_equal(spaghetti_wifi_profiles_set(&office), -EACCES);
	zassert_equal(spaghetti_wifi_profiles_scan(NULL, 0U, NULL), -EINVAL);
	zassert_equal(spaghetti_wifi_profiles_scan(NULL, 0U, &count), -EACCES);
	if (IS_ENABLED(CONFIG_SPAGHETTI_WIFI_PROFILES_TEST_OFFLINE)) {
		zassert_ok(spaghetti_wifi_profiles_init_offline());
	} else {
		zassert_ok(spaghetti_wifi_profiles_init());
	}
	zassert_equal(spaghetti_wifi_profiles_init(), -EALREADY);
	zassert_ok(spaghetti_wifi_profiles_set(&office));
	zassert_ok(spaghetti_wifi_profiles_set(&lab));
	zassert_ok(spaghetti_wifi_profiles_set_preferred("Office"));
	zassert_ok(spaghetti_wifi_profiles_list(summaries,
		ARRAY_SIZE(summaries), &count));
	zassert_equal(count, 2U);
	zassert_true(summaries[0].preferred);
	zassert_false(summaries[1].preferred);
	zassert_equal(spaghetti_wifi_profiles_request_connect(), -ENOTSUP);
	zassert_equal(spaghetti_wifi_profiles_scan(NULL, 0U, &count), -ENOTSUP);
	zassert_equal(stored_profiles[0].passphrase_size,
		strlen("office-password"));

	summaries[0].visible = true;
	summaries[0].rssi_dbm = -80;
	summaries[1].visible = true;
	summaries[1].rssi_dbm = -35;
	zassert_ok(spaghetti_wifi_profiles_order_candidates(
		summaries, count, ordered, ARRAY_SIZE(ordered), &count));
	zassert_equal(ordered[0], 0U);
	zassert_equal(ordered[1], 1U);

	summaries[0].preferred = false;
	zassert_ok(spaghetti_wifi_profiles_order_candidates(
		summaries, 2U, ordered, ARRAY_SIZE(ordered), &count));
	zassert_equal(ordered[0], 1U);
	zassert_equal(ordered[1], 0U);

	zassert_ok(spaghetti_wifi_profiles_clear_preferred());
	zassert_ok(spaghetti_wifi_profiles_remove("Office"));
	zassert_equal(spaghetti_wifi_profiles_remove("Office"), -ENOENT);
	zassert_equal(spaghetti_wifi_profiles_request_connect(), -ENOTSUP);
	zassert_ok(spaghetti_wifi_profiles_get_status(&status));
	zassert_equal(status.profile_count, 1U);
}

ZTEST_SUITE(wifi_profiles, NULL, NULL, NULL, NULL, NULL);
