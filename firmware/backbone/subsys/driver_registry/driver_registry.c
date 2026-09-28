#include <spaghetti/driver_registry.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/logging/log.h>
#include <zephyr/sys/iterable_sections.h>
#include <zephyr/sys/util.h>

#include <spaghetti/module.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/schema.h>

#include "driver_registry_internal.h"

LOG_MODULE_REGISTER(spaghetti_driver_registry,
		    CONFIG_SPAGHETTI_DRIVER_REGISTRY_LOG_LEVEL);

static bool type_id_is_valid(const char *type_id)
{
	if (type_id == NULL) {
		return false;
	}

	for (size_t char_idx = 0U; char_idx < SPAGHETTI_TYPE_ID_MAX; ++char_idx) {
		if (type_id[char_idx] == '\0') {
			return char_idx > 0U;
		}
	}

	return false;
}

static int schema_descriptor_is_usable(
	const struct spaghetti_schema_descriptor *schema)
{
	struct spaghetti_property_set empty = { 0 };
	int err = spaghetti_property_validate(&empty, schema);

	return ((err == 0) || (err == -ENOENT)) ? 0 : -EINVAL;
}

static int validate_one_driver(const struct spaghetti_module_driver *driver)
{
	bool has_start;
	bool has_stop;
	int err;

	if ((driver == NULL) || !type_id_is_valid(driver->type_id) ||
	    (driver->api_version != SPAGHETTI_MODULE_DRIVER_API_VERSION) ||
	    (driver->ops == NULL) || (driver->config_schema == NULL) ||
	    (driver->ops->validate_config == NULL) ||
	    (driver->ops->describe_endpoint == NULL) ||
	    (driver->ops->init == NULL) || (driver->ops->deinit == NULL)) {
		return -EINVAL;
	}

	if (((driver->record_schemas == NULL) !=
	     (driver->record_schema_count == 0U)) ||
	    ((driver->commands == NULL) != (driver->command_count == 0U))) {
		return -EINVAL;
	}

	if ((driver->ops->read == NULL) && (driver->ops->command == NULL) &&
	    (driver->ops->start == NULL)) {
		return -EINVAL;
	}

	if ((driver->ops->read != NULL) && (driver->record_schema_count == 0U)) {
		return -EINVAL;
	}
	if ((driver->ops->read == NULL) && (driver->record_schema_count != 0U)) {
		return -EINVAL;
	}
	if ((driver->ops->command != NULL) && (driver->command_count == 0U)) {
		return -EINVAL;
	}
	if ((driver->ops->command == NULL) && (driver->command_count != 0U)) {
		return -EINVAL;
	}

	has_start = driver->ops->start != NULL;
	has_stop = driver->ops->stop != NULL;
	if (has_start != has_stop) {
		return -EINVAL;
	}

	err = schema_descriptor_is_usable(driver->config_schema);
	if (err < 0) {
		return err;
	}

	for (size_t idx = 0U; idx < driver->record_schema_count; ++idx) {
		if (driver->record_schemas[idx] == NULL) {
			return -EINVAL;
		}
		err = schema_descriptor_is_usable(driver->record_schemas[idx]);
		if (err < 0) {
			return err;
		}
	}

	for (size_t idx = 0U; idx < driver->command_count; ++idx) {
		const struct spaghetti_command_descriptor *command =
			&driver->commands[idx];

		if ((command->name == NULL) ||
		    (command->argument_schema == NULL)) {
			return -EINVAL;
		}
		err = schema_descriptor_is_usable(command->argument_schema);
		if (err < 0) {
			return err;
		}
	}

	return 0;
}

int spaghetti_driver_registry_validate(
	const struct spaghetti_module_driver *const *entries,
	size_t entry_count)
{
	if ((entries == NULL) || (entry_count == 0U)) {
		return -EINVAL;
	}

	for (size_t driver_idx = 0U; driver_idx < entry_count; ++driver_idx) {
		const struct spaghetti_module_driver *driver = entries[driver_idx];
		int err = validate_one_driver(driver);

		if (err < 0) {
			return err;
		}

		for (size_t other_idx = driver_idx + 1U; other_idx < entry_count;
		     ++other_idx) {
			const struct spaghetti_module_driver *other =
				entries[other_idx];

			if ((other != NULL) && type_id_is_valid(other->type_id) &&
			    (strcmp(driver->type_id, other->type_id) == 0)) {
				return -EINVAL;
			}
		}
	}

	return 0;
}

int spaghetti_driver_registry_init(void)
{
	size_t count = 0U;

	STRUCT_SECTION_FOREACH(spaghetti_module_driver, driver) {
		int err = validate_one_driver(driver);

		if (err < 0) {
			LOG_ERR("invalid driver type_id=%s err=%d",
				(driver != NULL) && (driver->type_id != NULL) ?
					driver->type_id :
					"(null)",
				err);
			return err;
		}

		STRUCT_SECTION_FOREACH(spaghetti_module_driver, other) {
			if ((other != driver) &&
			    (strcmp(driver->type_id, other->type_id) == 0)) {
				LOG_ERR("duplicate driver type_id=%s",
					driver->type_id);
				return -EINVAL;
			}
		}
		count += 1U;
	}

	if (count == 0U) {
		LOG_ERR("no module drivers registered");
		return -EINVAL;
	}

	LOG_INF("ready: drivers=%u", (uint32_t)count);
	return 0;
}

const struct spaghetti_module_driver *spaghetti_driver_registry_find(
	const char *type_id)
{
	if (!type_id_is_valid(type_id)) {
		return NULL;
	}

	STRUCT_SECTION_FOREACH(spaghetti_module_driver, driver) {
		if (strcmp(driver->type_id, type_id) == 0) {
			return driver;
		}
	}

	return NULL;
}

size_t spaghetti_driver_registry_count(void)
{
	size_t count = 0U;

	STRUCT_SECTION_FOREACH(spaghetti_module_driver, driver) {
		ARG_UNUSED(driver);
		count += 1U;
	}

	return count;
}

const struct spaghetti_module_driver *spaghetti_driver_registry_get(size_t index)
{
	size_t current = 0U;

	STRUCT_SECTION_FOREACH(spaghetti_module_driver, driver) {
		if (current == index) {
			return driver;
		}
		current += 1U;
	}

	return NULL;
}
