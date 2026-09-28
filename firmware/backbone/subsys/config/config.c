#include <spaghetti/config.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/config_codec.h>
#include <spaghetti/connectivity.h>
#include <spaghetti/driver_registry.h>
#include <spaghetti/energy.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/power.h>
#include <spaghetti/rule_driver.h>
#include <spaghetti/rule_registry.h>
#include <spaghetti/processing.h>
#include <spaghetti/runtime.h>
#include <spaghetti/schema.h>
#include <spaghetti/service.h>
#include <spaghetti/storage.h>
#include <spaghetti/topology.h>

LOG_MODULE_REGISTER(spaghetti_config, CONFIG_SPAGHETTI_CONFIG_LOG_LEVEL);

struct spaghetti_config_transaction {
	bool old_removed[SPAGHETTI_CONFIG_MAX_MODULES];
	bool candidate_added[SPAGHETTI_CONFIG_MAX_MODULES];
	struct spaghetti_module_snapshot old_live[SPAGHETTI_CONFIG_MAX_MODULES];
	struct spaghetti_module_snapshot candidate_live[SPAGHETTI_CONFIG_MAX_MODULES];
};

static struct spaghetti_config current_config;
static struct spaghetti_config_revision current_revision;
static bool is_initialized;
static int64_t last_persistent_write_ms;
K_MUTEX_DEFINE(config_lock);

BUILD_ASSERT(SPAGHETTI_CONFIG_MAX_MODULES <= CONFIG_SPAGHETTI_MAX_MODULES);
BUILD_ASSERT(SPAGHETTI_CONFIG_MAX_SCHEDULES <= CONFIG_SPAGHETTI_MAX_SCHEDULES);
BUILD_ASSERT(SPAGHETTI_CONFIG_MAX_RULES <= CONFIG_SPAGHETTI_MAX_RULES);
BUILD_ASSERT(SPAGHETTI_CONFIG_TYPE_ID_SIZE == SPAGHETTI_TYPE_ID_MAX);

static bool module_is_absent(spaghetti_module_key_t key);

static uint32_t sha256_rotr(uint32_t value, uint32_t bits)
{
	return (value >> bits) | (value << (32U - bits));
}

static void sha256_transform(uint32_t state[8], const uint8_t block[64])
{
	static const uint32_t k[64] = {
		0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
		0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
		0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
		0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
		0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
		0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
		0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
		0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
		0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
		0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
		0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
		0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
		0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
		0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
		0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
		0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
	};
	uint32_t w[64];
	uint32_t a = state[0];
	uint32_t b = state[1];
	uint32_t c = state[2];
	uint32_t d = state[3];
	uint32_t e = state[4];
	uint32_t f = state[5];
	uint32_t g = state[6];
	uint32_t h = state[7];

	for (size_t idx = 0U; idx < 16U; ++idx) {
		w[idx] = ((uint32_t)block[(idx * 4U) + 0U] << 24) |
			 ((uint32_t)block[(idx * 4U) + 1U] << 16) |
			 ((uint32_t)block[(idx * 4U) + 2U] << 8) |
			 ((uint32_t)block[(idx * 4U) + 3U]);
	}
	for (size_t idx = 16U; idx < 64U; ++idx) {
		const uint32_t s0 = sha256_rotr(w[idx - 15U], 7U) ^
				    sha256_rotr(w[idx - 15U], 18U) ^
				    (w[idx - 15U] >> 3);
		const uint32_t s1 = sha256_rotr(w[idx - 2U], 17U) ^
				    sha256_rotr(w[idx - 2U], 19U) ^
				    (w[idx - 2U] >> 10);

		w[idx] = w[idx - 16U] + s0 + w[idx - 7U] + s1;
	}

	for (size_t idx = 0U; idx < 64U; ++idx) {
		const uint32_t s1 = sha256_rotr(e, 6U) ^ sha256_rotr(e, 11U) ^
				    sha256_rotr(e, 25U);
		const uint32_t ch = (e & f) ^ ((~e) & g);
		const uint32_t temp1 = h + s1 + ch + k[idx] + w[idx];
		const uint32_t s0 = sha256_rotr(a, 2U) ^ sha256_rotr(a, 13U) ^
				    sha256_rotr(a, 22U);
		const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
		const uint32_t temp2 = s0 + maj;

		h = g;
		g = f;
		f = e;
		e = d + temp1;
		d = c;
		c = b;
		b = a;
		a = temp1 + temp2;
	}

	state[0] += a;
	state[1] += b;
	state[2] += c;
	state[3] += d;
	state[4] += e;
	state[5] += f;
	state[6] += g;
	state[7] += h;
}

