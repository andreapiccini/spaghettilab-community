#include <spaghetti/module_manager.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/driver_registry.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/resources.h>
#include <spaghetti/schema.h>
#include <spaghetti/topology.h>

LOG_MODULE_REGISTER(spaghetti_module_manager,
		    CONFIG_SPAGHETTI_MODULE_MANAGER_LOG_LEVEL);

struct spaghetti_module_slot {
	bool used;
	bool reserved;
	bool busy;
	bool power_attached;
	bool events_started;
	spaghetti_port_id_t port_id;
	spaghetti_flow_id_t flow_id;
	struct spaghetti_module_placement placement;
	enum spaghetti_power_admission_state power_admission;
	uint32_t revision;
	uint32_t read_sequence;
	struct spaghetti_module module;
};

static struct spaghetti_module_slot slots[CONFIG_SPAGHETTI_MAX_MODULES];
static bool is_initialized;
K_MUTEX_DEFINE(slots_lock);

BUILD_ASSERT(CONFIG_SPAGHETTI_MAX_MODULES <= (UINT8_MAX + 1U));

static uint16_t count_used_modules_locked(void)
{
	uint16_t used = 0U;

	for (size_t idx = 0U; idx < ARRAY_SIZE(slots); ++idx) {
		if (slots[idx].used) {
			++used;
		}
	}

	return used;
}

static bool endpoint_is_valid(const struct spaghetti_module_endpoint *endpoint)
{
	switch (endpoint->kind) {
	case SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE:
	case SPAGHETTI_ENDPOINT_UART_EXCLUSIVE:
		return endpoint->value_size == 0U;
	case SPAGHETTI_ENDPOINT_I2C_ADDRESS:
		return (endpoint->value_size == 1U) &&
		       (endpoint->value[0] <= 0x7FU);
	case SPAGHETTI_ENDPOINT_SPI_CHIP_SELECT:
		return (endpoint->value_size == 1U) &&
		       (endpoint->value[0] <= 4U);
	case SPAGHETTI_ENDPOINT_GPIO_LINE:
	case SPAGHETTI_ENDPOINT_ADC_CHANNEL:
		return (endpoint->value_size == 1U) &&
		       (endpoint->value[0] <= 4U);
	case SPAGHETTI_ENDPOINT_W1_ROM:
		return endpoint->value_size == SPAGHETTI_ENDPOINT_VALUE_MAX;
	default:
		return false;
	}
}

static bool endpoints_conflict(
	const struct spaghetti_module_endpoint *first,
	const struct spaghetti_module_endpoint *second)
{
	if ((first->kind == SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE) ||
	    (second->kind == SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE) ||
	    (first->kind == SPAGHETTI_ENDPOINT_UART_EXCLUSIVE) ||
	    (second->kind == SPAGHETTI_ENDPOINT_UART_EXCLUSIVE)) {
		return true;
	}

	return (first->kind == second->kind) &&
	       (first->value_size == second->value_size) &&
	       (memcmp(first->value, second->value, first->value_size) == 0);
}

static uint32_t endpoint_log_value(
	const struct spaghetti_module_endpoint *endpoint)
{
	uint32_t value = 0U;
	const size_t copy_size = MIN(endpoint->value_size, sizeof(value));

	if (copy_size > 0U) {
		memcpy(&value, endpoint->value, copy_size);
	}

	return value;
}

static struct spaghetti_module_slot *find_slot_by_id(spaghetti_module_id_t id)
{
	const size_t slot_idx = (size_t)id;

	if ((slot_idx >= ARRAY_SIZE(slots)) || !slots[slot_idx].used) {
		return NULL;
	}

	return &slots[slot_idx];
}

static void copy_snapshot(const struct spaghetti_module_slot *slot,
			  struct spaghetti_module_snapshot *out)
{
	struct spaghetti_module_snapshot snapshot = {
		.id = slot->module.id,
		.key = slot->module.key,
		.port_id = slot->port_id,
		.flow_id = slot->flow_id,
		.placement = slot->placement,
		.power_admission = slot->power_admission,
		.endpoint = slot->module.endpoint,
		.state = slot->module.state,
		.revision = slot->revision,
	};
	size_t type_id_len = 0U;

	while ((type_id_len < (SPAGHETTI_TYPE_ID_MAX - 1U)) &&
	       (slot->module.driver->type_id[type_id_len] != '\0')) {
		++type_id_len;
	}

