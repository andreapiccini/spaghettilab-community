#include <spaghetti/factory_reset.h>

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <spaghetti/maintenance_link.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/ota.h>
#include <spaghetti/ble.h>
#include <spaghetti/remote_console.h>
#include <spaghetti/runtime.h>
#include <spaghetti/service.h>
#include <spaghetti/storage.h>
#include <spaghetti/wifi_profiles.h>
#include <spaghetti/communication.h>

#include "core_boot_internal.h"

LOG_MODULE_REGISTER(spaghetti_factory_reset,
		    CONFIG_SPAGHETTI_FACTORY_RESET_LOG_LEVEL);

#define SPAGHETTI_RESET_KNOWN_MASK ((uint32_t)SPAGHETTI_RESET_ALL)

static spaghetti_principal_id_t acting_principal_id;
static bool status_valid;
static struct spaghetti_factory_reset_status last_status;
K_MUTEX_DEFINE(factory_reset_lock);

static bool is_authorized(void)
{
	if (spaghetti_maintenance_link_get_state() ==
	    SPAGHETTI_MAINTENANCE_LINK_ACTIVE) {
		return true;
	}
	if (acting_principal_id == 0U) {
		return false;
	}
	return spaghetti_principal_authorize(
		       acting_principal_id,
		       SPAGHETTI_PERMISSION_PROVISION) == 0;
}

static void stop_runtime_services(void)
{
	(void)spaghetti_runtime_stop(
		K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
	(void)spaghetti_service_stop(
		"ota", K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
	(void)spaghetti_mqtt_stop(
		K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
	(void)spaghetti_wifi_profiles_stop(
		K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
	(void)spaghetti_remote_console_stop(
		K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
	(void)spaghetti_ble_stop(
		K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
	(void)spaghetti_ota_stop(
		K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
}

static int delete_config_scope(void)
{
	int err = spaghetti_storage_delete_config();

	if ((err == 0) || (err == -ENOENT)) {
		err = spaghetti_storage_probe_config();
		return (err == -ENOENT) ? 0 : -EIO;
	}
	return err;
}

static int delete_network_scope(void)
{
	int err = spaghetti_wifi_profiles_delete_all();

	if ((err == 0) || (err == -EACCES) || (err == -ENOENT)) {
		return (err == -EACCES) ? err : 0;
	}
	return err;
}

static int delete_credentials_scope(void)
{
	int first_error = 0;
	int err;

	err = spaghetti_ota_erase_credentials();
	if ((err < 0) && (err != -ENOENT) && (first_error == 0)) {
		first_error = err;
	}

	err = spaghetti_remote_console_erase_credentials();
	if ((err < 0) && (err != -ENOENT) && (err != -ENOTSUP) &&
	    (first_error == 0)) {
		first_error = err;
	}

	err = spaghetti_mqtt_clear_credentials();
	if ((err < 0) && (err != -ENOENT) && (first_error == 0)) {
		first_error = err;
	}

	return first_error;
}

static int delete_ble_bonds_scope(void)
{
	int err = spaghetti_ble_clear_bonds();

	if ((err == 0) || (err == -ENOENT) || (err == -ENOTSUP)) {
		return 0;
	}
	return err;
}

static int force_maintenance(void)
{
	int err = spaghetti_storage_request_maintenance_once();

	if (err < 0) {
		return err;
	}
	if (spaghetti_maintenance_link_get_state() !=
	    SPAGHETTI_MAINTENANCE_LINK_ACTIVE) {
		err = spaghetti_maintenance_link_enter(
			SPAGHETTI_MAINTENANCE_REBOOT_REQUEST);
		if ((err < 0) && (err != -EALREADY) && (err != -EACCES)) {
			return err;
		}
	}
	return 0;
}

void spaghetti_factory_reset_set_acting_principal(spaghetti_principal_id_t id)
{
	(void)k_mutex_lock(&factory_reset_lock, K_FOREVER);
	acting_principal_id = id;
	k_mutex_unlock(&factory_reset_lock);
}

int spaghetti_factory_reset_get_status(
	struct spaghetti_factory_reset_status *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&factory_reset_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!status_valid) {
		k_mutex_unlock(&factory_reset_lock);
		return -ENOENT;
	}
	*out = last_status;
	k_mutex_unlock(&factory_reset_lock);
	return 0;
}

int spaghetti_factory_reset(uint32_t scope)
{
	uint32_t failed_scopes = 0U;
	int err;

	if ((scope == 0U) || ((scope & ~SPAGHETTI_RESET_KNOWN_MASK) != 0U)) {
		return -EINVAL;
	}
	if (!is_authorized()) {
		return -EACCES;
	}

	stop_runtime_services();

	if ((scope & SPAGHETTI_RESET_CONFIG) != 0U) {
		err = delete_config_scope();
		if (err < 0) {
			failed_scopes |= SPAGHETTI_RESET_CONFIG;
		}
	}
	if ((scope & SPAGHETTI_RESET_NETWORK) != 0U) {
		err = delete_network_scope();
		if (err < 0) {
			failed_scopes |= SPAGHETTI_RESET_NETWORK;
		}
	}
	if ((scope & SPAGHETTI_RESET_CREDENTIALS) != 0U) {
		err = delete_credentials_scope();
		if (err < 0) {
			failed_scopes |= SPAGHETTI_RESET_CREDENTIALS;
		}
	}
	if ((scope & SPAGHETTI_RESET_BLE_BONDS) != 0U) {
		err = delete_ble_bonds_scope();
		if (err < 0) {
			failed_scopes |= SPAGHETTI_RESET_BLE_BONDS;
		}
	}

	(void)k_mutex_lock(&factory_reset_lock, K_FOREVER);
	last_status = (struct spaghetti_factory_reset_status) {
		.requested_scope = scope,
		.failed_scopes = failed_scopes,
	};
	status_valid = true;

	if (failed_scopes != 0U) {
		err = force_maintenance();
		last_status.maintenance_forced = (err == 0);
		k_mutex_unlock(&factory_reset_lock);
		LOG_WRN("factory reset partial failure scopes=0x%x",
			failed_scopes);
		return (err < 0) ? err : -EIO;
	}

	spaghetti_communication_invalidate_sessions();
	last_status.reboot_requested = true;
	k_mutex_unlock(&factory_reset_lock);
	LOG_INF("factory reset complete scopes=0x%x", scope);
	spaghetti_core_boot_reboot();
	return 0;
}
