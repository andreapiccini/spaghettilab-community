#include <spaghetti/wifi_profiles.h>

#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/net/net_if.h>
#include <zephyr/net/net_mgmt.h>
#include <zephyr/net/wifi_mgmt.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/util.h>

#include "wifi_profiles_internal.h"
#include "../service_thread.h"

LOG_MODULE_REGISTER(spaghetti_wifi_profiles,
			CONFIG_SPAGHETTI_WIFI_PROFILES_LOG_LEVEL);

#define SPAGHETTI_WIFI_INVALID_SLOT CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT

struct spaghetti_wifi_profile_slot {
	struct spaghetti_wifi_profile_summary summary;
	bool used;
};

struct spaghetti_wifi_profiles_context {
	struct spaghetti_wifi_profile_slot
		slots[CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT];
	struct spaghetti_wifi_profiles_status status;
	size_t preferred_slot;
	bool initialized;
};

static struct spaghetti_wifi_profiles_context context = {
	.preferred_slot = SPAGHETTI_WIFI_INVALID_SLOT,
};
static atomic_t network_allowed;
K_MUTEX_DEFINE(profiles_lock);

#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
static struct net_mgmt_event_callback wifi_event_callback;
static struct spaghetti_wifi_profile_summary
	scan_profiles[CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT];
static size_t scan_profile_count;
static atomic_t scan_is_active;
static atomic_t catalog_scan_active;
static atomic_t connect_event_received;
static atomic_t connect_status;
static atomic_t wifi_is_connected;
static atomic_t force_reconnect;
static atomic_t startup_delay_pending;
static atomic_t stop_requested;
static struct spaghetti_service_thread wifi_worker_thread;
static bool wifi_callback_registered;
static struct spaghetti_wifi_scan_result
	catalog[SPAGHETTI_WIFI_SCAN_MAX_RESULTS];
static size_t catalog_count;
K_MUTEX_DEFINE(scan_op_lock);
K_SEM_DEFINE(worker_sem, 0, 1);
K_SEM_DEFINE(scan_done_sem, 0, 1);
K_SEM_DEFINE(connect_done_sem, 0, 1);
K_SEM_DEFINE(disconnect_done_sem, 0, 1);
#endif

static void wipe_sensitive(void *data, size_t data_size)
{
	volatile uint8_t *bytes = data;

	for (size_t byte_idx = 0U; byte_idx < data_size; ++byte_idx) {
		bytes[byte_idx] = 0U;
	}
}

static int validate_ssid(const char *ssid, size_t *out_size)
{
	const char *terminator;

	if ((ssid == NULL) || (out_size == NULL)) {
		return -EINVAL;
	}

	terminator = memchr(ssid, '\0', SPAGHETTI_WIFI_SSID_SIZE);
	if ((terminator == NULL) || (terminator == ssid)) {
		return -EINVAL;
	}

	*out_size = (size_t)(terminator - ssid);
	return 0;
}

static int validate_config(
	const struct spaghetti_wifi_profile_config *config,
	size_t *out_ssid_size)
{
	int err;

	if (config == NULL) {
		return -EINVAL;
	}

	err = validate_ssid(config->ssid, out_ssid_size);
	if (err < 0) {
		return err;
	}

	switch (config->security) {
	case SPAGHETTI_WIFI_SECURITY_OPEN:
		return (config->passphrase_size == 0U) ? 0 : -EINVAL;
	case SPAGHETTI_WIFI_SECURITY_WPA2_PSK:
		return ((config->passphrase_size >= 8U) &&
			(config->passphrase_size <= 64U)) ? 0 : -EINVAL;
	default:
		return -EINVAL;
	}
}

static size_t profile_count_locked(void)
{
	size_t profile_count = 0U;

	for (size_t slot = 0U;
	     slot < CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT; ++slot) {
		if (context.slots[slot].used) {
			++profile_count;
		}
	}

	return profile_count;
}

static size_t find_slot_locked(const char *ssid)
{
	for (size_t slot = 0U;
	     slot < CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT; ++slot) {
		if (context.slots[slot].used &&
		    (strcmp(context.slots[slot].summary.ssid, ssid) == 0)) {
			return slot;
		}
	}

	return SPAGHETTI_WIFI_INVALID_SLOT;
}

static size_t find_free_slot_locked(void)
{
	for (size_t slot = 0U;
	     slot < CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT; ++slot) {
		if (!context.slots[slot].used) {
			return slot;
		}
	}

	return SPAGHETTI_WIFI_INVALID_SLOT;
}

static void update_profile_count_locked(void)
{
	context.status.profile_count = profile_count_locked();
}

#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
static void set_status(enum spaghetti_wifi_profiles_state state,
		       const char *active_ssid, int error)
{
	(void)k_mutex_lock(&profiles_lock, K_FOREVER);
	context.status.state = state;
	context.status.last_error = error;
	memset(context.status.active_ssid, 0,
	       sizeof(context.status.active_ssid));
	if (active_ssid != NULL) {
		const size_t ssid_size = strlen(active_ssid);

		memcpy(context.status.active_ssid, active_ssid, ssid_size);
	}
	k_mutex_unlock(&profiles_lock);
}
#endif

