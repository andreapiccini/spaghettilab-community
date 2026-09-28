#include <spaghetti/enrollment.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/toolchain.h>

static const struct spaghetti_enrollment_backend *backend;
static bool enrollment_ready;

__weak const struct spaghetti_enrollment_backend *spaghetti_enrollment_backend_get(void)
{
	return NULL;
}

int spaghetti_enrollment_init(void)
{
	int err;

	if (enrollment_ready) {
		return -EALREADY;
	}
	backend = spaghetti_enrollment_backend_get();
	if (backend == NULL) {
		enrollment_ready = true;
		return 0;
	}
	if ((backend->api_version != SPAGHETTI_ENROLLMENT_BACKEND_API_VERSION) ||
	    (backend->init == NULL) || (backend->get_status == NULL) ||
	    (backend->begin == NULL) || (backend->cancel == NULL)) {
		backend = NULL;
		return -EPROTONOSUPPORT;
	}
	err = backend->init();
	if (err < 0) {
		backend = NULL;
		return err;
	}
	enrollment_ready = true;
	return 0;
}

int spaghetti_enrollment_get_status(struct spaghetti_enrollment_status *out)
{
	if (out == NULL) {
		return -EINVAL;
	}
	if (!enrollment_ready) {
		return -EACCES;
	}
	if (backend == NULL) {
		memset(out, 0, sizeof(*out));
		out->state = SPAGHETTI_ENROLLMENT_UNMANAGED;
		return 0;
	}
	return backend->get_status(out);
}

int spaghetti_enrollment_begin(const struct spaghetti_enrollment_request *request)
{
	if ((request == NULL) || (request->organization_id == NULL) ||
	    (request->organization_id[0] == '\0') ||
	    (strnlen(request->organization_id,
		     SPAGHETTI_ENROLLMENT_ORGANIZATION_ID_SIZE) >=
	     SPAGHETTI_ENROLLMENT_ORGANIZATION_ID_SIZE) ||
	    (request->enrollment_uri == NULL) ||
	    (request->activation_secret == NULL) ||
	    (request->activation_secret_size == 0U)) {
		return -EINVAL;
	}
	if (!enrollment_ready) {
		return -EACCES;
	}
	if (backend == NULL) {
		return -ENOTSUP;
	}
	return backend->begin(request);
}

int spaghetti_enrollment_cancel(void)
{
	if (!enrollment_ready) {
		return -EACCES;
	}
	if (backend == NULL) {
		return -ENOTSUP;
	}
	return backend->cancel();
}
