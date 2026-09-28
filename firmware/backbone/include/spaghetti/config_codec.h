/**
 * @file
 * @brief Public CBOR codec contract for Spaghetti Config.
 * @ingroup spaghetti_config
 */

#ifndef SPAGHETTI_CONFIG_CODEC_H
#define SPAGHETTI_CONFIG_CODEC_H

#include <stddef.h>
#include <stdint.h>

#include <spaghetti/config.h>

/** Maximum accepted encoded Config payload size in bytes. */
#define SPAGHETTI_CONFIG_CBOR_MAX_SIZE CONFIG_SPAGHETTI_CONFIG_CBOR_MAX_SIZE

/**
 * @brief Decode and validate one complete Config CBOR payload.
 *
 * Decode wire V0 version 1, wire V1 version 2, wire V2 version 3, or wire V3
 * version 4 into the current in-memory Config model. Legacy wire formats are
 * converted into property sets and schedules. Wire V2 payloads without a
 * processing graph migrate to empty blocks/edges. The decoder validates the
 * temporary Config through @ref spaghetti_config_validate before publishing it
 * to @p out.
 *
 * @param[in] bytes Caller-owned encoded bytes borrowed only for this call.
 * @param[in] length Exact encoded size in bytes, in the inclusive range 1 to
 *                   @ref SPAGHETTI_CONFIG_CBOR_MAX_SIZE.
 * @param[out] out Caller-owned destination written only after complete decode
 *                 and semantic validation succeed. It is never retained.
 *
 * @retval 0 A complete validated Config was copied to @p out.
 * @retval -EINVAL A pointer, length, numeric range, or decoded field is invalid.
 * @retval -EMSGSIZE The payload, Module array, or type ID exceeds a fixed bound.
 * @retval -EBADMSG The CBOR shape, key order, type, collection size, or complete
 *                  input consumption is invalid.
 * @retval -ENOTSUP The wire version or Module type is unsupported.
 * @retval -ENOENT A decoded Port does not exist.
 * @retval -EEXIST Stable Module keys are duplicated.
 * @retval -EADDRINUSE Two decoded Modules claim the same Port endpoint.
 * @retval -ERANGE A decoded property value is not representable.
 *
 * @note Call from thread context. The function performs no hardware I/O,
 *       allocation, wait, or state mutation.
 */
int spaghetti_config_decode_cbor(const uint8_t *bytes, size_t length,
				 struct spaghetti_config *out);

/**
 * @brief Encode one validated Config as canonical wire V3 CBOR.
 *
 * Validates @p config first, then writes deterministic root and property field
 * order. Buffer contents and @p written_size change only on success.
 *
 * @param[in] config Caller-owned snapshot borrowed for this call.
 * @param[out] buffer Caller-owned destination with @p buffer_capacity bytes.
 * @param[in] buffer_capacity Capacity of @p buffer in bytes.
 * @param[out] written_size Caller-owned encoded size written only on success.
 *
 * @retval 0 Canonical CBOR was written.
 * @retval -EINVAL A pointer is NULL or Config validation failed with -EINVAL.
 * @retval -EMSGSIZE The encoded payload exceeds @p buffer_capacity or the
 *                   configured CBOR maximum.
 * @retval -errno Propagated from @ref spaghetti_config_validate.
 *
 * @note Call from thread context. The function performs no hardware I/O.
 */
int spaghetti_config_encode_cbor(
	const struct spaghetti_config *config,
	uint8_t *buffer,
	size_t buffer_capacity,
	size_t *written_size);

#endif /* SPAGHETTI_CONFIG_CODEC_H */