static bool candidate_precedes(
	const struct spaghetti_wifi_profile_summary *first,
	const struct spaghetti_wifi_profile_summary *second)
{
	if (first->preferred != second->preferred) {
		return first->preferred;
	}
	if (first->rssi_dbm != second->rssi_dbm) {
		return first->rssi_dbm > second->rssi_dbm;
	}

	return strcmp(first->ssid, second->ssid) < 0;
}

int spaghetti_wifi_profiles_order_candidates(
	const struct spaghetti_wifi_profile_summary *profiles,
	size_t profile_count,
	size_t *out_indices,
	size_t capacity,
	size_t *out_count)
{
	size_t ordered[CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT];
	size_t visible_count = 0U;

	if ((profiles == NULL) || (out_count == NULL) ||
	    (profile_count > CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT) ||
	    ((out_indices == NULL) != (capacity == 0U))) {
		return -EINVAL;
	}

	for (size_t profile_idx = 0U; profile_idx < profile_count;
	     ++profile_idx) {
		if (!profiles[profile_idx].visible) {
			continue;
		}

		size_t insert_idx = visible_count;

		while ((insert_idx > 0U) &&
		       candidate_precedes(&profiles[profile_idx],
					  &profiles[ordered[insert_idx - 1U]])) {
			ordered[insert_idx] = ordered[insert_idx - 1U];
			--insert_idx;
		}
		ordered[insert_idx] = profile_idx;
		++visible_count;
	}

	if (capacity < visible_count) {
		return -ENOSPC;
	}
	if (visible_count > 0U) {
		memcpy(out_indices, ordered,
		       visible_count * sizeof(ordered[0]));
	}
	*out_count = visible_count;
	return 0;
}

#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
static enum spaghetti_wifi_scan_security map_scan_security(
	enum wifi_security_type security)
{
	switch (security) {
	case WIFI_SECURITY_TYPE_NONE:
		return SPAGHETTI_WIFI_SCAN_OPEN;
	case WIFI_SECURITY_TYPE_PSK:
	case WIFI_SECURITY_TYPE_PSK_SHA256:
		return SPAGHETTI_WIFI_SCAN_WPA2;
	default:
		return SPAGHETTI_WIFI_SCAN_OTHER;
	}
}

static void catalog_add(const struct wifi_scan_result *entry)
{
	char ssid[SPAGHETTI_WIFI_SSID_SIZE];
	size_t slot = 0U;
	size_t weakest = 0U;

	if ((entry->ssid_length == 0U) ||
	    (entry->ssid_length >= SPAGHETTI_WIFI_SSID_SIZE)) {
		return;
	}

	memcpy(ssid, entry->ssid, entry->ssid_length);
	ssid[entry->ssid_length] = '\0';

	for (size_t result_idx = 0U; result_idx < catalog_count;
	     ++result_idx) {
		if (strcmp(catalog[result_idx].ssid, ssid) != 0) {
			continue;
		}
		if (entry->rssi > catalog[result_idx].rssi_dbm) {
			catalog[result_idx].rssi_dbm = entry->rssi;
			catalog[result_idx].security =
				map_scan_security(entry->security);
		}
		return;
	}

	if (catalog_count < ARRAY_SIZE(catalog)) {
		slot = catalog_count;
		++catalog_count;
	} else {
		for (size_t result_idx = 1U; result_idx < catalog_count;
		     ++result_idx) {
			if (catalog[result_idx].rssi_dbm <
			    catalog[weakest].rssi_dbm) {
				weakest = result_idx;
			}
		}
		if (entry->rssi <= catalog[weakest].rssi_dbm) {
			return;
		}
		slot = weakest;
	}

	memset(&catalog[slot], 0, sizeof(catalog[slot]));
	memcpy(catalog[slot].ssid, ssid, entry->ssid_length + 1U);
	catalog[slot].security = map_scan_security(entry->security);
	catalog[slot].rssi_dbm = entry->rssi;
}

static void sort_catalog_by_rssi(void)
{
	for (size_t result_idx = 1U; result_idx < catalog_count;
	     ++result_idx) {
		struct spaghetti_wifi_scan_result current =
			catalog[result_idx];
		size_t insert_idx = result_idx;

		while ((insert_idx > 0U) &&
		       (catalog[insert_idx - 1U].rssi_dbm <
			current.rssi_dbm)) {
			catalog[insert_idx] = catalog[insert_idx - 1U];
			--insert_idx;
		}
		catalog[insert_idx] = current;
	}
}

