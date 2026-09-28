/**
 * @file
 * @brief Port/service stubs for the V1 extension suite only.
 */

#include "harness.h"

#include <errno.h>
#include <string.h>

#include <zephyr/sys/util.h>

#include <spaghetti/energy.h>
#include <spaghetti/processing.h>
#include <spaghetti/runtime.h>
#include <spaghetti/storage.h>
#include <spaghetti/topology.h>

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
	bool transport_active;
	enum spaghetti_port_transport active_transport;
	spaghetti_port_owner_t owners[8];
	size_t owner_count;
};

static struct spaghetti_port ports[] = {
	{
		.id = 0U,
		.capabilities = SPAGHETTI_PORT_CAP_I2C |
				SPAGHETTI_PORT_CAP_DIGITAL_INPUT |
				SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT |
				SPAGHETTI_PORT_CAP_ADC,
	},
	{
		.id = 1U,
		.capabilities = SPAGHETTI_PORT_CAP_I2C |
				SPAGHETTI_PORT_CAP_DIGITAL_INPUT |
				SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT |
				SPAGHETTI_PORT_CAP_ADC,
	},
};

static struct v1_harness harness;

void v1_harness_reset(void)
{
	memset(&harness, 0, sizeof(harness));
	harness.connectivity = SPAGHETTI_CONNECTIVITY_ONLINE;
	harness.service_state = SPAGHETTI_SERVICE_STOPPED;
	harness.eeprom_enabled = true;
	harness.analog_enabled = true;
	harness.eeprom_identity[0] = 0xAAU;
	harness.eeprom_identity_size = 1U;
	harness.analog_identity[0] = 0xBBU;
	harness.analog_identity_size = 1U;
}

struct v1_harness *v1_harness_get(void)
{
	return &harness;
}

void v1_port_reset(void)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(ports); ++idx) {
		ports[idx].transport_active = false;
		ports[idx].owner_count = 0U;
		memset(ports[idx].owners, 0, sizeof(ports[idx].owners));
	}
}

static bool transport_shareable(enum spaghetti_port_transport transport)
{
	return (transport == SPAGHETTI_PORT_TRANSPORT_I2C) ||
	       (transport == SPAGHETTI_PORT_TRANSPORT_SPI) ||
	       (transport == SPAGHETTI_PORT_TRANSPORT_W1);
}

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(ports); ++idx) {
		if (ports[idx].id == id) {
			return &ports[idx];
		}
	}

	return NULL;
}

size_t spaghetti_port_count(void)
{
	return ARRAY_SIZE(ports);
}

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				   uint32_t capabilities)
{
	return (port != NULL) &&
	       ((port->capabilities & capabilities) == capabilities);
}

int spaghetti_port_acquire(const struct spaghetti_port *port,
			   spaghetti_port_owner_t owner,
			   enum spaghetti_port_transport transport)
{
	struct spaghetti_port *mutable_port;

	if ((port == NULL) || (owner == 0U)) {
		return -EINVAL;
	}

	mutable_port = (struct spaghetti_port *)port;
	if (mutable_port->transport_active) {
		if (mutable_port->active_transport != transport) {
			return -EBUSY;
		}
		if (!transport_shareable(transport) &&
		    (mutable_port->owner_count > 0U)) {
			return -EBUSY;
		}
	} else {
		mutable_port->transport_active = true;
		mutable_port->active_transport = transport;
	}

	for (size_t idx = 0U; idx < mutable_port->owner_count; ++idx) {
		if (mutable_port->owners[idx] == owner) {
			return 0;
		}
	}
	if (mutable_port->owner_count >= ARRAY_SIZE(mutable_port->owners)) {
		return -ENOMEM;
	}
	mutable_port->owners[mutable_port->owner_count++] = owner;
	return 0;
}

int spaghetti_port_release(const struct spaghetti_port *port,
			   spaghetti_port_owner_t owner)
{
	struct spaghetti_port *mutable_port;
	size_t found = SIZE_MAX;

	if ((port == NULL) || (owner == 0U)) {
		return -EINVAL;
	}

	mutable_port = (struct spaghetti_port *)port;
	for (size_t idx = 0U; idx < mutable_port->owner_count; ++idx) {
		if (mutable_port->owners[idx] == owner) {
			found = idx;
			break;
		}
	}
	if (found == SIZE_MAX) {
		return -ENOENT;
	}
	for (size_t idx = found; idx + 1U < mutable_port->owner_count; ++idx) {
		mutable_port->owners[idx] = mutable_port->owners[idx + 1U];
	}
	--mutable_port->owner_count;
	if (mutable_port->owner_count == 0U) {
		mutable_port->transport_active = false;
	}
	return 0;
}

int spaghetti_port_get_active_transport(
	const struct spaghetti_port *port,
	enum spaghetti_port_transport *out_transport,
	size_t *out_owner_count)
{
	if ((port == NULL) || !port->transport_active) {
		return -ENOENT;
	}
	if (out_transport != NULL) {
		*out_transport = port->active_transport;
	}
	if (out_owner_count != NULL) {
		*out_owner_count = port->owner_count;
	}
	return 0;
}

int spaghetti_storage_write_config(const struct spaghetti_config *config)
{
	if (harness.storage_error < 0) {
		return harness.storage_error;
	}
	if (config == NULL) {
		return -EINVAL;
	}
	harness.stored = *config;
	++harness.storage_writes;
	return 0;
}

