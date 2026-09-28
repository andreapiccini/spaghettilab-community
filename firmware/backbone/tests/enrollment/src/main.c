#include <errno.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/ztest.h>

#include <spaghetti/enrollment.h>

ZTEST(enrollment, test_unmanaged_fallback_is_complete_and_non_blocking)
{
	struct spaghetti_enrollment_status status;
	const uint8_t secret[] = {0x01U};
	const struct spaghetti_enrollment_request request = {
		.organization_id = "example",
		.enrollment_uri = "https://enroll.invalid",
		.activation_secret = secret,
		.activation_secret_size = sizeof(secret),
	};

	zassert_equal(spaghetti_enrollment_get_status(&status), -EACCES);
	zassert_ok(spaghetti_enrollment_init());
	zassert_ok(spaghetti_enrollment_get_status(&status));
	zassert_equal(status.state, SPAGHETTI_ENROLLMENT_UNMANAGED);
	zassert_equal(status.provider_id[0], '\0');
	zassert_equal(status.organization_id[0], '\0');
	zassert_equal(spaghetti_enrollment_begin(&request), -ENOTSUP);
	zassert_equal(spaghetti_enrollment_cancel(), -ENOTSUP);
}

ZTEST_SUITE(enrollment, NULL, NULL, NULL, NULL, NULL);
