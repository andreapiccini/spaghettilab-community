#include <spaghetti/ble.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

int spaghetti_ble_start(void)
{
	return -ENOTSUP;
}

int spaghetti_ble_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return -ENOTSUP;
}

int spaghetti_ble_get_status(struct spaghetti_ble_status *out)
{
	ARG_UNUSED(out);
	return -ENOTSUP;
}

int spaghetti_ble_credential_set(
	uint16_t credential_id,
	spaghetti_principal_id_t principal_id,
	const uint8_t key[SPAGHETTI_BLE_KEY_SIZE])
{
	ARG_UNUSED(credential_id);
	ARG_UNUSED(principal_id);
	ARG_UNUSED(key);
	return -ENOTSUP;
}

int spaghetti_ble_credential_clear(uint16_t credential_id)
{
	ARG_UNUSED(credential_id);
	return -ENOTSUP;
}

int spaghetti_ble_credential_exists(
	uint16_t credential_id,
	bool *out_exists)
{
	ARG_UNUSED(credential_id);
	ARG_UNUSED(out_exists);
	return -ENOTSUP;
}

int spaghetti_ble_erase_credentials(void)
{
	return -ENOTSUP;
}

int spaghetti_ble_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
	return -ENOTSUP;
}

void spaghetti_ble_close_peers_for_principal(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
}

int spaghetti_ble_clear_bonds(void)
{
	return -ENOTSUP;
}

int spaghetti_ble_set_radio(bool enabled)
{
	ARG_UNUSED(enabled);
	return -ENOTSUP;
}

int spaghetti_ble_find_update_principal(spaghetti_principal_id_t *out_principal)
{
	ARG_UNUSED(out_principal);
	return -ENOTSUP;
}

int spaghetti_ble_principal_is_authenticated(
	spaghetti_principal_id_t principal_id)
{
	if (principal_id == 0U) {
		return -EINVAL;
	}
	return -ENOTSUP;
}

void spaghetti_ble_wifi_handover_set_test_authenticated(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
}

void spaghetti_ble_wifi_handover_request_disconnect(
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(principal_id);
}

bool spaghetti_ble_wifi_handover_take_pending_disconnect(
	spaghetti_principal_id_t *out_principal)
{
	ARG_UNUSED(out_principal);
	return false;
}