int spaghetti_runtime_configure(
	const struct spaghetti_runtime_schedule_config *schedules,
	size_t schedule_count,
	const struct spaghetti_rule_config *rules,
	size_t rule_count)
{
	if (((schedules == NULL) && (schedule_count > 0U)) ||
	    ((rules == NULL) && (rule_count > 0U)) ||
	    (schedule_count > SPAGHETTI_CONFIG_MAX_SCHEDULES) ||
	    (rule_count > SPAGHETTI_CONFIG_MAX_RULES)) {
		return -EINVAL;
	}
	if (harness.runtime_running) {
		return -EBUSY;
	}
	harness.runtime_schedule_count = schedule_count;
	harness.runtime_rule_count = rule_count;
	return 0;
}

int spaghetti_runtime_start(void)
{
	if (harness.runtime_running) {
		return -EALREADY;
	}
	if ((harness.runtime_schedule_count == 0U) &&
	    (harness.runtime_rule_count == 0U)) {
		return -ENOENT;
	}
	harness.runtime_running = true;
	return 0;
}

int spaghetti_runtime_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	if (!harness.runtime_running) {
		return -EALREADY;
	}
	harness.runtime_running = false;
	return 0;
}

int spaghetti_mqtt_init(const struct spaghetti_mqtt_config *config)
{
	if (config == NULL) {
		return -EINVAL;
	}
	harness.mqtt = *config;
	return 0;
}

int spaghetti_service_get_state(const char *id,
				enum spaghetti_service_state *out)
{
	ARG_UNUSED(id);
	if (out == NULL) {
		return -EINVAL;
	}
	*out = harness.service_state;
	return 0;
}

int spaghetti_service_stop(const char *id, k_timeout_t timeout)
{
	ARG_UNUSED(id);
	ARG_UNUSED(timeout);
	harness.service_state = SPAGHETTI_SERVICE_STOPPED;
	return 0;
}

int spaghetti_service_start(const char *id)
{
	ARG_UNUSED(id);
	harness.service_state = SPAGHETTI_SERVICE_RUNNING;
	return 0;
}

int spaghetti_connectivity_set_policy(enum spaghetti_connectivity_policy policy)
{
	if ((policy != SPAGHETTI_CONNECTIVITY_LOW_ENERGY) &&
	    (policy != SPAGHETTI_CONNECTIVITY_ONLINE)) {
		return -EINVAL;
	}
	harness.connectivity = policy;
	return 0;
}

int spaghetti_power_backend_set(spaghetti_power_resource_id_t id, bool enabled)
{
	ARG_UNUSED(id);
	ARG_UNUSED(enabled);
	return 0;
}

int spaghetti_port_i2c_transfer(const struct spaghetti_port *port,
				const struct spaghetti_port_i2c_request *request,
				k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(request);
	ARG_UNUSED(timeout);
	return 0;
}

int spaghetti_port_spi_transceive(
	const struct spaghetti_port *port,
	const struct spaghetti_port_spi_request *request,
	k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(request);
	ARG_UNUSED(timeout);
	return -ENOTSUP;
}

int spaghetti_port_get_input(const struct spaghetti_port *port, bool *out_high)
{
	if ((port == NULL) || (out_high == NULL)) {
		return -EINVAL;
	}
	*out_high = false;
	return 0;
}

int spaghetti_port_set_output(const struct spaghetti_port *port, bool high)
{
	ARG_UNUSED(port);
	ARG_UNUSED(high);
	return 0;
}

int spaghetti_port_adc_read(const struct spaghetti_port *port, uint8_t channel,
			    int32_t *out_raw, int32_t *out_microvolts,
			    k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(channel);
	ARG_UNUSED(timeout);
	if ((out_raw == NULL) || (out_microvolts == NULL)) {
		return -EINVAL;
	}
	*out_raw = 0;
	*out_microvolts = 0;
	return 0;
}

int spaghetti_port_uart_write(const struct spaghetti_port *port,
			      const uint8_t *buf, size_t len,
			      k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(buf);
	ARG_UNUSED(len);
	ARG_UNUSED(timeout);
	return -ENOTSUP;
}

int spaghetti_port_uart_read_until(const struct spaghetti_port *port,
				   uint8_t *buf, size_t capacity,
				   uint8_t stop_byte, size_t *out_len,
				   k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(buf);
	ARG_UNUSED(capacity);
	ARG_UNUSED(stop_byte);
	ARG_UNUSED(timeout);
	if (out_len != NULL) {
		*out_len = 0U;
	}
	return -ENOTSUP;
}

int spaghetti_port_uart_read(const struct spaghetti_port *port, uint8_t *buf,
			     size_t len, k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(buf);
	ARG_UNUSED(len);
	ARG_UNUSED(timeout);
	return -ENOTSUP;
}

int spaghetti_port_w1_write_read(const struct spaghetti_port *port,
				 const uint8_t rom[SPAGHETTI_ENDPOINT_VALUE_MAX],
				 const uint8_t *write_data, size_t write_size,
				 uint8_t *read_data, size_t read_size,
				 k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(rom);
	ARG_UNUSED(write_data);
	ARG_UNUSED(write_size);
	ARG_UNUSED(read_data);
	ARG_UNUSED(read_size);
	ARG_UNUSED(timeout);
	return -ENOTSUP;
}
