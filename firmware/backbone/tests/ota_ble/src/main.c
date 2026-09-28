#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/ztest.h>

#include <spaghetti/access_control.h>
#include <spaghetti/core.h>
#include <spaghetti/ota.h>
#include <spaghetti/runtime.h>
#include <spaghetti/update.h>

static int update_arm_calls;
static int update_begin_calls;
static int update_write_calls;
static int update_finish_calls;
static int update_cancel_calls;
static int runtime_stop_calls;
static int authorize_calls;
static enum spaghetti_update_transport last_begin_transport;
static enum spaghetti_update_state update_state =
	SPAGHETTI_UPDATE_IDLE;
static enum spaghetti_update_transport update_transport =
	SPAGHETTI_UPDATE_TRANSPORT_NONE;
static bool image_confirmed = true;
static int authorize_result;
static int next_arm_error;
static int next_begin_error;
static int next_write_error;
static int next_finish_error;
static int next_cancel_error;
static uint32_t last_write_offset;
static size_t last_write_size;
static bool last_write_last;

/* SHA-256("test") */
static const uint8_t sha_test[32] = {
	0x9f, 0x86, 0xd0, 0x81, 0x88, 0x4c, 0x7d, 0x65,
	0x9a, 0x2f, 0xea, 0xa0, 0xc5, 0x5a, 0xd0, 0x15,
	0xa3, 0xbf, 0x4f, 0x1b, 0x2b, 0x0b, 0x82, 0x2c,
	0xd1, 0x5d, 0x6c, 0x15, 0xb0, 0xf0, 0x0a, 0x08,
};

static void reset_fakes(void)
{
	update_arm_calls = 0;
	update_begin_calls = 0;
	update_write_calls = 0;
	update_finish_calls = 0;
	update_cancel_calls = 0;
	runtime_stop_calls = 0;
	authorize_calls = 0;
	last_begin_transport = SPAGHETTI_UPDATE_TRANSPORT_NONE;
	update_state = SPAGHETTI_UPDATE_IDLE;
	update_transport = SPAGHETTI_UPDATE_TRANSPORT_NONE;
	image_confirmed = true;
	authorize_result = 0;
	next_arm_error = 0;
	next_begin_error = 0;
	next_write_error = 0;
	next_finish_error = 0;
	next_cancel_error = 0;
	spaghetti_ota_ble_set_acting_principal(0U);
}

int spaghetti_runtime_stop(k_timeout_t timeout)
{
	ARG_UNUSED(timeout);
	++runtime_stop_calls;
	return 0;
}

int spaghetti_principal_authorize(
	spaghetti_principal_id_t id,
	uint32_t required_permissions)
{
	++authorize_calls;
	zassert_true(id != 0U);
	zassert_true((required_permissions & SPAGHETTI_PERMISSION_UPDATE) !=
		     0U);
	return authorize_result;
}

int spaghetti_ble_find_update_principal(spaghetti_principal_id_t *out_principal)
{
	ARG_UNUSED(out_principal);
	return -ENOENT;
}

int spaghetti_update_get_capacity(size_t *out_size)
{
	zassert_not_null(out_size);
	*out_size = 4096U;
	return 0;
}

int spaghetti_update_get_status(struct spaghetti_update_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	*out = (struct spaghetti_update_status) {
		.state = update_state,
		.transport = update_transport,
		.image_confirmed = image_confirmed,
	};
	return 0;
}

int spaghetti_update_arm(uint32_t timeout_ms)
{
	const int err = next_arm_error;

	zassert_true(timeout_ms > 0U);
	++update_arm_calls;
	next_arm_error = 0;
	if (err < 0) {
		return err;
	}
	if (update_state == SPAGHETTI_UPDATE_RECEIVING) {
		return -EBUSY;
	}
	update_state = SPAGHETTI_UPDATE_ARMED;
	update_transport = SPAGHETTI_UPDATE_TRANSPORT_NONE;
	return 0;
}

