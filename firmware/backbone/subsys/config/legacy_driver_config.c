#include "legacy_driver_config.h"

#include <errno.h>
#include <string.h>

#include <ina219.h>
#include <relay.h>

int spaghetti_legacy_driver_config_bytes_to_properties(
	const char *type_id,
	const void *bytes,
	size_t size,
	struct spaghetti_property_set *out)
{
	if ((type_id == NULL) || (bytes == NULL) || (out == NULL) || (size == 0U)) {
		return -EINVAL;
	}

	if (strcmp(type_id, "ina219") == 0) {
		struct spaghetti_ina219_config config;

		if (size != sizeof(config)) {
			return -EINVAL;
		}

		memcpy(&config, bytes, sizeof(config));
		return spaghetti_ina219_config_to_properties(&config, out);
	}

	if (strcmp(type_id, "relay") == 0) {
		struct spaghetti_relay_config config;

		if (size != sizeof(config)) {
			return -EINVAL;
		}

		memcpy(&config, bytes, sizeof(config));
		return spaghetti_relay_config_to_properties(&config, out);
	}

	return -ENOTSUP;
}
