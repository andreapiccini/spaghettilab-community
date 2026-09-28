#include <spaghetti/image_manifest.h>

#include <errno.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/core.h>
#include <spaghetti/feature_pack.h>

LOG_MODULE_REGISTER(spaghetti_image_manifest,
		    CONFIG_SPAGHETTI_FEATURE_REGISTRY_LOG_LEVEL);

#if defined(CONFIG_SPAGHETTI_RESOURCE_PROFILE_MINIMAL)
#define SPAGHETTI_MANIFEST_PROFILE SPAGHETTI_RESOURCE_PROFILE_MINIMAL
#elif defined(CONFIG_SPAGHETTI_RESOURCE_PROFILE_STANDARD)
#define SPAGHETTI_MANIFEST_PROFILE SPAGHETTI_RESOURCE_PROFILE_STANDARD
#else
#define SPAGHETTI_MANIFEST_PROFILE SPAGHETTI_RESOURCE_PROFILE_EXTENDED
#endif

#ifndef CONFIG_SPAGHETTI_FLASH_SLOT_BYTES
#define CONFIG_SPAGHETTI_FLASH_SLOT_BYTES 1048576
#endif
#ifndef CONFIG_SPAGHETTI_FLASH_IMAGE_BUDGET_BYTES
#define CONFIG_SPAGHETTI_FLASH_IMAGE_BUDGET_BYTES 917504
#endif
#ifndef CONFIG_SPAGHETTI_FLASH_HEADROOM_BYTES
#define CONFIG_SPAGHETTI_FLASH_HEADROOM_BYTES 65536
#endif
#ifndef CONFIG_SPAGHETTI_STATIC_RAM_BUDGET_BYTES
#define CONFIG_SPAGHETTI_STATIC_RAM_BUDGET_BYTES 327680
#endif
#ifndef CONFIG_SPAGHETTI_DECLARED_STACK_BYTES
#define CONFIG_SPAGHETTI_DECLARED_STACK_BYTES 24576
#endif
#ifndef CONFIG_SPAGHETTI_DECLARED_POOL_BYTES
#define CONFIG_SPAGHETTI_DECLARED_POOL_BYTES 65536
#endif
#ifndef CONFIG_SPAGHETTI_DECLARED_WORKSPACE_BYTES
#define CONFIG_SPAGHETTI_DECLARED_WORKSPACE_BYTES 60000
#endif

static struct spaghetti_image_manifest manifest;
static bool is_initialized;

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
				    (w[idx - 15U] >> 3);
		const uint32_t s1 = sha256_rotr(w[idx - 2U], 17U) ^
				    sha256_rotr(w[idx - 2U], 19U) ^
				    (w[idx - 2U] >> 10);

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

static void compute_sha256(const uint8_t *data, size_t size, uint8_t out[32])
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
		out[(idx * 4U) + 0U] = (uint8_t)(state[idx] >> 24);
		out[(idx * 4U) + 1U] = (uint8_t)(state[idx] >> 16);
		out[(idx * 4U) + 2U] = (uint8_t)(state[idx] >> 8);
		out[(idx * 4U) + 3U] = (uint8_t)state[idx];
	}
}

static int cmp_pack_ref(const void *left, const void *right)
{
	const struct spaghetti_feature_pack_ref *a = left;
	const struct spaghetti_feature_pack_ref *b = right;
	const int id_cmp = strcmp(a->id, b->id);

	if (id_cmp != 0) {
		return id_cmp;
	}

	return strcmp(a->version, b->version);
}

static void sort_pack_refs(struct spaghetti_feature_pack_ref *refs, size_t count)
{
	for (size_t i = 1U; i < count; ++i) {
		struct spaghetti_feature_pack_ref key = refs[i];
		size_t j = i;

		while ((j > 0U) && (cmp_pack_ref(&refs[j - 1U], &key) > 0)) {
			refs[j] = refs[j - 1U];
			--j;
		}
		refs[j] = key;
	}
}

