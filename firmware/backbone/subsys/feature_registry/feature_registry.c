#include <spaghetti/feature_pack.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

LOG_MODULE_REGISTER(spaghetti_feature_registry,
		    CONFIG_SPAGHETTI_FEATURE_REGISTRY_LOG_LEVEL);

static bool is_initialized;
static size_t pack_count_cache;

static bool string_in_table(const char *const *table, size_t count,
			    const char *needle)
{
	if ((needle == NULL) || (needle[0] == '\0')) {
		return false;
	}
	if ((table == NULL) && (count != 0U)) {
		return false;
	}

	for (size_t idx = 0U; idx < count; ++idx) {
		if ((table[idx] != NULL) && (strcmp(table[idx], needle) == 0)) {
			return true;
		}
	}

	return false;
}

static bool pack_provides_type(const struct spaghetti_feature_pack *pack,
			       const char *const *table, size_t count,
			       const char *type_id)
{
	ARG_UNUSED(pack);
	return string_in_table(table, count, type_id);
}

static int validate_pack(const struct spaghetti_feature_pack *pack)
{
	if ((pack == NULL) || (pack->id == NULL) || (pack->id[0] == '\0') ||
	    (pack->version == NULL) || (pack->version[0] == '\0')) {
		return -EINVAL;
	}
	if (pack->abi_version != SPAGHETTI_FEATURE_PACK_ABI_VERSION) {
		return -EINVAL;
	}
	if ((pack->deps == NULL) && (pack->dep_count != 0U)) {
		return -EINVAL;
	}
	if ((pack->conflicts == NULL) && (pack->conflict_count != 0U)) {
		return -EINVAL;
	}
	if ((pack->module_types == NULL) && (pack->module_type_count != 0U)) {
		return -EINVAL;
	}
	if ((pack->rule_types == NULL) && (pack->rule_type_count != 0U)) {
		return -EINVAL;
	}
	if ((pack->block_types == NULL) && (pack->block_type_count != 0U)) {
		return -EINVAL;
	}
	if ((pack->dep_count > SPAGHETTI_FEATURE_PACK_DEP_MAX) ||
	    (pack->conflict_count > SPAGHETTI_FEATURE_PACK_DEP_MAX) ||
	    (pack->module_type_count > SPAGHETTI_FEATURE_PACK_TYPE_MAX) ||
	    (pack->rule_type_count > SPAGHETTI_FEATURE_PACK_TYPE_MAX) ||
	    (pack->block_type_count > SPAGHETTI_FEATURE_PACK_TYPE_MAX)) {
		return -EINVAL;
	}
	if (strlen(pack->id) >= SPAGHETTI_FEATURE_PACK_ID_SIZE) {
		return -EINVAL;
	}
	if (strlen(pack->version) >= SPAGHETTI_FEATURE_PACK_ID_SIZE) {
		return -EINVAL;
	}

	return 0;
}

static const struct spaghetti_feature_pack *find_unlocked(const char *id)
{
	STRUCT_SECTION_FOREACH(spaghetti_feature_pack, pack) {
		if ((pack->id != NULL) && (strcmp(pack->id, id) == 0)) {
			return pack;
		}
	}

	return NULL;
}

int spaghetti_feature_registry_init(void)
{
	size_t count = 0U;

	if (is_initialized) {
		return -EALREADY;
	}

	STRUCT_SECTION_FOREACH(spaghetti_feature_pack, pack) {
		const int err = validate_pack(pack);

		if (err < 0) {
			LOG_ERR("invalid pack descriptor at index %u",
				(uint32_t)count);
			return err;
		}

		STRUCT_SECTION_FOREACH(spaghetti_feature_pack, other) {
			if ((other != pack) && (strcmp(other->id, pack->id) == 0)) {
				LOG_ERR("duplicate pack id=%s", pack->id);
				return -EEXIST;
			}
		}

		++count;
	}

	STRUCT_SECTION_FOREACH(spaghetti_feature_pack, pack) {
		for (size_t idx = 0U; idx < pack->dep_count; ++idx) {
			const char *dep = pack->deps[idx];

			if ((dep == NULL) || (dep[0] == '\0') ||
			    (find_unlocked(dep) == NULL)) {
				LOG_ERR("pack %s missing dependency %s",
					pack->id,
					(dep != NULL) ? dep : "(null)");
				return -ENOENT;
			}
		}

		for (size_t idx = 0U; idx < pack->conflict_count; ++idx) {
			const char *conflict = pack->conflicts[idx];

			if ((conflict != NULL) && (conflict[0] != '\0') &&
			    (find_unlocked(conflict) != NULL)) {
				LOG_ERR("pack %s conflicts with linked %s",
					pack->id, conflict);
				return -EADDRINUSE;
			}
		}
	}

	if (count > SPAGHETTI_IMAGE_MANIFEST_PACK_MAX) {
		LOG_ERR("too many packs: %u", (uint32_t)count);
		return -ENOSPC;
	}

	pack_count_cache = count;
	is_initialized = true;
	LOG_INF("ready: packs=%u", (uint32_t)count);
	return 0;
}