static int compute_sha256(const uint8_t *data, size_t size, uint8_t out[32])
{
	uint32_t state[8] = {
		0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
		0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U,
	};
	uint8_t block[64];
	size_t offset = 0U;
	const uint64_t bit_len = (uint64_t)size * 8U;

	if ((data == NULL) && (size != 0U)) {
		return -EINVAL;
	}

	while ((offset + 64U) <= size) {
		sha256_transform(state, &data[offset]);
		offset += 64U;
	}

	memset(block, 0, sizeof(block));
	if (size > offset) {
		memcpy(block, &data[offset], size - offset);
	}
	block[size - offset] = 0x80U;
	if ((size - offset) >= 56U) {
		sha256_transform(state, block);
		memset(block, 0, sizeof(block));
	}

	block[56] = (uint8_t)(bit_len >> 56);
	block[57] = (uint8_t)(bit_len >> 48);
	block[58] = (uint8_t)(bit_len >> 40);
	block[59] = (uint8_t)(bit_len >> 32);
	block[60] = (uint8_t)(bit_len >> 24);
	block[61] = (uint8_t)(bit_len >> 16);
	block[62] = (uint8_t)(bit_len >> 8);
	block[63] = (uint8_t)bit_len;
	sha256_transform(state, block);

	for (size_t idx = 0U; idx < 8U; ++idx) {
		out[(idx * 4U) + 0U] = (uint8_t)(state[idx] >> 24);
		out[(idx * 4U) + 1U] = (uint8_t)(state[idx] >> 16);
		out[(idx * 4U) + 2U] = (uint8_t)(state[idx] >> 8);
		out[(idx * 4U) + 3U] = (uint8_t)state[idx];
	}

	return 0;
}

static int compute_config_hash(const struct spaghetti_config *config,
			       uint8_t out_hash[SPAGHETTI_CONFIG_HASH_SIZE])
{
	uint8_t encoded[SPAGHETTI_CONFIG_CBOR_MAX_SIZE];
	size_t written = 0U;
	int err = spaghetti_config_encode_cbor(config, encoded, sizeof(encoded),
					       &written);

	if (err < 0) {
		return err;
	}

	return compute_sha256(encoded, written, out_hash);
}

static bool type_id_is_valid(const char *type_id)
{
	if (type_id[0] == '\0') {
		return false;
	}

	return memchr(type_id, '\0', SPAGHETTI_CONFIG_TYPE_ID_SIZE) != NULL;
}

static bool mqtt_config_is_valid(const struct spaghetti_mqtt_config *mqtt)
{
	const char *host_end = memchr(mqtt->host, '\0', sizeof(mqtt->host));
	const char *topic_end = memchr(mqtt->base_topic, '\0',
				       sizeof(mqtt->base_topic));

	if (!mqtt->enabled) {
		return (mqtt->host[0] == '\0') && (mqtt->port == 0U) &&
		       (mqtt->base_topic[0] == '\0') &&
		       (mqtt->security == SPAGHETTI_MQTT_SECURITY_TLS_SERVER) &&
		       (mqtt->credential_id == 0U);
	}
	if ((host_end == NULL) || (host_end == mqtt->host) ||
	    (topic_end == NULL) || (topic_end == mqtt->base_topic) ||
	    (mqtt->port == 0U) || (mqtt->credential_id == 0U)) {
		return false;
	}
	switch (mqtt->security) {
	case SPAGHETTI_MQTT_SECURITY_TLS_SERVER:
	case SPAGHETTI_MQTT_SECURITY_TLS_MUTUAL:
		break;
	case SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT:
		if (!IS_ENABLED(
			    CONFIG_SPAGHETTI_MQTT_ALLOW_PLAINTEXT_DEVELOPMENT)) {
			return false;
		}
		break;
	default:
		return false;
	}

	return (mqtt->base_topic[0] != '/') && (topic_end[-1] != '/');
}

static bool energy_policy_is_valid(const struct spaghetti_energy_policy *policy)
{
	if ((policy->ble_availability != SPAGHETTI_BLE_OFF) &&
	    (policy->ble_availability != SPAGHETTI_BLE_ADVERTISING) &&
	    (policy->ble_availability != SPAGHETTI_BLE_WINDOWED)) {
		return false;
	}
	if (policy->ble_availability != SPAGHETTI_BLE_WINDOWED) {
		return true;
	}

	return (policy->advertising_window_ms > 0U) &&
	       (policy->advertising_period_ms > 0U) &&
	       (policy->advertising_window_ms <
		policy->advertising_period_ms);
}

