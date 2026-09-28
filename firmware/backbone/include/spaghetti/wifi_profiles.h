/**
 * @file
 * @brief Public persistent Wi-Fi profile and connection-policy contract.
 * @ingroup spaghetti_wifi_profiles
 */

#ifndef SPAGHETTI_WIFI_PROFILES_H
#define SPAGHETTI_WIFI_PROFILES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

/** Maximum SSID bytes including the terminating NUL. */
#define SPAGHETTI_WIFI_SSID_SIZE 33U

/** Maximum WPA2 passphrase bytes including one spare terminating NUL. */
#define SPAGHETTI_WIFI_PASSPHRASE_SIZE 65U

/** Maximum nearby access points returned by one catalog scan. */
#define SPAGHETTI_WIFI_SCAN_MAX_RESULTS 8U

/** Supported personal-network security modes. */
enum spaghetti_wifi_security {
	SPAGHETTI_WIFI_SECURITY_OPEN, /**< Open network with no passphrase. */
	SPAGHETTI_WIFI_SECURITY_WPA2_PSK, /**< WPA2-PSK with an 8-to-64-byte passphrase. */
};

/** Security class reported by a nearby-network scan. */
enum spaghetti_wifi_scan_security {
	SPAGHETTI_WIFI_SCAN_OPEN, /**< Open network with no passphrase. */
	SPAGHETTI_WIFI_SCAN_WPA2, /**< WPA2-PSK or WPA2-PSK-SHA256. */
	SPAGHETTI_WIFI_SCAN_OTHER, /**< WPA3, enterprise, or another unsupported mode. */
};

/** Wi-Fi profile service lifecycle visible to diagnostics. */
enum spaghetti_wifi_profiles_state {
	SPAGHETTI_WIFI_PROFILES_UNINITIALIZED, /**< Initialization has not succeeded. */
	SPAGHETTI_WIFI_PROFILES_IDLE, /**< No known profile is currently usable. */
	SPAGHETTI_WIFI_PROFILES_SCANNING, /**< The worker is collecting visible networks. */
	SPAGHETTI_WIFI_PROFILES_CONNECTING, /**< The worker is trying one known network. */
	SPAGHETTI_WIFI_PROFILES_CONNECTED, /**< Wi-Fi association succeeded. */
	SPAGHETTI_WIFI_PROFILES_ERROR, /**< A retryable storage or network error occurred. */
};

/** @brief Complete caller-owned profile supplied to persistent storage. */
struct spaghetti_wifi_profile_config {
	/** NUL-terminated SSID containing 1 to 32 bytes. */
	char ssid[SPAGHETTI_WIFI_SSID_SIZE];
	/** Validated security mode encoded explicitly by the persistent backend. */
	enum spaghetti_wifi_security security;
	/** Valid leading passphrase bytes; zero for an open network. */
	size_t passphrase_size;
	/** Sensitive caller-owned bytes borrowed only during the set call. */
	uint8_t passphrase[SPAGHETTI_WIFI_PASSPHRASE_SIZE];
};

/** @brief One visible access point from a nearby-network scan. */
struct spaghetti_wifi_scan_result {
	/** NUL-terminated advertised SSID. Hidden networks are omitted. */
	char ssid[SPAGHETTI_WIFI_SSID_SIZE];
	/** Advertised security class; passwords are never included. */
	enum spaghetti_wifi_scan_security security;
	/** Strongest RSSI observed for this SSID, in dBm. */
	int8_t rssi_dbm;
	/** True when a persistent profile already exists for this SSID. */
	bool known;
};

/** @brief Non-sensitive caller-owned summary of one stored profile. */
struct spaghetti_wifi_profile_summary {
	/** NUL-terminated stored SSID. */
	char ssid[SPAGHETTI_WIFI_SSID_SIZE];
	/** Stored security mode. */
	enum spaghetti_wifi_security security;
	/** True when this profile has priority whenever it is visible. */
	bool preferred;
	/** True when the latest completed scan contained this SSID. */
	bool visible;
	/** Strongest RSSI observed for this SSID, in dBm; valid only when visible. */
	int8_t rssi_dbm;
};

/** @brief Caller-owned snapshot of Wi-Fi profile service diagnostics. */
struct spaghetti_wifi_profiles_status {
	/** Current service lifecycle. */
	enum spaghetti_wifi_profiles_state state;
	/** Number of valid persistent profiles currently cached. */
	size_t profile_count;
	/** Associated or attempted SSID, or an empty string when none applies. */
	char active_ssid[SPAGHETTI_WIFI_SSID_SIZE];
	/** Latest negative errno, or zero when no error is recorded. */
	int last_error;
};

/**
 * @brief Load persistent profiles for a later lifecycle start.
 *
 * Invalid or unauthentic stored records are ignored without exposing their
 * contents. When at least one valid profile exists, the worker requests a scan.
 *
 * @retval 0 Profiles are loaded while the network worker remains stopped.
 * @retval -EALREADY The service was already initialized.
 *
 * @note Call once from the boot thread after Settings is initialized. The call
 *       performs bounded persistent reads without allocating a worker stack.
 */
