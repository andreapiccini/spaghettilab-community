#include <spaghetti/core.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/devicetree.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>
#if DT_HAS_ALIAS(led0)
#include <zephyr/drivers/gpio.h>
#endif

#include <spaghetti/communication.h>
#include <spaghetti/capabilities.h>
#include <spaghetti/config.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/data.h>
#include <spaghetti/device_profile.h>
#include <spaghetti/discovery.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/feature_pack.h>
#include <spaghetti/health.h>
#include <spaghetti/identity.h>
#include <spaghetti/enrollment.h>
#include <spaghetti/access_control.h>
#include <spaghetti/image_manifest.h>
#include <spaghetti/maintenance_link.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/ota.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/block_registry.h>
#include <spaghetti/processing.h>
#include <spaghetti/resources.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/runtime.h>
#include <spaghetti/remote_console.h>
#include <spaghetti/schema.h>
#include <spaghetti/secure_workspace.h>
#include <spaghetti/service.h>
#include <spaghetti/storage.h>
#include <spaghetti/topology.h>
#include <spaghetti/update.h>
#include <spaghetti/field_update.h>
#include <spaghetti/nfc.h>
#include <spaghetti/wifi_profiles.h>

#include "core_boot_internal.h"
#include "../services/service_registry.h"

LOG_MODULE_REGISTER(spaghetti_core, CONFIG_SPAGHETTI_CORE_LOG_LEVEL);

#if defined(CONFIG_SPAGHETTI_CONNECTIVITY_BOOT_LOW_ENERGY)
#define SPAGHETTI_CONNECTIVITY_BOOT_POLICY_VALUE \
	SPAGHETTI_CONNECTIVITY_LOW_ENERGY
#else
#define SPAGHETTI_CONNECTIVITY_BOOT_POLICY_VALUE \
	SPAGHETTI_CONNECTIVITY_ONLINE
#endif

static bool startup_config_present;
static enum spaghetti_connectivity_policy startup_connectivity_policy =
	SPAGHETTI_CONNECTIVITY_BOOT_POLICY_VALUE;
static bool core_info_available;
static struct spaghetti_core_info core_info;
static enum spaghetti_maintenance_entry_reason maintenance_reason;
static atomic_t core_state = ATOMIC_INIT(SPAGHETTI_CORE_UNINITIALIZED);
K_MUTEX_DEFINE(core_lock);

#if DT_HAS_ALIAS(led0)
static const struct gpio_dt_spec status_led =
	GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
#endif

static void status_led_on(void)
{
#if DT_HAS_ALIAS(led0)
	if (!gpio_is_ready_dt(&status_led)) {
		return;
	}
	if (gpio_pin_configure_dt(&status_led, GPIO_OUTPUT_ACTIVE) < 0) {
		LOG_WRN("status LED D5 could not be driven");
		return;
	}
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
	LOG_INF("status LED D5 idle pulse");
#else
	LOG_INF("status LED D5 on (fixed red)");
#endif
#endif
}

BUILD_ASSERT(sizeof(CONFIG_MCUBOOT_IMGTOOL_SIGN_VERSION) <=
	     SPAGHETTI_CORE_VERSION_SIZE);
static int fail_initialization(const char *component, int err)
{
	atomic_set(&core_state, SPAGHETTI_CORE_FAILED);
	LOG_ERR("%s initialization failed: err=%d", component, err);
	return err;
}

