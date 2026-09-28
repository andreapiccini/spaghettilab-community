#include <spaghetti/remote_console.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <spaghetti/maintenance_link.h>

#include "remote_console_internal.h"

LOG_MODULE_REGISTER(spaghetti_remote_console,
		    CONFIG_SPAGHETTI_REMOTE_CONSOLE_LOG_LEVEL);

struct spaghetti_remote_console_context {
	enum spaghetti_remote_console_state state;
	bool initialized;
	spaghetti_principal_id_t principal_id;
	uint8_t identity_size;
	uint8_t identity[SPAGHETTI_REMOTE_CONSOLE_IDENTITY_MAX_SIZE];
	int last_error;
};

static struct spaghetti_remote_console_context context;
K_MUTEX_DEFINE(remote_console_lock);

int spaghetti_remote_console_init(void)
{
	bool credentials_present;
	int err = k_mutex_lock(&remote_console_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (context.initialized) {
		err = -EALREADY;
		goto unlock;
	}
	err = spaghetti_remote_console_backend_init();
	if (err < 0) {
		goto failed;
	}
	err = spaghetti_remote_console_backend_has_credentials(
		&credentials_present);
	if (err == -EBADMSG) {
		LOG_WRN("invalid remote-console credential removed");
		err = spaghetti_remote_console_backend_clear_credentials();
		if (err == -ENOENT) {
			err = 0;
		}
		credentials_present = false;
	}
	if (err < 0) {
		goto failed;
	}
	context.initialized = true;
	context.last_error = 0;
	context.state = SPAGHETTI_REMOTE_CONSOLE_DISABLED;
	LOG_INF("ready: credentials=%u listener=closed",
		credentials_present ? 1U : 0U);
	goto unlock;

failed:
	context.state = SPAGHETTI_REMOTE_CONSOLE_ERROR;
	context.last_error = err;
unlock:
	k_mutex_unlock(&remote_console_lock);
	return err;
}

int spaghetti_remote_console_start(void)
{
	bool credentials_present;
	int err = k_mutex_lock(&remote_console_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (context.state == SPAGHETTI_REMOTE_CONSOLE_LISTENING) {
		err = -EALREADY;
		goto unlock;
	}
	err = spaghetti_remote_console_backend_has_credentials(
		&credentials_present);
	if ((err < 0) || !credentials_present) {
		err = (err < 0) ? err : -ENOENT;
		goto failed;
	}
	err = spaghetti_remote_console_backend_open();
	if (err < 0) {
		goto failed;
	}
	context.state = SPAGHETTI_REMOTE_CONSOLE_LISTENING;
	context.last_error = 0;
	LOG_INF("listening: port=%u", CONFIG_SPAGHETTI_REMOTE_CONSOLE_PORT);
	goto unlock;

failed:
	context.state = SPAGHETTI_REMOTE_CONSOLE_ERROR;
	context.last_error = err;
unlock:
	k_mutex_unlock(&remote_console_lock);
	return err;
}

int spaghetti_remote_console_stop(k_timeout_t timeout)
{
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
	err = k_mutex_lock(&remote_console_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!context.initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (context.state == SPAGHETTI_REMOTE_CONSOLE_DISABLED) {
		err = -EALREADY;
		goto unlock;
	}
	k_mutex_unlock(&remote_console_lock);
	err = spaghetti_remote_console_backend_close(timeout);
	(void)k_mutex_lock(&remote_console_lock, K_FOREVER);
	if ((err == 0) || (err == -EALREADY)) {
		context.state = SPAGHETTI_REMOTE_CONSOLE_DISABLED;
		context.last_error = 0;
		err = 0;
	} else {
		context.state = SPAGHETTI_REMOTE_CONSOLE_ERROR;
		context.last_error = err;
	}
unlock:
	k_mutex_unlock(&remote_console_lock);
	return err;
}

int spaghetti_remote_console_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size,
	spaghetti_principal_id_t principal_id)
{
	int err;

	if ((psk == NULL) ||
	    (psk_size != SPAGHETTI_REMOTE_CONSOLE_PSK_SIZE) ||
	    (identity == NULL) || (identity_size == 0U) ||
	    (identity_size > SPAGHETTI_REMOTE_CONSOLE_IDENTITY_MAX_SIZE)) {
		return -EINVAL;
	}
	if (spaghetti_maintenance_link_get_state() !=
	    SPAGHETTI_MAINTENANCE_LINK_ACTIVE) {
		return -EACCES;
	}

	err = spaghetti_remote_console_backend_set_credentials(
		psk, psk_size, identity, identity_size);
	if (err == 0) {
		(void)k_mutex_lock(&remote_console_lock, K_FOREVER);
		context.principal_id = principal_id;
		context.identity_size = (uint8_t)identity_size;
		memcpy(context.identity, identity, identity_size);
		if (identity_size < sizeof(context.identity)) {
			memset(&context.identity[identity_size], 0,
			       sizeof(context.identity) - identity_size);
		}
		k_mutex_unlock(&remote_console_lock);
	}
	return err;
}

int spaghetti_remote_console_rotate_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size)
{
	spaghetti_principal_id_t principal_id;
	bool credentials_present = false;
	int err;

	if ((psk == NULL) ||
	    (psk_size != SPAGHETTI_REMOTE_CONSOLE_PSK_SIZE) ||
	    (identity == NULL) || (identity_size == 0U) ||
	    (identity_size > SPAGHETTI_REMOTE_CONSOLE_IDENTITY_MAX_SIZE)) {
		return -EINVAL;
	}
	if (spaghetti_maintenance_link_get_state() !=
	    SPAGHETTI_MAINTENANCE_LINK_ACTIVE) {
		return -EACCES;
	}

	err = spaghetti_remote_console_backend_has_credentials(
		&credentials_present);
	if (err < 0) {
		return err;
	}
	if (!credentials_present) {
		return -ENOENT;
	}

	(void)k_mutex_lock(&remote_console_lock, K_FOREVER);
	principal_id = context.principal_id;
	k_mutex_unlock(&remote_console_lock);

	err = spaghetti_remote_console_backend_set_credentials(
		psk, psk_size, identity, identity_size);
	if (err == 0) {
		(void)k_mutex_lock(&remote_console_lock, K_FOREVER);
		context.principal_id = principal_id;
		context.identity_size = (uint8_t)identity_size;
		memcpy(context.identity, identity, identity_size);
		if (identity_size < sizeof(context.identity)) {
			memset(&context.identity[identity_size], 0,
			       sizeof(context.identity) - identity_size);
		}
		k_mutex_unlock(&remote_console_lock);
	}
	return err;
}

int spaghetti_remote_console_erase_credentials(void)
{
	int err = spaghetti_remote_console_backend_clear_credentials();

	if ((err == 0) || (err == -ENOENT) || (err == -ENOTSUP)) {
		(void)k_mutex_lock(&remote_console_lock, K_FOREVER);
		context.principal_id = 0U;
		context.identity_size = 0U;
		memset(context.identity, 0, sizeof(context.identity));
		k_mutex_unlock(&remote_console_lock);
	}
	return err;
}

int spaghetti_remote_console_clear_credentials(void)
{
	int err;

	if (spaghetti_maintenance_link_get_state() !=
	    SPAGHETTI_MAINTENANCE_LINK_ACTIVE) {
		return -EACCES;
	}
	err = spaghetti_remote_console_erase_credentials();
	return err;
}

int spaghetti_remote_console_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	int err;

	if (principal_id == 0U) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&remote_console_lock, K_FOREVER);
	if (context.principal_id != principal_id) {
		k_mutex_unlock(&remote_console_lock);
		return -ENOENT;
	}
	k_mutex_unlock(&remote_console_lock);

	err = spaghetti_remote_console_erase_credentials();
	return err;
}