static void wifi_event_handler(struct net_mgmt_event_callback *callback,
			       uint64_t event, struct net_if *iface)
{
	ARG_UNUSED(iface);

	if ((event == NET_EVENT_WIFI_SCAN_RESULT) &&
	    (atomic_get(&scan_is_active) != 0)) {
		const struct wifi_scan_result *result = callback->info;

		if ((result == NULL) ||
		    (result->ssid_length > WIFI_SSID_MAX_LEN)) {
			return;
		}

		if (atomic_get(&catalog_scan_active) != 0) {
			catalog_add(result);
			return;
		}

		for (size_t profile_idx = 0U;
		     profile_idx < scan_profile_count; ++profile_idx) {
			const size_t ssid_size = strlen(
				scan_profiles[profile_idx].ssid);

			if ((ssid_size != result->ssid_length) ||
			    (memcmp(scan_profiles[profile_idx].ssid,
				    result->ssid, ssid_size) != 0)) {
				continue;
			}
			if (!scan_profiles[profile_idx].visible ||
			    (result->rssi >
			     scan_profiles[profile_idx].rssi_dbm)) {
				scan_profiles[profile_idx].visible = true;
				scan_profiles[profile_idx].rssi_dbm =
					result->rssi;
			}
		}
		return;
	}

	if (event == NET_EVENT_WIFI_SCAN_DONE) {
		atomic_set(&scan_is_active, 0);
		k_sem_give(&scan_done_sem);
		return;
	}

	if (event == NET_EVENT_WIFI_CONNECT_RESULT) {
		const struct wifi_status *status = callback->info;
		const int result = (status != NULL) ? status->status : -EIO;

		atomic_set(&connect_status, result);
		atomic_set(&connect_event_received, 1);
		atomic_set(&wifi_is_connected, (result == 0) ? 1 : 0);
		k_sem_give(&connect_done_sem);
		return;
	}

	if (event == NET_EVENT_WIFI_DISCONNECT_RESULT) {
		atomic_set(&wifi_is_connected, 0);
		k_sem_give(&disconnect_done_sem);
		k_sem_give(&worker_sem);
	}
}

static size_t copy_scan_snapshot(size_t *out_slots)
{
	size_t profile_count = 0U;

	(void)k_mutex_lock(&profiles_lock, K_FOREVER);
	for (size_t slot = 0U;
	     slot < CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT; ++slot) {
		if (!context.slots[slot].used) {
			continue;
		}

		scan_profiles[profile_count] = context.slots[slot].summary;
		scan_profiles[profile_count].visible = false;
		scan_profiles[profile_count].rssi_dbm = INT8_MIN;
		out_slots[profile_count] = slot;
		++profile_count;
	}
	k_mutex_unlock(&profiles_lock);

	scan_profile_count = profile_count;
	return profile_count;
}

static void commit_scan_snapshot(const size_t *slots, size_t profile_count)
{
	(void)k_mutex_lock(&profiles_lock, K_FOREVER);
	for (size_t profile_idx = 0U; profile_idx < profile_count;
	     ++profile_idx) {
		const size_t slot = slots[profile_idx];

		if (!context.slots[slot].used ||
		    (strcmp(context.slots[slot].summary.ssid,
			    scan_profiles[profile_idx].ssid) != 0)) {
			continue;
		}
		context.slots[slot].summary.visible =
			scan_profiles[profile_idx].visible;
		context.slots[slot].summary.rssi_dbm =
			scan_profiles[profile_idx].rssi_dbm;
	}
	k_mutex_unlock(&profiles_lock);
}

static int scan_known_networks(struct net_if *iface, const size_t *slots,
			       size_t profile_count)
{
	int err = k_mutex_lock(&scan_op_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}

	k_sem_reset(&scan_done_sem);
	atomic_set(&scan_is_active, 1);
	err = net_mgmt(NET_REQUEST_WIFI_SCAN, iface, NULL, 0U);

	if (err < 0) {
		atomic_set(&scan_is_active, 0);
		k_mutex_unlock(&scan_op_lock);
		return err;
	}

	err = k_sem_take(&scan_done_sem,
			 K_SECONDS(CONFIG_SPAGHETTI_WIFI_SCAN_TIMEOUT_SECONDS));
	atomic_set(&scan_is_active, 0);
	if (err < 0) {
		k_mutex_unlock(&scan_op_lock);
		return -ETIMEDOUT;
	}

	commit_scan_snapshot(slots, profile_count);
	k_mutex_unlock(&scan_op_lock);
	return 0;
}

static int load_candidate_secret(
	size_t slot, const char *expected_ssid,
	struct spaghetti_wifi_profile_secret *out)
{
	struct spaghetti_wifi_profile_secret secret;
	int err;

	(void)k_mutex_lock(&profiles_lock, K_FOREVER);
	if (!context.slots[slot].used ||
	    (strcmp(context.slots[slot].summary.ssid, expected_ssid) != 0)) {
		k_mutex_unlock(&profiles_lock);
		return -ENOENT;
	}

	err = spaghetti_wifi_profiles_storage_read(slot, &secret);
	k_mutex_unlock(&profiles_lock);
	if (err < 0) {
		wipe_sensitive(&secret, sizeof(secret));
		return err;
	}
	if (strcmp(secret.ssid, expected_ssid) != 0) {
		wipe_sensitive(&secret, sizeof(secret));
		return -ENOENT;
	}

	*out = secret;
	wipe_sensitive(&secret, sizeof(secret));
	return 0;
}

