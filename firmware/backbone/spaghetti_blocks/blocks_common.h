#ifndef SPAGHETTI_BLOCKS_COMMON_H
#define SPAGHETTI_BLOCKS_COMMON_H

#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include <spaghetti/block_driver.h>
#include <spaghetti/schema.h>

static inline int spaghetti_block_require_inputs(
	const bool *input_valid, size_t count, size_t required)
{
	if ((input_valid == NULL) || (count < required)) {
		return -EINVAL;
	}
	for (size_t idx = 0U; idx < required; ++idx) {
		if (!input_valid[idx]) {
			return -EINVAL;
		}
	}
	return 0;
}

static inline int64_t spaghetti_block_as_i64(const struct spaghetti_value *value)
{
	if (value->type == SPAGHETTI_VALUE_UINT64) {
		return (value->data.unsigned_integer > (uint64_t)INT64_MAX) ?
			       INT64_MAX :
			       (int64_t)value->data.unsigned_integer;
	}
	return value->data.signed_integer;
}

static inline void spaghetti_block_set_i64(struct spaghetti_value *out,
					  uint16_t field_id, int64_t value)
{
	out->field_id = field_id;
	out->type = SPAGHETTI_VALUE_INT64;
	out->data.signed_integer = value;
}

static inline void spaghetti_block_set_u64(struct spaghetti_value *out,
					  uint16_t field_id, uint64_t value)
{
	out->field_id = field_id;
	out->type = SPAGHETTI_VALUE_UINT64;
	out->data.unsigned_integer = value;
}

static inline void spaghetti_block_set_bool(struct spaghetti_value *out,
					   uint16_t field_id, bool value)
{
	out->field_id = field_id;
	out->type = SPAGHETTI_VALUE_BOOL;
	out->data.boolean = value;
}

static inline int64_t spaghetti_block_sat_i64(int64_t value, int64_t lo,
					     int64_t hi)
{
	if (value < lo) {
		return lo;
	}
	if (value > hi) {
		return hi;
	}
	return value;
}

static inline int spaghetti_block_add_i64(int64_t a, int64_t b, int64_t *out)
{
	if (((b > 0) && (a > (INT64_MAX - b))) ||
	    ((b < 0) && (a < (INT64_MIN - b)))) {
		return -ERANGE;
	}
	*out = a + b;
	return 0;
}

static inline int spaghetti_block_sub_i64(int64_t a, int64_t b, int64_t *out)
{
	if (((b > 0) && (a < (INT64_MIN + b))) ||
	    ((b < 0) && (a > (INT64_MAX + b)))) {
		return -ERANGE;
	}
	*out = a - b;
	return 0;
}

static inline int spaghetti_block_mul_i64(int64_t a, int64_t b, int64_t *out)
{
	if ((a == 0) || (b == 0)) {
		*out = 0;
		return 0;
	}
	if ((a == INT64_MIN) && (b == -1)) {
		return -ERANGE;
	}
	if ((b == INT64_MIN) && (a == -1)) {
		return -ERANGE;
	}
	if ((a > 0) && (b > 0) && (a > (INT64_MAX / b))) {
		return -ERANGE;
	}
	if ((a < 0) && (b < 0) && (a < (INT64_MAX / b))) {
		return -ERANGE;
	}
	if ((a > 0) && (b < 0) && (b < (INT64_MIN / a))) {
		return -ERANGE;
	}
	if ((a < 0) && (b > 0) && (a < (INT64_MIN / b))) {
		return -ERANGE;
	}
	*out = a * b;
	return 0;
}

static inline const struct spaghetti_value *spaghetti_block_prop(
	const struct spaghetti_property_set *config, uint16_t field_id)
{
	return spaghetti_property_find(config, field_id);
}

static inline void spaghetti_block_noop_reset(void *state)
{
	(void)state;
}

static inline void spaghetti_block_noop_deinit(void *state)
{
	(void)state;
}

#endif /* SPAGHETTI_BLOCKS_COMMON_H */
