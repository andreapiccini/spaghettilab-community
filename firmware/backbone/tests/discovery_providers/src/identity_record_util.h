#ifndef DISCOVERY_TEST_IDENTITY_UTIL_H
#define DISCOVERY_TEST_IDENTITY_UTIL_H

#include <stddef.h>
#include <stdint.h>

#include <spaghetti/discovery.h>

/**
 * @brief Encode a V1 identity record for Discovery provider tests.
 *
 * @retval 0 Encoded into @p out with @p out_size set.
 * @retval -EINVAL Invalid argument.
 * @retval -EMSGSIZE @p capacity is too small.
 * @retval -ERANGE Property payload exceeds schema limits.
 */
int discovery_test_identity_record_encode(
	const uint8_t *identity,
	uint8_t identity_size,
	const char *type_id,
	spaghetti_bay_id_t bay_id,
	spaghetti_power_rail_id_t power_rail_id,
	const struct spaghetti_property_set *properties,
	uint8_t *out,
	size_t capacity,
	size_t *out_size);

#endif /* DISCOVERY_TEST_IDENTITY_UTIL_H */
