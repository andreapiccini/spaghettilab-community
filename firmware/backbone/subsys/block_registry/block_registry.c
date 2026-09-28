#include <spaghetti/block_registry.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/logging/log.h>
#include <zephyr/sys/iterable_sections.h>
#include <zephyr/sys/util.h>

#include <spaghetti/block_driver.h>
#include <spaghetti/module.h>
#include <spaghetti/schema.h>

#include "block_registry_internal.h"

LOG_MODULE_REGISTER(spaghetti_block_registry,
		    CONFIG_SPAGHETTI_BLOCK_REGISTRY_LOG_LEVEL);

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

static int ports_are_valid(
	const struct spaghetti_block_port_descriptor *ports,
	size_t port_count)
{
	if ((ports == NULL) && (port_count != 0U)) {
		return -EINVAL;
	}
	if (port_count > SPAGHETTI_BLOCK_MAX_PORTS) {
		return -EINVAL;
	}

	for (size_t idx = 0U; idx < port_count; ++idx) {
		if ((ports[idx].name == NULL) || (ports[idx].name[0] == '\0') ||
		    (ports[idx].accepted_types == 0U)) {
			return -EINVAL;
		}
		for (size_t other = idx + 1U; other < port_count; ++other) {
			if (ports[idx].port_id == ports[other].port_id) {
				return -EINVAL;
			}
		}
	}

	return 0;
}

static int validate_one_driver(const struct spaghetti_block_driver *driver)
{
	int err;

	if ((driver == NULL) || !type_id_is_valid(driver->type_id) ||
	    (driver->api_version != SPAGHETTI_BLOCK_DRIVER_API_VERSION) ||
	    (driver->algorithm_version == 0U) ||
	    (driver->ops == NULL) || (driver->config_schema == NULL) ||
	    (driver->ops->validate == NULL) || (driver->ops->init == NULL) ||
	    (driver->ops->process == NULL) || (driver->ops->reset == NULL) ||
	    (driver->ops->deinit == NULL) ||
	    (driver->state_size > SPAGHETTI_BLOCK_STATE_MAX) ||
	    (driver->workspace_size > SPAGHETTI_BLOCK_WORKSPACE_MAX) ||
	    ((driver->state_size > 0U) && (driver->state_align == 0U)) ||
	    ((driver->state_align & (driver->state_align - 1U)) != 0U)) {
		return -EINVAL;
	}

	err = schema_descriptor_is_usable(driver->config_schema);
	if (err < 0) {
		return err;
	}
	err = ports_are_valid(driver->inputs, driver->input_count);
	if (err < 0) {
		return err;
	}
	err = ports_are_valid(driver->outputs, driver->output_count);
	if (err < 0) {
		return err;
	}

	return 0;
}

int spaghetti_block_registry_validate(
	const struct spaghetti_block_driver *const *entries,
	size_t entry_count)
{
	if ((entries == NULL) && (entry_count != 0U)) {
		return -EINVAL;
	}

	for (size_t driver_idx = 0U; driver_idx < entry_count; ++driver_idx) {
		const struct spaghetti_block_driver *driver = entries[driver_idx];
		int err = validate_one_driver(driver);

		if (err < 0) {
			return err;
		}

		for (size_t other_idx = driver_idx + 1U; other_idx < entry_count;
		     ++other_idx) {
			const struct spaghetti_block_driver *other =
				entries[other_idx];

			if ((other != NULL) && type_id_is_valid(other->type_id) &&
			    (strcmp(driver->type_id, other->type_id) == 0)) {
				return -EINVAL;
			}
		}
	}

	return 0;
}

int spaghetti_block_registry_init(void)
{
	size_t count = 0U;

	STRUCT_SECTION_FOREACH(spaghetti_block_driver, driver) {
		int err = validate_one_driver(driver);

		if (err < 0) {
			return err;
		}

		STRUCT_SECTION_FOREACH(spaghetti_block_driver, other) {
			if ((other != driver) &&
			    (strcmp(driver->type_id, other->type_id) == 0)) {
				return -EINVAL;
			}
		}
		count += 1U;
	}

	LOG_INF("ready: blocks=%u", (uint32_t)count);
	return 0;
}

const struct spaghetti_block_driver *spaghetti_block_registry_find(
	const char *type_id)
{
	if (!type_id_is_valid(type_id)) {
		return NULL;
	}

	STRUCT_SECTION_FOREACH(spaghetti_block_driver, driver) {
		if (strcmp(driver->type_id, type_id) == 0) {
			return driver;
		}
	}

	return NULL;
}

size_t spaghetti_block_registry_count(void)
{
	size_t count = 0U;

	STRUCT_SECTION_FOREACH(spaghetti_block_driver, driver) {
		ARG_UNUSED(driver);
		count += 1U;
	}

	return count;
}

const struct spaghetti_block_driver *spaghetti_block_registry_get(size_t index)
{
	size_t current = 0U;

	STRUCT_SECTION_FOREACH(spaghetti_block_driver, driver) {
		if (current == index) {
			return driver;
		}
		current += 1U;
	}

	return NULL;
}
