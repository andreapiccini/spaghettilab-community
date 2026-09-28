#include "communication_internal.h"

#include <errno.h>
#include <string.h>

#include <zephyr/sys/util.h>

struct spaghetti_config *spaghetti_ops_alloc_config(void)
{
	return spaghetti_config_acquire_workspace();
}

void spaghetti_ops_free_config(struct spaghetti_config *config)
{
	spaghetti_config_release_workspace(config);
}

int spaghetti_ops_encode_empty_map(struct spaghetti_protocol_payload *out)
{
	ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, out->bytes,
		       sizeof(out->bytes), 1U);

	if (out == NULL) {
		return -EINVAL;
	}
	if (!zcbor_map_start_encode(state, 0U) ||
	    !zcbor_map_end_encode(state, 0U)) {
		return -EMSGSIZE;
	}
	out->size = (size_t)(state->payload - out->bytes);
	return 0;
}

int spaghetti_ops_encode_u32_map(
	struct spaghetti_protocol_payload *out,
	const uint32_t *keys,
	const uint32_t *values,
	size_t count)
{
	ZCBOR_STATE_E(state, SPAGHETTI_OPS_CBOR_BACKUP, out->bytes,
		       sizeof(out->bytes), 1U);

	if ((out == NULL) || ((count > 0U) && ((keys == NULL) || (values == NULL)))) {
		return -EINVAL;
	}
	if (!zcbor_map_start_encode(state, count)) {
		return -EMSGSIZE;
	}
	for (size_t idx = 0U; idx < count; ++idx) {
		if (!zcbor_uint32_put(state, keys[idx]) ||
		    !zcbor_uint32_put(state, values[idx])) {
			return -EMSGSIZE;
		}
	}
	if (!zcbor_map_end_encode(state, count)) {
		return -EMSGSIZE;
	}
	out->size = (size_t)(state->payload - out->bytes);
	return 0;
}

static int decode_map_find_u32(
	const struct spaghetti_protocol_payload *payload,
	uint32_t key,
	bool required,
	uint32_t default_value,
	uint32_t *out_value)
{
	uint32_t decoded_key;
	uint32_t decoded_value;
	bool found = false;

	ZCBOR_STATE_D(state, SPAGHETTI_OPS_CBOR_BACKUP, payload->bytes,
		       payload->size, 1U, 0U);

	if ((payload == NULL) || (out_value == NULL)) {
		return -EINVAL;
	}
	if (payload->size == 0U) {
		if (required) {
			return -EINVAL;
		}
		*out_value = default_value;
		return 0;
	}
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	while (!zcbor_array_at_end(state)) {
		if (!zcbor_uint32_decode(state, &decoded_key)) {
			return -EBADMSG;
		}
		if (decoded_key == key) {
			if (!zcbor_uint32_decode(state, &decoded_value)) {
				return -EBADMSG;
			}
			found = true;
			*out_value = decoded_value;
		} else if (!zcbor_any_skip(state, NULL)) {
			return -EBADMSG;
		}
	}
	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}
	if (!found) {
		if (required) {
			return -EINVAL;
		}
		*out_value = default_value;
	}
	return 0;
}

int spaghetti_ops_decode_u32(
	const struct spaghetti_protocol_payload *payload,
	uint32_t key,
	uint32_t *out_value)
{
	return decode_map_find_u32(payload, key, true, 0U, out_value);
}

int spaghetti_ops_decode_optional_u32(
	const struct spaghetti_protocol_payload *payload,
	uint32_t key,
	uint32_t default_value,
	uint32_t *out_value)
{
	return decode_map_find_u32(payload, key, false, default_value, out_value);
}

int spaghetti_ops_decode_bstr(
	const struct spaghetti_protocol_payload *payload,
	uint32_t key,
	const uint8_t **out_bytes,
	size_t *out_size)
{
	uint32_t decoded_key;
	struct zcbor_string value = {0};
	bool found = false;

	ZCBOR_STATE_D(state, SPAGHETTI_OPS_CBOR_BACKUP, payload->bytes,
		       payload->size, 1U, 0U);

	if ((payload == NULL) || (out_bytes == NULL) || (out_size == NULL)) {
		return -EINVAL;
	}
	if (!zcbor_map_start_decode(state)) {
		return -EBADMSG;
	}
	while (!zcbor_array_at_end(state)) {
		if (!zcbor_uint32_decode(state, &decoded_key)) {
			return -EBADMSG;
		}
		if (decoded_key == key) {
			if (!zcbor_bstr_decode(state, &value)) {
				return -EBADMSG;
			}
			found = true;
			*out_bytes = value.value;
			*out_size = value.len;
		} else if (!zcbor_any_skip(state, NULL)) {
			return -EBADMSG;
		}
	}
	if (!zcbor_map_end_decode(state)) {
		return -EBADMSG;
	}
	if (!found) {
		return -EINVAL;
	}
	return 0;
}

