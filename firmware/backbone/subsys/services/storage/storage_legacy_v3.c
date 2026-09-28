/* Legacy V3 Storage blob converter kept for migration only.
 * REMOVE AFTER: 2026-12-31 (or after every device has rewritten Config as V5+).
 * Do not extend; new persistence uses the typed Config CBOR path.
 */

#include "storage_legacy_v3.h"

#include <errno.h>
#include <string.h>

#include <zephyr/logging/log.h>

#include <spaghetti/power.h>
#include <spaghetti/topology.h>

#include "../../config/legacy_driver_config.h"

LOG_MODULE_DECLARE(spaghetti_storage, CONFIG_SPAGHETTI_STORAGE_LOG_LEVEL);

/* Legacy V3 field IDs kept numeric so migration needs no driver headers. */
enum {
	LEGACY_INA219_CURRENT_FIELD_ID = 2U,
	LEGACY_RELAY_COMMAND_SET = 1U,
	LEGACY_RELAY_COMMAND_FIELD_ON = 1U,
};

static bool type_id_is_terminated(const char *type_id)
{
	return memchr(type_id, '\0', SPAGHETTI_STORAGE_LEGACY_TYPE_ID_SIZE) !=
	       NULL;
}

static int convert_legacy_threshold(
	const struct spaghetti_storage_legacy_threshold_config *legacy,
	struct spaghetti_rule_config *out)
{
	if ((legacy->source_key == 0U) || (legacy->relay_key == 0U) ||
	    (legacy->lower_current_microamps >=
	     legacy->upper_current_microamps)) {
		return -EPROTONOSUPPORT;
	}

	memset(out, 0, sizeof(*out));
	out->key = 1U;
	memcpy(out->type_id, "threshold", sizeof("threshold"));
	out->properties.field_count = 8U;
	out->properties.fields[0] = (struct spaghetti_value){
		.field_id = 1U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = legacy->source_key,
	};
	out->properties.fields[1] = (struct spaghetti_value){
		.field_id = 2U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = LEGACY_INA219_CURRENT_FIELD_ID,
	};
	out->properties.fields[2] = (struct spaghetti_value){
		.field_id = 3U,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = legacy->lower_current_microamps,
	};
	out->properties.fields[3] = (struct spaghetti_value){
		.field_id = 4U,
		.type = SPAGHETTI_VALUE_INT64,
		.data.signed_integer = legacy->upper_current_microamps,
	};
	out->properties.fields[4] = (struct spaghetti_value){
		.field_id = 5U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = legacy->relay_key,
	};
	out->properties.fields[5] = (struct spaghetti_value){
		.field_id = 6U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = LEGACY_RELAY_COMMAND_SET,
	};
	out->properties.fields[6] = (struct spaghetti_value){
		.field_id = 7U,
		.type = SPAGHETTI_VALUE_UINT64,
		.data.unsigned_integer = LEGACY_RELAY_COMMAND_FIELD_ON,
	};
	out->properties.fields[7] = (struct spaghetti_value){
		.field_id = 8U,
		.type = SPAGHETTI_VALUE_BOOL,
		.data.boolean = legacy->relay_on_above,
	};

	return 0;
}

int spaghetti_storage_legacy_v3_convert(
	const uint8_t *bytes,
	size_t length,
	struct spaghetti_config *out)
{
	struct spaghetti_storage_legacy_record legacy;
	int err;

	if ((bytes == NULL) || (out == NULL)) {
		return -EINVAL;
	}
	if (length != sizeof(legacy)) {
		return -EBADMSG;
	}

	memcpy(&legacy, bytes, sizeof(legacy));
	if ((legacy.magic != SPAGHETTI_STORAGE_RECORD_MAGIC_V3) ||
	    (legacy.version != 3U) || (legacy.config.version != 3U)) {
		return -EBADMSG;
	}
	if (legacy.config.module_count > CONFIG_SPAGHETTI_MAX_MODULES) {
		return -EPROTONOSUPPORT;
	}

	memset(out, 0, sizeof(*out));
	out->version = SPAGHETTI_CONFIG_VERSION;
	out->connectivity_policy = SPAGHETTI_CONNECTIVITY_ONLINE;
	out->energy_policy.ble_availability = SPAGHETTI_BLE_OFF;

	out->module_count = legacy.config.module_count;
	for (size_t module_idx = 0U; module_idx < legacy.config.module_count;
	     ++module_idx) {
		const struct spaghetti_storage_legacy_module_config *source =
			&legacy.config.modules[module_idx];
		struct spaghetti_module_config *destination =
			&out->modules[module_idx];

		if ((source->key == 0U) ||
		    !type_id_is_terminated(source->type_id) ||
		    (source->driver_config_size == 0U) ||
		    (source->driver_config_size >
		     SPAGHETTI_STORAGE_LEGACY_DRIVER_CONFIG_MAX)) {
			return -EPROTONOSUPPORT;
		}

		destination->key = source->key;
		destination->port_id = source->port_id;
		destination->bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
		destination->power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
		memcpy(destination->type_id, source->type_id,
		       strlen(source->type_id) + 1U);

		err = spaghetti_legacy_driver_config_bytes_to_properties(
			source->type_id, source->driver_config,
			source->driver_config_size, &destination->properties);
		if (err < 0) {
			return (err == -ENOTSUP) ? -EPROTONOSUPPORT : err;
		}
	}

	out->schedules[0].enabled = legacy.config.sampling.enabled;
	out->schedules[0].source_key = legacy.config.sampling.source_key;
	out->schedules[0].period_ms = legacy.config.sampling.period_ms;
	out->schedule_count = 1U;
	out->mqtt = legacy.config.mqtt;

	if (legacy.config.threshold_rule.enabled) {
		err = convert_legacy_threshold(&legacy.config.threshold_rule,
					       &out->rules[0]);
		if (err < 0) {
			return err;
		}
		out->rule_count = 1U;
	}

	return spaghetti_config_validate(out, NULL);
}
