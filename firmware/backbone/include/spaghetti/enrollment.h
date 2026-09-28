/**
 * @file
 * @brief Optional enterprise enrollment boundary.
 * @ingroup spaghetti_identity
 */

#ifndef SPAGHETTI_ENROLLMENT_H
#define SPAGHETTI_ENROLLMENT_H

#include <stddef.h>
#include <stdint.h>

#define SPAGHETTI_ENROLLMENT_BACKEND_API_VERSION 1U
#define SPAGHETTI_ENROLLMENT_ORGANIZATION_ID_SIZE 64U
#define SPAGHETTI_ENROLLMENT_PROVIDER_ID_SIZE 32U

/** Non-secret lifecycle state reported by the optional backend. */
enum spaghetti_enrollment_state {
	SPAGHETTI_ENROLLMENT_UNMANAGED, /**< No enterprise backend is linked. */
	SPAGHETTI_ENROLLMENT_AVAILABLE, /**< Backend is ready but not enrolled. */
	SPAGHETTI_ENROLLMENT_PENDING, /**< Enrollment has not completed. */
	SPAGHETTI_ENROLLMENT_ENROLLED, /**< Backend confirms managed membership. */
	SPAGHETTI_ENROLLMENT_ERROR, /**< Backend reports a lifecycle failure. */
};

/** Non-secret enrollment status safe to expose to local clients. */
struct spaghetti_enrollment_status {
	enum spaghetti_enrollment_state state;
	char provider_id[SPAGHETTI_ENROLLMENT_PROVIDER_ID_SIZE];
	char organization_id[SPAGHETTI_ENROLLMENT_ORGANIZATION_ID_SIZE];
	int32_t last_error;
};

/**
 * Ephemeral enrollment input. The Community layer never persists or logs it.
 * A downstream backend owns transport, credential storage and certificate policy.
 */
struct spaghetti_enrollment_request {
	const char *organization_id;
	const char *enrollment_uri;
	const uint8_t *activation_secret;
	size_t activation_secret_size;
};

/** Source-level API implemented by at most one downstream backend. */
struct spaghetti_enrollment_backend {
	uint16_t api_version;
	int (*init)(void);
	int (*get_status)(struct spaghetti_enrollment_status *out);
	int (*begin)(const struct spaghetti_enrollment_request *request);
	int (*cancel)(void);
};

/**
 * Downstream override point. Community provides a weak NULL implementation.
 * The returned descriptor must remain immutable for the lifetime of the image.
 */
const struct spaghetti_enrollment_backend *spaghetti_enrollment_backend_get(void);

/**
 * @brief Initialize the optional enrollment backend.
 *
 * @retval 0 Backend initialized or Community unmanaged fallback selected.
 * @retval -EALREADY Already initialized.
 * @retval -EPROTONOSUPPORT Backend descriptor is incompatible.
 * @return A backend-specific negative errno on initialization failure.
 */
int spaghetti_enrollment_init(void);

/**
 * @brief Copy non-secret enterprise enrollment status.
 *
 * @param[out] out Caller-owned status destination.
 * @retval 0 Status copied, including UNMANAGED when no backend exists.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES Enrollment has not initialized.
 * @return A backend-specific negative errno.
 */
int spaghetti_enrollment_get_status(struct spaghetti_enrollment_status *out);

/**
 * @brief Begin enrollment using ephemeral caller-owned input.
 *
 * @param[in] request Organization, endpoint and one-time activation input.
 * @retval 0 Backend accepted the request.
 * @retval -EINVAL Input is incomplete or out of bounds.
 * @retval -EACCES Enrollment has not initialized.
 * @retval -ENOTSUP No enterprise backend is linked.
 * @return A backend-specific negative errno.
 */
int spaghetti_enrollment_begin(const struct spaghetti_enrollment_request *request);

/**
 * @brief Cancel a pending enterprise enrollment request.
 *
 * @retval 0 Backend cancelled the request.
 * @retval -EACCES Enrollment has not initialized.
 * @retval -ENOTSUP No enterprise backend is linked.
 * @return A backend-specific negative errno.
 */
int spaghetti_enrollment_cancel(void);

#endif /* SPAGHETTI_ENROLLMENT_H */
