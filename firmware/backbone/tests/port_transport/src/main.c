#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/drivers/i2c.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/module.h>
#include <spaghetti/port.h>

struct spaghetti_port {
	spaghetti_port_id_t id;
	uint32_t capabilities;
	bool transport_active;
	enum spaghetti_port_transport active_transport;
	size_t owner_count;
	spaghetti_port_owner_t owners[4];
};

static struct k_mutex shared_lock;
static struct k_sem transfer_done;
static atomic_t concurrent_transfers;
static atomic_t max_concurrent_transfers;
static int backend_select_count;
static int backend_safe_count;
static bool fail_backend_select;

K_THREAD_STACK_DEFINE(transfer_stack_a, 1024);
K_THREAD_STACK_DEFINE(transfer_stack_b, 1024);

static struct spaghetti_port ports[] = {
	{
		.id = 0U,
		.capabilities = SPAGHETTI_PORT_CAP_I2C | SPAGHETTI_PORT_CAP_UART,
	},
	{
		.id = 1U,
		.capabilities = SPAGHETTI_PORT_CAP_I2C,
	},
};

static bool transport_shareable(enum spaghetti_port_transport transport)
{
	return (transport == SPAGHETTI_PORT_TRANSPORT_I2C) ||
	       (transport == SPAGHETTI_PORT_TRANSPORT_SPI) ||
	       (transport == SPAGHETTI_PORT_TRANSPORT_W1);
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

static int fake_backend_select(enum spaghetti_port_transport transport)
{
	ARG_UNUSED(transport);
	backend_select_count++;
	return fail_backend_select ? -EIO : 0;
}

static int fake_backend_safe(void)
{
	backend_safe_count++;
	return 0;
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

bool spaghetti_port_has_capability(const struct spaghetti_port *port,
				    uint32_t capabilities)
{
	return (port != NULL) && (capabilities != 0U) &&
	       ((port->capabilities & capabilities) == capabilities);
}

int spaghetti_port_acquire(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner,
	enum spaghetti_port_transport transport)
{
	struct spaghetti_port *mutable_port;
	uint32_t required = 0U;

	if ((port == NULL) || (owner == 0U)) {
		return -EINVAL;
	}

	mutable_port = (struct spaghetti_port *)port;
	switch (transport) {
	case SPAGHETTI_PORT_TRANSPORT_I2C:
		required = SPAGHETTI_PORT_CAP_I2C;
		break;
	case SPAGHETTI_PORT_TRANSPORT_UART:
		required = SPAGHETTI_PORT_CAP_UART;
		break;
	default:
		return -ENOTSUP;
	}
	if (!spaghetti_port_has_capability(mutable_port, required)) {
		return -ENOTSUP;
	}

	for (size_t idx = 0U; idx < mutable_port->owner_count; ++idx) {
		if (mutable_port->owners[idx] == owner) {
			return -EALREADY;
		}
	}

	if (mutable_port->transport_active) {
		if (mutable_port->active_transport != transport) {
			return -EBUSY;
		}
		if (!transport_shareable(transport) &&
		    (mutable_port->owner_count > 0U)) {
			return -EBUSY;
		}
	} else {
		int err = fake_backend_select(transport);

		if (err < 0) {
			return err;
		}
		mutable_port->transport_active = true;
		mutable_port->active_transport = transport;
	}

	if (mutable_port->owner_count >= ARRAY_SIZE(mutable_port->owners)) {
		return -ENOMEM;
	}

	mutable_port->owners[mutable_port->owner_count++] = owner;
	return 0;
}

int spaghetti_port_release(
	const struct spaghetti_port *port,
	spaghetti_port_owner_t owner)
{
	struct spaghetti_port *mutable_port;
	size_t owner_idx = ARRAY_SIZE(ports[0].owners);

	if ((port == NULL) || (owner == 0U)) {
		return -EINVAL;
	}

	mutable_port = (struct spaghetti_port *)port;
	for (size_t idx = 0U; idx < mutable_port->owner_count; ++idx) {
		if (mutable_port->owners[idx] == owner) {
			owner_idx = idx;
			break;
		}
	}
	if (owner_idx >= mutable_port->owner_count) {
		return -ENOENT;
	}

	mutable_port->owners[owner_idx] =
		mutable_port->owners[mutable_port->owner_count - 1U];
	mutable_port->owner_count--;
	if (mutable_port->owner_count == 0U) {
		(void)fake_backend_safe();
		mutable_port->transport_active = false;
	}

	return 0;
}

int spaghetti_port_get_active_transport(
	const struct spaghetti_port *port,
	enum spaghetti_port_transport *out_transport,
	size_t *out_owner_count)
{
	if (port == NULL) {
		return -EINVAL;
	}
	if (!port->transport_active) {
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

int spaghetti_port_i2c_transfer(
	const struct spaghetti_port *port,
	const struct spaghetti_port_i2c_request *request,
	k_timeout_t timeout)
{
	int32_t concurrent;
	int err;

	if ((port == NULL) || (request == NULL)) {
		return -EINVAL;
	}
	if (K_TIMEOUT_EQ(timeout, K_FOREVER)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&shared_lock, timeout);
	if (err == -EAGAIN) {
		return -EBUSY;
	}
	if (err < 0) {
		return err;
	}

	concurrent = atomic_inc(&concurrent_transfers) + 1;
	if (concurrent > atomic_get(&max_concurrent_transfers)) {
		atomic_set(&max_concurrent_transfers, concurrent);
	}
	k_busy_wait(1000);
	atomic_dec(&concurrent_transfers);
	k_mutex_unlock(&shared_lock);
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

int spaghetti_port_adc_read(
	const struct spaghetti_port *port,
	uint8_t channel,
	int32_t *out_raw,
	int32_t *out_microvolts,
	k_timeout_t timeout)
{
	ARG_UNUSED(port);
	ARG_UNUSED(out_raw);
	ARG_UNUSED(out_microvolts);
	ARG_UNUSED(timeout);

	if (channel > 4U) {
		return -EINVAL;
	}

	return -ENOTSUP;
}

int spaghetti_port_w1_write_read(
	const struct spaghetti_port *port,
	const uint8_t rom[SPAGHETTI_ENDPOINT_VALUE_MAX],
	const uint8_t *write_data,
	size_t write_size,
	uint8_t *read_data,
	size_t read_size,
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

int spaghetti_port_get_input(const struct spaghetti_port *port, bool *out_high)
{
	ARG_UNUSED(port);
	ARG_UNUSED(out_high);
	return -ENOTSUP;
}

static void port_transport_before(void *fixture)
{
	ARG_UNUSED(fixture);
	k_mutex_init(&shared_lock);
	k_sem_init(&transfer_done, 0, 2);
	atomic_set(&concurrent_transfers, 0);
	atomic_set(&max_concurrent_transfers, 0);
	backend_select_count = 0;
	backend_safe_count = 0;
	fail_backend_select = false;
	for (size_t idx = 0U; idx < ARRAY_SIZE(ports); ++idx) {
		ports[idx].transport_active = false;
		ports[idx].owner_count = 0U;
		memset(ports[idx].owners, 0, sizeof(ports[idx].owners));
	}
}

static void transfer_worker(void *port_ptr, void *unused1, void *unused2)
{
	struct i2c_msg message = {0};
	uint8_t byte = 0U;
	const struct spaghetti_port_i2c_request request = {
		.address = 0x40U,
		.messages = &message,
		.message_count = 1U,
	};

	ARG_UNUSED(unused1);
	ARG_UNUSED(unused2);
	message.buf = &byte;
	message.len = 1U;
	message.flags = I2C_MSG_WRITE | I2C_MSG_STOP;
	zassert_ok(spaghetti_port_i2c_transfer(port_ptr, &request, K_MSEC(50)));
	k_sem_give(&transfer_done);
}

ZTEST(port_transport, test_shared_controller_serializes_transfers)
{
	struct k_thread thread_a;
	struct k_thread thread_b;

	zassert_ok(spaghetti_port_acquire(
		&ports[0], 10U, SPAGHETTI_PORT_TRANSPORT_I2C));
	zassert_ok(spaghetti_port_acquire(
		&ports[1], 11U, SPAGHETTI_PORT_TRANSPORT_I2C));

	k_thread_create(&thread_a, transfer_stack_a,
			K_THREAD_STACK_SIZEOF(transfer_stack_a), transfer_worker,
			&ports[0], NULL, NULL, 5, 0, K_NO_WAIT);
	k_thread_create(&thread_b, transfer_stack_b,
			K_THREAD_STACK_SIZEOF(transfer_stack_b), transfer_worker,
			&ports[1], NULL, NULL, 5, 0, K_NO_WAIT);
	zassert_ok(k_sem_take(&transfer_done, K_MSEC(200)));
	zassert_ok(k_sem_take(&transfer_done, K_MSEC(200)));
	zassert_equal(atomic_get(&max_concurrent_transfers), 1);
}

ZTEST(port_transport, test_owners_conflicts_limits_and_backend)
{
	enum spaghetti_port_transport transport = SPAGHETTI_PORT_TRANSPORT_UART;
	size_t owners = 0U;
	const struct spaghetti_module_endpoint i2c_a = {
		.kind = SPAGHETTI_ENDPOINT_I2C_ADDRESS,
		.value_size = 1U,
		.value = {0x40U},
	};
	const struct spaghetti_module_endpoint i2c_b = {
		.kind = SPAGHETTI_ENDPOINT_I2C_ADDRESS,
		.value_size = 1U,
		.value = {0x41U},
	};
	const struct spaghetti_module_endpoint exclusive = {
		.kind = SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE,
		.value_size = 0U,
	};
	const struct spaghetti_module_endpoint uart = {
		.kind = SPAGHETTI_ENDPOINT_UART_EXCLUSIVE,
		.value_size = 0U,
	};
	const struct spaghetti_module_endpoint w1_a = {
		.kind = SPAGHETTI_ENDPOINT_W1_ROM,
		.value_size = SPAGHETTI_ENDPOINT_VALUE_MAX,
		.value = {1U, 2U, 3U, 4U, 5U, 6U, 7U, 8U},
	};
	const struct spaghetti_module_endpoint w1_b = {
		.kind = SPAGHETTI_ENDPOINT_W1_ROM,
		.value_size = SPAGHETTI_ENDPOINT_VALUE_MAX,
		.value = {8U, 7U, 6U, 5U, 4U, 3U, 2U, 1U},
	};
	int32_t raw = 7;
	int32_t microvolts = 7;

	zassert_false(endpoints_conflict(&i2c_a, &i2c_b));
	zassert_false(endpoints_conflict(&w1_a, &w1_b));
	zassert_true(endpoints_conflict(&i2c_a, &exclusive));
	zassert_true(endpoints_conflict(&i2c_a, &uart));
	zassert_equal(spaghetti_port_adc_read(&ports[0], 5U, &raw, &microvolts,
					      K_MSEC(10)),
		      -EINVAL);
	zassert_equal(raw, 7);
	zassert_equal(microvolts, 7);
	zassert_equal(spaghetti_port_spi_transceive(&ports[0], NULL, K_MSEC(10)),
		      -ENOTSUP);

	zassert_ok(spaghetti_port_acquire(
		&ports[0], 1U, SPAGHETTI_PORT_TRANSPORT_I2C));
	zassert_ok(spaghetti_port_acquire(
		&ports[0], 2U, SPAGHETTI_PORT_TRANSPORT_I2C));
	zassert_equal(spaghetti_port_acquire(
			      &ports[0], 1U, SPAGHETTI_PORT_TRANSPORT_I2C),
		      -EALREADY);
	zassert_equal(spaghetti_port_acquire(
			      &ports[0], 3U, SPAGHETTI_PORT_TRANSPORT_UART),
		      -EBUSY);
	zassert_ok(spaghetti_port_get_active_transport(&ports[0], &transport,
						       &owners));
	zassert_equal(transport, SPAGHETTI_PORT_TRANSPORT_I2C);
	zassert_equal(owners, 2U);
	zassert_ok(spaghetti_port_release(&ports[0], 1U));
	zassert_ok(spaghetti_port_release(&ports[0], 2U));
	zassert_equal(backend_safe_count, 1);
	zassert_equal(spaghetti_port_get_active_transport(&ports[0], &transport,
							  &owners),
		      -ENOENT);

	fail_backend_select = true;
	zassert_equal(spaghetti_port_acquire(
			      &ports[0], 4U, SPAGHETTI_PORT_TRANSPORT_I2C),
		      -EIO);
	zassert_equal(raw, 7);
}

ZTEST_SUITE(port_transport, NULL, NULL, port_transport_before, NULL, NULL);
