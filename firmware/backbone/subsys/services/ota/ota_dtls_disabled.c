#include "ota_internal.h"

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

int spaghetti_ota_backend_init(void)
{
	return 0;
}

int spaghetti_ota_backend_has_credentials(bool *present)
{
	if (present == NULL) {
		return -EINVAL;
	}

	*present = false;
	return 0;
}

int spaghetti_ota_backend_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size)
{
	ARG_UNUSED(psk);
	ARG_UNUSED(psk_size);
	ARG_UNUSED(identity);
	ARG_UNUSED(identity_size);
	return -ENOTSUP;
}

int spaghetti_ota_backend_clear_credentials(void)
{
	return -ENOTSUP;
}

int spaghetti_ota_backend_request_once(uint32_t timeout_ms)
{
	ARG_UNUSED(timeout_ms);
	return -ENOTSUP;
}

int spaghetti_ota_backend_consume_request(uint32_t *timeout_ms)
{
	ARG_UNUSED(timeout_ms);
	return -ENOTSUP;
}

int spaghetti_ota_backend_open(void)
{
	return -ENOTSUP;
}

int spaghetti_ota_backend_close(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return 0;
}

bool spaghetti_ota_backend_is_transport(
	const struct smp_transport *transport)
{
	ARG_UNUSED(transport);
	return false;
}