static bool candidate_has_pack(const struct spaghetti_image_manifest *candidate,
			       const char *pack_id)
{
	for (size_t idx = 0U; idx < candidate->pack_count; ++idx) {
		if (strcmp(candidate->packs[idx].id, pack_id) == 0) {
			return true;
		}
	}

	return false;
}

static bool pack_provides(const struct spaghetti_feature_pack *pack,
			  const char *type_id, char kind)
{
	const char *const *table = NULL;
	size_t count = 0U;

	if ((pack == NULL) || (type_id == NULL)) {
		return false;
	}

	switch (kind) {
	case 'm':
		table = pack->module_types;
		count = pack->module_type_count;
		break;
	case 'r':
		table = pack->rule_types;
		count = pack->rule_type_count;
		break;
	case 'b':
		table = pack->block_types;
		count = pack->block_type_count;
		break;
	default:
		return false;
	}

	for (size_t idx = 0U; idx < count; ++idx) {
		if ((table[idx] != NULL) && (strcmp(table[idx], type_id) == 0)) {
			return true;
		}
	}

	return false;
}

static bool candidate_provides_type(
	const struct spaghetti_image_manifest *candidate,
	const char *type_id,
	char kind)
{
	const size_t pack_count = spaghetti_feature_pack_count();

	for (size_t idx = 0U; idx < pack_count; ++idx) {
		const struct spaghetti_feature_pack *pack =
			spaghetti_feature_pack_get(idx);

		if ((pack == NULL) || !pack_provides(pack, type_id, kind)) {
			continue;
		}
		if (candidate_has_pack(candidate, pack->id)) {
			return true;
		}
	}

	return false;
}

static int ensure_type_retained(
	const struct spaghetti_image_manifest *candidate,
	const char *type_id,
	char kind)
{
	if ((type_id == NULL) || (type_id[0] == '\0')) {
		return -EINVAL;
	}
	if (candidate_provides_type(candidate, type_id, kind)) {
		return 0;
	}
	if (candidate->config_migration_policy ==
	    SPAGHETTI_CONFIG_MIGRATION_EXPLICIT) {
		return 0;
	}

	return -ENOENT;
}

