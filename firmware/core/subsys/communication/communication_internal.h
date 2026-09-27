#ifndef SPAGHETTI_COMMUNICATION_INTERNAL_H
#define SPAGHETTI_COMMUNICATION_INTERNAL_H

#include <stddef.h>
#include <stdint.h>

#include <spaghetti/communication.h>
#include <spaghetti/config.h>
#include <spaghetti/protocol.h>

#include <zcbor_common.h>
#include <zcbor_decode.h>
#include <zcbor_encode.h>

#define SPAGHETTI_OPS_CBOR_BACKUP 4U

int spaghetti_communication_shell_init(void);

int spaghetti_usb_protocol_init(void);

int spaghetti_usb_protocol_send_event(const uint8_t *envelope, size_t size);

int spaghetti_communication_shell_decode_hex(
	const char *hex,
	uint8_t *out,
	size_t capacity,
	size_t *out_size);

uint32_t spaghetti_communication_shell_permissions(
	enum spaghetti_core_mode mode);

uint32_t spaghetti_communication_remote_console_permissions(void);

/**
 * Heap snapshot owned by the caller. Bound is one
 * sizeof(struct spaghetti_config). Free with
 * spaghetti_ops_free_config() before return. Failure: NULL.
 */
struct spaghetti_config *spaghetti_ops_alloc_config(void);

void spaghetti_ops_free_config(struct spaghetti_config *config);

int spaghetti_ops_encode_empty_map(struct spaghetti_protocol_payload *out);

int spaghetti_ops_encode_u32_map(
	struct spaghetti_protocol_payload *out,
	const uint32_t *keys,
	const uint32_t *values,
	size_t count);

int spaghetti_ops_decode_u32(
	const struct spaghetti_protocol_payload *payload,
	uint32_t key,
	uint32_t *out_value);

int spaghetti_ops_decode_optional_u32(
	const struct spaghetti_protocol_payload *payload,
	uint32_t key,
	uint32_t default_value,
	uint32_t *out_value);

int spaghetti_ops_decode_bstr(
	const struct spaghetti_protocol_payload *payload,
	uint32_t key,
	const uint8_t **out_bytes,
	size_t *out_size);

void spaghetti_ops_sha256(
	const uint8_t *data,
	size_t size,
	uint8_t out[32]);

int spaghetti_communication_job_get_status(
	const struct spaghetti_request_context *context,
	uint32_t job_id,
	struct spaghetti_protocol_payload *response);

/** Test hook that bounds Wi-Fi association wait during BLE handover. */
void spaghetti_connectivity_handover_set_assoc_wait_ms(uint32_t ms);

#endif /* SPAGHETTI_COMMUNICATION_INTERNAL_H */
