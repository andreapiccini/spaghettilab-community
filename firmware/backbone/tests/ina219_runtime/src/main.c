#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/device.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/init.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <ina219.h>

#include <spaghetti/driver_registry.h>
#include <spaghetti/module_driver.h>
#include <spaghetti/module_manager.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/schema.h>
#include <spaghetti/topology.h>

#define SPAGHETTI_TEST_INA219_ADDRESS_MIN 0x40U
#define SPAGHETTI_TEST_INA219_ADDRESS_COUNT 16U
#define SPAGHETTI_TEST_INA219_REGISTER_COUNT 6U
#define SPAGHETTI_TEST_INA219_REG_BUS_VOLTAGE 0x02U
#define SPAGHETTI_TEST_INA219_REG_POWER 0x03U
#define SPAGHETTI_TEST_INA219_REG_CURRENT 0x04U
#define SPAGHETTI_TEST_INA219_REG_CALIBRATION 0x05U
#define SPAGHETTI_TEST_INA219_BUS_CNVR BIT(1)
#define SPAGHETTI_TEST_INA219_BUS_OVF BIT(0)

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
};

struct fake_i2c_bus {
	uint16_t registers[SPAGHETTI_TEST_INA219_ADDRESS_COUNT]
			  [SPAGHETTI_TEST_INA219_REGISTER_COUNT];
	bool conversion_ready[SPAGHETTI_TEST_INA219_ADDRESS_COUNT];
	bool overflow[SPAGHETTI_TEST_INA219_ADDRESS_COUNT];
	int transfer_error;
};

static struct fake_i2c_bus fake_bus;

static bool fake_address_is_valid(uint16_t address)
{
	return (address >= SPAGHETTI_TEST_INA219_ADDRESS_MIN) &&
	       (address < (SPAGHETTI_TEST_INA219_ADDRESS_MIN +
			   SPAGHETTI_TEST_INA219_ADDRESS_COUNT));
}

static int fake_i2c_transfer(const struct device *device, struct i2c_msg *messages,
			     uint8_t message_count, uint16_t address)
{
	struct fake_i2c_bus *bus = device->data;
	size_t address_idx;
	uint8_t reg;
	uint16_t value;

	if (bus->transfer_error < 0) {
		return bus->transfer_error;
	}

	if (!fake_address_is_valid(address) || (messages == NULL)) {
		return -EINVAL;
	}

	address_idx = address - SPAGHETTI_TEST_INA219_ADDRESS_MIN;
	if ((message_count == 1U) && (messages[0].len == 3U)) {
		reg = messages[0].buf[0];
		if (reg >= SPAGHETTI_TEST_INA219_REGISTER_COUNT) {
			return -EINVAL;
		}

		bus->registers[address_idx][reg] = sys_get_be16(&messages[0].buf[1]);
		return 0;
	}

	if ((message_count != 2U) || (messages[0].len != 1U) ||
	    (messages[1].len != 2U)) {
		return -EINVAL;
	}

	reg = messages[0].buf[0];
	if (reg >= SPAGHETTI_TEST_INA219_REGISTER_COUNT) {
		return -EINVAL;
	}

	value = bus->registers[address_idx][reg];
	if (reg == SPAGHETTI_TEST_INA219_REG_BUS_VOLTAGE) {
		value &= ~(SPAGHETTI_TEST_INA219_BUS_CNVR | SPAGHETTI_TEST_INA219_BUS_OVF);
		if (bus->conversion_ready[address_idx]) {
			value |= SPAGHETTI_TEST_INA219_BUS_CNVR;
		}
		if (bus->overflow[address_idx]) {
			value |= SPAGHETTI_TEST_INA219_BUS_OVF;
		}
	}

	sys_put_be16(value, messages[1].buf);
	return 0;
}

static int fake_i2c_init(const struct device *device)
{
	struct fake_i2c_bus *bus = device->data;

	memset(bus, 0, sizeof(*bus));
	for (size_t address_idx = 0U;
	     address_idx < SPAGHETTI_TEST_INA219_ADDRESS_COUNT; ++address_idx) {
		bus->conversion_ready[address_idx] = true;
	}

	return 0;
}

static const struct i2c_driver_api fake_i2c_api = {
	.transfer = fake_i2c_transfer,
};

DEVICE_DEFINE(fake_i2c, "fake_i2c", fake_i2c_init, NULL, &fake_bus, NULL,
	      POST_KERNEL, CONFIG_KERNEL_INIT_PRIORITY_DEVICE, &fake_i2c_api);

static const struct spaghetti_port fake_port = {
	.id = 0U,
	.capabilities = SPAGHETTI_PORT_CAP_I2C,
};

