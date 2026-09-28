#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/ztest.h>
#include <zephyr/sys/util.h>

#include <spaghetti/config.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/core.h>
#include <spaghetti/discovery.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/secure_workspace.h>
#include <spaghetti/service.h>
#include <spaghetti/update.h>

enum init_step {
	STEP_SECURE_WORKSPACE,
	STEP_STORAGE,
	STEP_UPDATE,
	STEP_MAINTENANCE_INIT,
	STEP_PORT,
	STEP_TOPOLOGY,
	STEP_REGISTRY,
	STEP_MANAGER,
	STEP_DATA,
	STEP_CONFIG,
	STEP_HEALTH,
	STEP_RUNTIME,
	STEP_MQTT,
	STEP_DISCOVERY,
	STEP_WIFI,
	STEP_OTA,
	STEP_MAINTENANCE_ENTER,
	STEP_COMMUNICATION,
	STEP_REMOTE_CONSOLE,
	STEP_SERVICE_REGISTRY,
	STEP_OTA_START,
	STEP_CONNECTIVITY,
};

static enum init_step steps[21];
static size_t step_count;
static struct spaghetti_config initialized_defaults;
static int trial_confirm_count;
static int wifi_connect_request_count;

static int record_step(enum init_step step)
{
	steps[step_count] = step;
	++step_count;
	return 0;
}

int spaghetti_connectivity_init(
	enum spaghetti_connectivity_policy boot_policy)
{
	zassert_equal(boot_policy, SPAGHETTI_CONNECTIVITY_ONLINE);
	return record_step(STEP_CONNECTIVITY);
}

int spaghetti_service_registry_init(void)
{
	return record_step(STEP_SERVICE_REGISTRY);
}

int spaghetti_service_start(const char *id)
{
	zassert_equal(strcmp(id, SPAGHETTI_SERVICE_ID_OTA), 0);
	return record_step(STEP_OTA_START);
}

int spaghetti_secure_workspace_init(void)
{
	return record_step(STEP_SECURE_WORKSPACE);
}

int spaghetti_feature_registry_init(void)
{
	return 0;
}

int spaghetti_image_manifest_init(void)
{
	return 0;
}

int spaghetti_resources_init(void)
{
	return 0;
}

int spaghetti_port_init_all(void)
{
	return record_step(STEP_PORT);
}

int spaghetti_topology_init(void)
{
	return record_step(STEP_TOPOLOGY);
}

int spaghetti_health_init(void)
{
	return record_step(STEP_HEALTH);
}

int spaghetti_health_start(void)
{
	return 0;
}

int spaghetti_driver_registry_init(void)
{
	return record_step(STEP_REGISTRY);
}

int spaghetti_module_manager_init(void)
{
	return record_step(STEP_MANAGER);
}

int spaghetti_data_init(void)
{
	return record_step(STEP_DATA);
}

int spaghetti_runtime_init(void)
{
	return record_step(STEP_RUNTIME);
}

int spaghetti_mqtt_init(const struct spaghetti_mqtt_config *config)
{
	zassert_not_null(config);
	zassert_false(config->enabled);
	return record_step(STEP_MQTT);
}

int spaghetti_storage_init(void)
{
	return record_step(STEP_STORAGE);
}

int spaghetti_identity_init(void)
{
	return 0;
}

int spaghetti_access_control_init(void)
{
	return 0;
}

int spaghetti_enrollment_init(void)
{
	return 0;
}

int spaghetti_update_init(void)
{
	return record_step(STEP_UPDATE);
}

int spaghetti_storage_read_config(struct spaghetti_config *out)
{
	zassert_not_null(out);
	if (IS_ENABLED(CONFIG_SPAGHETTI_TEST_CONFIG_ABSENT)) {
		return -ENOENT;
	}
	*out = (struct spaghetti_config) {
		.version = SPAGHETTI_CONFIG_VERSION,
		.module_count = 1U,
		.connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE,
		.energy_policy = {
			.ble_availability = SPAGHETTI_BLE_OFF,
		},
	};
	return 0;
}

int spaghetti_storage_probe_config(void)
{
	if (IS_ENABLED(CONFIG_SPAGHETTI_TEST_CONFIG_ABSENT)) {
		return -ENOENT;
	}
	return 0;
}

int spaghetti_storage_consume_maintenance_once(bool *requested)
{
	zassert_not_null(requested);
	*requested = IS_ENABLED(CONFIG_SPAGHETTI_TEST_MAINTENANCE_MARKER);
	return 0;
}