int spaghetti_update_begin(enum spaghetti_update_transport transport)
{
	const int err = next_begin_error;

	++update_begin_calls;
	last_begin_transport = transport;
	next_begin_error = 0;
	if (err < 0) {
		return err;
	}
	if (update_state == SPAGHETTI_UPDATE_RECEIVING) {
		return -EBUSY;
	}
	if (update_state != SPAGHETTI_UPDATE_ARMED) {
		return -EPERM;
	}
	update_state = SPAGHETTI_UPDATE_RECEIVING;
	update_transport = transport;
	return 0;
}

int spaghetti_update_write(uint32_t offset, const uint8_t *data,
			   size_t data_size, bool last)
{
	const int err = next_write_error;

	zassert_not_null(data);
	zassert_true(data_size > 0U);
	++update_write_calls;
	last_write_offset = offset;
	last_write_size = data_size;
	last_write_last = last;
	next_write_error = 0;
	return err;
}

int spaghetti_update_finish(void)
{
	const int err = next_finish_error;

	++update_finish_calls;
	next_finish_error = 0;
	if (err < 0) {
		return err;
	}
	update_state = SPAGHETTI_UPDATE_PENDING_REBOOT;
	return 0;
}

int spaghetti_update_cancel(void)
{
	const int err = next_cancel_error;

	++update_cancel_calls;
	next_cancel_error = 0;
	if (err < 0) {
		return err;
	}
	update_state = SPAGHETTI_UPDATE_IDLE;
	update_transport = SPAGHETTI_UPDATE_TRANSPORT_NONE;
	return 0;
}

static void fill_begin(struct spaghetti_ble_update_begin *begin,
		       uint32_t size, const uint8_t sha[32],
		       const char *version)
{
	size_t version_len = 0U;

	memset(begin, 0, sizeof(*begin));
	begin->image_size = size;
	memcpy(begin->image_sha256, sha, 32U);
	while ((version_len < SPAGHETTI_CORE_VERSION_SIZE) &&
	       (version[version_len] != '\0')) {
		++version_len;
	}
	if (version_len < SPAGHETTI_CORE_VERSION_SIZE) {
		memcpy(begin->version, version, version_len);
		begin->version[version_len] = '\0';
	}
}

static int open_authorized(uint32_t *session_id)
{
	struct spaghetti_ble_update_begin begin;

	fill_begin(&begin, 4U, sha_test, "1.0.0");
	spaghetti_ota_ble_set_acting_principal(7U);
	return spaghetti_ota_ble_open(&begin, session_id);
}

ZTEST(ota_ble, test_permission_denied)
{
	struct spaghetti_ble_update_begin begin;
	uint32_t session_id = 0U;

	reset_fakes();
	fill_begin(&begin, 4U, sha_test, "1.0.0");
	authorize_result = -EACCES;
	spaghetti_ota_ble_set_acting_principal(7U);
	zassert_equal(spaghetti_ota_ble_open(&begin, &session_id), -EACCES);
	zassert_equal(update_arm_calls, 0);
	zassert_equal(runtime_stop_calls, 0);

	spaghetti_ota_ble_set_acting_principal(0U);
	authorize_result = 0;
	zassert_equal(spaghetti_ota_ble_open(&begin, &session_id), -EACCES);
}