const struct spaghetti_feature_pack *spaghetti_feature_pack_find(const char *id)
{
	if (!is_initialized || (id == NULL) || (id[0] == '\0')) {
		return NULL;
	}

	return find_unlocked(id);
}

size_t spaghetti_feature_pack_count(void)
{
	return is_initialized ? pack_count_cache : 0U;
}

const struct spaghetti_feature_pack *spaghetti_feature_pack_get(size_t index)
{
	size_t idx = 0U;

	if (!is_initialized || (index >= pack_count_cache)) {
		return NULL;
	}

	STRUCT_SECTION_FOREACH(spaghetti_feature_pack, pack) {
		if (idx == index) {
			return pack;
		}
		++idx;
	}

	return NULL;
}

int spaghetti_feature_pack_catalog(
	struct spaghetti_feature_pack_catalog_entry *out,
	size_t capacity,
	size_t *out_count)
{
	size_t idx = 0U;

	if (out_count == NULL) {
		return -EINVAL;
	}
	if ((out == NULL) && (capacity != 0U)) {
		return -EINVAL;
	}
	if (!is_initialized) {
		return -EACCES;
	}

	*out_count = pack_count_cache;
	if (capacity < pack_count_cache) {
		return (out == NULL) ? 0 : -ENOSPC;
	}

	STRUCT_SECTION_FOREACH(spaghetti_feature_pack, pack) {
		struct spaghetti_feature_pack_catalog_entry *entry = &out[idx];

		memset(entry, 0, sizeof(*entry));
		strncpy(entry->pack.id, pack->id, sizeof(entry->pack.id) - 1U);
		strncpy(entry->pack.version, pack->version,
			sizeof(entry->pack.version) - 1U);
		entry->required_hw_caps = pack->required_hw_caps;
		entry->module_types = pack->module_types;
		entry->module_type_count = pack->module_type_count;
		entry->rule_types = pack->rule_types;
		entry->rule_type_count = pack->rule_type_count;
		entry->block_types = pack->block_types;
		entry->block_type_count = pack->block_type_count;
		entry->min_protocol_version = pack->min_protocol_version;
		entry->min_config_version = pack->min_config_version;
		entry->abi_version = pack->abi_version;
		++idx;
	}

	*out_count = idx;
	return 0;
}

bool spaghetti_feature_pack_provides_module(const char *type_id)
{
	if (!is_initialized) {
		return false;
	}

	STRUCT_SECTION_FOREACH(spaghetti_feature_pack, pack) {
		if (pack_provides_type(pack, pack->module_types,
				       pack->module_type_count, type_id)) {
			return true;
		}
	}

	return false;
}

bool spaghetti_feature_pack_provides_rule(const char *type_id)
{
	if (!is_initialized) {
		return false;
	}

	STRUCT_SECTION_FOREACH(spaghetti_feature_pack, pack) {
		if (pack_provides_type(pack, pack->rule_types,
				       pack->rule_type_count, type_id)) {
			return true;
		}
	}

	return false;
}

bool spaghetti_feature_pack_provides_block(const char *type_id)
{
	if (!is_initialized) {
		return false;
	}

	STRUCT_SECTION_FOREACH(spaghetti_feature_pack, pack) {
		if (pack_provides_type(pack, pack->block_types,
				       pack->block_type_count, type_id)) {
			return true;
		}
	}

	return false;
}