static int connect_candidate(struct net_if *iface, size_t slot,
			     const struct spaghetti_wifi_profile_summary *profile)
{
	struct spaghetti_wifi_profile_secret secret = {0};
	struct wifi_connect_req_params parameters = {
		.band = WIFI_FREQ_BAND_UNKNOWN,
		.channel = WIFI_CHANNEL_ANY,
		.mfp = WIFI_MFP_OPTIONAL,
		.timeout = CONFIG_SPAGHETTI_WIFI_CONNECT_TIMEOUT_SECONDS,
	};
	int err = load_candidate_secret(slot, profile->ssid, &secret);

	if (err < 0) {
		return err;
	}

	parameters.ssid = (const uint8_t *)secret.ssid;
	parameters.ssid_length = (uint8_t)strlen(secret.ssid);
	if (secret.security == SPAGHETTI_WIFI_SECURITY_OPEN) {
		parameters.security = WIFI_SECURITY_TYPE_NONE;
	} else if (secret.security ==
		   SPAGHETTI_WIFI_SECURITY_WPA2_PSK) {
		parameters.security = WIFI_SECURITY_TYPE_PSK;
		parameters.psk = secret.passphrase;
		parameters.psk_length = (uint8_t)secret.passphrase_size;
	} else {
		wipe_sensitive(&secret, sizeof(secret));
		return -ENOTSUP;
	}

	set_status(SPAGHETTI_WIFI_PROFILES_CONNECTING, profile->ssid, 0);
	k_sem_reset(&connect_done_sem);
	atomic_set(&connect_event_received, 0);
	err = net_mgmt(NET_REQUEST_WIFI_CONNECT, iface, &parameters,
		       sizeof(parameters));
	wipe_sensitive(&secret, sizeof(secret));
	if (err < 0) {
		return err;
	}

	err = k_sem_take(
		&connect_done_sem,
		K_SECONDS(CONFIG_SPAGHETTI_WIFI_CONNECT_TIMEOUT_SECONDS + 1));
	if ((err < 0) || (atomic_get(&connect_event_received) == 0)) {
		return -ETIMEDOUT;
	}

	const int status = (int)atomic_get(&connect_status);

	return (status == 0) ? 0 : -ECONNREFUSED;
}

static int disconnect_current(struct net_if *iface)
{
	k_sem_reset(&disconnect_done_sem);
	int err = net_mgmt(NET_REQUEST_WIFI_DISCONNECT, iface, NULL, 0U);

	if (err < 0) {
		return err;
	}

	err = k_sem_take(
		&disconnect_done_sem,
		K_SECONDS(CONFIG_SPAGHETTI_WIFI_DISCONNECT_TIMEOUT_SECONDS));
	if (err < 0) {
		return -ETIMEDOUT;
	}

	return 0;
}

static int run_connection_cycle(void)
{
	size_t slots[CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT];
	size_t ordered[CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT];
	size_t ordered_count = 0U;
	struct net_if *iface = net_if_get_wifi_sta();
	size_t profile_count;
	int err;

	if (iface == NULL) {
		return -ENODEV;
	}

	if ((atomic_get(&wifi_is_connected) != 0) &&
	    (atomic_cas(&force_reconnect, 1, 0))) {
		err = disconnect_current(iface);
		if (err < 0) {
			return err;
		}
	}
	if (atomic_get(&wifi_is_connected) != 0) {
		return 0;
	}
	atomic_set(&force_reconnect, 0);

	profile_count = copy_scan_snapshot(slots);
	if (profile_count == 0U) {
		return -ENOENT;
	}

	set_status(SPAGHETTI_WIFI_PROFILES_SCANNING, NULL, 0);
	err = scan_known_networks(iface, slots, profile_count);
	if (err < 0) {
		return err;
	}
	if (atomic_get(&stop_requested) != 0) {
		return -ECANCELED;
	}

	err = spaghetti_wifi_profiles_order_candidates(
		scan_profiles, profile_count, ordered, ARRAY_SIZE(ordered),
		&ordered_count);
	if (err < 0) {
		return err;
	}
	if (ordered_count == 0U) {
		return -ENOENT;
	}

	for (size_t candidate_idx = 0U; candidate_idx < ordered_count;
	     ++candidate_idx) {
		const size_t profile_idx = ordered[candidate_idx];

		if (atomic_get(&stop_requested) != 0) {
			return -ECANCELED;
		}

		err = connect_candidate(iface, slots[profile_idx],
					&scan_profiles[profile_idx]);
		if (err == 0) {
			set_status(SPAGHETTI_WIFI_PROFILES_CONNECTED,
				   scan_profiles[profile_idx].ssid, 0);
			LOG_INF("connected: ssid=%s",
				scan_profiles[profile_idx].ssid);
			return 0;
		}
	}

	return err;
}

static void wifi_worker_thread_entry(void *first, void *second, void *third)
{
	ARG_UNUSED(first);
	ARG_UNUSED(second);
	ARG_UNUSED(third);

	while (atomic_get(&stop_requested) == 0) {
		(void)k_sem_take(&worker_sem, K_FOREVER);
		if (atomic_get(&stop_requested) != 0) {
			break;
		}
		if (atomic_cas(&startup_delay_pending, 1, 0)) {
			(void)k_sem_take(
				&worker_sem,
				K_MSEC(CONFIG_SPAGHETTI_WIFI_PROFILE_STARTUP_DELAY_MS));
			if (atomic_get(&stop_requested) != 0) {
				break;
			}
		}

		while (atomic_get(&stop_requested) == 0) {
			const int err = run_connection_cycle();

			if (err == 0) {
				break;
			}
			if (err == -ENOENT) {
				set_status(SPAGHETTI_WIFI_PROFILES_IDLE, NULL,
					   err);
			} else {
				set_status(SPAGHETTI_WIFI_PROFILES_ERROR, NULL,
					   err);
			}

			if (k_sem_take(
				    &worker_sem,
				    K_SECONDS(
					    CONFIG_SPAGHETTI_WIFI_RETRY_SECONDS)) ==
			    0) {
				continue;
			}
		}
	}
	if (atomic_get(&wifi_is_connected) != 0) {
		struct net_if *iface = net_if_get_wifi_sta();

		if (iface != NULL) {
			(void)disconnect_current(iface);
		}
	}
}
#endif

