#include "remote_console_internal.h"

#include <errno.h>

#include <zephyr/sys/util.h>

int spaghetti_remote_console_backend_init(void)
{
	return 0;
}

int spaghetti_remote_console_backend_has_credentials(bool *present)
{
	if (present == NULL) {
		return -EINVAL;
	}

	*present = false;
	return 0;
}

int spaghetti_remote_console_backend_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size)
{
	ARG_UNUSED(psk);
	ARG_UNUSED(psk_size);
	ARG_UNUSED(identity);
	ARG_UNUSED(identity_size);
	return -ENOTSUP;
}

int spaghetti_remote_console_backend_clear_credentials(void)
{
	return -ENOTSUP;
}

int spaghetti_remote_console_backend_open(void)
{
	return -ENOTSUP;
}

int spaghetti_remote_console_backend_close(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return -ENOTSUP;
}

bool spaghetti_remote_console_backend_client_connected(void)
{
	return false;
}

uint32_t spaghetti_remote_console_backend_dropped_logs(void)
{
	return 0U;
}