int spaghetti_remote_console_get_credential_metadata(
	struct spaghetti_remote_console_credential_metadata *out)
{
	bool credentials_present = false;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = spaghetti_remote_console_backend_has_credentials(
		&credentials_present);
	if (err < 0) {
		return err;
	}

	(void)k_mutex_lock(&remote_console_lock, K_FOREVER);
	*out = (struct spaghetti_remote_console_credential_metadata) {
		.present = credentials_present,
		.principal_id = context.principal_id,
		.identity_size = context.identity_size,
	};
	memcpy(out->identity, context.identity, sizeof(out->identity));
	k_mutex_unlock(&remote_console_lock);
	return 0;
}

int spaghetti_remote_console_get_status(
	struct spaghetti_remote_console_status *out)
{
	bool credentials_present;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}
	err = k_mutex_lock(&remote_console_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	err = spaghetti_remote_console_backend_has_credentials(
		&credentials_present);
	if (err == 0) {
		*out = (struct spaghetti_remote_console_status) {
			.state = context.state,
			.port = CONFIG_SPAGHETTI_REMOTE_CONSOLE_PORT,
			.credentials_present = credentials_present,
			.client_connected =
				spaghetti_remote_console_backend_client_connected(),
			.dropped_log_count =
				spaghetti_remote_console_backend_dropped_logs(),
			.last_error = context.last_error,
		};
	}
	k_mutex_unlock(&remote_console_lock);
	return err;
}