const struct spaghetti_port *spaghetti_port_get(spaghetti_port_id_t id)
{
	return (id == fake_port.id) ? &fake_port : NULL;
}

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				    uint32_t capabilities)
{
	return (port != NULL) && (capabilities != 0U) &&
	       ((port->capabilities & capabilities) == capabilities);
}

const struct device *spaghetti_port_i2c_device(const struct spaghetti_port *port)
{
	ARG_UNUSED(port);
	return NULL;
}

int spaghetti_port_i2c_transfer(
	const struct spaghetti_port *port,
	const struct spaghetti_port_i2c_request *request,
	k_timeout_t timeout)
{
	ARG_UNUSED(timeout);

	if ((port != &fake_port) || (request == NULL) ||
	    (request->messages == NULL) || (request->message_count == 0U)) {
		return -EINVAL;
	}

	return fake_i2c_transfer(DEVICE_GET(fake_i2c), request->messages,
				 request->message_count, request->address);
}

int spaghetti_port_acquire(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner,
	enum spaghetti_port_transport transport)
{
	ARG_UNUSED(transport);
	return ((port != NULL) && (owner != 0U)) ? 0 : -EINVAL;
}

int spaghetti_port_release(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner)
{
	return ((port != NULL) && (owner != 0U)) ? 0 : -EINVAL;
}

const struct spaghetti_flow_descriptor *spaghetti_topology_flow_for_port(
	spaghetti_port_id_t port_id)
{
	ARG_UNUSED(port_id);
	return NULL;
}

int spaghetti_topology_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_descriptor *out)
{
	ARG_UNUSED(flow_id);
	ARG_UNUSED(bay_id);
	ARG_UNUSED(out);
	return -ENOENT;
}

const struct spaghetti_module_driver *spaghetti_driver_registry_find(
	const char *type_id)
{
	if ((type_id != NULL) &&
	    (strcmp(type_id, spaghetti_ina219_driver.type_id) == 0)) {
		return &spaghetti_ina219_driver;
	}

	return NULL;
}

static int configure_ina219(spaghetti_module_key_t key, uint8_t address,
			    spaghetti_module_id_t *out_id)
{
	const struct spaghetti_ina219_config config = {
		.i2c_address = address,
		.shunt_milliohm = 100U,
		.current_lsb_microamp = 200U,
	};
	struct spaghetti_property_set properties;
	struct spaghetti_module_request request;
	int err;

	err = spaghetti_ina219_config_to_properties(&config, &properties);
	if (err < 0) {
		return err;
	}

	memset(&request, 0, sizeof(request));
	request.key = key;
	request.port_id = 0U;
	request.type_id = "ina219";
	request.config = &properties;
	request.placement.bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	request.placement.power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	request.revision = 1U;

	return spaghetti_module_manager_configure(&request, out_id);
}

static void set_measurement(uint8_t address, uint32_t bus_uv, int32_t current_ua,
			    uint32_t power_uw)
{
	const size_t address_idx = address - SPAGHETTI_TEST_INA219_ADDRESS_MIN;

	fake_bus.registers[address_idx][SPAGHETTI_TEST_INA219_REG_BUS_VOLTAGE] =
		(uint16_t)((bus_uv / 4000U) << 3U);
	fake_bus.registers[address_idx][SPAGHETTI_TEST_INA219_REG_CURRENT] =
		(uint16_t)(int16_t)(current_ua / 200);
	fake_bus.registers[address_idx][SPAGHETTI_TEST_INA219_REG_POWER] =
		(uint16_t)(power_uw / 4000U);
}