static int wifi_profiles_init(bool allow_network)
{
	char preferred_ssid[SPAGHETTI_WIFI_SSID_SIZE] = {0};
	size_t loaded_profile_count;
	bool has_preferred;
	int err;

	err = k_mutex_lock(&profiles_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EALREADY;
	}

	for (size_t slot = 0U;
	     slot < CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT; ++slot) {
		struct spaghetti_wifi_profile_secret secret = {0};

		err = spaghetti_wifi_profiles_storage_read(slot, &secret);
		if (err == -ENOENT) {
			continue;
		}
		if (err < 0) {
			LOG_WRN("stored profile ignored: slot=%u err=%d",
				(uint32_t)slot, err);
			continue;
		}

		context.slots[slot].used = true;
		context.slots[slot].summary.security = secret.security;
		context.slots[slot].summary.rssi_dbm = INT8_MIN;
		memcpy(context.slots[slot].summary.ssid, secret.ssid,
		       sizeof(secret.ssid));
		wipe_sensitive(&secret, sizeof(secret));
	}

	err = spaghetti_wifi_profiles_storage_read_preferred(preferred_ssid);
	if (err == 0) {
		context.preferred_slot = find_slot_locked(preferred_ssid);
		if (context.preferred_slot != SPAGHETTI_WIFI_INVALID_SLOT) {
			context.slots[context.preferred_slot].summary.preferred = true;
		}
	} else if (err != -ENOENT) {
		LOG_WRN("preferred profile ignored: err=%d", err);
	}

	context.status = (struct spaghetti_wifi_profiles_status) {
		.state = SPAGHETTI_WIFI_PROFILES_IDLE,
	};
	update_profile_count_locked();
	context.initialized = true;
	atomic_set(&network_allowed, allow_network ? 1 : 0);
	loaded_profile_count = context.status.profile_count;
	has_preferred =
		context.preferred_slot != SPAGHETTI_WIFI_INVALID_SLOT;
	wipe_sensitive(preferred_ssid, sizeof(preferred_ssid));
	k_mutex_unlock(&profiles_lock);

	LOG_INF("ready: profiles=%u preferred=%u",
		(uint32_t)loaded_profile_count, has_preferred ? 1U : 0U);
	return 0;
}

int spaghetti_wifi_profiles_init(void)
{
	return wifi_profiles_init(true);
}

int spaghetti_wifi_profiles_init_offline(void)
{
	return wifi_profiles_init(false);
}

int spaghetti_wifi_profiles_start(void)
{
#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
	int err = k_mutex_lock(&profiles_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}
	if (wifi_worker_thread.stack != NULL) {
		k_mutex_unlock(&profiles_lock);
		return -EALREADY;
	}
	atomic_set(&network_allowed, 1);
	atomic_set(&stop_requested, 0);
	atomic_set(&startup_delay_pending, 1);
	if (!wifi_callback_registered) {
		net_mgmt_init_event_callback(
			&wifi_event_callback, wifi_event_handler,
			NET_EVENT_WIFI_SCAN_RESULT | NET_EVENT_WIFI_SCAN_DONE |
			NET_EVENT_WIFI_CONNECT_RESULT |
			NET_EVENT_WIFI_DISCONNECT_RESULT);
		net_mgmt_add_event_callback(&wifi_event_callback);
		wifi_callback_registered = true;
	}
	k_mutex_unlock(&profiles_lock);

	err = spaghetti_service_thread_start(
		&wifi_worker_thread,
		CONFIG_SPAGHETTI_WIFI_PROFILE_WORKER_STACK_SIZE,
		wifi_worker_thread_entry, NULL, NULL, NULL,
		CONFIG_SPAGHETTI_WIFI_PROFILE_WORKER_PRIORITY,
		"wifi_profiles");
	if (err < 0) {
		(void)k_mutex_lock(&profiles_lock, K_FOREVER);
		atomic_set(&network_allowed, 0);
		if (wifi_callback_registered) {
			net_mgmt_del_event_callback(&wifi_event_callback);
			wifi_callback_registered = false;
		}
		k_mutex_unlock(&profiles_lock);
		return err;
	}
	return 0;
#else
	return -ENOTSUP;
#endif
}

