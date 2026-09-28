/**
 * @file
 * @brief MQTT TLS credential vault with principal binding.
 * @ingroup spaghetti_mqtt_credentials
 *
 * Credentials live in PSA ITS (or a host-side stub when secure storage is
 * unavailable). Buffers are borrowed and never logged. Set is allowed only
 * while the local Maintenance link is ACTIVE.
 */

#ifndef SPAGHETTI_MQTT_CREDENTIALS_H
#define SPAGHETTI_MQTT_CREDENTIALS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/access_control.h>

/**
 * @brief Store or replace one MQTT credential bound to a principal.
 *
 * Fails with @c -ENOENT when @p principal_id is missing or revoked. TLS server
 * mode requires a non-empty CA; mutual TLS also requires certificate and key.
 * Sizes are bounded by Kconfig certificate ceilings.
 *
 * @param[in] credential_id Non-zero vault slot.
 * @param[in] principal_id Non-zero principal copied by value.
 * @param[in] ca Borrowed CA certificate bytes; may be NULL when @p ca_size is 0.
 * @param[in] ca_size CA byte count.
 * @param[in] client_certificate Borrowed client certificate; optional.
 * @param[in] client_certificate_size Client certificate byte count.
 * @param[in] private_key Borrowed private key; optional.
 * @param[in] private_key_size Private key byte count.
 *
 * @retval 0 The credential was stored.
 * @retval -EINVAL An argument or size is invalid.
 * @retval -EACCES Maintenance is inactive.
 * @retval -ENOENT The principal does not exist or is revoked.
 * @retval -ENOSPC Secure storage rejected the write.
 * @retval -EIO Secure storage I/O failed.
 */
int spaghetti_mqtt_credentials_set(
	uint16_t credential_id,
	spaghetti_principal_id_t principal_id,
	const uint8_t *ca,
	size_t ca_size,
	const uint8_t *client_certificate,
	size_t client_certificate_size,
	const uint8_t *private_key,
	size_t private_key_size);

/**
 * @brief Delete one MQTT credential slot.
 *
 * @param[in] credential_id Non-zero vault slot.
 *
 * @retval 0 The credential was deleted.
 * @retval -EINVAL @p credential_id is zero.
 * @retval -ENOENT No credential exists in that slot.
 * @retval -EACCES Maintenance is inactive.
 */
int spaghetti_mqtt_credentials_clear(uint16_t credential_id);

/**
 * @brief Report whether a credential slot is occupied.
 *
 * @param[in] credential_id Non-zero vault slot.
 * @param[out] out_exists Written only on success.
 *
 * @retval 0 @p out_exists was updated.
 * @retval -EINVAL A pointer is NULL or @p credential_id is zero.
 */
int spaghetti_mqtt_credentials_exists(
	uint16_t credential_id,
	bool *out_exists);

/**
 * @brief Resolve the principal bound to a credential slot.
 *
 * @param[in] credential_id Non-zero vault slot.
 * @param[out] out_principal_id Written only on success.
 *
 * @retval 0 @p out_principal_id contains the bound principal.
 * @retval -EINVAL A pointer is NULL or @p credential_id is zero.
 * @retval -ENOENT The slot is empty or the principal is missing/revoked.
 */
int spaghetti_mqtt_credentials_resolve_principal(
	uint16_t credential_id,
	spaghetti_principal_id_t *out_principal_id);

/**
 * @brief Load TLS material for one credential without logging secrets.
 *
 * Caller-owned buffers receive copies up to their capacities. Output sizes
 * are written only on success. Empty material yields size zero.
 *
 * @param[in] credential_id Non-zero vault slot.
 * @param[out] ca Caller-owned CA destination; unused when @p ca_capacity is 0.
 * @param[in] ca_capacity Capacity of @p ca in bytes.
 * @param[out] ca_size Written CA byte count on success.
 * @param[out] client_certificate Caller-owned certificate destination.
 * @param[in] client_certificate_capacity Capacity of @p client_certificate.
 * @param[out] client_certificate_size Written certificate byte count on success.
 * @param[out] private_key Caller-owned private key destination.
 * @param[in] private_key_capacity Capacity of @p private_key.
 * @param[out] private_key_size Written private key byte count on success.
 *
 * @retval 0 Material was copied.
 * @retval -EINVAL A required pointer is NULL or @p credential_id is zero.
 * @retval -ENOENT The slot is empty.
 * @retval -EMSGSIZE A buffer is too small for stored material.
 */
int spaghetti_mqtt_credentials_load_tls(
	uint16_t credential_id,
	uint8_t *ca,
	size_t ca_capacity,
	size_t *ca_size,
	uint8_t *client_certificate,
	size_t client_certificate_capacity,
	size_t *client_certificate_size,
	uint8_t *private_key,
	size_t private_key_capacity,
	size_t *private_key_size);

/**
 * @brief Delete every MQTT credential slot.
 *
 * @retval 0 All slots were cleared (including an already-empty vault).
 * @retval -ENOSPC Secure storage rejected a remove.
 * @retval -EIO Secure storage I/O failed.
 */
int spaghetti_mqtt_credentials_erase_all(void);

/**
 * @brief Delete every MQTT credential bound to @p principal_id.
 *
 * @param[in] principal_id Non-zero principal.
 *
 * @retval 0 At least one matching credential was deleted.
 * @retval -EINVAL @p principal_id is zero.
 * @retval -ENOENT No credential is bound to that principal.
 */
int spaghetti_mqtt_credentials_delete_for_principal(
	spaghetti_principal_id_t principal_id);

#endif /* SPAGHETTI_MQTT_CREDENTIALS_H */