int spaghetti_update_get_status(struct spaghetti_update_status *out)
{
	zassert_not_null(out);
	*out = (struct spaghetti_update_status) {
		.state = IS_ENABLED(CONFIG_SPAGHETTI_TEST_TRIAL_IMAGE) ?
			SPAGHETTI_UPDATE_TRIAL_BOOT : SPAGHETTI_UPDATE_IDLE,
		.active_slot = IS_ENABLED(CONFIG_SPAGHETTI_TEST_TRIAL_IMAGE) ? 1U : 0U,
		.image_confirmed = !IS_ENABLED(CONFIG_SPAGHETTI_TEST_TRIAL_IMAGE),
	};
	return 0;
}

int spaghetti_update_confirm_trial(void)
{
	++trial_confirm_count;
	return 0;
}

int spaghetti_maintenance_link_init(void)
{
	return record_step(STEP_MAINTENANCE_INIT);
}

int spaghetti_maintenance_link_probe(uint32_t timeout_ms, bool *requested)
{
	zassert_true(timeout_ms > 0U);
	zassert_not_null(requested);
	*requested = IS_ENABLED(CONFIG_SPAGHETTI_TEST_BOOTSTRAP_REQUEST);
	return 0;
}

int spaghetti_maintenance_link_enter(
	enum spaghetti_maintenance_entry_reason reason)
{
	if (IS_ENABLED(CONFIG_SPAGHETTI_TEST_CONFIG_ABSENT)) {
		zassert_equal(reason, SPAGHETTI_MAINTENANCE_CONFIG_ABSENT);
	} else if (IS_ENABLED(CONFIG_SPAGHETTI_TEST_MAINTENANCE_MARKER)) {
		zassert_equal(reason, SPAGHETTI_MAINTENANCE_REBOOT_REQUEST);
	} else {
		zassert_equal(reason, SPAGHETTI_MAINTENANCE_BOOTSTRAP_FRAME);
	}
	return record_step(STEP_MAINTENANCE_ENTER);
}

void spaghetti_core_boot_reboot(void)
{
	ztest_test_fail();
}

int spaghetti_discovery_init(void)
{
	return record_step(STEP_DISCOVERY);
}

int spaghetti_config_init(const struct spaghetti_config *defaults)
{
	ARG_UNUSED(defaults);
	initialized_defaults = (struct spaghetti_config) {
		.version = SPAGHETTI_CONFIG_VERSION,
	};
	return record_step(STEP_CONFIG);
}

static struct spaghetti_config test_workspace;

struct spaghetti_config *spaghetti_config_acquire_workspace(void)
{
	return &test_workspace;
}

void spaghetti_config_release_workspace(struct spaghetti_config *config)
{
	ARG_UNUSED(config);
}

int spaghetti_config_validate(const struct spaghetti_config *candidate,
			      struct spaghetti_config_failure *failure)
{
	ARG_UNUSED(failure);
	return (candidate != NULL) ? 0 : -EINVAL;
}

int spaghetti_wifi_profiles_init(void)
{
	return record_step(STEP_WIFI);
}

int spaghetti_wifi_profiles_init_offline(void)
{
	return record_step(STEP_WIFI);
}

int spaghetti_wifi_profiles_request_connect(void)
{
	++wifi_connect_request_count;
	return 0;
}

int spaghetti_ota_init(void)
{
	return record_step(STEP_OTA);
}

int spaghetti_communication_init(void)
{
	return record_step(STEP_COMMUNICATION);
}

int spaghetti_remote_console_init(void)
{
	return record_step(STEP_REMOTE_CONSOLE);
}

int spaghetti_config_get_snapshot(
	struct spaghetti_config *out,
	struct spaghetti_config_revision *out_revision)
{
	if ((out == NULL) || (out_revision == NULL)) {
		return -EINVAL;
	}

	*out = initialized_defaults;
	out_revision->generation = 1U;
	memset(out_revision->sha256, 0, sizeof(out_revision->sha256));
	return 0;
}

int spaghetti_config_apply(
	const struct spaghetti_config *candidate,
	uint32_t expected_generation,
	struct spaghetti_config_commit_result *out_result)
{
	ARG_UNUSED(out_result);
	zassert_not_null(candidate);
	zassert_equal(candidate->module_count, 1U);
	zassert_equal(expected_generation, 1U);
	return -ENODEV;
}

int spaghetti_rule_registry_init(void)
{
	return 0;
}

int spaghetti_device_profile_init(void)
{
	return 0;
}

int spaghetti_block_registry_init(void)
{
	return 0;
}

int spaghetti_processing_init(void)
{
	return 0;
}

int spaghetti_module_manager_configure(
	const struct spaghetti_module_request *request,
	spaghetti_module_id_t *out_id)
{
	ARG_UNUSED(request);
	ARG_UNUSED(out_id);
	return -ENOTSUP;
}

int spaghetti_module_manager_get_by_key(
	spaghetti_module_key_t key,
	struct spaghetti_module_snapshot *out)
{
	ARG_UNUSED(key);
	ARG_UNUSED(out);
	return -ENOENT;
}