int spaghetti_wifi_profiles_stop(k_timeout_t timeout)
{
#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
	int64_t timeout_ms;
	int err;

	if (K_TIMEOUT_EQ(timeout, K_FOREVER)) {
		return -EINVAL;
	}
	timeout_ms = k_ticks_to_ms_floor64(timeout.ticks);
	if ((timeout_ms < 0) ||
	    (timeout_ms > CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS)) {
		return -EINVAL;
	}
	(void)k_mutex_lock(&profiles_lock, K_FOREVER);
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}
	if (wifi_worker_thread.stack == NULL) {
		k_mutex_unlock(&profiles_lock);
		return -EALREADY;
	}
	atomic_set(&network_allowed, 0);
	atomic_set(&stop_requested, 1);
	atomic_set(&startup_delay_pending, 0);
	k_sem_give(&worker_sem);
	k_sem_give(&scan_done_sem);
	k_sem_give(&connect_done_sem);
	k_mutex_unlock(&profiles_lock);

	err = spaghetti_service_thread_join_and_release(
		&wifi_worker_thread, timeout);
	if (err < 0) {
		return err;
	}
	(void)k_mutex_lock(&profiles_lock, K_FOREVER);
	if (wifi_callback_registered) {
		net_mgmt_del_event_callback(&wifi_event_callback);
		wifi_callback_registered = false;
	}
	context.status.state = SPAGHETTI_WIFI_PROFILES_IDLE;
	context.status.active_ssid[0] = '\0';
	k_mutex_unlock(&profiles_lock);
	return 0;
#else
	ARG_UNUSED(timeout);
	return -ENOTSUP;
#endif
}

int spaghetti_wifi_profiles_set(
	const struct spaghetti_wifi_profile_config *config)
{
	size_t ignored_ssid_size;
	size_t slot;
	int err = validate_config(config, &ignored_ssid_size);

	if (err < 0) {
		return err;
	}

	err = k_mutex_lock(&profiles_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}

	slot = find_slot_locked(config->ssid);
	if (slot == SPAGHETTI_WIFI_INVALID_SLOT) {
		slot = find_free_slot_locked();
		if (slot == SPAGHETTI_WIFI_INVALID_SLOT) {
			k_mutex_unlock(&profiles_lock);
			return -ENOSPC;
		}
	}

	err = spaghetti_wifi_profiles_storage_write(slot, config);
	if (err == 0) {
		const bool is_preferred =
			(slot == context.preferred_slot);

		context.slots[slot] =
			(struct spaghetti_wifi_profile_slot) {
				.summary = {
					.security = config->security,
					.preferred = is_preferred,
					.rssi_dbm = INT8_MIN,
				},
				.used = true,
			};
		memcpy(context.slots[slot].summary.ssid, config->ssid,
		       ignored_ssid_size + 1U);
		update_profile_count_locked();
	}
	k_mutex_unlock(&profiles_lock);

#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
	const bool should_connect =
		(err == 0) && (atomic_get(&network_allowed) != 0) &&
		(atomic_get(&wifi_is_connected) == 0);

	if (should_connect) {
		k_sem_give(&worker_sem);
	}
#endif
	return err;
}

int spaghetti_wifi_profiles_remove(const char *ssid)
{
	size_t ignored_ssid_size;
	size_t slot;
	bool was_preferred;
	bool was_active;
	int err = validate_ssid(ssid, &ignored_ssid_size);

	if (err < 0) {
		return err;
	}
	ARG_UNUSED(ignored_ssid_size);

	err = k_mutex_lock(&profiles_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}

	slot = find_slot_locked(ssid);
	if (slot == SPAGHETTI_WIFI_INVALID_SLOT) {
		k_mutex_unlock(&profiles_lock);
		return -ENOENT;
	}

	was_preferred = (slot == context.preferred_slot);
	was_active = strcmp(context.status.active_ssid, ssid) == 0;
	if (was_preferred) {
		err = spaghetti_wifi_profiles_storage_remove_preferred();
		if (err < 0) {
			k_mutex_unlock(&profiles_lock);
			return err;
		}
	}

	err = spaghetti_wifi_profiles_storage_remove(slot);
	if (err < 0) {
		if (was_preferred &&
		    (spaghetti_wifi_profiles_storage_write_preferred(ssid) < 0)) {
			err = -EIO;
		}
		k_mutex_unlock(&profiles_lock);
		return err;
	}

	memset(&context.slots[slot], 0, sizeof(context.slots[slot]));
	if (was_preferred) {
		context.preferred_slot = SPAGHETTI_WIFI_INVALID_SLOT;
	}
	update_profile_count_locked();
	k_mutex_unlock(&profiles_lock);

#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
	if ((atomic_get(&network_allowed) != 0) && was_active) {
		atomic_set(&force_reconnect, 1);
	}
	if (atomic_get(&network_allowed) != 0) {
		k_sem_give(&worker_sem);
	}
#else
	ARG_UNUSED(was_active);
#endif
	return 0;
}

int spaghetti_wifi_profiles_set_preferred(const char *ssid)
{
	size_t ignored_ssid_size;
	size_t slot;
	int err = validate_ssid(ssid, &ignored_ssid_size);

	if (err < 0) {
		return err;
	}
	ARG_UNUSED(ignored_ssid_size);

	err = k_mutex_lock(&profiles_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}

	slot = find_slot_locked(ssid);
	if (slot == SPAGHETTI_WIFI_INVALID_SLOT) {
		k_mutex_unlock(&profiles_lock);
		return -ENOENT;
	}

	err = spaghetti_wifi_profiles_storage_write_preferred(ssid);
	if (err == 0) {
		for (size_t profile_slot = 0U;
		     profile_slot < CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT;
		     ++profile_slot) {
			context.slots[profile_slot].summary.preferred =
				(profile_slot == slot);
		}
		context.preferred_slot = slot;
	}
	k_mutex_unlock(&profiles_lock);

#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
	if ((err == 0) && (atomic_get(&network_allowed) != 0)) {
		atomic_set(&force_reconnect, 1);
		k_sem_give(&worker_sem);
	}
#endif
	return err;
}