int spaghetti_image_manifest_init(void)
{
	struct spaghetti_feature_pack_ref sorted[SPAGHETTI_IMAGE_MANIFEST_PACK_MAX];
	char fingerprint[SPAGHETTI_IMAGE_MANIFEST_PACK_MAX *
			 (SPAGHETTI_FEATURE_PACK_ID_SIZE * 2U + 2U)];
	size_t fingerprint_len = 0U;
	const size_t pack_count = spaghetti_feature_pack_count();

	if (is_initialized) {
		return -EALREADY;
	}
	if (pack_count == 0U) {
		return -EINVAL;
	}
	if (pack_count > SPAGHETTI_IMAGE_MANIFEST_PACK_MAX) {
		return -ENOSPC;
	}

	memset(&manifest, 0, sizeof(manifest));
	strncpy(manifest.core_variant, CONFIG_SPAGHETTI_CORE_VARIANT,
		sizeof(manifest.core_variant) - 1U);
	manifest.resource_profile = SPAGHETTI_MANIFEST_PROFILE;
#if defined(CONFIG_MCUBOOT_IMGTOOL_SIGN_VERSION)
	strncpy(manifest.fw_version, CONFIG_MCUBOOT_IMGTOOL_SIGN_VERSION,
		sizeof(manifest.fw_version) - 1U);
#else
	strncpy(manifest.fw_version, "0.0.0+test",
		sizeof(manifest.fw_version) - 1U);
#endif
	manifest.abi_version = SPAGHETTI_FEATURE_PACK_ABI_VERSION;
	manifest.min_protocol_version = 1U;
	manifest.min_config_version = SPAGHETTI_CONFIG_VERSION;
	manifest.pack_count = pack_count;
	manifest.flash_slot_bytes = CONFIG_SPAGHETTI_FLASH_SLOT_BYTES;
	manifest.flash_image_budget_bytes =
		CONFIG_SPAGHETTI_FLASH_IMAGE_BUDGET_BYTES;
	manifest.flash_headroom_bytes = CONFIG_SPAGHETTI_FLASH_HEADROOM_BYTES;
	manifest.static_ram_budget_bytes =
		CONFIG_SPAGHETTI_STATIC_RAM_BUDGET_BYTES;
	manifest.declared_stack_bytes = CONFIG_SPAGHETTI_DECLARED_STACK_BYTES;
	manifest.declared_pool_bytes = CONFIG_SPAGHETTI_DECLARED_POOL_BYTES;
	manifest.declared_workspace_bytes =
		CONFIG_SPAGHETTI_DECLARED_WORKSPACE_BYTES;
	strncpy(manifest.bootloader_min, "1.0.0",
		sizeof(manifest.bootloader_min) - 1U);
	manifest.config_migration_policy =
		SPAGHETTI_CONFIG_MIGRATION_REJECT_REMOVAL;

	for (size_t idx = 0U; idx < pack_count; ++idx) {
		const struct spaghetti_feature_pack *pack =
			spaghetti_feature_pack_get(idx);

		if (pack == NULL) {
			return -EINVAL;
		}
		strncpy(manifest.packs[idx].id, pack->id,
			sizeof(manifest.packs[idx].id) - 1U);
		strncpy(manifest.packs[idx].version, pack->version,
			sizeof(manifest.packs[idx].version) - 1U);
		sorted[idx] = manifest.packs[idx];
	}

	sort_pack_refs(sorted, pack_count);
	memset(fingerprint, 0, sizeof(fingerprint));
	for (size_t idx = 0U; idx < pack_count; ++idx) {
		const int written = snprintk(
			&fingerprint[fingerprint_len],
			sizeof(fingerprint) - fingerprint_len,
			"%s%s@%s",
			(idx == 0U) ? "" : ",",
			sorted[idx].id,
			sorted[idx].version);

		if (written < 0) {
			return -EINVAL;
		}
		fingerprint_len += (size_t)written;
		if (fingerprint_len >= sizeof(fingerprint)) {
			return -ENOSPC;
		}
	}

	compute_sha256((const uint8_t *)fingerprint, fingerprint_len,
		       manifest.feature_set_hash);
	is_initialized = true;
	LOG_INF("manifest ready: packs=%u", (uint32_t)pack_count);
	return 0;
}

const struct spaghetti_image_manifest *spaghetti_image_manifest_get(void)
{
	return is_initialized ? &manifest : NULL;
}

int spaghetti_image_manifest_validate_candidate(
	const struct spaghetti_image_manifest *candidate,
	const struct spaghetti_config *config)
{
	int err;

	if ((candidate == NULL) || (config == NULL)) {
		return -EINVAL;
	}
	if ((candidate->pack_count == 0U) ||
	    (candidate->pack_count > SPAGHETTI_IMAGE_MANIFEST_PACK_MAX)) {
		return -EINVAL;
	}
	if (strncmp(candidate->core_variant, CONFIG_SPAGHETTI_CORE_VARIANT,
		    SPAGHETTI_CORE_VARIANT_SIZE) != 0) {
		return -ENOTSUP;
	}
	if (candidate->resource_profile != SPAGHETTI_MANIFEST_PROFILE) {
		return -ENOTSUP;
	}
	if (candidate->abi_version > SPAGHETTI_FEATURE_PACK_ABI_VERSION) {
		return -ENOTSUP;
	}
	if (candidate->min_config_version > SPAGHETTI_CONFIG_VERSION) {
		return -ENOTSUP;
	}

	for (size_t idx = 0U; idx < config->module_count; ++idx) {
		err = ensure_type_retained(candidate,
					   config->modules[idx].type_id, 'm');
		if (err < 0) {
			return err;
		}
	}
	for (size_t idx = 0U; idx < config->rule_count; ++idx) {
		err = ensure_type_retained(candidate,
					   config->rules[idx].type_id, 'r');
		if (err < 0) {
			return err;
		}
	}
	for (size_t idx = 0U; idx < config->block_count; ++idx) {
		err = ensure_type_retained(candidate,
					   config->blocks[idx].type_id, 'b');
		if (err < 0) {
			return err;
		}
	}

	return 0;
}
