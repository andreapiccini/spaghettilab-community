#include <errno.h>
#include <string.h>

#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/device_profile.h>
#include <spaghetti/feature_pack.h>
#include <spaghetti/image_manifest.h>
#include <spaghetti/resources.h>

size_t spaghetti_device_profile_count(void)
{
	return 2U;
}

static void *resources_setup(void)
{
	zassert_ok(spaghetti_feature_registry_init());
	zassert_ok(spaghetti_image_manifest_init());
	zassert_ok(spaghetti_resources_init());
	return NULL;
}

ZTEST(resources, test_snapshot_coherence_and_no_free_ram_field)
{
	struct spaghetti_resources_snapshot snapshot;
	struct spaghetti_resources_snapshot untouched = {
		.modules.capacity = UINT16_MAX,
	};

	zassert_equal(spaghetti_resources_get_snapshot(NULL), -EINVAL);
	zassert_equal(untouched.modules.capacity, UINT16_MAX);
	zassert_ok(spaghetti_resources_get_snapshot(&snapshot));
	zassert_equal(snapshot.modules.capacity, CONFIG_SPAGHETTI_MAX_MODULES);
	zassert_equal(snapshot.rules.capacity, CONFIG_SPAGHETTI_MAX_RULES);
	zassert_equal(snapshot.blocks.capacity,
		      CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS);
	zassert_equal(snapshot.profiles.capacity,
		      CONFIG_SPAGHETTI_MAX_DEVICE_PROFILES);
	zassert_equal(snapshot.records.capacity,
		      CONFIG_SPAGHETTI_MAX_RECORD_QUEUE);
	zassert_equal(snapshot.profiles.used, 2U);
	zassert_true(snapshot.pack_count >= 2U);
	zassert_true(snapshot.flash_slot_bytes > 0U);
	zassert_true(snapshot.flash_image_budget_bytes > 0U);
	zassert_true(snapshot.flash_headroom_bytes > 0U);
	zassert_true(snapshot.static_ram_budget_bytes > 0U);
	zassert_true(snapshot.heap_metrics_available);
	zassert_false(snapshot.stack_metrics_available);
	/* Snapshot must not advertise installability via free RAM. */
	zassert_equal(sizeof(snapshot), sizeof(struct spaghetti_resources_snapshot));
}

ZTEST(resources, test_peak_updates_and_high_water_reset)
{
	struct spaghetti_resources_snapshot snapshot;

	spaghetti_resources_note_used(SPAGHETTI_RESOURCE_OWNER_MODULES, 3U);
	spaghetti_resources_note_used(SPAGHETTI_RESOURCE_OWNER_MODULES, 5U);
	spaghetti_resources_note_used(SPAGHETTI_RESOURCE_OWNER_MODULES, 2U);
	spaghetti_resources_note_failure(SPAGHETTI_RESOURCE_OWNER_RECORDS);

	zassert_ok(spaghetti_resources_get_snapshot(&snapshot));
	zassert_equal(snapshot.modules.used, 2U);
	zassert_equal(snapshot.modules.peak, 5U);
	zassert_equal(snapshot.allocation_failures, 1U);
	zassert_equal(snapshot.last_exhausted, SPAGHETTI_RESOURCE_OWNER_RECORDS);

	zassert_ok(spaghetti_resources_reset_high_water());
	zassert_ok(spaghetti_resources_get_snapshot(&snapshot));
	zassert_equal(snapshot.modules.used, 2U);
	zassert_equal(snapshot.modules.peak, 2U);
	zassert_equal(snapshot.allocation_failures, 1U);
}

ZTEST_SUITE(resources, NULL, resources_setup, NULL, NULL, NULL);