static uint32_t sha256_rotr(uint32_t value, uint32_t bits)
{
	return (value >> bits) | (value << (32U - bits));
}

static void sha256_transform(uint32_t state[8], const uint8_t block[64])
{
	static const uint32_t k[64] = {
		0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
		0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
		0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
		0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
		0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
		0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
		0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
		0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
		0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
		0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
		0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
		0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
		0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
		0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
		0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
		0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
	};
	uint32_t w[64];
	uint32_t a = state[0];
	uint32_t b = state[1];
	uint32_t c = state[2];
	uint32_t d = state[3];
	uint32_t e = state[4];
	uint32_t f = state[5];
	uint32_t g = state[6];
	uint32_t h = state[7];

	for (size_t idx = 0U; idx < 16U; ++idx) {
		w[idx] = ((uint32_t)block[idx * 4U] << 24) |
			 ((uint32_t)block[(idx * 4U) + 1U] << 16) |
			 ((uint32_t)block[(idx * 4U) + 2U] << 8) |
			 (uint32_t)block[(idx * 4U) + 3U];
	}
	for (size_t idx = 16U; idx < 64U; ++idx) {
		const uint32_t s0 = sha256_rotr(w[idx - 15U], 7U) ^
				    sha256_rotr(w[idx - 15U], 18U) ^
				    (w[idx - 15U] >> 3U);
		const uint32_t s1 = sha256_rotr(w[idx - 2U], 17U) ^
				    sha256_rotr(w[idx - 2U], 19U) ^
				    (w[idx - 2U] >> 10U);

		w[idx] = w[idx - 16U] + s0 + w[idx - 7U] + s1;
	}
	for (size_t idx = 0U; idx < 64U; ++idx) {
		const uint32_t s1 = sha256_rotr(e, 6U) ^ sha256_rotr(e, 11U) ^
				    sha256_rotr(e, 25U);
		const uint32_t ch = (e & f) ^ ((~e) & g);
		const uint32_t temp1 = h + s1 + ch + k[idx] + w[idx];
		const uint32_t s0 = sha256_rotr(a, 2U) ^ sha256_rotr(a, 13U) ^
				    sha256_rotr(a, 22U);
		const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
		const uint32_t temp2 = s0 + maj;

		h = g;
		g = f;
		f = e;
		e = d + temp1;
		d = c;
		c = b;
		b = a;
		a = temp1 + temp2;
	}
	state[0] += a;
	state[1] += b;
	state[2] += c;
	state[3] += d;
	state[4] += e;
	state[5] += f;
	state[6] += g;
	state[7] += h;
}

void spaghetti_ops_sha256(const uint8_t *data, size_t size, uint8_t out[32])
{
	uint32_t state[8] = {
		0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
		0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U,
	};
	uint8_t block[64];
	size_t offset = 0U;
	const uint64_t bit_len = (uint64_t)size * 8U;

	while ((size - offset) >= 64U) {
		sha256_transform(state, &data[offset]);
		offset += 64U;
	}
	memset(block, 0, sizeof(block));
	memcpy(block, &data[offset], size - offset);
	block[size - offset] = 0x80U;
	if ((size - offset) >= 56U) {
		sha256_transform(state, block);
		memset(block, 0, sizeof(block));
	}
	block[56] = (uint8_t)(bit_len >> 56);
	block[57] = (uint8_t)(bit_len >> 48);
	block[58] = (uint8_t)(bit_len >> 40);
	block[59] = (uint8_t)(bit_len >> 32);
	block[60] = (uint8_t)(bit_len >> 24);
	block[61] = (uint8_t)(bit_len >> 16);
	block[62] = (uint8_t)(bit_len >> 8);
	block[63] = (uint8_t)bit_len;
	sha256_transform(state, block);
	for (size_t idx = 0U; idx < 8U; ++idx) {
		out[idx * 4U] = (uint8_t)(state[idx] >> 24);
		out[(idx * 4U) + 1U] = (uint8_t)(state[idx] >> 16);
		out[(idx * 4U) + 2U] = (uint8_t)(state[idx] >> 8);
		out[(idx * 4U) + 3U] = (uint8_t)state[idx];
	}
}
