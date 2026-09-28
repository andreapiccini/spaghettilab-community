#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/ztest.h>

#include <spaghetti/access_control.h>
#include <spaghetti/ble.h>
#include <spaghetti/factory_reset.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/ota.h>
#include <spaghetti/remote_console.h>
#include <spaghetti/runtime.h>
#include <spaghetti/service.h>
#include <spaghetti/storage.h>
#include <spaghetti/wifi_profiles.h>

static enum spaghetti_maintenance_link_state maintenance_state =
	SPAGHETTI_MAINTENANCE_LINK_NORMAL;
static bool config_present = true;
static bool wifi_present = true;
static bool ota_present = true;
static bool console_present = true;
static bool mqtt_present = true;
static bool ble_bonds_present = true;
static int wifi_delete_error;
static int config_delete_error;
static int ota_clear_error;
static int ble_clear_error;
static int reboot_calls;
static int maintenance_once_calls;
static int maintenance_enter_calls;
static int session_invalidate_calls;
static int ble_stop_calls;
static int ble_clear_calls;

enum spaghetti_maintenance_link_state
spaghetti_maintenance_link_get_state(void)
{
	return maintenance_state;
}

int spaghetti_maintenance_link_enter(
	enum spaghetti_maintenance_entry_reason reason)
{
	ARG_UNUSED(reason);
	++maintenance_enter_calls;
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	return 0;
}

int spaghetti_storage_request_maintenance_once(void)
{
	++maintenance_once_calls;
	return 0;
}

int spaghetti_storage_delete_config(void)
{
	if (config_delete_error < 0) {
		return config_delete_error;
	}
	if (!config_present) {
		return -ENOENT;
	}
	config_present = false;
	return 0;
}

int spaghetti_storage_read_config(struct spaghetti_config *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	if (!config_present) {
		return -ENOENT;
	}
	*out = (struct spaghetti_config) {
		.version = SPAGHETTI_CONFIG_VERSION,
	};
	return 0;
}

int spaghetti_wifi_profiles_delete_all(void)
{
	if (wifi_delete_error < 0) {
		return wifi_delete_error;
	}
	wifi_present = false;
	return 0;
}

int spaghetti_wifi_profiles_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return -EACCES;
}

int spaghetti_ota_backend_clear_credentials(void)
{
	if (ota_clear_error < 0) {
		return ota_clear_error;
	}
	if (!ota_present) {
		return -ENOENT;
	}
	ota_present = false;
	return 0;
}

int spaghetti_ota_erase_credentials(void)
{
	int err = spaghetti_ota_backend_clear_credentials();

	return err;
}

int spaghetti_remote_console_backend_clear_credentials(void)
{
	if (!console_present) {
		return -ENOENT;
	}
	console_present = false;
	return 0;
}

int spaghetti_remote_console_erase_credentials(void)
{
	return spaghetti_remote_console_backend_clear_credentials();
}

int spaghetti_mqtt_clear_credentials(void)
{
	if (!mqtt_present) {
		return -ENOENT;
	}
	mqtt_present = false;
	return 0;
}

int spaghetti_ota_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
	return -ENOENT;
}

int spaghetti_remote_console_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
	return -ENOENT;
}

int spaghetti_mqtt_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
	return -ENOENT;
}

void spaghetti_communication_invalidate_principal(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
}

int spaghetti_runtime_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return -EACCES;
}

int spaghetti_service_stop(const char *id, k_timeout_t timeout)
{
	ARG_UNUSED(id);
	ARG_UNUSED(timeout);
	return -EACCES;
}

int spaghetti_mqtt_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return -EACCES;
}

int spaghetti_remote_console_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return -EACCES;
}

int spaghetti_ble_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	++ble_stop_calls;
	return -EACCES;
}

int spaghetti_ble_clear_bonds(void)
{
	++ble_clear_calls;
	if (ble_clear_error < 0) {
		return ble_clear_error;
	}
	if (!ble_bonds_present) {
		return -ENOENT;
	}
	ble_bonds_present = false;
	return 0;
}

int spaghetti_ota_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return -EACCES;
}

void spaghetti_communication_invalidate_sessions(void)
{
	++session_invalidate_calls;
}