int spaghetti_wifi_profiles_init(void);

/**
 * @brief Load persistent profiles without starting network activity.
 *
 * This maintenance-only variant enables encrypted profile set/remove calls but
 * does not allocate a worker or connect. `spaghetti_wifi_profiles_scan()` may
 * briefly power the station interface to list nearby networks.
 *
 * @retval 0 Profiles are available in storage-only mode.
 * @retval -EALREADY The service was initialized previously.
 *
 * @note Core calls this only in UNPROVISIONED or MAINTENANCE mode.
 */
int spaghetti_wifi_profiles_init_offline(void);

/**
 * @brief Start the optional automatic connection worker.
 *
 * @retval 0 Callback and dynamically allocated worker are active.
 * @retval -EACCES Profiles are not initialized.
 * @retval -EALREADY The worker is already active.
 * @retval -ENOMEM The bounded optional-thread budget cannot provide its stack.
 * @retval -ENOTSUP Automatic connection support is not compiled.
 */
int spaghetti_wifi_profiles_start(void);

/**
 * @brief Stop Wi-Fi activity and return the worker stack.
 *
 * @param[in] timeout Finite deadline for disconnect, worker exit, and stack release.
 *
 * @retval 0 Callback, connection, worker, and stack are released.
 * @retval -EINVAL @p timeout is unbounded or exceeds the service limit.
 * @retval -EACCES Profiles are not initialized.
 * @retval -EALREADY The worker is already stopped.
 * @retval -EAGAIN The deadline expired; cleanup can be retried.
 * @retval -ENOTSUP Automatic connection support is not compiled.
 */
int spaghetti_wifi_profiles_stop(k_timeout_t timeout);

/**
 * @brief Add or atomically replace one persistent Wi-Fi profile.
 *
 * An existing profile with the same SSID keeps its slot. A new profile uses one
 * free bounded slot. The cache changes only after authenticated storage accepts
 * the complete encoded record.
 *
 * @param[in] config Caller-owned profile borrowed only for this call. The
 *                   complete object is copied into a temporary encoded record;
 *                   the pointer is never retained. The caller should erase its
 *                   passphrase bytes after this function returns.
 *
 * @retval 0 The encrypted persistent profile and cache were updated.
 * @retval -EINVAL A pointer, SSID, security mode, or passphrase is invalid.
 * @retval -EACCES The service is not initialized.
 * @retval -ENOSPC All fixed profile slots are occupied.
 * @retval -EIO Authenticated persistent storage rejected the write.
 *
 * @note Thread-safe. Call from thread context; this performs synchronous flash
 *       and cryptographic work and never logs the passphrase.
 */
int spaghetti_wifi_profiles_set(
	const struct spaghetti_wifi_profile_config *config);

/**
 * @brief Remove one persistent profile identified by SSID.
 *
 * Removing the preferred profile also clears the separate preferred record.
 * A currently associated removed profile triggers reselection.
 *
 * @param[in] ssid Caller-owned NUL-terminated SSID borrowed only during the
 *                 call. It must contain 1 to 32 bytes.
 *
 * @retval 0 The profile no longer exists in the live cache or persistent store.
 * @retval -EINVAL @p ssid is NULL, empty, or longer than 32 bytes.
 * @retval -EACCES The service is not initialized.
 * @retval -ENOENT No stored profile has that SSID.
 * @retval -EIO Authenticated persistent storage could not remove the record.
 *
 * @note Thread-safe. Call from thread context; this may perform synchronous
 *       flash I/O. Flash wear levelling may defer physical erasure of ciphertext.
 */
int spaghetti_wifi_profiles_remove(const char *ssid);

/**
 * @brief Make one stored profile the preferred visible network.
 *
 * The preferred SSID is stored in a separate authenticated record. A connection
 * reselection is requested after success.
 *
 * @param[in] ssid Caller-owned NUL-terminated stored SSID borrowed only during
 *                 this call. It must contain 1 to 32 bytes.
 *
 * @retval 0 The preferred profile was durably updated.
 * @retval -EINVAL @p ssid is NULL, empty, or longer than 32 bytes.
 * @retval -EACCES The service is not initialized.
 * @retval -ENOENT No stored profile has that SSID.
 * @retval -EIO Authenticated persistent storage rejected the write.
 *
 * @note Thread-safe and callable from thread context. This performs synchronous
 *       flash I/O and may cause the worker to reconnect.
 */
int spaghetti_wifi_profiles_set_preferred(const char *ssid);

/**
 * @brief Clear the preferred-network selection.
 *
 * @retval 0 No profile is preferred.
 * @retval -EACCES The service is not initialized.
 * @retval -EALREADY No preferred profile was configured.
 * @retval -EIO Authenticated persistent storage could not remove the record.
 *
 * @note Thread-safe and callable from thread context. This performs synchronous
 *       flash I/O and requests connection reselection.
 */