int spaghetti_module_manager_remove(spaghetti_module_id_t id,
				    uint32_t expected_revision)
{
	ARG_UNUSED(id);
	ARG_UNUSED(expected_revision);
	return -ENOENT;
}

ZTEST(core, test_boot_order_and_nonfatal_stored_config_failure)
{
	const bool maintenance =
		IS_ENABLED(CONFIG_SPAGHETTI_TEST_MAINTENANCE_MARKER) ||
		IS_ENABLED(CONFIG_SPAGHETTI_TEST_BOOTSTRAP_REQUEST);
	const bool normal = !IS_ENABLED(CONFIG_SPAGHETTI_TEST_CONFIG_ABSENT) &&
			    !maintenance;
	struct spaghetti_core_info info;

	zassert_equal(spaghetti_core_get_state(), SPAGHETTI_CORE_UNINITIALIZED);
	zassert_equal(spaghetti_core_get_info(&info), -EAGAIN);
	zassert_equal(spaghetti_core_get_info(NULL), -EINVAL);
	zassert_equal(spaghetti_core_start(), -EACCES);
	zassert_ok(spaghetti_core_init());
	zassert_equal(spaghetti_core_get_state(), SPAGHETTI_CORE_READY);
	zassert_ok(spaghetti_core_get_info(&info));
	zassert_equal(info.state, SPAGHETTI_CORE_READY);
	zassert_equal(info.mode,
		IS_ENABLED(CONFIG_SPAGHETTI_TEST_CONFIG_ABSENT) ?
			SPAGHETTI_CORE_MODE_UNPROVISIONED :
			maintenance ? SPAGHETTI_CORE_MODE_MAINTENANCE :
				      SPAGHETTI_CORE_MODE_NORMAL);
	zassert_equal(info.image_state,
		IS_ENABLED(CONFIG_SPAGHETTI_TEST_TRIAL_IMAGE) ?
			SPAGHETTI_CORE_IMAGE_TRIAL :
			SPAGHETTI_CORE_IMAGE_CONFIRMED);
	zassert_equal(strcmp(info.version, "1.2.3+4"), 0);
	zassert_equal(spaghetti_core_init(), -EALREADY);
	zassert_equal(step_count, normal ? 21U : 14U);
	zassert_equal(steps[0], STEP_SECURE_WORKSPACE);
	zassert_equal(steps[1], STEP_STORAGE);
	zassert_equal(steps[2], STEP_UPDATE);
	zassert_equal(steps[3], STEP_MAINTENANCE_INIT);
	zassert_equal(steps[4], STEP_PORT);
	zassert_equal(steps[5], STEP_TOPOLOGY);
	zassert_equal(steps[6], STEP_REGISTRY);
	zassert_equal(steps[7], STEP_MANAGER);
	zassert_equal(steps[8], STEP_DATA);
	zassert_equal(steps[9], STEP_CONFIG);
	zassert_equal(steps[10], STEP_HEALTH);
	if (normal) {
		zassert_equal(steps[11], STEP_RUNTIME);
		zassert_equal(steps[12], STEP_MQTT);
		zassert_equal(steps[13], STEP_DISCOVERY);
		zassert_equal(steps[14], STEP_WIFI);
		zassert_equal(steps[15], STEP_OTA);
		zassert_equal(steps[16], STEP_COMMUNICATION);
		zassert_equal(steps[17], STEP_REMOTE_CONSOLE);
		zassert_equal(steps[18], STEP_SERVICE_REGISTRY);
		zassert_equal(steps[19], STEP_OTA_START);
		zassert_equal(steps[20], STEP_CONNECTIVITY);
	} else {
		zassert_equal(steps[11], STEP_WIFI);
		zassert_equal(steps[12], STEP_MAINTENANCE_ENTER);
		zassert_equal(steps[13], STEP_COMMUNICATION);
	}
	zassert_equal(initialized_defaults.version, SPAGHETTI_CONFIG_VERSION);
	zassert_equal(initialized_defaults.module_count, 0U);
	zassert_equal(initialized_defaults.schedule_count, 0U);
	zassert_equal(initialized_defaults.rule_count, 0U);

	zassert_ok(spaghetti_core_start());
	zassert_equal(spaghetti_core_get_state(), SPAGHETTI_CORE_RUNNING);
	zassert_ok(spaghetti_core_get_info(&info));
	zassert_equal(info.state, SPAGHETTI_CORE_RUNNING);
	zassert_equal(trial_confirm_count,
		IS_ENABLED(CONFIG_SPAGHETTI_TEST_TRIAL_IMAGE) ? 1 : 0);
	zassert_equal(wifi_connect_request_count, normal ? 1 : 0);
	zassert_true(info.image_confirmed);
	zassert_equal(spaghetti_core_start(), -EACCES);
}

ZTEST_SUITE(core, NULL, NULL, NULL, NULL, NULL);