static bool connectivity_policy_is_valid(
	enum spaghetti_connectivity_policy policy)
{
	return (policy == SPAGHETTI_CONNECTIVITY_LOW_ENERGY) ||
	       (policy == SPAGHETTI_CONNECTIVITY_ONLINE);
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

static bool property_values_equal(const struct spaghetti_value *first,
				  const struct spaghetti_value *second)
{
	if ((first->field_id != second->field_id) ||
	    (first->type != second->type)) {
		return false;
	}

	switch (first->type) {
	case SPAGHETTI_VALUE_BOOL:
		return first->data.boolean == second->data.boolean;
	case SPAGHETTI_VALUE_INT64:
		return first->data.signed_integer == second->data.signed_integer;
	case SPAGHETTI_VALUE_UINT64:
		return first->data.unsigned_integer ==
		       second->data.unsigned_integer;
	case SPAGHETTI_VALUE_TEXT:
		return (first->data.text.size == second->data.text.size) &&
		       (memcmp(first->data.text.text, second->data.text.text,
			       first->data.text.size) == 0);
	case SPAGHETTI_VALUE_BYTES:
		return (first->data.bytes.size == second->data.bytes.size) &&
		       (memcmp(first->data.bytes.bytes, second->data.bytes.bytes,
			       first->data.bytes.size) == 0);
	default:
		return false;
	}
}

static bool property_sets_are_equal(const struct spaghetti_property_set *first,
				    const struct spaghetti_property_set *second)
{
	if (first->field_count != second->field_count) {
		return false;
	}

	for (size_t idx = 0U; idx < first->field_count; ++idx) {
		const struct spaghetti_value *peer =
			spaghetti_property_find(second,
						first->fields[idx].field_id);

		if ((peer == NULL) ||
		    !property_values_equal(&first->fields[idx], peer)) {
			return false;
		}
	}

	return true;
}

static int describe_module(
	const struct spaghetti_module_config *module_config,
	struct spaghetti_module_endpoint *out_endpoint,
	const struct spaghetti_flow_descriptor **out_flow)
{
	const struct spaghetti_module_driver *driver;
	const struct spaghetti_port *port;
	const struct spaghetti_flow_descriptor *flow;
	int err;

	if ((module_config->key == 0U) ||
	    !type_id_is_valid(module_config->type_id)) {
		return -EINVAL;
	}
	if ((module_config->power_rail_id != SPAGHETTI_POWER_RAIL_UNSPECIFIED) &&
	    (module_config->bay_id == SPAGHETTI_BAY_ID_UNSPECIFIED)) {
		return -EINVAL;
	}

	port = spaghetti_port_get(module_config->port_id);
	if (port == NULL) {
		return -ENOENT;
	}

	flow = spaghetti_topology_flow_for_port(module_config->port_id);
	*out_flow = flow;

	driver = spaghetti_driver_registry_find(module_config->type_id);
	if ((driver == NULL) || (driver->ops == NULL) ||
	    (driver->ops->validate_config == NULL) ||
	    (driver->ops->describe_endpoint == NULL) ||
	    (driver->ops->init == NULL) ||
	    ((driver->ops->read == NULL) &&
	     (driver->ops->command == NULL) &&
	     (driver->ops->start == NULL)) ||
	    (driver->ops->deinit == NULL)) {
		return -ENOTSUP;
	}
	if ((driver->required_capabilities != 0U) &&
	    !spaghetti_port_has_capability(port,
					   driver->required_capabilities)) {
		return -ENOTSUP;
	}

	if (module_config->bay_id != SPAGHETTI_BAY_ID_UNSPECIFIED) {
		struct spaghetti_bay_descriptor bay;

		if (flow == NULL) {
			return -ENOENT;
		}
		err = spaghetti_topology_bay_get(flow->id, module_config->bay_id,
						 &bay);
		if (err < 0) {
			return err;
		}
	}

	if ((module_config->bay_id != SPAGHETTI_BAY_ID_UNSPECIFIED) &&
	    (module_config->power_rail_id != SPAGHETTI_POWER_RAIL_UNSPECIFIED)) {
#if defined(CONFIG_SPAGHETTI_POWER)
		const struct spaghetti_power_binding binding = {
			.flow_id = flow->id,
			.bay_id = module_config->bay_id,
			.rail_id = module_config->power_rail_id,
		};
		enum spaghetti_power_admission_state admission;

		err = spaghetti_power_validate_binding(
			&binding, &driver->power_requirement, &admission);
		if (err < 0) {
			return err;
		}
		ARG_UNUSED(admission);
#else
		return -ENOTSUP;
#endif
	}

	err = driver->ops->validate_config(&module_config->properties);
	if (err < 0) {
		return err;
	}

	err = driver->ops->describe_endpoint(&module_config->properties,
					     out_endpoint);
	if (err < 0) {
		return err;
	}

	if (!endpoint_is_valid(out_endpoint)) {
		return -EINVAL;
	}

	return 0;
}

static int find_module_index(const struct spaghetti_config *config,
			     spaghetti_module_key_t key)
{
	for (size_t module_idx = 0U; module_idx < config->module_count;
	     ++module_idx) {
		if (config->modules[module_idx].key == key) {
			return (int)module_idx;
		}
	}

	return -1;
}

static bool module_supports_read(const struct spaghetti_config *config,
				 spaghetti_module_key_t key)
{
	const int module_idx = find_module_index(config, key);

	if (module_idx < 0) {
		return false;
	}

	const struct spaghetti_module_driver *driver =
		spaghetti_driver_registry_find(
			config->modules[module_idx].type_id);

	return (driver != NULL) && (driver->ops != NULL) &&
	       (driver->ops->read != NULL);
}

static bool module_configs_are_equal(
	const struct spaghetti_module_config *first,
	const struct spaghetti_module_config *second)
{
	return (first->port_id == second->port_id) &&
	       (first->bay_id == second->bay_id) &&
	       (first->power_rail_id == second->power_rail_id) &&
	       (strcmp(first->type_id, second->type_id) == 0) &&
	       property_sets_are_equal(&first->properties, &second->properties);
}

static int configure_module(
	const struct spaghetti_module_config *module_config,
	uint32_t revision,
	struct spaghetti_module_snapshot *out)
{
	const struct spaghetti_module_request request = {
		.key = module_config->key,
		.port_id = module_config->port_id,
		.type_id = module_config->type_id,
		.config = &module_config->properties,
		.placement = {
			.bay_id = module_config->bay_id,
			.power_rail_id = module_config->power_rail_id,
		},
		.revision = revision,
	};
	spaghetti_module_id_t module_id;
	int err = spaghetti_module_manager_configure(&request, &module_id);

