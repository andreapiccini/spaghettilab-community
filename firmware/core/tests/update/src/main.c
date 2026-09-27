#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <zephyr/ztest.h>

#include <spaghetti/config.h>
#include <spaghetti/health.h>
#include <spaghetti/update.h>

static int prepare_calls;
static int finalize_calls;
static int cancel_calls;
static int confirm_calls;
static int write_calls;
static int next_prepare_error;
static int next_write_error;
static int next_finalize_error;
static int next_cancel_error;

int spaghetti_update_backend_get_capacity(size_t *out_size)
{
	zassert_not_null(out_size);
	*out_size = 4096U;
	return 0;
}

int spaghetti_update_backend_is_trial(bool *trial)
{
	zassert_not_null(trial);
	*trial = IS_ENABLED(CONFIG_SPAGHETTI_UPDATE_TEST_TRIAL);
	return 0;
}

int spaghetti_update_backend_active_slot(uint8_t *slot)
{
	zassert_not_null(slot);
	*slot = 1U;
	return 0;
}

int spaghetti_update_backend_prepare(void)
{
	const int err = next_prepare_error;

	++prepare_calls;
	next_prepare_error = 0;
	return err;
}

int spaghetti_update_backend_write(uint32_t offset, const uint8_t *data,
				   size_t data_size, bool last)
{
	const int err = next_write_error;

	zassert_not_null(data);
	zassert_equal(offset, 0U);
	zassert_equal(data_size, 4U);
	zassert_true(last);
	++write_calls;
	next_write_error = 0;
	return err;
}

int spaghetti_update_backend_finalize_test(void)
{
	const int err = next_finalize_error;

	++finalize_calls;
	next_finalize_error = 0;
	return err;
}

int spaghetti_update_backend_cancel(void)
{
	const int err = next_cancel_error;

	++cancel_calls;
	next_cancel_error = 0;
	return err;
}

int spaghetti_update_backend_confirm(void)
{
	++confirm_calls;
	return 0;
}

int spaghetti_config_get_snapshot(
	struct spaghetti_config *out,
	struct spaghetti_config_revision *out_revision)
{
	ARG_UNUSED(out);
	ARG_UNUSED(out_revision);
	return -EACCES;
}

int spaghetti_image_manifest_validate_candidate(
	const struct spaghetti_image_manifest *candidate,
	const struct spaghetti_config *config)
{
	ARG_UNUSED(candidate);
	ARG_UNUSED(config);
	return 0;
}

int spaghetti_health_heartbeat(spaghetti_health_component_id_t component_id)
{
	ARG_UNUSED(component_id);
	return 0;
}

int spaghetti_health_window_acquire(
	spaghetti_health_component_id_t component_id,
	k_timeout_t duration,
	spaghetti_health_window_token_t *out_token)
{
	ARG_UNUSED(component_id);
	ARG_UNUSED(duration);
	if (out_token != NULL) {
		*out_token = 1U;
	}
	return 0;
}

int spaghetti_health_window_release(spaghetti_health_window_token_t token)
{
	ARG_UNUSED(token);
	return 0;
}

static void expect_status(enum spaghetti_update_state state,
			  enum spaghetti_update_transport transport,
			  int last_error)
{
	struct spaghetti_update_status status;

	zassert_ok(spaghetti_update_get_status(&status));
	zassert_equal(status.state, state);
	zassert_equal(status.transport, transport);
	zassert_equal(status.last_error, last_error);
}

