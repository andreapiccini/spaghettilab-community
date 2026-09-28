#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/config.h>
#include <spaghetti/feature_pack.h>
#include <spaghetti/image_manifest.h>

static void assert_pack_present(const char *id)
{
	const struct spaghetti_feature_pack *pack =
		spaghetti_feature_pack_find(id);

	zassert_not_null(pack);
	zassert_equal(strcmp(pack->id, id), 0);
}

static void copy_live_manifest(struct spaghetti_image_manifest *out)
{
	const struct spaghetti_image_manifest *live =
		spaghetti_image_manifest_get();

	zassert_not_null(live);
	*out = *live;
}

static void *feature_packs_setup(void)
{
	zassert_ok(spaghetti_feature_registry_init());
	zassert_ok(spaghetti_image_manifest_init());
	return NULL;
}

ZTEST(feature_packs, test_registry_enumerates_base_packs)
{
	size_t count;
	struct spaghetti_feature_pack_catalog_entry entries[
		SPAGHETTI_IMAGE_MANIFEST_PACK_MAX];

	zassert_equal(spaghetti_feature_registry_init(), -EALREADY);
	zassert_true(spaghetti_feature_pack_count() >= 2U);
	assert_pack_present("core-basic");
	assert_pack_present("processing-basic");
	assert_pack_present("device-profile-engine");

	if (IS_ENABLED(CONFIG_SPAGHETTI_PACK_MODBUS)) {
		assert_pack_present("transport-modbus");
	} else {
		zassert_is_null(spaghetti_feature_pack_find("transport-modbus"));
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_PACK_PROCESSING_KALMAN)) {
		assert_pack_present("processing-kalman");
		zassert_true(spaghetti_feature_pack_provides_block("kalman"));
	} else {
		zassert_is_null(spaghetti_feature_pack_find("processing-kalman"));
		zassert_false(spaghetti_feature_pack_provides_block("kalman"));
	}

	zassert_true(spaghetti_feature_pack_provides_module("ina219"));
	zassert_true(spaghetti_feature_pack_provides_rule("threshold"));
	zassert_true(spaghetti_feature_pack_provides_block("scale_offset"));

	zassert_equal(spaghetti_feature_pack_catalog(NULL, 0U, NULL), -EINVAL);
	zassert_ok(spaghetti_feature_pack_catalog(NULL, 0U, &count));
	zassert_equal(count, spaghetti_feature_pack_count());
	zassert_equal(spaghetti_feature_pack_catalog(entries, 1U, &count),
		      -ENOSPC);
	zassert_ok(spaghetti_feature_pack_catalog(entries, ARRAY_SIZE(entries),
						  &count));
	zassert_equal(count, spaghetti_feature_pack_count());
	zassert_not_null(spaghetti_feature_pack_get(0U));
	zassert_is_null(spaghetti_feature_pack_get(count));
}

ZTEST(feature_packs, test_manifest_fingerprint_stable_and_nonzero)
{
	const struct spaghetti_image_manifest *manifest =
		spaghetti_image_manifest_get();
	uint8_t zero[SPAGHETTI_FEATURE_SET_HASH_SIZE] = {0};

	zassert_not_null(manifest);
	zassert_true(manifest->pack_count >= 2U);
	zassert_true(memcmp(manifest->feature_set_hash, zero,
			    sizeof(zero)) != 0);
	zassert_equal(strcmp(manifest->core_variant,
			     CONFIG_SPAGHETTI_CORE_VARIANT),
		      0);

	if (IS_ENABLED(CONFIG_SPAGHETTI_PACK_PROCESSING_KALMAN)) {
		zassert_not_null(spaghetti_feature_pack_find("processing-kalman"));
	}
	if (IS_ENABLED(CONFIG_SPAGHETTI_PACK_MODBUS)) {
		zassert_not_null(spaghetti_feature_pack_find("transport-modbus"));
	}
}

ZTEST(feature_packs, test_validate_candidate_rejects_removed_used_type)
{
	struct spaghetti_image_manifest candidate;
	struct spaghetti_config config;
	bool removed = false;
	const char *pack_to_remove;
	const char *type_id;
	char kind;

	copy_live_manifest(&candidate);
	memset(&config, 0, sizeof(config));
	config.version = SPAGHETTI_CONFIG_VERSION;

	if (IS_ENABLED(CONFIG_SPAGHETTI_PACK_PROCESSING_KALMAN)) {
		pack_to_remove = "processing-kalman";
		type_id = "kalman";
		kind = 'b';
		config.block_count = 1U;
		config.blocks[0].key = 1U;
		strncpy(config.blocks[0].type_id, type_id,
			sizeof(config.blocks[0].type_id) - 1U);
	} else {
		pack_to_remove = "processing-basic";
		type_id = "scale_offset";
		kind = 'b';
		config.block_count = 1U;
		config.blocks[0].key = 1U;
		strncpy(config.blocks[0].type_id, type_id,
			sizeof(config.blocks[0].type_id) - 1U);
	}
	ARG_UNUSED(kind);

	zassert_ok(spaghetti_image_manifest_validate_candidate(&candidate,
							       &config));

	for (size_t idx = 0U; idx < candidate.pack_count; ++idx) {
		if (strcmp(candidate.packs[idx].id, pack_to_remove) != 0) {
			continue;
		}
		for (size_t move = idx + 1U; move < candidate.pack_count;
		     ++move) {
			candidate.packs[move - 1U] = candidate.packs[move];
		}
		--candidate.pack_count;
		removed = true;
		break;
	}
	zassert_true(removed);
	zassert_equal(spaghetti_image_manifest_validate_candidate(&candidate,
								  &config),
		      -ENOENT);

	candidate.config_migration_policy =
		SPAGHETTI_CONFIG_MIGRATION_EXPLICIT;
	zassert_ok(spaghetti_image_manifest_validate_candidate(&candidate,
							       &config));
}

ZTEST_SUITE(feature_packs, NULL, feature_packs_setup, NULL, NULL, NULL);
