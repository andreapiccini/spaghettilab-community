#ifndef SPAGHETTI_REMOTE_CONSOLE_INTERNAL_H
#define SPAGHETTI_REMOTE_CONSOLE_INTERNAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

int spaghetti_remote_console_backend_init(void);
int spaghetti_remote_console_backend_has_credentials(bool *present);
int spaghetti_remote_console_backend_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size);
int spaghetti_remote_console_backend_clear_credentials(void);
int spaghetti_remote_console_backend_open(void);
int spaghetti_remote_console_backend_close(k_timeout_t timeout);
bool spaghetti_remote_console_backend_client_connected(void);
uint32_t spaghetti_remote_console_backend_dropped_logs(void);

#endif /* SPAGHETTI_REMOTE_CONSOLE_INTERNAL_H */
