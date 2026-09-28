#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/mgmt/mcumgr/transport/smp.h>
#include <zephyr/ztest.h>

#include <spaghetti/config.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/ota.h>
#include <spaghetti/secure_workspace.h>
#include <spaghetti/update.h>

#include "ota_internal.h"

static struct smp_transport fake_transport;
static enum spaghetti_maintenance_link_state maintenance_state;
static bool config_present;
static bool credentials_present;
static bool pending_request;
static bool listener_open;
static uint32_t pending_timeout_ms;
static int update_arm_calls;
static int update_cancel_calls;
static int backend_open_calls;
static int backend_close_calls;
static int workspace_acquire_calls;
static int workspace_release_calls;

int spaghetti_secure_workspace_acquire(
	enum spaghetti_secure_workspace_owner owner, k_timeout_t timeout)
{
	zassert_equal(owner, SPAGHETTI_SECURE_OWNER_WIFI_OTA);
	zassert_false(K_TIMEOUT_EQ(timeout, K_FOREVER));
	++workspace_acquire_calls;
	return 0;
}

int spaghetti_secure_workspace_release(
	enum spaghetti_secure_workspace_owner owner)
{
	zassert_equal(owner, SPAGHETTI_SECURE_OWNER_WIFI_OTA);
	++workspace_release_calls;
	return 0;
}

int spaghetti_ota_backend_init(void)
{
	return 0;
}

int spaghetti_ota_backend_has_credentials(bool *present)
{
	zassert_not_null(present);
	*present = credentials_present;
	return 0;
}

int spaghetti_ota_backend_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size)
{
	zassert_not_null(psk);
	zassert_equal(psk_size, SPAGHETTI_OTA_PSK_SIZE);
	zassert_not_null(identity);
	zassert_true(identity_size > 0U);
	credentials_present = true;
	return 0;
}

int spaghetti_ota_backend_clear_credentials(void)
{
	if (!credentials_present) {
		return -ENOENT;
	}
	credentials_present = false;
	pending_request = false;
	return 0;
}

int spaghetti_ota_backend_request_once(uint32_t timeout_ms)
{
	pending_timeout_ms = timeout_ms;
	pending_request = true;
	return 0;
}

int spaghetti_ota_backend_consume_request(uint32_t *timeout_ms)
{
	zassert_not_null(timeout_ms);
	if (!pending_request) {
		return -ENOENT;
	}
	*timeout_ms = pending_timeout_ms;
	pending_request = false;
	return 0;
}

int spaghetti_ota_backend_open(void)
{
	++backend_open_calls;
	listener_open = true;
	return 0;
}

int spaghetti_ota_backend_close(k_timeout_t timeout)
{
	zassert_false(K_TIMEOUT_EQ(timeout, K_FOREVER));
	if (!listener_open) {
		return -EALREADY;
	}
	++backend_close_calls;
	listener_open = false;
	return 0;
}

bool spaghetti_ota_backend_is_transport(
	const struct smp_transport *transport)
{
	return listener_open && (transport == &fake_transport);
}

enum spaghetti_maintenance_link_state
spaghetti_maintenance_link_get_state(void)
{
	return maintenance_state;
}

int spaghetti_storage_read_config(struct spaghetti_config *out)
{
	zassert_not_null(out);
	if (!config_present) {
		return -ENOENT;
	}
	*out = (struct spaghetti_config) {
		.version = SPAGHETTI_CONFIG_VERSION,
	};
	return 0;
}

int spaghetti_update_arm(uint32_t timeout_ms)
{
	zassert_true(timeout_ms > 0U);
	++update_arm_calls;
	return 0;
}

int spaghetti_update_get_status(struct spaghetti_update_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_update_status) {
		.state = SPAGHETTI_UPDATE_IDLE,
		.transport = SPAGHETTI_UPDATE_TRANSPORT_NONE,
	};
	return 0;
}

int spaghetti_update_cancel(void)
{
	++update_cancel_calls;
	return 0;
}

static void expect_status(enum spaghetti_ota_state state,
			  bool has_credentials)
{
	struct spaghetti_ota_status status;

	zassert_ok(spaghetti_ota_get_status(&status));
	zassert_equal(status.state, state);
	zassert_equal(status.port, 1337U);
	zassert_equal(status.credentials_present, has_credentials);
	zassert_equal(status.last_error, 0);
}

ZTEST(ota, test_local_provisioning_one_shot_and_network_loss)
{
	const uint8_t psk[SPAGHETTI_OTA_PSK_SIZE] = {0x5a};
	const uint8_t identity[] = "core-v1";

	zassert_equal(spaghetti_ota_get_status(NULL), -EINVAL);
	expect_status(SPAGHETTI_OTA_UNINITIALIZED, false);
	zassert_false(spaghetti_ota_is_transport(NULL));
	zassert_equal(spaghetti_ota_arm(0U), -EINVAL);
	zassert_equal(spaghetti_ota_arm(101U), -EINVAL);
	zassert_equal(spaghetti_ota_arm(50U), -EACCES);
	zassert_equal(spaghetti_ota_set_credentials(
		psk, sizeof(psk), identity, sizeof(identity) - 1U, 0U), -EACCES);

	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	zassert_equal(spaghetti_ota_set_credentials(
		psk, sizeof(psk) - 1U, identity,
		sizeof(identity) - 1U, 0U), -EINVAL);
	zassert_ok(spaghetti_ota_set_credentials(
		psk, sizeof(psk), identity, sizeof(identity) - 1U, 0U));
	expect_status(SPAGHETTI_OTA_UNINITIALIZED, true);
	zassert_equal(spaghetti_ota_request_once(50U), -ENOENT);

	config_present = true;
	zassert_equal(spaghetti_ota_request_once(101U), -EINVAL);
	zassert_ok(spaghetti_ota_request_once(50U));
	zassert_true(pending_request);

	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_NORMAL;
	zassert_ok(spaghetti_ota_init());
	zassert_ok(spaghetti_ota_start());
	zassert_false(pending_request);
	zassert_equal(update_arm_calls, 1);
	zassert_equal(backend_open_calls, 1);
	zassert_equal(workspace_acquire_calls, 1);
	zassert_true(spaghetti_ota_is_transport(&fake_transport));
	expect_status(SPAGHETTI_OTA_ARMED, true);

	spaghetti_ota_network_lost();
	k_sleep(K_MSEC(30));
	zassert_equal(backend_close_calls, 1);
	zassert_equal(workspace_release_calls, 1);
	zassert_equal(update_cancel_calls, 1);
	zassert_false(spaghetti_ota_is_transport(&fake_transport));
	expect_status(SPAGHETTI_OTA_CLOSED, true);

	zassert_equal(spaghetti_ota_clear_credentials(), -EACCES);
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	zassert_ok(spaghetti_ota_clear_credentials());
	expect_status(SPAGHETTI_OTA_CLOSED, false);
	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_NORMAL;
	zassert_ok(spaghetti_ota_stop(K_MSEC(50)));
}

ZTEST_SUITE(ota, NULL, NULL, NULL, NULL, NULL);
