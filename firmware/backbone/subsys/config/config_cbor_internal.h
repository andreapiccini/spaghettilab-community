#ifndef SPAGHETTI_CONFIG_CBOR_INTERNAL_H
#define SPAGHETTI_CONFIG_CBOR_INTERNAL_H

#include <stddef.h>
#include <stdint.h>

#include <spaghetti/config.h>

int spaghetti_config_decode_cbor_legacy(
	const uint8_t *bytes,
	size_t length,
	uint32_t wire_version,
	struct spaghetti_config *out);

#endif /* SPAGHETTI_CONFIG_CBOR_INTERNAL_H */