ZTEST(ota_ble, test_exclusive_transport_and_finish)
{
	struct spaghetti_ble_update_begin begin;
	uint32_t session_id = 0U;
	const uint8_t payload[] = "test";

	reset_fakes();
	zassert_equal(spaghetti_ota_ble_open(NULL, &session_id), -EINVAL);
	zassert_equal(spaghetti_ota_ble_write(0U, 0U, payload, 4U), -EINVAL);

	zassert_ok(open_authorized(&session_id));
	zassert_true(session_id != 0U);
	zassert_equal(runtime_stop_calls, 1);
	zassert_equal(update_arm_calls, 1);
	zassert_equal(update_begin_calls, 1);
	zassert_equal(last_begin_transport, SPAGHETTI_UPDATE_TRANSPORT_BLE);
	zassert_equal(update_transport, SPAGHETTI_UPDATE_TRANSPORT_BLE);
	zassert_equal(spaghetti_update_arm(100U), -EBUSY);
	zassert_equal(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UART),
		      -EBUSY);
	zassert_equal(spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_UDP),
		      -EBUSY);

	fill_begin(&begin, 4U, sha_test, "1.0.1");
	spaghetti_ota_ble_set_acting_principal(7U);
	{
		uint32_t ignored = 0U;

		zassert_equal(spaghetti_ota_ble_open(&begin, &ignored), -EBUSY);
	}

	zassert_equal(spaghetti_ota_ble_write(session_id, 1U, payload, 4U),
		      -EINVAL);
	zassert_ok(spaghetti_ota_ble_write(session_id, 0U, payload, 4U));
	zassert_equal(update_write_calls, 1);
	zassert_equal(last_write_offset, 0U);
	zassert_equal(last_write_size, 4U);
	zassert_true(last_write_last);

	zassert_ok(spaghetti_ota_ble_finish(session_id));
	zassert_equal(update_finish_calls, 1);
	zassert_equal(update_state, SPAGHETTI_UPDATE_PENDING_REBOOT);
	zassert_true(image_confirmed);
	zassert_equal(spaghetti_ota_ble_cancel(session_id), -EALREADY);
}

ZTEST(ota_ble, test_cancel_leaves_confirmed_image)
{
	uint32_t session_id = 0U;
	const uint8_t payload[] = "test";

	reset_fakes();
	zassert_ok(open_authorized(&session_id));
	zassert_ok(spaghetti_ota_ble_write(session_id, 0U, payload, 2U));
	zassert_false(last_write_last);
	zassert_ok(spaghetti_ota_ble_cancel(session_id));
	zassert_equal(update_cancel_calls, 1);
	zassert_equal(update_finish_calls, 0);
	zassert_equal(update_state, SPAGHETTI_UPDATE_IDLE);
	zassert_equal(update_transport, SPAGHETTI_UPDATE_TRANSPORT_NONE);
	zassert_true(image_confirmed);
}

ZTEST(ota_ble, test_disconnect_resume_timeout_cancels)
{
	uint32_t session_id = 0U;
	int cancel_before;

	reset_fakes();
	zassert_ok(open_authorized(&session_id));
	cancel_before = update_cancel_calls;
	spaghetti_ota_ble_on_disconnect();
	k_sleep(K_MSEC(80));
	zassert_equal(update_cancel_calls, cancel_before + 1);
	zassert_equal(update_state, SPAGHETTI_UPDATE_IDLE);
	zassert_true(image_confirmed);
	zassert_equal(spaghetti_ota_ble_write(session_id, 0U,
		(const uint8_t *)"test", 4U), -EPERM);
}

ZTEST(ota_ble, test_disconnect_resume_continues)
{
	uint32_t session_id = 0U;
	const uint8_t payload[] = "test";

	reset_fakes();
	zassert_ok(open_authorized(&session_id));
	spaghetti_ota_ble_on_disconnect();
	zassert_ok(spaghetti_ota_ble_write(session_id, 0U, payload, 4U));
	zassert_equal(update_cancel_calls, 0);
	zassert_ok(spaghetti_ota_ble_finish(session_id));
	zassert_equal(update_finish_calls, 1);
}

ZTEST(ota_ble, test_finish_hash_mismatch)
{
	uint32_t session_id = 0U;
	const uint8_t payload[] = "test";
	uint8_t bad_sha[32];

	reset_fakes();
	memset(bad_sha, 0x11, sizeof(bad_sha));
	{
		struct spaghetti_ble_update_begin begin;

		fill_begin(&begin, 4U, bad_sha, "1.0.0");
		spaghetti_ota_ble_set_acting_principal(7U);
		zassert_ok(spaghetti_ota_ble_open(&begin, &session_id));
	}
	zassert_ok(spaghetti_ota_ble_write(session_id, 0U, payload, 4U));
	zassert_equal(spaghetti_ota_ble_finish(session_id), -EBADMSG);
	zassert_equal(update_finish_calls, 0);
	zassert_equal(update_cancel_calls, 1);
	zassert_true(image_confirmed);
}

ZTEST_SUITE(ota_ble, NULL, NULL, NULL, NULL, NULL);