int spaghetti_wifi_profiles_clear_preferred(void);

/**
 * @brief Remove every persistent Wi-Fi profile and the preferred selection.
 *
 * @retval 0 No profiles remain in cache or secure storage.
 * @retval -EACCES The service is not initialized.
 * @retval -EIO Authenticated persistent storage rejected a deletion.
 *
 * @note Thread-safe. Secrets are wiped from temporary buffers and never logged.
 */
int spaghetti_wifi_profiles_delete_all(void);

/**
 * @brief Replace the passphrase of one stored profile without changing its SSID.
 *
 * @param[in] ssid Caller-owned NUL-terminated stored SSID borrowed for this call.
 * @param[in] passphrase Caller-owned secret bytes borrowed only for this call.
 * @param[in] passphrase_size Valid leading passphrase bytes; zero for open networks.
 *
 * @retval 0 The encrypted profile was rotated in place.
 * @retval -EINVAL A pointer, SSID, or passphrase is invalid.
 * @retval -EACCES The service is not initialized.
 * @retval -ENOENT No stored profile has that SSID.
 * @retval -EIO Authenticated persistent storage rejected the write.
 *
 * @note Does not change any principal binding metadata owned elsewhere.
 */
int spaghetti_wifi_profiles_rotate(
	const char *ssid,
	const uint8_t *passphrase,
	size_t passphrase_size);

/**
 * @brief Copy non-sensitive summaries of every stored profile.
 *
 * @param[out] out Caller-owned array written only on success. Pass NULL only
 *                 when @p capacity is zero to query the required count.
 * @param[in] capacity Number of elements available at @p out.
 * @param[out] out_count Caller-owned count destination written on success. It
 *                       receives the number of stored profiles.
 *
 * @retval 0 All summaries were copied or their required count was returned.
 * @retval -EINVAL Pointer and capacity arguments are inconsistent.
 * @retval -EACCES The service is not initialized.
 * @retval -ENOSPC @p capacity is smaller than the required profile count.
 *
 * @note Thread-safe and non-blocking apart from one short mutex. Passwords are
 *       never loaded or exposed by this function.
 */
int spaghetti_wifi_profiles_list(
	struct spaghetti_wifi_profile_summary *out,
	size_t capacity,
	size_t *out_count);

/**
 * @brief Scan for nearby Wi-Fi networks, including SSIDs with no saved profile.
 *
 * Results are ordered by descending RSSI. Duplicate SSIDs keep the strongest
 * observation. At most @c SPAGHETTI_WIFI_SCAN_MAX_RESULTS networks are kept.
 * The call blocks until the scan completes or times out. It is allowed in
 * unprovisioned/offline mode and does not connect.
 *
 * @param[out] out Caller-owned array written only on success. Pass NULL only
 *                 when @p capacity is zero to query the result count.
 * @param[in] capacity Number of elements available at @p out.
 * @param[out] out_count Caller-owned count destination written on success.
 *
 * @retval 0 Nearby networks were copied or their count was returned.
 * @retval -EINVAL Pointer and capacity arguments are inconsistent.
 * @retval -EACCES The service is not initialized.
 * @retval -ENODEV No Wi-Fi station interface is available.
 * @retval -ENOSPC @p capacity is smaller than the number of results.
 * @retval -EBUSY Another scan is already running.
 * @retval -ETIMEDOUT The scan did not complete before the configured deadline.
 * @retval -ENOTSUP Wi-Fi scan support is not compiled.
 *
 * @note Thread-safe. Call from thread context. Passwords are never collected.
 *       The station radio may be powered for the duration of the scan.
 */
int spaghetti_wifi_profiles_scan(
	struct spaghetti_wifi_scan_result *out,
	size_t capacity,
	size_t *out_count);

/**
 * @brief Request immediate scan and automatic connection reselection.
 *
 * If associated, the worker disconnects first. A visible preferred profile is
 * attempted before all other visible profiles ordered by descending RSSI.
 *
 * @retval 0 The coalesced worker request was accepted.
 * @retval -EACCES The service is not initialized.
 * @retval -ENOENT No profile is stored.
 * @retval -ENOTSUP Automatic connection support was disabled at build time.
 *
 * @note Thread-safe and non-blocking. Network operations run only in the owned
 *       Wi-Fi Profiles worker thread.
 */
int spaghetti_wifi_profiles_request_connect(void);

/**
 * @brief Copy the current coherent Wi-Fi profile service status.
 *
 * @param[out] out Caller-owned destination written only on success and never retained.
 *
 * @retval 0 A coherent snapshot was copied.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES The service is not initialized.
 *
 * @note Thread-safe and callable from thread context without flash or network I/O.
 */
int spaghetti_wifi_profiles_get_status(
	struct spaghetti_wifi_profiles_status *out);

#endif /* SPAGHETTI_WIFI_PROFILES_H */
