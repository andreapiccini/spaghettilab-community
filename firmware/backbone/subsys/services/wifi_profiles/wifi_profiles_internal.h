#ifndef SPAGHETTI_WIFI_PROFILES_INTERNAL_H
#define SPAGHETTI_WIFI_PROFILES_INTERNAL_H

#include <stddef.h>
#include <stdint.h>

#include <spaghetti/wifi_profiles.h>

struct spaghetti_wifi_profile_secret {
	char ssid[SPAGHETTI_WIFI_SSID_SIZE];
	enum spaghetti_wifi_security security;
	size_t passphrase_size;
	uint8_t passphrase[SPAGHETTI_WIFI_PASSPHRASE_SIZE];
};

int spaghetti_wifi_profiles_storage_read(
	size_t slot,
	struct spaghetti_wifi_profile_secret *out);
int spaghetti_wifi_profiles_storage_write(
	size_t slot,
	const struct spaghetti_wifi_profile_config *config);
int spaghetti_wifi_profiles_storage_remove(size_t slot);
int spaghetti_wifi_profiles_storage_read_preferred(
	char out_ssid[SPAGHETTI_WIFI_SSID_SIZE]);
int spaghetti_wifi_profiles_storage_write_preferred(const char *ssid);
int spaghetti_wifi_profiles_storage_remove_preferred(void);

int spaghetti_wifi_profiles_order_candidates(
	const struct spaghetti_wifi_profile_summary *profiles,
	size_t profile_count,
	size_t *out_indices,
	size_t capacity,
	size_t *out_count);

#endif /* SPAGHETTI_WIFI_PROFILES_INTERNAL_H */