void spaghetti_core_boot_reboot(void)
{
	++reboot_calls;
}

static void reset_state(void)
{
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_NORMAL;
	config_present = true;
	wifi_present = true;
	ota_present = true;
	console_present = true;
	mqtt_present = true;
	ble_bonds_present = true;
	wifi_delete_error = 0;
	config_delete_error = 0;
	ota_clear_error = 0;
	ble_clear_error = 0;
	reboot_calls = 0;
	maintenance_once_calls = 0;
	maintenance_enter_calls = 0;
	session_invalidate_calls = 0;
	ble_stop_calls = 0;
	ble_clear_calls = 0;
	spaghetti_factory_reset_set_acting_principal(0U);
}

static void expect_clean_scope(uint32_t scope)
{
	struct spaghetti_factory_reset_status status;

	reset_state();
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	zassert_ok(spaghetti_factory_reset(scope));
	zassert_ok(spaghetti_factory_reset_get_status(&status));
	zassert_equal(status.requested_scope, scope);
	zassert_equal(status.failed_scopes, 0U);
	zassert_true(status.reboot_requested);
	zassert_false(status.maintenance_forced);
	zassert_equal(reboot_calls, 1);
	zassert_equal(session_invalidate_calls, 1);
}

ZTEST(factory_reset, test_scopes_auth_failure_and_reboot)
{
	struct spaghetti_factory_reset_status status;
	struct spaghetti_principal principal;

	reset_state();
	zassert_equal(spaghetti_factory_reset(0U), -EINVAL);
	zassert_equal(spaghetti_factory_reset(BIT(7)), -EINVAL);
	zassert_equal(spaghetti_factory_reset(SPAGHETTI_RESET_CONFIG), -EACCES);

	zassert_ok(spaghetti_access_control_init());
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	zassert_ok(spaghetti_principal_provision(
		4U, SPAGHETTI_ROLE_OPERATOR, "ops"));
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_NORMAL;
	spaghetti_factory_reset_set_acting_principal(4U);
	zassert_equal(spaghetti_factory_reset(SPAGHETTI_RESET_CONFIG),
		      -EACCES);

	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	zassert_ok(spaghetti_principal_provision(
		5U, SPAGHETTI_ROLE_PROVISIONER, "prov"));
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_NORMAL;
	spaghetti_factory_reset_set_acting_principal(5U);
	zassert_ok(spaghetti_principal_get(5U, &principal));
	zassert_ok(spaghetti_factory_reset(SPAGHETTI_RESET_BLE_BONDS));
	zassert_equal(reboot_calls, 1);

	expect_clean_scope(SPAGHETTI_RESET_CONFIG);
	zassert_false(config_present);
	expect_clean_scope(SPAGHETTI_RESET_NETWORK);
	zassert_false(wifi_present);
	expect_clean_scope(SPAGHETTI_RESET_CREDENTIALS);
	zassert_false(ota_present);
	zassert_false(console_present);
	zassert_false(mqtt_present);
	expect_clean_scope(SPAGHETTI_RESET_BLE_BONDS);
	zassert_false(ble_bonds_present);
	zassert_true(ble_clear_calls > 0);
	expect_clean_scope(SPAGHETTI_RESET_ALL);
	zassert_false(config_present);
	zassert_false(wifi_present);
	zassert_false(ota_present);

	reset_state();
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	wifi_delete_error = -EIO;
	zassert_equal(spaghetti_factory_reset(SPAGHETTI_RESET_NETWORK), -EIO);
	zassert_ok(spaghetti_factory_reset_get_status(&status));
	zassert_equal(status.failed_scopes, SPAGHETTI_RESET_NETWORK);
	zassert_true(status.maintenance_forced);
	zassert_false(status.reboot_requested);
	zassert_equal(reboot_calls, 0);
	zassert_equal(maintenance_once_calls, 1);
	zassert_equal(maintenance_enter_calls, 0);
	zassert_equal(maintenance_state, SPAGHETTI_MAINTENANCE_LINK_ACTIVE);
}

ZTEST_SUITE(factory_reset, NULL, NULL, NULL, NULL, NULL);