	memcpy(snapshot.type_id, slot->module.driver->type_id, type_id_len);
	snapshot.type_id[type_id_len] = '\0';
	*out = snapshot;
}

static int validate_placement(
	spaghetti_port_id_t port_id,
	const struct spaghetti_module_placement *placement,
	spaghetti_flow_id_t *out_flow_id)
{
	const struct spaghetti_flow_descriptor *flow;
	struct spaghetti_bay_descriptor bay;
	int err;

	if ((placement == NULL) || (out_flow_id == NULL)) {
		return -EINVAL;
	}

	if ((placement->power_rail_id != SPAGHETTI_POWER_RAIL_UNSPECIFIED) &&
	    (placement->bay_id == SPAGHETTI_BAY_ID_UNSPECIFIED)) {
		return -EINVAL;
	}

	flow = spaghetti_topology_flow_for_port(port_id);
	*out_flow_id = (flow != NULL) ? flow->id : 0U;

	if (placement->bay_id == SPAGHETTI_BAY_ID_UNSPECIFIED) {
		return 0;
	}

	if (flow == NULL) {
		return -ENOENT;
	}

	err = spaghetti_topology_bay_get(flow->id, placement->bay_id, &bay);
	if (err < 0) {
		return err;
	}

	*out_flow_id = flow->id;
	return 0;
}

static int attach_power_if_needed(
	const struct spaghetti_module_slot *slot,
	const struct spaghetti_module_driver *driver,
	enum spaghetti_power_admission_state *out_admission,
	bool *out_attached)
{
	*out_attached = false;
	*out_admission = SPAGHETTI_POWER_ADMISSION_NOT_REQUIRED;

	if (slot->placement.power_rail_id == SPAGHETTI_POWER_RAIL_UNSPECIFIED) {
		return 0;
	}

#if defined(CONFIG_SPAGHETTI_POWER)
	{
		const struct spaghetti_power_binding binding = {
			.flow_id = slot->flow_id,
			.bay_id = slot->placement.bay_id,
			.rail_id = slot->placement.power_rail_id,
		};
		int err = spaghetti_power_attach(
			&binding, slot->module.id, &driver->power_requirement,
			out_admission);

		if (err < 0) {
			return err;
		}

		*out_attached = true;
		return 0;
	}
#else
	ARG_UNUSED(driver);
	return -ENOTSUP;
#endif
}

static void detach_power_if_needed(struct spaghetti_module_slot *slot)
{
#if defined(CONFIG_SPAGHETTI_POWER)
	if (slot->power_attached) {
		const struct spaghetti_power_binding binding = {
			.flow_id = slot->flow_id,
			.bay_id = slot->placement.bay_id,
			.rail_id = slot->placement.power_rail_id,
		};

		(void)spaghetti_power_detach(&binding, slot->module.id);
		slot->power_attached = false;
	}
#else
	ARG_UNUSED(slot);
#endif
}

static enum spaghetti_port_transport transport_for_endpoint(
	enum spaghetti_module_endpoint_kind kind,
	enum spaghetti_port_transport fallback)
{
	switch (kind) {
	case SPAGHETTI_ENDPOINT_I2C_ADDRESS:
		return SPAGHETTI_PORT_TRANSPORT_I2C;
	case SPAGHETTI_ENDPOINT_SPI_CHIP_SELECT:
		return SPAGHETTI_PORT_TRANSPORT_SPI;
	case SPAGHETTI_ENDPOINT_UART_EXCLUSIVE:
		return SPAGHETTI_PORT_TRANSPORT_UART;
	case SPAGHETTI_ENDPOINT_GPIO_LINE:
	case SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE:
		return SPAGHETTI_PORT_TRANSPORT_GPIO;
	case SPAGHETTI_ENDPOINT_ADC_CHANNEL:
		return SPAGHETTI_PORT_TRANSPORT_ADC;
	case SPAGHETTI_ENDPOINT_W1_ROM:
		return SPAGHETTI_PORT_TRANSPORT_W1;
	default:
		return fallback;
	}
}