	if (err < 0) {
		return err;
	}

	err = spaghetti_module_manager_get_by_id(module_id, out);
	if (err < 0) {
		(void)spaghetti_module_manager_remove(module_id, revision);
	}

	return err;
}

static int remove_module(const struct spaghetti_module_snapshot *module)
{
	int err = spaghetti_module_manager_remove(module->id, module->revision);

	if ((err < 0) && module_is_absent(module->key)) {
		return 0;
	}

	return err;
}

static bool config_needs_runtime(const struct spaghetti_config *config)
{
	return (config->schedule_count > 0U) || (config->rule_count > 0U);
}

static int load_runtime(const struct spaghetti_config *config)
{
	int err = spaghetti_runtime_configure(config->schedules,
					      config->schedule_count,
					      config->rules,
					      config->rule_count);

	if (err < 0) {
		return err;
	}

	err = spaghetti_processing_configure(config->blocks, config->block_count,
					     config->edges, config->edge_count);
	if (err < 0) {
		(void)spaghetti_runtime_configure(NULL, 0U, NULL, 0U);
	}

	return err;
}

static int start_runtime(const struct spaghetti_config *config)
{
	int err;

	if (!config_needs_runtime(config)) {
		return 0;
	}

	err = spaghetti_runtime_start();
	return err;
}

static bool mqtt_configs_are_equal(
	const struct spaghetti_mqtt_config *first,
	const struct spaghetti_mqtt_config *second)
{
	return (first->enabled == second->enabled) &&
	       (first->port == second->port) &&
	       (first->security == second->security) &&
	       (first->credential_id == second->credential_id) &&
	       (strcmp(first->host, second->host) == 0) &&
	       (strcmp(first->base_topic, second->base_topic) == 0);
}

static int configure_mqtt(const struct spaghetti_mqtt_config *mqtt)
{
	enum spaghetti_service_state state;
	bool restart_service;
	int err = spaghetti_service_get_state(SPAGHETTI_SERVICE_ID_MQTT, &state);

	if (err < 0) {
		return err;
	}
	restart_service = state != SPAGHETTI_SERVICE_STOPPED;
	if (state != SPAGHETTI_SERVICE_STOPPED) {
		err = spaghetti_service_stop(
			SPAGHETTI_SERVICE_ID_MQTT,
			K_MSEC(CONFIG_SPAGHETTI_MQTT_STOP_TIMEOUT_MS));
		if ((err < 0) && (err != -EALREADY)) {
			return err;
		}
	}

	err = spaghetti_mqtt_init(mqtt);
	if ((err == 0) && restart_service) {
		err = spaghetti_service_start(SPAGHETTI_SERVICE_ID_MQTT);
	}

	return err;
}

static int apply_connectivity_policy(enum spaghetti_connectivity_policy policy)
{
	int err = spaghetti_connectivity_set_policy(policy);

	if (err < 0) {
		return err;
	}

#if defined(CONFIG_SPAGHETTI_ENERGY)
	return spaghetti_energy_apply_connectivity(policy);
#else
	return 0;
#endif
}

static int restore_runtime(const struct spaghetti_config *config)
{
	int err = spaghetti_runtime_stop(
		K_MSEC(CONFIG_SPAGHETTI_RUNTIME_STOP_TIMEOUT_MS));

	if ((err < 0) && (err != -EALREADY)) {
		return err;
	}

	err = load_runtime(config);
	if (err < 0) {
		return err;
	}

	return start_runtime(config);
}

static bool module_is_absent(spaghetti_module_key_t key)
{
	struct spaghetti_module_snapshot ignored;

	return spaghetti_module_manager_get_by_key(key, &ignored) == -ENOENT;
}

static int rollback_transaction(
	const struct spaghetti_config *old_config,
	struct spaghetti_config_transaction *transaction)
{
	int first_error = 0;

