#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/ztest.h>

#include <spaghetti/maintenance_link.h>
#include <spaghetti/remote_console.h>

static enum spaghetti_maintenance_link_state maintenance_state;
static bool credentials_present;
static bool listener_open;

int spaghetti_remote_console_backend_init(void)
{
	return 0;
}

int spaghetti_remote_console_backend_has_credentials(bool *present)
{
	zassert_not_null(present);
	*present = credentials_present;
	return 0;
}

int spaghetti_remote_console_backend_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size)
{
	zassert_not_null(psk);
	zassert_equal(psk_size, SPAGHETTI_REMOTE_CONSOLE_PSK_SIZE);
	zassert_not_null(identity);
	zassert_true(identity_size > 0U);
	credentials_present = true;
	return 0;
}

int spaghetti_remote_console_backend_clear_credentials(void)
{
	if (!credentials_present) {
		return -ENOENT;
	}
	credentials_present = false;
	return 0;
}

int spaghetti_remote_console_backend_open(void)
{
	listener_open = true;
	return 0;
}

int spaghetti_remote_console_backend_close(k_timeout_t timeout)
{
	zassert_false(K_TIMEOUT_EQ(timeout, K_FOREVER));
	if (!listener_open) {
		return -EALREADY;
	}
	listener_open = false;
	return 0;
}

bool spaghetti_remote_console_backend_client_connected(void)
{
	return false;
}

uint32_t spaghetti_remote_console_backend_dropped_logs(void)
{
	return 3U;
}

enum spaghetti_maintenance_link_state
spaghetti_maintenance_link_get_state(void)
{
	return maintenance_state;
}

ZTEST(remote_console, test_local_credentials_and_normal_mode_listener)
{
	const uint8_t psk[SPAGHETTI_REMOTE_CONSOLE_PSK_SIZE] = {0x5a};
	const uint8_t identity[] = "core-v1";
	struct spaghetti_remote_console_status status;

	zassert_equal(spaghetti_remote_console_get_status(NULL), -EINVAL);
	zassert_ok(spaghetti_remote_console_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_REMOTE_CONSOLE_UNINITIALIZED);
	zassert_false(status.credentials_present);
	zassert_equal(spaghetti_remote_console_set_credentials(
		psk, sizeof(psk), identity, sizeof(identity) - 1U, 0U), -EACCES);
	zassert_equal(spaghetti_remote_console_clear_credentials(), -EACCES);

	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_ACTIVE;
	zassert_equal(spaghetti_remote_console_set_credentials(
		psk, sizeof(psk) - 1U, identity,
		sizeof(identity) - 1U, 0U), -EINVAL);
	zassert_ok(spaghetti_remote_console_set_credentials(
		psk, sizeof(psk), identity, sizeof(identity) - 1U, 0U));
	zassert_ok(spaghetti_remote_console_clear_credentials());
	zassert_equal(spaghetti_remote_console_clear_credentials(), -ENOENT);
	zassert_ok(spaghetti_remote_console_set_credentials(
		psk, sizeof(psk), identity, sizeof(identity) - 1U, 0U));

	maintenance_state = SPAGHETTI_MAINTENANCE_LINK_NORMAL;
	zassert_ok(spaghetti_remote_console_init());
	zassert_false(listener_open);
	zassert_equal(spaghetti_remote_console_init(), -EALREADY);
	zassert_ok(spaghetti_remote_console_start());
	zassert_true(listener_open);
	zassert_ok(spaghetti_remote_console_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_REMOTE_CONSOLE_LISTENING);
	zassert_equal(status.port, 1338U);
	zassert_true(status.credentials_present);
	zassert_false(status.client_connected);
	zassert_equal(status.dropped_log_count, 3U);
	zassert_ok(spaghetti_remote_console_stop(K_MSEC(50)));
	zassert_false(listener_open);
}

ZTEST_SUITE(remote_console, NULL, NULL, NULL, NULL, NULL);