static int retain_startup_config(void)
{
	struct spaghetti_config *startup_config;
	struct spaghetti_config_failure validation_failure;
	int err;

	startup_config_present = false;
	startup_connectivity_policy = SPAGHETTI_CONNECTIVITY_BOOT_POLICY_VALUE;
	err = spaghetti_storage_probe_config();
	if (err == -ENOENT) {
		LOG_INF("no stored Config: first boot");
		return 0;
	}
	if ((err == -EBADMSG) || (err == -EPROTONOSUPPORT)) {
		LOG_WRN("stored Config is corrupt or incompatible; using empty state");
		return 0;
	}
	if (err < 0) {
		return err;
	}

	/*
	 * Heap snapshot owned by this function. Bound is one
	 * sizeof(struct spaghetti_config); freed before return. Failure
	 * leaves the live empty Config in place.
	 */
	startup_config = k_malloc(sizeof(*startup_config));
	if (startup_config == NULL) {
		return -ENOMEM;
	}
	err = spaghetti_storage_read_config(startup_config);
	if (err < 0) {
		k_free(startup_config);
		if ((err == -EBADMSG) || (err == -EPROTONOSUPPORT)) {
			LOG_WRN("stored Config is corrupt or incompatible; using empty state");
			return 0;
		}
		return err;
	}

	err = spaghetti_config_validate(startup_config, &validation_failure);
	if (err < 0) {
		LOG_WRN("stored Config invalid: field=%u index=%u reason=%u err=%d",
			(uint32_t)validation_failure.field,
			(uint32_t)validation_failure.index,
			(uint32_t)validation_failure.reason, err);
		k_free(startup_config);
		return 0;
	}

	startup_config_present = true;
	startup_connectivity_policy = startup_config->connectivity_policy;
	LOG_INF("stored Config retained: modules=%u policy=%u",
		(uint32_t)startup_config->module_count,
		(uint32_t)startup_connectivity_policy);
	k_free(startup_config);
	return 0;
}

static int select_boot_mode(const struct spaghetti_update_status *update_status)
{
	bool maintenance_requested;
	int err = spaghetti_storage_consume_maintenance_once(
		&maintenance_requested);

	if (err < 0) {
		return err;
	}
	if (!startup_config_present) {
		core_info.mode = SPAGHETTI_CORE_MODE_UNPROVISIONED;
		maintenance_reason = SPAGHETTI_MAINTENANCE_CONFIG_ABSENT;
	} else if (maintenance_requested) {
		core_info.mode = SPAGHETTI_CORE_MODE_MAINTENANCE;
		maintenance_reason = SPAGHETTI_MAINTENANCE_REBOOT_REQUEST;
	} else {
		err = spaghetti_maintenance_link_probe(
			CONFIG_SPAGHETTI_BOOTSTRAP_PROBE_MS,
			&maintenance_requested);
		if (err < 0) {
			return err;
		}
		core_info.mode = maintenance_requested ?
			SPAGHETTI_CORE_MODE_MAINTENANCE :
			SPAGHETTI_CORE_MODE_NORMAL;
		maintenance_reason = SPAGHETTI_MAINTENANCE_BOOTSTRAP_FRAME;
	}

	core_info.image_state = update_status->image_confirmed ?
		SPAGHETTI_CORE_IMAGE_CONFIRMED : SPAGHETTI_CORE_IMAGE_TRIAL;
	core_info.active_slot = update_status->active_slot;
	core_info.image_confirmed = update_status->image_confirmed;
	memcpy(core_info.version, CONFIG_MCUBOOT_IMGTOOL_SIGN_VERSION,
	       sizeof(CONFIG_MCUBOOT_IMGTOOL_SIGN_VERSION));
	return 0;
}

static const char *core_mode_name(enum spaghetti_core_mode mode)
{
	switch (mode) {
	case SPAGHETTI_CORE_MODE_UNPROVISIONED:
		return "unprovisioned";
	case SPAGHETTI_CORE_MODE_NORMAL:
		return "normal";
	case SPAGHETTI_CORE_MODE_MAINTENANCE:
		return "maintenance";
	default:
		return "unknown";
	}
}