	for (size_t candidate_idx = SPAGHETTI_CONFIG_MAX_MODULES;
	     candidate_idx > 0U; --candidate_idx) {
		const size_t index = candidate_idx - 1U;

		if (!transaction->candidate_added[index]) {
			continue;
		}

		const int err = remove_module(&transaction->candidate_live[index]);

		if ((err < 0) && (first_error == 0)) {
			first_error = err;
		}
	}

	for (size_t old_idx = 0U; old_idx < old_config->module_count; ++old_idx) {
		struct spaghetti_module_snapshot restored;

		if (!transaction->old_removed[old_idx]) {
			continue;
		}

		const int err = configure_module(&old_config->modules[old_idx],
			transaction->old_live[old_idx].revision,
			&restored);

		if ((err < 0) && (first_error == 0)) {
			first_error = err;
		}
	}

	return first_error;
}

static int validation_failure(struct spaghetti_config_failure *failure,
			      enum spaghetti_config_failure_field field,
			      size_t index,
			      enum spaghetti_config_failure_reason reason,
			      int err)
{
	if (failure != NULL) {
		failure->field = field;
		failure->index = index;
		failure->reason = reason;
	}

	return err;
}

int spaghetti_config_init(const struct spaghetti_config *defaults)
{
	uint8_t hash[SPAGHETTI_CONFIG_HASH_SIZE];
	int err;

	if (defaults != NULL) {
		err = spaghetti_config_validate(defaults, NULL);
		if (err < 0) {
			return err;
		}
		err = compute_config_hash(defaults, hash);
		if (err < 0) {
			return err;
		}
	}

	err = k_mutex_lock(&config_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (is_initialized) {
		k_mutex_unlock(&config_lock);
		return -EALREADY;
	}

	if (defaults == NULL) {
		memset(&current_config, 0, sizeof(current_config));
		current_config.version = SPAGHETTI_CONFIG_VERSION;
#if defined(CONFIG_SPAGHETTI_CONNECTIVITY_BOOT_LOW_ENERGY)
		current_config.connectivity_policy =
			SPAGHETTI_CONNECTIVITY_LOW_ENERGY;
#else
		current_config.connectivity_policy =
			SPAGHETTI_CONNECTIVITY_ONLINE;
#endif
		current_config.energy_policy.ble_availability =
			(current_config.connectivity_policy ==
			 SPAGHETTI_CONNECTIVITY_ONLINE) ?
				SPAGHETTI_BLE_OFF :
				SPAGHETTI_BLE_ADVERTISING;
		err = spaghetti_config_validate(&current_config, NULL);
		if (err == 0) {
			err = compute_config_hash(&current_config, hash);
		}
		if (err < 0) {
			memset(&current_config, 0, sizeof(current_config));
			k_mutex_unlock(&config_lock);
			return err;
		}
	} else {
		current_config = *defaults;
	}

	current_revision.generation = 1U;
	memcpy(current_revision.sha256, hash, sizeof(hash));
	last_persistent_write_ms = 0;
	is_initialized = true;
	k_mutex_unlock(&config_lock);
	LOG_INF("ready: generation=1");
	return 0;
}

int spaghetti_config_validate(const struct spaghetti_config *candidate,
			      struct spaghetti_config_failure *failure)
{
	struct spaghetti_module_endpoint
		endpoints[SPAGHETTI_CONFIG_MAX_MODULES];
	const struct spaghetti_flow_descriptor
		*flows[SPAGHETTI_CONFIG_MAX_MODULES];

	if ((candidate == NULL) ||
	    (candidate->version != SPAGHETTI_CONFIG_VERSION) ||
	    (candidate->module_count > SPAGHETTI_CONFIG_MAX_MODULES) ||
	    (candidate->schedule_count > SPAGHETTI_CONFIG_MAX_SCHEDULES) ||
	    (candidate->rule_count > SPAGHETTI_CONFIG_MAX_RULES) ||
	    (candidate->block_count > SPAGHETTI_CONFIG_MAX_BLOCKS) ||
	    (candidate->edge_count > SPAGHETTI_CONFIG_MAX_EDGES)) {
		return validation_failure(failure, SPAGHETTI_CONFIG_FAILURE_ROOT,
			0U, SPAGHETTI_CONFIG_FAILURE_RANGE, -EINVAL);
	}
	if (!mqtt_config_is_valid(&candidate->mqtt)) {
		return validation_failure(failure, SPAGHETTI_CONFIG_FAILURE_MQTT,
			0U, SPAGHETTI_CONFIG_FAILURE_INCONSISTENT, -EINVAL);
	}
	if (!connectivity_policy_is_valid(candidate->connectivity_policy)) {
		return validation_failure(failure,
			SPAGHETTI_CONFIG_FAILURE_CONNECTIVITY, 0U,
			SPAGHETTI_CONFIG_FAILURE_RANGE, -EINVAL);
	}
	if (!energy_policy_is_valid(&candidate->energy_policy)) {
		return validation_failure(failure, SPAGHETTI_CONFIG_FAILURE_ENERGY,
			0U, SPAGHETTI_CONFIG_FAILURE_INCONSISTENT, -EINVAL);
	}
	if ((candidate->connectivity_policy ==
	     SPAGHETTI_CONNECTIVITY_ONLINE) &&
	    (candidate->energy_policy.ble_availability != SPAGHETTI_BLE_OFF)) {
		return validation_failure(failure, SPAGHETTI_CONFIG_FAILURE_ENERGY,
			0U, SPAGHETTI_CONFIG_FAILURE_INCONSISTENT, -EINVAL);
	}
	if ((candidate->connectivity_policy ==
	     SPAGHETTI_CONNECTIVITY_LOW_ENERGY) &&
	    candidate->mqtt.enabled) {
		return validation_failure(failure, SPAGHETTI_CONFIG_FAILURE_MQTT,
			0U, SPAGHETTI_CONFIG_FAILURE_INCONSISTENT, -EINVAL);
	}

	for (size_t module_idx = 0U; module_idx < candidate->module_count;
	     ++module_idx) {
		int err = describe_module(&candidate->modules[module_idx],
					  &endpoints[module_idx],
					  &flows[module_idx]);

		if (err < 0) {
			const enum spaghetti_config_failure_reason reason =
				(err == -ENOTSUP) ?
				SPAGHETTI_CONFIG_FAILURE_UNKNOWN_TYPE :
				SPAGHETTI_CONFIG_FAILURE_INCONSISTENT;

			return validation_failure(failure,
				SPAGHETTI_CONFIG_FAILURE_MODULE, module_idx,
				reason, err);
		}

		for (size_t previous_idx = 0U; previous_idx < module_idx;
		     ++previous_idx) {
			if (candidate->modules[previous_idx].key ==
			    candidate->modules[module_idx].key) {
				return validation_failure(failure,
					SPAGHETTI_CONFIG_FAILURE_MODULE,
					module_idx,
					SPAGHETTI_CONFIG_FAILURE_DUPLICATE,
					-EEXIST);
			}

			if ((candidate->modules[previous_idx].port_id ==
			     candidate->modules[module_idx].port_id) &&
			    endpoints_conflict(&endpoints[previous_idx],
					       &endpoints[module_idx])) {
				return validation_failure(failure,
					SPAGHETTI_CONFIG_FAILURE_MODULE,
					module_idx,
					SPAGHETTI_CONFIG_FAILURE_DUPLICATE,
					-EADDRINUSE);
			}

			if ((candidate->modules[module_idx].bay_id !=
			     SPAGHETTI_BAY_ID_UNSPECIFIED) &&
			    (candidate->modules[previous_idx].bay_id ==
			     candidate->modules[module_idx].bay_id) &&
			    (flows[previous_idx] != NULL) &&
			    (flows[module_idx] != NULL) &&
			    (flows[previous_idx]->id == flows[module_idx]->id)) {
				return validation_failure(failure,
					SPAGHETTI_CONFIG_FAILURE_MODULE,
					module_idx,
					SPAGHETTI_CONFIG_FAILURE_DUPLICATE,
					-EADDRINUSE);
			}
		}
	}

	for (size_t schedule_idx = 0U; schedule_idx < candidate->schedule_count;
	     ++schedule_idx) {
		const struct spaghetti_runtime_schedule_config *schedule =
			&candidate->schedules[schedule_idx];

		if ((schedule->source_key == 0U) ||
		    (schedule->period_ms == 0U) ||
		    (find_module_index(candidate, schedule->source_key) < 0)) {
			return validation_failure(failure,
				SPAGHETTI_CONFIG_FAILURE_SCHEDULE, schedule_idx,
				SPAGHETTI_CONFIG_FAILURE_INCONSISTENT, -EINVAL);
		}
		if (schedule->enabled &&
		    !module_supports_read(candidate, schedule->source_key)) {
			return validation_failure(failure,
				SPAGHETTI_CONFIG_FAILURE_SCHEDULE, schedule_idx,
				SPAGHETTI_CONFIG_FAILURE_INCONSISTENT, -ENOTSUP);
		}
	}

	for (size_t rule_idx = 0U; rule_idx < candidate->rule_count; ++rule_idx) {
		const struct spaghetti_rule_config *rule =
			&candidate->rules[rule_idx];
		const struct spaghetti_rule_driver *driver;

		if ((rule->key == 0U) || !type_id_is_valid(rule->type_id)) {
			return validation_failure(failure,
				SPAGHETTI_CONFIG_FAILURE_RULE, rule_idx,
				SPAGHETTI_CONFIG_FAILURE_INCONSISTENT, -EINVAL);
		}

		for (size_t previous_idx = 0U; previous_idx < rule_idx;
		     ++previous_idx) {
			if (candidate->rules[previous_idx].key == rule->key) {
				return validation_failure(failure,
					SPAGHETTI_CONFIG_FAILURE_RULE, rule_idx,
					SPAGHETTI_CONFIG_FAILURE_DUPLICATE,
					-EEXIST);
			}
		}

		driver = spaghetti_rule_registry_find(rule->type_id);
		if ((driver == NULL) || (driver->ops == NULL) ||
		    (driver->ops->validate_config == NULL)) {
			return validation_failure(failure,
				SPAGHETTI_CONFIG_FAILURE_RULE, rule_idx,
				SPAGHETTI_CONFIG_FAILURE_UNKNOWN_TYPE, -ENOTSUP);
		}

		{
			const int err =
				driver->ops->validate_config(&rule->properties);

			if (err < 0) {
				return validation_failure(failure,
					SPAGHETTI_CONFIG_FAILURE_RULE, rule_idx,
					SPAGHETTI_CONFIG_FAILURE_INCONSISTENT,
					err);
			}
		}
	}

	{
		const int err = spaghetti_processing_validate_graph(
			candidate->blocks, candidate->block_count,
			candidate->edges, candidate->edge_count,
			candidate->modules, candidate->module_count);

		if (err < 0) {
			enum spaghetti_config_failure_field field =
				SPAGHETTI_CONFIG_FAILURE_BLOCK;
			enum spaghetti_config_failure_reason reason =
				SPAGHETTI_CONFIG_FAILURE_INCONSISTENT;

			if (err == -ENOTSUP) {
				reason = SPAGHETTI_CONFIG_FAILURE_UNKNOWN_TYPE;
			} else if (err == -EEXIST) {
				reason = SPAGHETTI_CONFIG_FAILURE_DUPLICATE;
			} else if ((err == -ELOOP) || (err == -ENOENT)) {
				field = SPAGHETTI_CONFIG_FAILURE_EDGE;
			}

			return validation_failure(failure, field, 0U, reason,
						  err);
		}
	}

	return 0;
}

int spaghetti_config_apply(
	const struct spaghetti_config *candidate,
	uint32_t expected_generation,
	struct spaghetti_config_commit_result *out_result)
{
	struct spaghetti_config_transaction transaction = {0};
	struct spaghetti_config_revision old_revision = {0};
	uint8_t candidate_hash[SPAGHETTI_CONFIG_HASH_SIZE];
	bool mqtt_changed;
	bool connectivity_changed;
	bool mqtt_reconfigured = false;
	bool connectivity_reconfigured = false;
	bool candidate_persisted = false;
	uint32_t next_generation;
	int apply_error = 0;
	int err;

	err = spaghetti_config_validate(candidate, NULL);
	if (err < 0) {
		return err;
	}
	if (expected_generation == 0U) {
		return -EINVAL;
	}

	err = compute_config_hash(candidate, candidate_hash);
	if (err < 0) {
		return err;
	}

	err = k_mutex_lock(&config_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!is_initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (expected_generation != current_revision.generation) {
		err = -ESTALE;
		goto unlock;
	}
	if (memcmp(current_revision.sha256, candidate_hash,
		   sizeof(candidate_hash)) == 0) {
		if (out_result != NULL) {
			out_result->revision = current_revision;
			out_result->changed = false;
		}
		k_mutex_unlock(&config_lock);
		return 0;
	}
	if (current_revision.generation == UINT32_MAX) {
		err = -EOVERFLOW;
		goto unlock;
	}
	if (CONFIG_SPAGHETTI_CONFIG_MIN_WRITE_INTERVAL_MS > 0) {
		const int64_t now_ms = k_uptime_get();

		if ((last_persistent_write_ms != 0) &&
		    ((now_ms - last_persistent_write_ms) <
		     CONFIG_SPAGHETTI_CONFIG_MIN_WRITE_INTERVAL_MS)) {
			err = -EBUSY;
			goto unlock;
		}
	}

	old_revision = current_revision;
	next_generation = current_revision.generation + 1U;
	mqtt_changed = !mqtt_configs_are_equal(&current_config.mqtt,
					       &candidate->mqtt);
	connectivity_changed =
		current_config.connectivity_policy != candidate->connectivity_policy;

	if (config_needs_runtime(&current_config)) {
		err = spaghetti_runtime_stop(
			K_MSEC(CONFIG_SPAGHETTI_RUNTIME_STOP_TIMEOUT_MS));
		if ((err < 0) && (err != -EALREADY)) {
			k_mutex_unlock(&config_lock);
			return err;
		}
	}

	for (size_t old_idx = 0U; old_idx < current_config.module_count; ++old_idx) {
		err = spaghetti_module_manager_get_by_key(
			current_config.modules[old_idx].key,
			&transaction.old_live[old_idx]);
		if (err < 0) {
			apply_error = err;
			goto rollback;
		}
	}

	for (size_t old_idx = 0U; old_idx < current_config.module_count; ++old_idx) {
		const int candidate_idx = find_module_index(
			candidate, current_config.modules[old_idx].key);
		const bool unchanged =
			(candidate_idx >= 0) &&
			module_configs_are_equal(
				&current_config.modules[old_idx],
				&candidate->modules[candidate_idx]);

		if (unchanged) {
			continue;
		}

		err = remove_module(&transaction.old_live[old_idx]);
		if ((err == 0) ||
		    module_is_absent(current_config.modules[old_idx].key)) {
			transaction.old_removed[old_idx] = true;
		}
		if (err < 0) {
			apply_error = err;
			goto rollback;
		}
	}

	for (size_t candidate_idx = 0U;
	     candidate_idx < candidate->module_count; ++candidate_idx) {
		const int old_idx = find_module_index(
			&current_config, candidate->modules[candidate_idx].key);
		const bool unchanged =
			(old_idx >= 0) &&
			module_configs_are_equal(
				&current_config.modules[old_idx],
				&candidate->modules[candidate_idx]);

		if (unchanged) {
			continue;
		}

		err = configure_module(&candidate->modules[candidate_idx],
				       next_generation,
				       &transaction.candidate_live[candidate_idx]);
		if (err < 0) {
			apply_error = err;
			goto rollback;
		}
		transaction.candidate_added[candidate_idx] = true;
	}

	err = load_runtime(candidate);
	if (err < 0) {
		apply_error = err;
		goto rollback;
	}

	if (mqtt_changed) {
		mqtt_reconfigured = true;
		err = configure_mqtt(&candidate->mqtt);
		if (err < 0) {
			apply_error = err;
			goto rollback;
		}
	}

	if (connectivity_changed) {
		connectivity_reconfigured = true;
		err = apply_connectivity_policy(candidate->connectivity_policy);
		if (err < 0) {
			apply_error = err;
			goto rollback;
		}
	}

	err = spaghetti_storage_write_config(candidate);
	if (err < 0) {
		apply_error = err;
		goto rollback;
	}
	candidate_persisted = true;

	err = start_runtime(candidate);
	if (err < 0) {
		apply_error = err;
		goto rollback;
	}

	current_config = *candidate;
	current_revision.generation = next_generation;
	memcpy(current_revision.sha256, candidate_hash, sizeof(candidate_hash));
	last_persistent_write_ms = k_uptime_get();
	if (out_result != NULL) {
		out_result->revision = current_revision;
		out_result->changed = true;
	}
	k_mutex_unlock(&config_lock);

	LOG_INF("applied: generation=%u modules=%u schedules=%u",
		current_revision.generation, (uint32_t)candidate->module_count,
		(uint32_t)candidate->schedule_count);
	return 0;

rollback:
	err = rollback_transaction(&current_config, &transaction);
	if (err == 0) {
		err = restore_runtime(&current_config);
	}
	if (mqtt_reconfigured) {
		const int mqtt_error = configure_mqtt(&current_config.mqtt);

		if ((err == 0) && (mqtt_error < 0)) {
			err = mqtt_error;
		}
	}
	if (connectivity_reconfigured) {
		const int policy_error =
			apply_connectivity_policy(current_config.connectivity_policy);

		if ((err == 0) && (policy_error < 0)) {
			err = policy_error;
		}
	}
	if (candidate_persisted) {
		const int storage_error =
			spaghetti_storage_write_config(&current_config);

		if ((err == 0) && (storage_error < 0)) {
			err = storage_error;
		}
	}
	current_revision = old_revision;
	k_mutex_unlock(&config_lock);
	if (err < 0) {
		LOG_ERR("apply failed: err=%d rollback=%d", apply_error, err);
		return -EIO;
	}

	LOG_WRN("apply rejected and previous state restored: err=%d",
		apply_error);
	return apply_error;

unlock:
	k_mutex_unlock(&config_lock);
	return err;
}

int spaghetti_config_get_snapshot(
	struct spaghetti_config *out,
	struct spaghetti_config_revision *out_revision)
{
	int err;

	if ((out == NULL) || (out_revision == NULL)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&config_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	if (!is_initialized) {
		k_mutex_unlock(&config_lock);
		return -EACCES;
	}

	*out = current_config;
	*out_revision = current_revision;
	k_mutex_unlock(&config_lock);
	return 0;
}

int spaghetti_config_get_revision(struct spaghetti_config_revision *out_revision)
{
	int err;

	if (out_revision == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&config_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}

	if (!is_initialized) {
		k_mutex_unlock(&config_lock);
		return -EACCES;
	}

	*out_revision = current_revision;
	k_mutex_unlock(&config_lock);
	return 0;
}

K_MUTEX_DEFINE(config_workspace_lock);
static struct spaghetti_config config_workspace;

struct spaghetti_config *spaghetti_config_acquire_workspace(void)
{
	if (k_mutex_lock(&config_workspace_lock, K_FOREVER) != 0) {
		return NULL;
	}

	return &config_workspace;
}

void spaghetti_config_release_workspace(struct spaghetti_config *config)
{
	if (config == &config_workspace) {
		k_mutex_unlock(&config_workspace_lock);
	}
}