int spaghetti_wifi_profiles_clear_preferred(void)
{
	int err = k_mutex_lock(&profiles_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}
	if (context.preferred_slot == SPAGHETTI_WIFI_INVALID_SLOT) {
		k_mutex_unlock(&profiles_lock);
		return -EALREADY;
	}

	err = spaghetti_wifi_profiles_storage_remove_preferred();
	if (err == 0) {
		context.slots[context.preferred_slot].summary.preferred = false;
		context.preferred_slot = SPAGHETTI_WIFI_INVALID_SLOT;
	}
	k_mutex_unlock(&profiles_lock);

#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
	if ((err == 0) && (atomic_get(&network_allowed) != 0)) {
		atomic_set(&force_reconnect, 1);
		k_sem_give(&worker_sem);
	}
#endif
	return err;
}

int spaghetti_wifi_profiles_delete_all(void)
{
	int first_error = 0;
	int err = k_mutex_lock(&profiles_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}

	if (context.preferred_slot != SPAGHETTI_WIFI_INVALID_SLOT) {
		err = spaghetti_wifi_profiles_storage_remove_preferred();
		if ((err < 0) && (err != -ENOENT)) {
			first_error = err;
		} else {
			context.preferred_slot = SPAGHETTI_WIFI_INVALID_SLOT;
		}
	}

	for (size_t slot = 0U; slot < CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT;
	     ++slot) {
		if (!context.slots[slot].used) {
			continue;
		}
		err = spaghetti_wifi_profiles_storage_remove(slot);
		if ((err < 0) && (err != -ENOENT) && (first_error == 0)) {
			first_error = err;
			continue;
		}
		memset(&context.slots[slot], 0, sizeof(context.slots[slot]));
	}
	update_profile_count_locked();
	context.status.active_ssid[0] = '\0';
	k_mutex_unlock(&profiles_lock);
	return first_error;
}

int spaghetti_wifi_profiles_rotate(
	const char *ssid,
	const uint8_t *passphrase,
	size_t passphrase_size)
{
	struct spaghetti_wifi_profile_config config;
	struct spaghetti_wifi_profile_secret secret;
	size_t ignored_ssid_size;
	size_t slot;
	int err = validate_ssid(ssid, &ignored_ssid_size);

	if (err < 0) {
		return err;
	}
	ARG_UNUSED(ignored_ssid_size);

	err = k_mutex_lock(&profiles_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}

	slot = find_slot_locked(ssid);
	if (slot == SPAGHETTI_WIFI_INVALID_SLOT) {
		k_mutex_unlock(&profiles_lock);
		return -ENOENT;
	}

	err = spaghetti_wifi_profiles_storage_read(slot, &secret);
	if (err < 0) {
		k_mutex_unlock(&profiles_lock);
		return err;
	}

	memset(&config, 0, sizeof(config));
	memcpy(config.ssid, secret.ssid, sizeof(config.ssid));
	config.security = secret.security;
	if (config.security == SPAGHETTI_WIFI_SECURITY_OPEN) {
		if ((passphrase != NULL) && (passphrase_size != 0U)) {
			wipe_sensitive(&secret, sizeof(secret));
			k_mutex_unlock(&profiles_lock);
			return -EINVAL;
		}
		config.passphrase_size = 0U;
	} else {
		if ((passphrase == NULL) || (passphrase_size < 8U) ||
		    (passphrase_size > (SPAGHETTI_WIFI_PASSPHRASE_SIZE - 1U))) {
			wipe_sensitive(&secret, sizeof(secret));
			k_mutex_unlock(&profiles_lock);
			return -EINVAL;
		}
		config.passphrase_size = passphrase_size;
		memcpy(config.passphrase, passphrase, passphrase_size);
	}
	wipe_sensitive(&secret, sizeof(secret));

	err = spaghetti_wifi_profiles_storage_write(slot, &config);
	wipe_sensitive(&config, sizeof(config));
	k_mutex_unlock(&profiles_lock);
	return err;
}

int spaghetti_wifi_profiles_list(
	struct spaghetti_wifi_profile_summary *out,
	size_t capacity,
	size_t *out_count)
{
	int err;

	if ((out_count == NULL) || ((out == NULL) != (capacity == 0U))) {
		return -EINVAL;
	}

	err = k_mutex_lock(&profiles_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}

	const size_t required = profile_count_locked();

	if (out == NULL) {
		*out_count = required;
		k_mutex_unlock(&profiles_lock);
		return 0;
	}
	if (capacity < required) {
		k_mutex_unlock(&profiles_lock);
		return -ENOSPC;
	}

	size_t output_idx = 0U;

	for (size_t slot = 0U;
	     slot < CONFIG_SPAGHETTI_WIFI_PROFILE_MAX_COUNT; ++slot) {
		if (context.slots[slot].used) {
			out[output_idx] = context.slots[slot].summary;
			++output_idx;
		}
	}
	*out_count = required;
	k_mutex_unlock(&profiles_lock);
	return 0;
}

