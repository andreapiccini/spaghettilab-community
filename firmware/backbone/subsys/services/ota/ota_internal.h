#ifndef SPAGHETTI_OTA_INTERNAL_H
#define SPAGHETTI_OTA_INTERNAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>

struct smp_transport;

int spaghetti_ota_backend_init(void);
int spaghetti_ota_backend_has_credentials(bool *present);
int spaghetti_ota_backend_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const uint8_t *identity, size_t identity_size);
int spaghetti_ota_backend_clear_credentials(void);
int spaghetti_ota_backend_request_once(uint32_t timeout_ms);
int spaghetti_ota_backend_consume_request(uint32_t *timeout_ms);
int spaghetti_ota_backend_open(void);
int spaghetti_ota_backend_close(k_timeout_t timeout);
bool spaghetti_ota_backend_is_transport(
	const struct smp_transport *transport);
void spaghetti_ota_network_lost(void);

#endif /* SPAGHETTI_OTA_INTERNAL_H */