static int payload_matches_driver_schema(
	const struct spaghetti_module_driver *driver,
	const struct spaghetti_record_payload *payload)
{
	if (driver->required_capabilities == 0U) {
		/*
		 * Declarative drivers publish profile-owned schemas and validate
		 * payloads themselves before returning from read().
		 */
		ARG_UNUSED(payload);
		return 0;
	}

	for (size_t schema_idx = 0U; schema_idx < driver->record_schema_count;
	     ++schema_idx) {
		if (spaghetti_record_payload_validate(
			    payload, driver->record_schemas[schema_idx]) == 0) {
			return 0;
		}
	}

	return -EPROTONOSUPPORT;
}

static const struct spaghetti_command_descriptor *find_command(
	const struct spaghetti_module_driver *driver,
	uint16_t command_id)
{
	for (size_t command_idx = 0U; command_idx < driver->command_count;
	     ++command_idx) {
		if (driver->commands[command_idx].command_id == command_id) {
			return &driver->commands[command_idx];
		}
	}

	return NULL;
}

int spaghetti_module_manager_init(void)
{
	int err = k_mutex_lock(&slots_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}

	if (is_initialized) {
		k_mutex_unlock(&slots_lock);
		return -EALREADY;
	}

	memset(slots, 0, sizeof(slots));
	is_initialized = true;
	k_mutex_unlock(&slots_lock);

	LOG_INF("ready: capacity=%u", (uint32_t)ARRAY_SIZE(slots));
	return 0;
}