ZTEST(ina219_runtime, test_validation_and_two_runtime_instances)
{
	const struct spaghetti_ina219_config invalid_address = {
		.i2c_address = 0x3FU,
		.shunt_milliohm = 100U,
		.current_lsb_microamp = 200U,
	};
	struct spaghetti_property_set invalid_properties;
	struct spaghetti_module_endpoint endpoint = {
		.kind = SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE,
		.value_size = 0U,
		.value = {0xFFU},
	};
	struct spaghetti_module_snapshot snapshot;
	struct spaghetti_record record;
	const struct spaghetti_value *bus;
	const struct spaghetti_value *current;
	const struct spaghetti_value *power;
	spaghetti_module_id_t id_40;
	spaghetti_module_id_t id_41;
	spaghetti_module_id_t id_42;
	spaghetti_module_id_t id_43;
	spaghetti_module_id_t ignored_id;
	size_t module_count;

	zassert_ok(spaghetti_ina219_config_to_properties(&invalid_address,
							 &invalid_properties));
	zassert_equal(spaghetti_ina219_driver.ops->validate_config(
			      &invalid_properties),
		      -ERANGE);
	endpoint.kind = SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE;
	endpoint.value[0] = 0xFFU;
	zassert_equal(spaghetti_ina219_driver.ops->describe_endpoint(
			      &invalid_properties, &endpoint),
		      -ERANGE);
	zassert_equal(endpoint.kind, SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE);
	zassert_equal(endpoint.value[0], 0xFFU);

	zassert_ok(spaghetti_module_manager_init());
	zassert_ok(configure_ina219(10U, 0x40U, &id_40));
	zassert_ok(configure_ina219(11U, 0x41U, &id_41));
	zassert_ok(spaghetti_module_manager_get_by_key(10U, &snapshot));
	zassert_equal(snapshot.endpoint.value[0], 0x40U);
	zassert_ok(spaghetti_module_manager_get_by_key(11U, &snapshot));
	zassert_equal(snapshot.endpoint.value[0], 0x41U);
	zassert_ok(spaghetti_module_manager_list_by_port(0U, NULL, 0U, &module_count));
	zassert_equal(module_count, 2U);

	zassert_equal(
		fake_bus.registers[0U][SPAGHETTI_TEST_INA219_REG_CALIBRATION], 0x0800U);
	zassert_equal(
		fake_bus.registers[1U][SPAGHETTI_TEST_INA219_REG_CALIBRATION], 0x0800U);
	set_measurement(0x40U, 5000000U, 120000, 600000U);
	set_measurement(0x41U, 12000000U, -40000, 480000U);

	zassert_ok(spaghetti_module_manager_read(id_40, &record));
	bus = spaghetti_property_find(&record.payload.values,
				      SPAGHETTI_INA219_FIELD_BUS_VOLTAGE_MICROVOLTS);
	current = spaghetti_property_find(&record.payload.values,
					  SPAGHETTI_INA219_FIELD_CURRENT_MICROAMPS);
	power = spaghetti_property_find(&record.payload.values,
					SPAGHETTI_INA219_FIELD_POWER_MICROWATTS);
	zassert_not_null(bus);
	zassert_not_null(current);
	zassert_not_null(power);
	zassert_equal(bus->data.signed_integer, 5000000);
	zassert_equal(current->data.signed_integer, 120000);
	zassert_equal(power->data.unsigned_integer, 600000U);
	zassert_ok(spaghetti_module_manager_read(id_41, &record));
	bus = spaghetti_property_find(&record.payload.values,
				      SPAGHETTI_INA219_FIELD_BUS_VOLTAGE_MICROVOLTS);
	current = spaghetti_property_find(&record.payload.values,
					  SPAGHETTI_INA219_FIELD_CURRENT_MICROAMPS);
	power = spaghetti_property_find(&record.payload.values,
					SPAGHETTI_INA219_FIELD_POWER_MICROWATTS);
	zassert_equal(bus->data.signed_integer, 12000000);
	zassert_equal(current->data.signed_integer, -40000);
	zassert_equal(power->data.unsigned_integer, 480000U);

	record.payload.values.fields[0].data.signed_integer = -1;
	fake_bus.conversion_ready[0U] = false;
	zassert_equal(spaghetti_module_manager_read(id_40, &record), -ETIMEDOUT);
	zassert_equal(record.payload.values.fields[0].data.signed_integer, -1);
	fake_bus.conversion_ready[0U] = true;
	fake_bus.overflow[0U] = true;
	zassert_equal(spaghetti_module_manager_read(id_40, &record), -ERANGE);
	zassert_equal(record.payload.values.fields[0].data.signed_integer, -1);
	fake_bus.overflow[0U] = false;
	fake_bus.transfer_error = -EIO;
	zassert_equal(spaghetti_module_manager_read(id_40, &record), -EIO);
	zassert_equal(record.payload.values.fields[0].data.signed_integer, -1);
	fake_bus.transfer_error = 0;

	zassert_ok(spaghetti_module_manager_remove(id_41, 1U));
	zassert_ok(spaghetti_module_manager_read(id_40, &record));
	zassert_ok(configure_ina219(12U, 0x41U, &id_41));
	zassert_ok(configure_ina219(13U, 0x42U, &id_42));
	zassert_ok(configure_ina219(14U, 0x43U, &id_43));
	zassert_equal(configure_ina219(15U, 0x44U, &ignored_id), -ENOMEM);

	zassert_ok(spaghetti_module_manager_remove(id_40, 1U));
	zassert_ok(spaghetti_module_manager_remove(id_41, 1U));
	zassert_ok(spaghetti_module_manager_remove(id_42, 1U));
	zassert_ok(spaghetti_module_manager_remove(id_43, 1U));
}

ZTEST_SUITE(ina219_runtime, NULL, NULL, NULL, NULL, NULL);