#if defined(CONFIG_SPAGHETTI_UPDATE_TEST_TRIAL)
ZTEST(update, test_trial_rejects_update_transitions)
{
	zassert_ok(spaghetti_update_init());
	expect_status(SPAGHETTI_UPDATE_TRIAL_BOOT,
		      SPAGHETTI_UPDATE_TRANSPORT_NONE, 0);
	zassert_equal(spaghetti_update_arm(1000U), -EPERM);
	zassert_equal(spaghetti_update_begin(
		SPAGHETTI_UPDATE_TRANSPORT_UART), -EPERM);
	zassert_equal(spaghetti_update_write(0U, (const uint8_t *)"test",
		4U, true), -EPERM);
	zassert_equal(spaghetti_update_finish(), -EPERM);
	zassert_equal(spaghetti_update_cancel(), -EPERM);
	zassert_ok(spaghetti_update_confirm_trial());
	expect_status(SPAGHETTI_UPDATE_IDLE,
		      SPAGHETTI_UPDATE_TRANSPORT_NONE, 0);
	zassert_equal(confirm_calls, 1);
	zassert_equal(prepare_calls, 0);
	zassert_equal(finalize_calls, 0);
	zassert_equal(cancel_calls, 0);
}
#else
ZTEST(update, test_update_lifecycle_and_failures)
{
	struct spaghetti_update_status untouched = {
		.state = SPAGHETTI_UPDATE_ERROR,
	};
	int cancel_count;

	zassert_equal(spaghetti_update_get_status(NULL), -EINVAL);
	zassert_equal(spaghetti_update_get_status(&untouched), -EACCES);
	zassert_equal(untouched.state, SPAGHETTI_UPDATE_ERROR);
	zassert_equal(spaghetti_update_arm(100U), -EACCES);
	zassert_equal(spaghetti_update_begin(
		SPAGHETTI_UPDATE_TRANSPORT_UART), -EACCES);
	zassert_equal(spaghetti_update_write(0U, (const uint8_t *)"test",
		4U, true), -EACCES);
	zassert_equal(spaghetti_update_write(0U, NULL, 4U, true), -EINVAL);
	zassert_equal(spaghetti_update_write(0U, (const uint8_t *)"test",
		0U, true), -EINVAL);
	zassert_equal(spaghetti_update_finish(), -EACCES);
	zassert_equal(spaghetti_update_cancel(), -EACCES);
	zassert_equal(spaghetti_update_confirm_trial(), -EACCES);
	zassert_equal(spaghetti_update_get_capacity(NULL), -EINVAL);
	zassert_equal(spaghetti_update_get_capacity(
		&(size_t){0U}), -EACCES);

	zassert_ok(spaghetti_update_init());
	{
		size_t capacity = 0U;

		zassert_ok(spaghetti_update_get_capacity(&capacity));
		zassert_equal(capacity, 4096U);
	}
	zassert_equal(spaghetti_update_init(), -EALREADY);
	expect_status(SPAGHETTI_UPDATE_IDLE,
		      SPAGHETTI_UPDATE_TRANSPORT_NONE, 0);
	zassert_equal(spaghetti_update_arm(0U), -EINVAL);
	zassert_equal(spaghetti_update_begin(
		SPAGHETTI_UPDATE_TRANSPORT_NONE), -EINVAL);
	zassert_equal(spaghetti_update_finish(), -EPERM);
	zassert_equal(spaghetti_update_cancel(), -EALREADY);
	zassert_equal(spaghetti_update_confirm_trial(), -EPERM);

	zassert_ok(spaghetti_update_arm(1000U));
	zassert_equal(spaghetti_update_arm(1000U), -EALREADY);
	zassert_equal(spaghetti_update_begin(
		(enum spaghetti_update_transport)UINT32_MAX), -EINVAL);
	zassert_ok(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UART));
	expect_status(SPAGHETTI_UPDATE_RECEIVING,
		      SPAGHETTI_UPDATE_TRANSPORT_UART, 0);
	zassert_equal(spaghetti_update_begin(
		SPAGHETTI_UPDATE_TRANSPORT_UDP), -EBUSY);
	zassert_equal(prepare_calls, 1);
	zassert_ok(spaghetti_update_write(0U, (const uint8_t *)"test",
		4U, true));
	zassert_equal(write_calls, 1);
	zassert_ok(spaghetti_update_cancel());

	zassert_ok(spaghetti_update_arm(1000U));
	zassert_ok(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_BLE));
	expect_status(SPAGHETTI_UPDATE_RECEIVING,
		      SPAGHETTI_UPDATE_TRANSPORT_BLE, 0);
	zassert_equal(spaghetti_update_begin(
		SPAGHETTI_UPDATE_TRANSPORT_UART), -EBUSY);
	zassert_equal(spaghetti_update_begin(
		SPAGHETTI_UPDATE_TRANSPORT_UDP), -EBUSY);
	zassert_ok(spaghetti_update_cancel());
	zassert_ok(spaghetti_update_arm(1000U));
	zassert_ok(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_CAN));
	expect_status(SPAGHETTI_UPDATE_RECEIVING,
		      SPAGHETTI_UPDATE_TRANSPORT_CAN, 0);
	zassert_ok(spaghetti_update_cancel());
	zassert_ok(spaghetti_update_arm(1000U));
	zassert_ok(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_ESPNOW));
	expect_status(SPAGHETTI_UPDATE_RECEIVING,
		      SPAGHETTI_UPDATE_TRANSPORT_ESPNOW, 0);
	zassert_ok(spaghetti_update_cancel());
	expect_status(SPAGHETTI_UPDATE_IDLE,
		      SPAGHETTI_UPDATE_TRANSPORT_NONE, 0);

	zassert_ok(spaghetti_update_arm(1000U));
	zassert_ok(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UART));
	next_write_error = -EIO;
	zassert_equal(spaghetti_update_write(0U,
		(const uint8_t *)"test", 4U, true), -EIO);
	expect_status(SPAGHETTI_UPDATE_ERROR,
		      SPAGHETTI_UPDATE_TRANSPORT_UART, -EIO);
	zassert_ok(spaghetti_update_cancel());

	zassert_ok(spaghetti_update_arm(1000U));
	next_prepare_error = -EIO;
	zassert_equal(spaghetti_update_begin(
		SPAGHETTI_UPDATE_TRANSPORT_UDP), -EIO);
	expect_status(SPAGHETTI_UPDATE_ERROR,
		      SPAGHETTI_UPDATE_TRANSPORT_NONE, -EIO);
	zassert_ok(spaghetti_update_cancel());

	zassert_ok(spaghetti_update_arm(1000U));
	zassert_ok(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UDP));
	next_finalize_error = -EBADMSG;
	zassert_equal(spaghetti_update_finish(), -EBADMSG);
	expect_status(SPAGHETTI_UPDATE_ERROR,
		      SPAGHETTI_UPDATE_TRANSPORT_UDP, -EBADMSG);
	zassert_ok(spaghetti_update_cancel());

	zassert_ok(spaghetti_update_arm(1000U));
	zassert_ok(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UART));
	zassert_ok(spaghetti_update_finish());
	zassert_equal(finalize_calls, 2);
	expect_status(SPAGHETTI_UPDATE_PENDING_REBOOT,
		      SPAGHETTI_UPDATE_TRANSPORT_UART, 0);
	zassert_equal(spaghetti_update_arm(1000U), -EBUSY);
	zassert_ok(spaghetti_update_cancel());

	cancel_count = cancel_calls;
	zassert_ok(spaghetti_update_arm(20U));
	k_sleep(K_MSEC(60));
	expect_status(SPAGHETTI_UPDATE_IDLE,
		      SPAGHETTI_UPDATE_TRANSPORT_NONE, -ETIMEDOUT);
	zassert_equal(cancel_calls, cancel_count + 1);

	cancel_count = cancel_calls;
	zassert_ok(spaghetti_update_arm(20U));
	zassert_ok(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UDP));
	k_sleep(K_MSEC(60));
	expect_status(SPAGHETTI_UPDATE_IDLE,
		      SPAGHETTI_UPDATE_TRANSPORT_NONE, -ETIMEDOUT);
	zassert_equal(cancel_calls, cancel_count + 1);

	zassert_ok(spaghetti_update_arm(1000U));
	next_cancel_error = -EIO;
	zassert_equal(spaghetti_update_cancel(), -EIO);
	expect_status(SPAGHETTI_UPDATE_ERROR,
		      SPAGHETTI_UPDATE_TRANSPORT_NONE, -EIO);
	zassert_ok(spaghetti_update_cancel());
	expect_status(SPAGHETTI_UPDATE_IDLE,
		      SPAGHETTI_UPDATE_TRANSPORT_NONE, 0);
}
#endif /* CONFIG_SPAGHETTI_UPDATE_TEST_TRIAL */

ZTEST_SUITE(update, NULL, NULL, NULL, NULL, NULL);
