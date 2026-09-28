#ifndef SPAGHETTI_STORAGE_LEGACY_V3_H
#define SPAGHETTI_STORAGE_LEGACY_V3_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <spaghetti/config.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/port.h>

#define SPAGHETTI_STORAGE_RECORD_MAGIC_V3 0x53504754U
#define SPAGHETTI_STORAGE_LEGACY_TYPE_ID_SIZE 24U
#define SPAGHETTI_STORAGE_LEGACY_DRIVER_CONFIG_MAX 64U

struct spaghetti_storage_legacy_module_config {
	spaghetti_module_key_t key;
	spaghetti_port_id_t port_id;
	char type_id[SPAGHETTI_STORAGE_LEGACY_TYPE_ID_SIZE];
	size_t driver_config_size;
	uint8_t driver_config[SPAGHETTI_STORAGE_LEGACY_DRIVER_CONFIG_MAX];
};

struct spaghetti_storage_legacy_sampling_config {
	bool enabled;
	spaghetti_module_key_t source_key;
	uint32_t period_ms;
};

struct spaghetti_storage_legacy_threshold_config {
	bool enabled;
	spaghetti_module_key_t source_key;
	int32_t lower_current_microamps;
	int32_t upper_current_microamps;
	spaghetti_module_key_t relay_key;
	bool relay_on_above;
};

struct spaghetti_storage_legacy_config {
	uint32_t version;
	size_t module_count;
	struct spaghetti_storage_legacy_module_config
		modules[CONFIG_SPAGHETTI_MAX_MODULES];
	struct spaghetti_storage_legacy_sampling_config sampling;
	struct spaghetti_storage_legacy_threshold_config threshold_rule;
	struct spaghetti_mqtt_config mqtt;
};

struct spaghetti_storage_legacy_record {
	uint32_t magic;
	uint32_t version;
	struct spaghetti_storage_legacy_config config;
};

/**
 * @brief Convert a raw legacy V3 storage blob into the current Config model.
 *
 * @param[in] bytes Borrowed raw settings value.
 * @param[in] length Exact byte length of @p bytes.
 * @param[out] out Caller-owned Config written only on success.
 *
 * @retval 0 Conversion and semantic validation succeeded.
 * @retval -EBADMSG The blob is truncated or has the wrong magic/shape.
 * @retval -EPROTONOSUPPORT The layout cannot be converted.
 * @retval -errno Propagated from property conversion or Config validation.
 */
int spaghetti_storage_legacy_v3_convert(
	const uint8_t *bytes,
	size_t length,
	struct spaghetti_config *out);

#endif /* SPAGHETTI_STORAGE_LEGACY_V3_H */
