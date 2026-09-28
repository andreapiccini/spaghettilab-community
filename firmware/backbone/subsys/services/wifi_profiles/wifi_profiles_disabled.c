#include <spaghetti/wifi_profiles.h>

#include <errno.h>
#include <stddef.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

static bool initialized;

int spaghetti_wifi_profiles_init(void)
{
	if (initialized) {
		return -EALREADY;
	}

	initialized = true;
	return 0;
}

int spaghetti_wifi_profiles_init_offline(void)
{
	return spaghetti_wifi_profiles_init();
}

int spaghetti_wifi_profiles_start(void)
{
	return initialized ? -ENOTSUP : -EACCES;
}

int spaghetti_wifi_profiles_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return initialized ? 0 : -EACCES;
}

int spaghetti_wifi_profiles_set(
	const struct spaghetti_wifi_profile_config *config)
{
	ARG_UNUSED(config);
	return initialized ? -ENOTSUP : -EACCES;
}

int spaghetti_wifi_profiles_remove(const char *ssid)
{
	ARG_UNUSED(ssid);
	return initialized ? -ENOTSUP : -EACCES;
}

int spaghetti_wifi_profiles_set_preferred(const char *ssid)
{
	ARG_UNUSED(ssid);
	return initialized ? -ENOTSUP : -EACCES;
}

int spaghetti_wifi_profiles_clear_preferred(void)
{
	return initialized ? -ENOTSUP : -EACCES;
}

int spaghetti_wifi_profiles_delete_all(void)
{
	return initialized ? 0 : -EACCES;
}

int spaghetti_wifi_profiles_rotate(
	const char *ssid,
	const uint8_t *passphrase,
	size_t passphrase_size)
{
	ARG_UNUSED(ssid);
	ARG_UNUSED(passphrase);
	ARG_UNUSED(passphrase_size);
	return initialized ? -ENOTSUP : -EACCES;
}

int spaghetti_wifi_profiles_list(
	struct spaghetti_wifi_profile_summary *out,
	size_t capacity,
	size_t *out_count)
{
	if ((out_count == NULL) || ((out == NULL) && (capacity != 0U))) {
		return -EINVAL;
	}
	if (!initialized) {
		return -EACCES;
	}

	*out_count = 0U;
	return 0;
}

int spaghetti_wifi_profiles_scan(
	struct spaghetti_wifi_scan_result *out,
	size_t capacity,
	size_t *out_count)
{
	if ((out_count == NULL) || ((out == NULL) && (capacity != 0U))) {
		return -EINVAL;
	}
	if (!initialized) {
		return -EACCES;
	}

	ARG_UNUSED(out);
	ARG_UNUSED(capacity);
	return -ENOTSUP;
}

int spaghetti_wifi_profiles_request_connect(void)
{
	return initialized ? -ENOTSUP : -EACCES;
}

int spaghetti_wifi_profiles_get_status(
	struct spaghetti_wifi_profiles_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	if (!initialized) {
		return -EACCES;
	}

	*out = (struct spaghetti_wifi_profiles_status) {
		.state = SPAGHETTI_WIFI_PROFILES_IDLE,
	};
	return 0;
}
