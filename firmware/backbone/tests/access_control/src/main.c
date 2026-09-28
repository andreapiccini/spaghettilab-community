#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/ztest.h>

#include <spaghetti/access_control.h>
#include <spaghetti/ble.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/ota.h>
#include <spaghetti/remote_console.h>

static enum spaghetti_maintenance_link_state maintenance_state =
	SPAGHETTI_MAINTENANCE_LINK_NORMAL;
static spaghetti_principal_id_t ota_principal;
static spaghetti_principal_id_t console_principal;
static spaghetti_principal_id_t mqtt_principal;
static spaghetti_principal_id_t ble_principal;
static bool ota_present;
static bool console_present;
static bool mqtt_present;
static bool ble_present;
static spaghetti_principal_id_t invalidated_principal;
static int invalidate_calls;
static int ble_close_calls;

enum spaghetti_maintenance_link_state
spaghetti_maintenance_link_get_state(void)
{
	return maintenance_state;
}

int spaghetti_ota_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	if ((principal_id == 0U) || !ota_present ||
	    (ota_principal != principal_id)) {
		return -ENOENT;
	}
	ota_present = false;
	ota_principal = 0U;
	return 0;
}

int spaghetti_remote_console_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	if ((principal_id == 0U) || !console_present ||
	    (console_principal != principal_id)) {
		return -ENOENT;
	}
	console_present = false;
	console_principal = 0U;
	return 0;
}

int spaghetti_mqtt_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	if ((principal_id == 0U) || !mqtt_present ||
	    (mqtt_principal != principal_id)) {
		return -ENOENT;
	}
	mqtt_present = false;
	mqtt_principal = 0U;
	return 0;
}

int spaghetti_ble_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	if ((principal_id == 0U) || !ble_present ||
	    (ble_principal != principal_id)) {
		return -ENOENT;
	}
	ble_present = false;
	ble_principal = 0U;
	++ble_close_calls;
	return 0;
}

void spaghetti_communication_invalidate_principal(
	spaghetti_principal_id_t principal_id)
{
	invalidated_principal = principal_id;
	++invalidate_calls;
}

static void reset_state(void)
{
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_NORMAL;
	ota_present = false;
	console_present = false;
	mqtt_present = false;
	ble_present = false;
	ota_principal = 0U;
	console_principal = 0U;
	mqtt_principal = 0U;
	ble_principal = 0U;
	invalidated_principal = 0U;
	invalidate_calls = 0;
	ble_close_calls = 0;
}

ZTEST(access_control, test_roles_authorize_revoke_and_audit)
{
	struct spaghetti_principal principal;
	struct spaghetti_audit_entry entry;
	uint32_t first_sequence = 0U;
	uint32_t overwritten = 0U;

	reset_state();
	zassert_ok(spaghetti_access_control_init());
	zassert_equal(spaghetti_access_control_init(), -EALREADY);
	zassert_equal(spaghetti_principal_count(), 1U);
	zassert_ok(spaghetti_principal_get(SPAGHETTI_PRINCIPAL_MAINTENANCE_ID,
					   &principal));
	zassert_true(principal.enabled);
	zassert_equal(principal.role, SPAGHETTI_ROLE_PROVISIONER);

	zassert_equal(spaghetti_principal_provision(
		2U, SPAGHETTI_ROLE_OPERATOR, "peer-a"), -EACCES);
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	zassert_equal(spaghetti_principal_provision(
		0U, SPAGHETTI_ROLE_OPERATOR, "bad"), -EINVAL);
	zassert_equal(spaghetti_principal_provision(
		SPAGHETTI_PRINCIPAL_MAINTENANCE_ID, SPAGHETTI_ROLE_OPERATOR,
		"bad"), -EINVAL);
	zassert_ok(spaghetti_principal_provision(
		2U, SPAGHETTI_ROLE_OPERATOR, "peer-a"));
	zassert_ok(spaghetti_principal_provision(
		3U, SPAGHETTI_ROLE_OBSERVER, "peer-b"));
	zassert_equal(spaghetti_principal_provision(
		2U, SPAGHETTI_ROLE_ADMINISTRATOR, "dup"), -EEXIST);

	zassert_ok(spaghetti_principal_authorize(
		2U, SPAGHETTI_PERMISSION_COMMAND));
	zassert_equal(spaghetti_principal_authorize(
		2U, SPAGHETTI_PERMISSION_PROVISION), -EACCES);
	zassert_ok(spaghetti_principal_authorize(
		3U, SPAGHETTI_PERMISSION_READ));
	zassert_equal(spaghetti_principal_authorize(
		3U, SPAGHETTI_PERMISSION_COMMAND), -EACCES);

	ota_present = true;
	ota_principal = 2U;
	console_present = true;
	console_principal = 2U;
	mqtt_present = true;
	mqtt_principal = 3U;
	ble_present = true;
	ble_principal = 2U;

	zassert_ok(spaghetti_principal_revoke(2U));
	zassert_equal(spaghetti_principal_authorize(
		2U, SPAGHETTI_PERMISSION_COMMAND), -EACCES);
	zassert_ok(spaghetti_principal_authorize(
		3U, SPAGHETTI_PERMISSION_READ));
	zassert_false(ota_present);
	zassert_false(console_present);
	zassert_false(ble_present);
	zassert_true(mqtt_present);
	zassert_equal(ble_close_calls, 1);
	zassert_equal(invalidate_calls, 1);
	zassert_equal(invalidated_principal, 2U);
	zassert_equal(spaghetti_principal_revoke(
		SPAGHETTI_PRINCIPAL_MAINTENANCE_ID), -EINVAL);

	zassert_ok(spaghetti_audit_record(2U, 10U, -EACCES));
	zassert_ok(spaghetti_audit_get(1U, &entry));
	first_sequence = entry.sequence;
	zassert_equal(entry.principal_id, 2U);
	zassert_equal(entry.operation_id, 10U);
	zassert_equal(entry.internal_result, -EACCES);

	for (uint32_t index = 0U;
	     index < (uint32_t)CONFIG_SPAGHETTI_MAX_AUDIT_ENTRIES; ++index) {
		zassert_ok(spaghetti_audit_record(3U, (uint16_t)index, 0));
	}
	overwritten = first_sequence;
	zassert_equal(spaghetti_audit_get(overwritten, &entry), -ENOENT);
	zassert_ok(spaghetti_audit_get(
		first_sequence + CONFIG_SPAGHETTI_MAX_AUDIT_ENTRIES, &entry));
}

ZTEST_SUITE(access_control, NULL, NULL, NULL, NULL, NULL);
