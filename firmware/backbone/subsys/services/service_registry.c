#include "service_registry.h"

#include <spaghetti/service.h>

#include <errno.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

#include <spaghetti/capabilities.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/ble.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/ota.h>
#include <spaghetti/remote_console.h>
#include <spaghetti/wifi_profiles.h>

#include "../connectivity/connectivity_internal.h"

static int wifi_start(void)
{
	const int err = spaghetti_wifi_profiles_start();

	return err;
}

static int wifi_stop(k_timeout_t timeout)
{
	return spaghetti_wifi_profiles_stop(timeout);
}

static int mqtt_start(void)
{
	const int err = spaghetti_mqtt_start();

	return (err == -EACCES) ? 0 : err;
}

static int mqtt_stop(k_timeout_t timeout)
{
	const int err = spaghetti_mqtt_stop(timeout);

	return (err == -EALREADY) ? 0 : err;
}

static int ota_stop(k_timeout_t timeout)
{
	const int err = spaghetti_ota_stop(timeout);

	return (err == -EALREADY) ? 0 : err;
}

static const struct spaghetti_service_ops wifi_ops = {
	.start = wifi_start,
	.stop = wifi_stop,
};

static const struct spaghetti_service_ops mqtt_ops = {
	.start = mqtt_start,
	.stop = mqtt_stop,
};

static const struct spaghetti_service_ops ota_ops = {
	.start = spaghetti_ota_start,
	.stop = ota_stop,
};

static const struct spaghetti_service_ops remote_console_ops = {
	.start = spaghetti_remote_console_start,
	.stop = spaghetti_remote_console_stop,
};

static const struct spaghetti_service_descriptor descriptors[] = {
	{
		.id = SPAGHETTI_SERVICE_ID_WIFI,
		.required_capabilities = SPAGHETTI_BUILD_CAP_WIFI,
		.ops = &wifi_ops,
	},
	{
		.id = SPAGHETTI_SERVICE_ID_MQTT,
		.required_capabilities = SPAGHETTI_BUILD_CAP_WIFI |
			SPAGHETTI_BUILD_CAP_MQTT,
		.ops = &mqtt_ops,
	},
	{
		.id = SPAGHETTI_SERVICE_ID_OTA,
		.required_capabilities = SPAGHETTI_BUILD_CAP_WIFI |
			SPAGHETTI_BUILD_CAP_OTA_WIFI,
		.ops = &ota_ops,
	},
	{
		.id = SPAGHETTI_SERVICE_ID_REMOTE_CONSOLE,
		.required_capabilities = SPAGHETTI_BUILD_CAP_WIFI |
			SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE,
		.ops = &remote_console_ops,
	},
};

static const char *service_id(
	enum spaghetti_connectivity_service service)
{
	switch (service) {
	case SPAGHETTI_CONNECTIVITY_SERVICE_WIFI:
		return SPAGHETTI_SERVICE_ID_WIFI;
	case SPAGHETTI_CONNECTIVITY_SERVICE_MQTT:
		return SPAGHETTI_SERVICE_ID_MQTT;
	case SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE:
		return SPAGHETTI_SERVICE_ID_REMOTE_CONSOLE;
	case SPAGHETTI_CONNECTIVITY_SERVICE_BLE:
	default:
		return NULL;
	}
}

static int connectivity_start(
	enum spaghetti_connectivity_service service)
{
	const char *id;
	int err;

	if (service == SPAGHETTI_CONNECTIVITY_SERVICE_BLE) {
		err = spaghetti_ble_start();
		return ((err == 0) || (err == -EALREADY) ||
			(err == -ENOTSUP)) ? 0 : err;
	}

	id = service_id(service);
	if (id == NULL) {
		return -EINVAL;
	}
	err = spaghetti_service_start(id);
	return (err == -EALREADY) ? 0 : err;
}

static int connectivity_stop(
	enum spaghetti_connectivity_service service)
{
	const char *id;
	int err;

	if (service == SPAGHETTI_CONNECTIVITY_SERVICE_BLE) {
		err = spaghetti_ble_stop(
			K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
		return ((err == 0) || (err == -EALREADY) ||
			(err == -ENOTSUP)) ? 0 : err;
	}

	id = service_id(service);
	if (id == NULL) {
		return -EINVAL;
	}
	err = spaghetti_service_stop(
		id, K_MSEC(CONFIG_SPAGHETTI_SERVICE_STOP_MAX_MS));
	return (err == -EALREADY) ? 0 : err;
}

int spaghetti_service_registry_init(void)
{
	static const struct spaghetti_connectivity_backend backend = {
		.start = connectivity_start,
		.stop = connectivity_stop,
	};
	int err = spaghetti_service_manager_init(
		descriptors, ARRAY_SIZE(descriptors));

	if (err < 0) {
		return err;
	}
	return spaghetti_connectivity_backend_install(&backend);
}