int spaghetti_module_manager_configure(
	const struct spaghetti_module_request *request,
	spaghetti_module_id_t *out_id)
{
	struct spaghetti_module_endpoint endpoint;
	const struct spaghetti_module_driver *driver;
	const struct spaghetti_port *port;
	struct spaghetti_module_slot *slot = NULL;
	spaghetti_flow_id_t flow_id = 0U;
	enum spaghetti_power_admission_state admission =
		SPAGHETTI_POWER_ADMISSION_NOT_REQUIRED;
	bool power_attached = false;
	int err;

	if ((request == NULL) || (out_id == NULL) || (request->key == 0U) ||
	    (request->revision == 0U) || (request->type_id == NULL) ||
	    (request->config == NULL)) {
		return -EINVAL;
	}

	port = spaghetti_port_get(request->port_id);
	if (port == NULL) {
		return -ENOENT;
	}

	driver = spaghetti_driver_registry_find(request->type_id);
	if (driver == NULL) {
		return -ENOENT;
	}

	/*
	 * required_capabilities == 0 means the concrete Device Profile selected
	 * at configure time decides Port capability needs. The driver validates
	 * them during validate_config/init.
	 */
	if ((driver->required_capabilities != 0U) &&
	    !spaghetti_port_has_capability(port, driver->required_capabilities)) {
		return -ENOTSUP;
	}

	if ((driver->ops == NULL) || (driver->ops->validate_config == NULL) ||
	    (driver->ops->describe_endpoint == NULL) ||
	    (driver->ops->init == NULL) || (driver->ops->deinit == NULL)) {
		return -ENOTSUP;
	}

	err = validate_placement(request->port_id, &request->placement, &flow_id);
	if (err < 0) {
		return err;
	}

	err = driver->ops->validate_config(request->config);
	if (err < 0) {
		return err;
	}

	err = driver->ops->describe_endpoint(request->config, &endpoint);
	if (err < 0) {
		return err;
	}

	if (!endpoint_is_valid(&endpoint)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&slots_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	for (size_t slot_idx = 0U; slot_idx < ARRAY_SIZE(slots); ++slot_idx) {
		struct spaghetti_module_slot *candidate = &slots[slot_idx];

		if (!candidate->used && !candidate->reserved) {
			if (slot == NULL) {
				slot = candidate;
			}
			continue;
		}

		if (candidate->module.key == request->key) {
			err = candidate->reserved ? -EBUSY : -EEXIST;
			goto unlock;
		}

		if ((candidate->port_id == request->port_id) &&
		    endpoints_conflict(&candidate->module.endpoint, &endpoint)) {
			err = candidate->reserved ? -EBUSY : -EADDRINUSE;
			goto unlock;
		}
	}

	if (slot == NULL) {
		err = -ENOSPC;
		goto unlock;
	}

	const spaghetti_module_id_t module_id =
		(spaghetti_module_id_t)(slot - slots);

	memset(slot, 0, sizeof(*slot));
	slot->reserved = true;
	slot->port_id = request->port_id;
	slot->flow_id = flow_id;
	slot->placement = request->placement;
	slot->power_admission = SPAGHETTI_POWER_ADMISSION_NOT_REQUIRED;
	slot->revision = request->revision;
	slot->module.id = module_id;
	slot->module.key = request->key;
	slot->module.state = SPAGHETTI_MODULE_UNINITIALIZED;
	slot->module.port = port;
	slot->module.driver = driver;
	slot->module.endpoint = endpoint;
	k_mutex_unlock(&slots_lock);

	err = spaghetti_port_acquire(
		port, request->key,
		(driver->required_capabilities == 0U) ?
			transport_for_endpoint(endpoint.kind, driver->transport) :
			driver->transport);
	if (err < 0) {
		(void)k_mutex_lock(&slots_lock, K_FOREVER);
		memset(slot, 0, sizeof(*slot));
		k_mutex_unlock(&slots_lock);
		return err;
	}

	err = attach_power_if_needed(slot, driver, &admission, &power_attached);
	if (err < 0) {
		(void)spaghetti_port_release(port, request->key);
		(void)k_mutex_lock(&slots_lock, K_FOREVER);
		memset(slot, 0, sizeof(*slot));
		k_mutex_unlock(&slots_lock);
		return err;
	}

	err = driver->ops->init(&slot->module, request->config);
	if (err < 0) {
#if defined(CONFIG_SPAGHETTI_POWER)
		if (power_attached) {
			const struct spaghetti_power_binding binding = {
				.flow_id = flow_id,
				.bay_id = request->placement.bay_id,
				.rail_id = request->placement.power_rail_id,
			};

			(void)spaghetti_power_detach(&binding, module_id);
		}
#else
		ARG_UNUSED(power_attached);
#endif
		(void)spaghetti_port_release(port, request->key);
		(void)k_mutex_lock(&slots_lock, K_FOREVER);
		memset(slot, 0, sizeof(*slot));
		k_mutex_unlock(&slots_lock);
		return err;
	}

	(void)k_mutex_lock(&slots_lock, K_FOREVER);
	slot->module.state = SPAGHETTI_MODULE_READY;
	slot->power_admission = admission;
	slot->power_attached = power_attached;
	slot->used = true;
	slot->reserved = false;
	*out_id = slot->module.id;
	spaghetti_resources_note_used(SPAGHETTI_RESOURCE_OWNER_MODULES,
				      count_used_modules_locked());
	k_mutex_unlock(&slots_lock);

	LOG_INF("configured: key=%u id=%u port=%u endpoint=%u", request->key,
		(uint32_t)*out_id, (uint32_t)request->port_id,
		endpoint_log_value(&endpoint));
	return 0;

unlock:
	if (err == -ENOSPC) {
		spaghetti_resources_note_failure(SPAGHETTI_RESOURCE_OWNER_MODULES);
	}
	k_mutex_unlock(&slots_lock);
	return err;
}

int spaghetti_module_manager_remove(spaghetti_module_id_t id,
				    uint32_t expected_revision)
{
	struct spaghetti_module_slot *slot;
	const struct spaghetti_port *port;
	spaghetti_module_key_t key;
	int err;

	if (expected_revision == 0U) {
		return -EINVAL;
	}

	err = k_mutex_lock(&slots_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	slot = find_slot_by_id(id);
	if (slot == NULL) {
		err = -ENOENT;
		goto unlock;
	}

	if (slot->revision != expected_revision) {
		err = -ESTALE;
		goto unlock;
	}

	if (slot->busy) {
		err = -EBUSY;
		goto unlock;
	}

	slot->busy = true;
	key = slot->module.key;
	port = slot->module.port;
	k_mutex_unlock(&slots_lock);

	if (slot->events_started) {
		if ((slot->module.driver->ops->stop == NULL)) {
			(void)k_mutex_lock(&slots_lock, K_FOREVER);
			slot->module.state = SPAGHETTI_MODULE_ERROR;
			slot->busy = false;
			k_mutex_unlock(&slots_lock);
			return -ENOTSUP;
		}

		err = slot->module.driver->ops->stop(&slot->module);
		if (err < 0) {
			(void)k_mutex_lock(&slots_lock, K_FOREVER);
			slot->module.state = SPAGHETTI_MODULE_ERROR;
			slot->busy = false;
			k_mutex_unlock(&slots_lock);
			return err;
		}

		slot->events_started = false;
	}

	err = slot->module.driver->ops->deinit(&slot->module);
	detach_power_if_needed(slot);
	(void)spaghetti_port_release(port, key);

	(void)k_mutex_lock(&slots_lock, K_FOREVER);
	memset(slot, 0, sizeof(*slot));
	spaghetti_resources_note_used(SPAGHETTI_RESOURCE_OWNER_MODULES,
				      count_used_modules_locked());
	k_mutex_unlock(&slots_lock);

	LOG_INF("removed: key=%u id=%u err=%d", key, (uint32_t)id, err);
	return err;

unlock:
	k_mutex_unlock(&slots_lock);
	return err;
}

int spaghetti_module_manager_get_by_id(
	spaghetti_module_id_t id,
	struct spaghetti_module_snapshot *out)
{
	struct spaghetti_module_slot *slot;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&slots_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	slot = find_slot_by_id(id);
	if (slot == NULL) {
		k_mutex_unlock(&slots_lock);
		return -ENOENT;
	}

	copy_snapshot(slot, out);
	k_mutex_unlock(&slots_lock);
	return 0;
}

int spaghetti_module_manager_get_by_key(
	spaghetti_module_key_t key,
	struct spaghetti_module_snapshot *out)
{
	int err;

	if ((key == 0U) || (out == NULL)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&slots_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	for (size_t slot_idx = 0U; slot_idx < ARRAY_SIZE(slots); ++slot_idx) {
		if (slots[slot_idx].used && (slots[slot_idx].module.key == key)) {
			copy_snapshot(&slots[slot_idx], out);
			k_mutex_unlock(&slots_lock);
			return 0;
		}
	}

	k_mutex_unlock(&slots_lock);
	return -ENOENT;
}

int spaghetti_module_manager_list_by_port(
	spaghetti_port_id_t port_id,
	struct spaghetti_module_snapshot *out,
	size_t capacity,
	size_t *out_count)
{
	size_t module_count = 0U;
	int err;

	if ((out_count == NULL) || ((out == NULL) != (capacity == 0U))) {
		return -EINVAL;
	}

	if (spaghetti_port_get(port_id) == NULL) {
		return -ENOENT;
	}

	err = k_mutex_lock(&slots_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	for (size_t slot_idx = 0U; slot_idx < ARRAY_SIZE(slots); ++slot_idx) {
		if (slots[slot_idx].used && (slots[slot_idx].port_id == port_id)) {
			++module_count;
		}
	}

	if (out == NULL) {
		*out_count = module_count;
		k_mutex_unlock(&slots_lock);
		return 0;
	}

	if (capacity < module_count) {
		*out_count = module_count;
		k_mutex_unlock(&slots_lock);
		return -ENOSPC;
	}

	size_t output_idx = 0U;

	for (size_t slot_idx = 0U; slot_idx < ARRAY_SIZE(slots); ++slot_idx) {
		if (slots[slot_idx].used && (slots[slot_idx].port_id == port_id)) {
			copy_snapshot(&slots[slot_idx], &out[output_idx]);
			++output_idx;
		}
	}

	*out_count = module_count;
	k_mutex_unlock(&slots_lock);
	return 0;
}

int spaghetti_module_manager_read(
	spaghetti_module_id_t id,
	struct spaghetti_record *out)
{
	struct spaghetti_module_slot *slot;
	struct spaghetti_record_payload payload;
	struct spaghetti_record record;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&slots_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	slot = find_slot_by_id(id);
	if (slot == NULL) {
		err = -ENOENT;
		goto unlock;
	}

	if (slot->busy) {
		err = -EBUSY;
		goto unlock;
	}

	if ((slot->module.state != SPAGHETTI_MODULE_READY) ||
	    (slot->module.driver->ops->read == NULL)) {
		err = -ENOTSUP;
		goto unlock;
	}

	slot->busy = true;
	k_mutex_unlock(&slots_lock);

	err = slot->module.driver->ops->read(&slot->module, &payload);

	(void)k_mutex_lock(&slots_lock, K_FOREVER);
	if (err == 0) {
		err = payload_matches_driver_schema(slot->module.driver, &payload);
		if (err == 0) {
			if (slot->read_sequence == UINT32_MAX) {
				slot->read_sequence = 0U;
			}
			++slot->read_sequence;

			memset(&record, 0, sizeof(record));
			record.source_id = slot->module.id;
			record.source_key = slot->module.key;
			record.boot_id = 0U;
			record.timestamp_ms = k_uptime_get();
			record.sequence = slot->read_sequence;
			record.payload = payload;
			*out = record;
		}
	}
	slot->busy = false;
	k_mutex_unlock(&slots_lock);
	return err;

unlock:
	k_mutex_unlock(&slots_lock);
	return err;
}

int spaghetti_module_manager_command(
	spaghetti_module_id_t id,
	const struct spaghetti_module_command *command)
{
	struct spaghetti_module_slot *slot;
	const struct spaghetti_command_descriptor *descriptor;
	int err;

	if (command == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&slots_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	slot = find_slot_by_id(id);
	if (slot == NULL) {
		err = -ENOENT;
		goto unlock;
	}
	if (slot->busy) {
		err = -EBUSY;
		goto unlock;
	}
	if ((slot->module.state != SPAGHETTI_MODULE_READY) ||
	    (slot->module.driver->ops->command == NULL)) {
		err = -ENOTSUP;
		goto unlock;
	}

	descriptor = find_command(slot->module.driver, command->command_id);
	if (descriptor == NULL) {
		err = -ENOTSUP;
		goto unlock;
	}

	err = spaghetti_property_validate(&command->arguments,
					  descriptor->argument_schema);
	if (err < 0) {
		goto unlock;
	}

	slot->busy = true;
	k_mutex_unlock(&slots_lock);
	err = slot->module.driver->ops->command(&slot->module, command);

	(void)k_mutex_lock(&slots_lock, K_FOREVER);
	slot->busy = false;
	k_mutex_unlock(&slots_lock);
	return err;

unlock:
	k_mutex_unlock(&slots_lock);
	return err;
}

int spaghetti_module_manager_start_events(
	spaghetti_module_id_t id,
	spaghetti_module_event_cb_t emit,
	void *emit_user_data)
{
	struct spaghetti_module_slot *slot;
	int err;

	if (emit == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&slots_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	slot = find_slot_by_id(id);
	if (slot == NULL) {
		err = -ENOENT;
		goto unlock;
	}
	if (slot->busy) {
		err = -EBUSY;
		goto unlock;
	}
	if ((slot->module.driver->ops->start == NULL) ||
	    (slot->module.driver->ops->stop == NULL)) {
		err = -ENOTSUP;
		goto unlock;
	}
	if (slot->events_started) {
		err = -EALREADY;
		goto unlock;
	}
	if (slot->module.state != SPAGHETTI_MODULE_READY) {
		err = -ENOTSUP;
		goto unlock;
	}

	slot->busy = true;
	k_mutex_unlock(&slots_lock);

	err = slot->module.driver->ops->start(&slot->module, emit, emit_user_data);

	(void)k_mutex_lock(&slots_lock, K_FOREVER);
	if (err == 0) {
		slot->events_started = true;
	}
	slot->busy = false;
	k_mutex_unlock(&slots_lock);
	return err;

unlock:
	k_mutex_unlock(&slots_lock);
	return err;
}

int spaghetti_module_manager_stop_events(spaghetti_module_id_t id)
{
	struct spaghetti_module_slot *slot;
	int err;

	err = k_mutex_lock(&slots_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	slot = find_slot_by_id(id);
	if (slot == NULL) {
		err = -ENOENT;
		goto unlock;
	}
	if (slot->busy) {
		err = -EBUSY;
		goto unlock;
	}
	if ((slot->module.driver->ops->start == NULL) ||
	    (slot->module.driver->ops->stop == NULL)) {
		err = -ENOTSUP;
		goto unlock;
	}
	if (!slot->events_started) {
		err = -EALREADY;
		goto unlock;
	}

	slot->busy = true;
	k_mutex_unlock(&slots_lock);

	err = slot->module.driver->ops->stop(&slot->module);

	(void)k_mutex_lock(&slots_lock, K_FOREVER);
	if (err == 0) {
		slot->events_started = false;
	}
	slot->busy = false;
	k_mutex_unlock(&slots_lock);
	return err;

unlock:
	k_mutex_unlock(&slots_lock);
	return err;
}