int spaghetti_wifi_profiles_scan(
	struct spaghetti_wifi_scan_result *out,
	size_t capacity,
	size_t *out_count)
{
#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
	struct net_if *iface;
	size_t local_count = 0U;
	bool brought_up = false;
	bool release_iface = false;
	int err;

	if ((out_count == NULL) || ((out == NULL) != (capacity == 0U))) {
		return -EINVAL;
	}

	err = k_mutex_lock(&profiles_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}
	k_mutex_unlock(&profiles_lock);

	iface = net_if_get_wifi_sta();
	if (iface == NULL) {
		return -ENODEV;
	}

	err = k_mutex_lock(&scan_op_lock, K_NO_WAIT);
	if (err < 0) {
		return -EBUSY;
	}

	err = k_mutex_lock(&profiles_lock, K_FOREVER);
	if (err < 0) {
		k_mutex_unlock(&scan_op_lock);
		return err;
	}
	if (!wifi_callback_registered) {
		net_mgmt_init_event_callback(
			&wifi_event_callback, wifi_event_handler,
			NET_EVENT_WIFI_SCAN_RESULT | NET_EVENT_WIFI_SCAN_DONE |
			NET_EVENT_WIFI_CONNECT_RESULT |
			NET_EVENT_WIFI_DISCONNECT_RESULT);
		net_mgmt_add_event_callback(&wifi_event_callback);
		wifi_callback_registered = true;
	}
	release_iface = (wifi_worker_thread.stack == NULL);
	k_mutex_unlock(&profiles_lock);

	if (!net_if_is_up(iface)) {
		err = net_if_up(iface);
		if ((err < 0) && (err != -EALREADY)) {
			k_mutex_unlock(&scan_op_lock);
			return err;
		}
		brought_up = true;
		k_sleep(K_MSEC(1000));
	}

	catalog_count = 0U;
	atomic_set(&catalog_scan_active, 1);
	k_sem_reset(&scan_done_sem);
	atomic_set(&scan_is_active, 1);
	err = net_mgmt(NET_REQUEST_WIFI_SCAN, iface, NULL, 0U);
	if (err < 0) {
		atomic_set(&scan_is_active, 0);
		atomic_set(&catalog_scan_active, 0);
		if (brought_up && release_iface) {
			(void)net_if_down(iface);
		}
		k_mutex_unlock(&scan_op_lock);
		return err;
	}

	err = k_sem_take(
		&scan_done_sem,
		K_SECONDS(CONFIG_SPAGHETTI_WIFI_SCAN_TIMEOUT_SECONDS));
	atomic_set(&scan_is_active, 0);
	atomic_set(&catalog_scan_active, 0);
	if (brought_up && release_iface) {
		(void)net_if_down(iface);
	}
	if (err < 0) {
		k_mutex_unlock(&scan_op_lock);
		return -ETIMEDOUT;
	}

	sort_catalog_by_rssi();
	(void)k_mutex_lock(&profiles_lock, K_FOREVER);
	for (size_t result_idx = 0U; result_idx < catalog_count;
	     ++result_idx) {
		catalog[result_idx].known =
			find_slot_locked(catalog[result_idx].ssid) !=
			SPAGHETTI_WIFI_INVALID_SLOT;
	}
	local_count = catalog_count;
	if (out == NULL) {
		*out_count = local_count;
		k_mutex_unlock(&profiles_lock);
		k_mutex_unlock(&scan_op_lock);
		return 0;
	}
	if (capacity < local_count) {
		k_mutex_unlock(&profiles_lock);
		k_mutex_unlock(&scan_op_lock);
		return -ENOSPC;
	}
	if (local_count > 0U) {
		memcpy(out, catalog, local_count * sizeof(*out));
	}
	*out_count = local_count;
	k_mutex_unlock(&profiles_lock);
	k_mutex_unlock(&scan_op_lock);
	return 0;
#else
	if ((out_count == NULL) || ((out == NULL) != (capacity == 0U))) {
		return -EINVAL;
	}
	if (!context.initialized) {
		return -EACCES;
	}

	ARG_UNUSED(out);
	ARG_UNUSED(capacity);
	return -ENOTSUP;
#endif
}

int spaghetti_wifi_profiles_request_connect(void)
{
	int err = k_mutex_lock(&profiles_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}
	if (profile_count_locked() == 0U) {
		k_mutex_unlock(&profiles_lock);
		return -ENOENT;
	}
	k_mutex_unlock(&profiles_lock);

#if CONFIG_SPAGHETTI_WIFI_PROFILE_AUTO_CONNECT
	if (atomic_get(&network_allowed) == 0) {
		return -ENOTSUP;
	}
	atomic_set(&force_reconnect, 1);
	k_sem_give(&worker_sem);
	return 0;
#else
	return -ENOTSUP;
#endif
}

int spaghetti_wifi_profiles_get_status(
	struct spaghetti_wifi_profiles_status *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&profiles_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		k_mutex_unlock(&profiles_lock);
		return -EACCES;
	}

	*out = context.status;
	k_mutex_unlock(&profiles_lock);
	return 0;
}
