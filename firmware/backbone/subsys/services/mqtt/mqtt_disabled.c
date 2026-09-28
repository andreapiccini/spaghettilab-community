#include <spaghetti/mqtt.h>
#include <spaghetti/mqtt_credentials.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

#include <spaghetti/access_control.h>

static bool initialized;
static struct spaghetti_mqtt_config current_config;
static struct spaghetti_mqtt_status current_status = {
	.state = SPAGHETTI_MQTT_STOPPED,
};

uint32_t spaghetti_mqtt_adapter_permissions(void)
{
	return SPAGHETTI_PERMISSION_READ | SPAGHETTI_PERMISSION_CONFIGURE |
	       SPAGHETTI_PERMISSION_COMMAND | SPAGHETTI_PERMISSION_DISCOVER;
}

int spaghetti_mqtt_init(const struct spaghetti_mqtt_config *config)
{
	if (config == NULL) {
		return -EINVAL;
	}
	if (config->enabled) {
		return -ENOTSUP;
	}
	if (initialized) {
		return -EBUSY;
	}

	current_config = *config;
	current_status = (struct spaghetti_mqtt_status) {
		.state = SPAGHETTI_MQTT_STOPPED,
	};
	initialized = true;
	return 0;
}

int spaghetti_mqtt_start(void)
{
	return -EACCES;
}

int spaghetti_mqtt_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	return initialized ? -EALREADY : -EACCES;
}

int spaghetti_mqtt_publish(
	const struct spaghetti_mqtt_publication *publication)
{
	ARG_UNUSED(publication);
	return initialized ? -ENOTSUP : -EACCES;
}

int spaghetti_mqtt_get_status(struct spaghetti_mqtt_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	if (!initialized) {
		return -EACCES;
	}

	*out = current_status;
	return 0;
}

int spaghetti_mqtt_set_credentials(
	const uint8_t *psk, size_t psk_size,
	const char *identity,
	spaghetti_principal_id_t principal_id)
{
	ARG_UNUSED(identity);

	if ((psk == NULL) || (psk_size != SPAGHETTI_MQTT_PSK_SIZE)) {
		return -EINVAL;
	}
	return spaghetti_mqtt_credentials_set(1U, principal_id, psk, psk_size,
					      NULL, 0U, NULL, 0U);
}

int spaghetti_mqtt_rotate_credentials(
	const uint8_t *psk, size_t psk_size,
	const char *identity)
{
	ARG_UNUSED(psk);
	ARG_UNUSED(psk_size);
	ARG_UNUSED(identity);
	return -ENOTSUP;
}

int spaghetti_mqtt_clear_credentials(void)
{
	return spaghetti_mqtt_credentials_erase_all();
}

int spaghetti_mqtt_delete_credentials_for_principal(
	spaghetti_principal_id_t principal_id)
{
	return spaghetti_mqtt_credentials_delete_for_principal(principal_id);
}

int spaghetti_mqtt_get_credential_metadata(
	struct spaghetti_mqtt_credential_metadata *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	*out = (struct spaghetti_mqtt_credential_metadata) {0};
	return 0;
}