int spaghetti_core_init(void)
{
	struct spaghetti_capabilities capabilities;
	const struct spaghetti_mqtt_config mqtt_disabled = {0};
	struct spaghetti_update_status update_status;
	int err = k_mutex_lock(&core_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (atomic_get(&core_state) != SPAGHETTI_CORE_UNINITIALIZED) {
		k_mutex_unlock(&core_lock);
		return -EALREADY;
	}
	atomic_set(&core_state, SPAGHETTI_CORE_INITIALIZING);
	core_info_available = false;
	err = spaghetti_capabilities_get(&capabilities);
	if (err < 0) {
		goto capabilities_failed;
	}
	LOG_INF("resources: profile=%u variant=%s modules=%u payload=%u caps=0x%x",
		(uint32_t)capabilities.resource_profile,
		capabilities.core_variant,
		(uint32_t)capabilities.max_modules,
		(uint32_t)capabilities.max_protocol_payload,
		capabilities.build_capabilities);
	err = spaghetti_secure_workspace_init();
	if (err < 0) {
		goto secure_workspace_failed;
	}
	err = spaghetti_feature_registry_init();
	if (err < 0) {
		goto feature_registry_failed;
	}
	err = spaghetti_image_manifest_init();
	if (err < 0) {
		goto image_manifest_failed;
	}
	err = spaghetti_resources_init();
	if (err < 0) {
		goto resources_failed;
	}

	err = spaghetti_storage_init();
	if (err < 0) {
		goto storage_failed;
	}
	err = spaghetti_identity_init();
	if (err < 0) {
		goto identity_failed;
	}
	err = spaghetti_access_control_init();
	if (err < 0) {
		goto access_control_failed;
	}
	err = spaghetti_enrollment_init();
	if (err < 0) {
		goto enrollment_failed;
	}
	err = spaghetti_update_init();
	if (err < 0) {
		goto update_failed;
	}
	err = spaghetti_update_get_status(&update_status);
	if (err < 0) {
		goto update_status_failed;
	}
	err = spaghetti_maintenance_link_init();
	if (err < 0) {
		goto maintenance_link_failed;
	}
	err = spaghetti_port_init_all();
	if (err < 0) {
		goto port_failed;
	}
	err = spaghetti_topology_init();
	if (err < 0) {
		goto topology_failed;
	}
#if defined(CONFIG_SPAGHETTI_POWER)
	err = spaghetti_power_init();
	if (err < 0) {
		goto power_failed;
	}
#endif
	err = spaghetti_device_profile_init();
	if (err < 0) {
		goto profiles_failed;
	}
	err = spaghetti_driver_registry_init();
	if (err < 0) {
		goto registry_failed;
	}
	err = spaghetti_rule_registry_init();
	if (err < 0) {
		goto rule_registry_failed;
	}
	err = spaghetti_block_registry_init();
	if (err < 0) {
		goto block_registry_failed;
	}
	err = spaghetti_module_manager_init();
	if (err < 0) {
		goto manager_failed;
	}
	err = spaghetti_data_init();
	if (err < 0) {
		goto data_failed;
	}
	err = spaghetti_processing_init();
	if (err < 0) {
		goto processing_failed;
	}
	err = spaghetti_config_init(NULL);
	if (err < 0) {
		goto config_failed;
	}
	err = retain_startup_config();
	if (err < 0) {
		goto startup_config_failed;
	}
	err = select_boot_mode(&update_status);
	if (err < 0) {
		goto boot_mode_failed;
	}
	err = spaghetti_health_init();
	if (err < 0) {
		goto health_failed;
	}

	if (core_info.mode == SPAGHETTI_CORE_MODE_NORMAL) {
		err = spaghetti_runtime_init();
		if (err < 0) {
			goto runtime_failed;
		}
		err = spaghetti_mqtt_init(&mqtt_disabled);
		if (err < 0) {
			goto mqtt_failed;
		}
		err = spaghetti_discovery_init();
		if (err < 0) {
			goto discovery_failed;
		}
		err = spaghetti_wifi_profiles_init();
		if (err < 0) {
			goto wifi_failed;
		}
		err = spaghetti_ota_init();
		if (err < 0) {
			goto ota_failed;
		}
	} else {
		err = spaghetti_wifi_profiles_init_offline();
		if (err < 0) {
			goto wifi_failed;
		}
		err = spaghetti_maintenance_link_enter(maintenance_reason);
		if (err < 0) {
			goto maintenance_enter_failed;
		}
	}
	err = spaghetti_communication_init();
	if (err < 0) {
		goto communication_failed;
	}
	if (core_info.mode == SPAGHETTI_CORE_MODE_NORMAL) {
		err = spaghetti_remote_console_init();
		if (err < 0) {
			goto remote_console_failed;
		}
		err = spaghetti_service_registry_init();
		if (err < 0) {
			goto service_registry_failed;
		}
		err = spaghetti_service_start(SPAGHETTI_SERVICE_ID_OTA);
		if (err < 0) {
			goto ota_start_failed;
		}
		err = spaghetti_connectivity_init(startup_connectivity_policy);
		if (err < 0) {
			goto connectivity_failed;
		}
	}
#if defined(CONFIG_SPAGHETTI_NFC)
	err = spaghetti_nfc_init();
	if (err < 0) {
		LOG_WRN("NFC poller not started: err=%d", err);
	}
#endif
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
	err = spaghetti_field_update_init();
	if (err < 0) {
		LOG_WRN("SLUP listener not started: err=%d", err);
	}
#endif

	status_led_on();
	atomic_set(&core_state, SPAGHETTI_CORE_READY);
	core_info.state = SPAGHETTI_CORE_READY;
	core_info_available = true;
	k_mutex_unlock(&core_lock);
	LOG_INF("boot: mode=%s image=%s slot=%u confirmed=%u version=%s",
		core_mode_name(core_info.mode),
		(core_info.image_state == SPAGHETTI_CORE_IMAGE_TRIAL) ?
			"trial" : "confirmed",
		(uint32_t)core_info.active_slot,
		core_info.image_confirmed ? 1U : 0U, core_info.version);
	LOG_INF("Spaghetti Core ready");
	return 0;

remote_console_failed:
	(void)fail_initialization("Remote Console", err);
	goto unlock;
service_registry_failed:
	(void)fail_initialization("Service Registry", err);
	goto unlock;
ota_start_failed:
	(void)fail_initialization("OTA start", err);
	goto unlock;
communication_failed:
	(void)fail_initialization("Communication", err);
	goto unlock;
ota_failed:
	(void)fail_initialization("OTA", err);
	goto unlock;
maintenance_enter_failed:
	(void)fail_initialization("Maintenance Link enter", err);
	goto unlock;
wifi_failed:
	(void)fail_initialization("Wi-Fi Profiles", err);
	goto unlock;
startup_config_failed:
	(void)fail_initialization("startup Config", err);
	goto unlock;
boot_mode_failed:
	(void)fail_initialization("boot mode", err);
	goto unlock;
health_failed:
	(void)fail_initialization("Health", err);
	goto unlock;
config_failed:
	(void)fail_initialization("Config", err);
	goto unlock;
discovery_failed:
	(void)fail_initialization("Discovery", err);
	goto unlock;
update_failed:
	(void)fail_initialization("Update", err);
	goto unlock;
update_status_failed:
	(void)fail_initialization("Update status", err);
	goto unlock;
maintenance_link_failed:
	(void)fail_initialization("Maintenance Link", err);
	goto unlock;
access_control_failed:
	(void)fail_initialization("Access Control", err);
	goto unlock;
enrollment_failed:
	(void)fail_initialization("Enrollment", err);
	goto unlock;
identity_failed:
	(void)fail_initialization("Identity", err);
	goto unlock;
storage_failed:
	(void)fail_initialization("Storage", err);
	goto unlock;
resources_failed:
	(void)fail_initialization("Resources", err);
	goto unlock;
image_manifest_failed:
	(void)fail_initialization("Image Manifest", err);
	goto unlock;
feature_registry_failed:
	(void)fail_initialization("Feature Registry", err);
	goto unlock;
mqtt_failed:
	(void)fail_initialization("MQTT", err);
	goto unlock;
runtime_failed:
	(void)fail_initialization("Runtime", err);
	goto unlock;
data_failed:
	(void)fail_initialization("Data", err);
	goto unlock;
processing_failed:
	(void)fail_initialization("Processing", err);
	goto unlock;
manager_failed:
	(void)fail_initialization("Module Manager", err);
	goto unlock;
block_registry_failed:
	(void)fail_initialization("Block Registry", err);
	goto unlock;
rule_registry_failed:
	(void)fail_initialization("Rule Registry", err);
	goto unlock;
registry_failed:
	(void)fail_initialization("Driver Registry", err);
	goto unlock;
profiles_failed:
	(void)fail_initialization("Device Profiles", err);
	goto unlock;
#if defined(CONFIG_SPAGHETTI_POWER)
power_failed:
	(void)fail_initialization("Power", err);
	goto unlock;
#endif
topology_failed:
	(void)fail_initialization("Topology", err);
	goto unlock;
port_failed:
	(void)fail_initialization("Port", err);
	goto unlock;
connectivity_failed:
	(void)fail_initialization("Connectivity", err);
	goto unlock;
secure_workspace_failed:
	(void)fail_initialization("Secure Workspace", err);
	goto unlock;
capabilities_failed:
	(void)fail_initialization("Capabilities", err);

unlock:
	k_mutex_unlock(&core_lock);
	return err;
}

int spaghetti_core_start(void)
{
	bool confirm_trial;
	struct spaghetti_config_revision revision;
	int err = k_mutex_lock(&core_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (atomic_get(&core_state) != SPAGHETTI_CORE_READY) {
		k_mutex_unlock(&core_lock);
		return -EACCES;
	}

	if ((core_info.mode == SPAGHETTI_CORE_MODE_NORMAL) &&
	    startup_config_present) {
		struct spaghetti_config *startup_config =
			spaghetti_config_acquire_workspace();

		if (startup_config == NULL) {
			LOG_WRN("stored Config not applied; empty state remains live: "
				"err=%d",
				-ENOMEM);
		} else {
			err = spaghetti_config_get_snapshot(startup_config,
							    &revision);
			if (err == 0) {
				err = spaghetti_storage_read_config(
					startup_config);
			}
			if (err == 0) {
				err = spaghetti_config_apply(
					startup_config, revision.generation,
					NULL);
			}
			spaghetti_config_release_workspace(startup_config);
			if (err < 0) {
				LOG_WRN("stored Config not applied; empty state remains live: "
					"err=%d",
					err);
			}
		}
	}

	atomic_set(&core_state, SPAGHETTI_CORE_RUNNING);
	core_info.state = SPAGHETTI_CORE_RUNNING;
	confirm_trial =
		core_info.image_state == SPAGHETTI_CORE_IMAGE_TRIAL;
	k_mutex_unlock(&core_lock);

	if (confirm_trial) {
		k_sleep(K_MSEC(CONFIG_SPAGHETTI_TRIAL_HEALTH_MS));
		if (atomic_get(&core_state) != SPAGHETTI_CORE_RUNNING) {
			return -EIO;
		}
		err = spaghetti_update_confirm_trial();
		if (err < 0) {
			atomic_set(&core_state, SPAGHETTI_CORE_FAILED);
			spaghetti_core_boot_reboot();
			return err;
		}

		(void)k_mutex_lock(&core_lock, K_FOREVER);
		core_info.state = SPAGHETTI_CORE_RUNNING;
		core_info.image_state = SPAGHETTI_CORE_IMAGE_CONFIRMED;
		core_info.image_confirmed = true;
		k_mutex_unlock(&core_lock);
	}

	if (core_info.mode == SPAGHETTI_CORE_MODE_NORMAL) {
		err = spaghetti_wifi_profiles_request_connect();
		if ((err < 0) && (err != -ENOENT) && (err != -ENOTSUP)) {
			LOG_WRN("Wi-Fi auto-connect was not started: err=%d", err);
		}
	}

	err = spaghetti_health_start();
	if (err < 0) {
		atomic_set(&core_state, SPAGHETTI_CORE_FAILED);
		LOG_ERR("Health supervisor start failed: err=%d", err);
		return err;
	}

	return 0;
}

enum spaghetti_core_state spaghetti_core_get_state(void)
{
	return (enum spaghetti_core_state)atomic_get(&core_state);
}

int spaghetti_core_get_info(struct spaghetti_core_info *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&core_lock, K_FOREVER);
	if (!core_info_available) {
		k_mutex_unlock(&core_lock);
		return -EAGAIN;
	}
	core_info.state = (enum spaghetti_core_state)atomic_get(&core_state);
	*out = core_info;
	k_mutex_unlock(&core_lock);
	return 0;
}
