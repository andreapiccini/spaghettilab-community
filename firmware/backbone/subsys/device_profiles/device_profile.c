#include <spaghetti/device_profile.h>

#include <errno.h>
#include <string.h>

#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <zcbor_decode.h>

LOG_MODULE_REGISTER(spaghetti_device_profile,
		    CONFIG_SPAGHETTI_DEVICE_PROFILE_LOG_LEVEL);

#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_WIRE 0U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_ID 1U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_VERSION 2U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_TRANSPORT 3U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_CAPS 4U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_TIME 5U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_TX 6U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_BYTES 7U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_INIT 8U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_SAMPLE 9U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_STOP 10U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_SCHEMA_ID 11U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_SCHEMA_VER 12U
#define SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_FIELDS 13U

struct spaghetti_device_profile_slot {
	bool used;
	bool persisted;
	bool from_builtin;
	struct spaghetti_device_profile decoded;
	uint8_t cbor[CONFIG_SPAGHETTI_MAX_DEVICE_PROFILE_BYTES];
	size_t cbor_size;
};

static struct spaghetti_device_profile_slot slots
	[CONFIG_SPAGHETTI_MAX_DEVICE_PROFILES];
static const struct spaghetti_device_profile
	*catalog[CONFIG_SPAGHETTI_MAX_DEVICE_PROFILES];
static size_t catalog_count;
static bool catalog_ready;
static spaghetti_device_profile_reference_checker_t reference_checker;
static void *reference_checker_user_data;

static bool profile_id_is_valid(const char *id)
{
	if (id == NULL) {
		return false;
	}

	for (size_t idx = 0U; idx < SPAGHETTI_DEVICE_PROFILE_ID_SIZE; ++idx) {
		if (id[idx] == '\0') {
			return idx > 0U;
		}
	}

	return false;
}

static bool opcode_is_known(uint8_t opcode)
{
	return (opcode >= SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE) &&
	       (opcode <= SPAGHETTI_DEVICE_PROFILE_OP_WAIT_GPIO);
}

static bool temp_ok(uint8_t slot)
{
	return slot < SPAGHETTI_DEVICE_PROFILE_TEMP_SLOTS;
}

static int expect_key(zcbor_state_t *state, uint32_t expected)
{
	return zcbor_uint32_expect(state, expected) ? 0 : -EBADMSG;
}

static int decode_text(
	zcbor_state_t *state,
	char *out,
	size_t out_size)
{
	struct zcbor_string text;

	if (!zcbor_tstr_decode(state, &text)) {
		return -EBADMSG;
	}
	if (text.len >= out_size) {
		return -EMSGSIZE;
	}

	memcpy(out, text.value, text.len);
	out[text.len] = '\0';
	return 0;
}

static int accumulate_op_budget(
	const struct spaghetti_device_profile_op *op,
	struct spaghetti_device_profile_budget *budget)
{
	uint32_t time_ms = 0U;
	uint32_t transactions = 0U;
	uint32_t bytes = 0U;

	switch (op->opcode) {
	case SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE:
		if (!temp_ok(op->src_a)) {
			return -EINVAL;
		}
		transactions = 1U;
		bytes = op->imm0;
		time_ms = op->imm1;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_I2C_READ:
		if (!temp_ok(op->dst) || (op->imm0 == 0U) ||
		    (op->imm0 > SPAGHETTI_VALUE_BYTES_MAX)) {
			return -EINVAL;
		}
		transactions = 1U;
		bytes = op->imm0;
		time_ms = op->imm1;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ:
		if (!temp_ok(op->src_a) || !temp_ok(op->dst) ||
		    (op->imm0 == 0U) ||
		    (op->imm0 > SPAGHETTI_VALUE_BYTES_MAX)) {
			return -EINVAL;
		}
		transactions = 1U;
		bytes = (uint32_t)op->imm0 +
			((op->imm1 != 0U) ? (uint32_t)op->imm1 : 1U);
		time_ms = (op->imm2 > UINT16_MAX) ? UINT16_MAX :
						   (uint16_t)op->imm2;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_SPI_TRANSCEIVE:
		if (!temp_ok(op->src_a) || !temp_ok(op->dst) ||
		    (op->imm0 == 0U) ||
		    (op->imm0 > SPAGHETTI_VALUE_BYTES_MAX) ||
		    (op->imm3 > 3U)) {
			return -EINVAL;
		}
		transactions = 1U;
		bytes = op->imm0;
		time_ms = op->imm1;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_UART_WRITE:
		if (!temp_ok(op->src_a)) {
			return -EINVAL;
		}
		transactions = 1U;
		bytes = op->imm0;
		time_ms = op->imm1;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_UART_READ_UNTIL:
	case SPAGHETTI_DEVICE_PROFILE_OP_UART_READ:
		if (!temp_ok(op->dst) || (op->imm0 == 0U) ||
		    (op->imm0 > SPAGHETTI_VALUE_BYTES_MAX)) {
			return -EINVAL;
		}
		transactions = 1U;
		bytes = op->imm0;
		time_ms = op->imm1;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_W1_WRITE_READ:
		if (!temp_ok(op->src_a) || !temp_ok(op->dst) ||
		    (op->imm0 > SPAGHETTI_VALUE_BYTES_MAX)) {
			return -EINVAL;
		}
		transactions = 1U;
		bytes = (uint32_t)op->imm0 +
			((op->imm1 != 0U) ? (uint32_t)op->imm1 : 1U);
		time_ms = (op->imm2 > UINT16_MAX) ? UINT16_MAX :
						   (uint16_t)op->imm2;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_GET:
		if (!temp_ok(op->dst)) {
			return -EINVAL;
		}
		transactions = 1U;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_GPIO_SET:
		transactions = 1U;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_ADC_READ:
		if (!temp_ok(op->dst)) {
			return -EINVAL;
		}
		transactions = 1U;
		time_ms = op->imm0;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_DELAY_BOUNDED:
		time_ms = op->imm0;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_WAIT_FIELD_MASK:
		if (!temp_ok(op->dst) || (op->imm0 == 0U)) {
			return -EINVAL;
		}
		transactions = op->imm0;
		bytes = (uint32_t)op->imm0 * 2U;
		time_ms = (uint32_t)op->imm0 * (uint32_t)op->imm1;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_WAIT_GPIO:
		if (!temp_ok(op->dst) || (op->imm0 == 0U) || (op->imm2 > 1U)) {
			return -EINVAL;
		}
		transactions = op->imm0;
		time_ms = (uint32_t)op->imm0 * (uint32_t)op->imm1;
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST:
		if (!temp_ok(op->dst) || (op->imm0 == 0U) || (op->imm0 > 8U)) {
			return -EINVAL;
		}
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_COPY_BYTES:
		if (!temp_ok(op->dst) || !temp_ok(op->src_a)) {
			return -EINVAL;
		}
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_CONCAT:
		if (!temp_ok(op->dst) || !temp_ok(op->src_a) ||
		    !temp_ok(op->src_b)) {
			return -EINVAL;
		}
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_BYTE_SWAP:
		if (!temp_ok(op->dst) || !temp_ok(op->src_a) ||
		    ((op->imm0 != 2U) && (op->imm0 != 4U))) {
			return -EINVAL;
		}
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_MASK:
	case SPAGHETTI_DEVICE_PROFILE_OP_SHIFT:
	case SPAGHETTI_DEVICE_PROFILE_OP_SIGN_EXTEND:
	case SPAGHETTI_DEVICE_PROFILE_OP_CRC8:
	case SPAGHETTI_DEVICE_PROFILE_OP_CRC16:
		if (!temp_ok(op->dst) || !temp_ok(op->src_a)) {
			return -EINVAL;
		}
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD:
		if (!temp_ok(op->src_a) || (op->dst == 0U)) {
			return -EINVAL;
		}
		break;
	case SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD:
		break;
	default:
		return -ENOTSUP;
	}

	if ((budget->total_time_ms > (UINT32_MAX - time_ms)) ||
	    (budget->transactions > (UINT32_MAX - transactions)) ||
	    (budget->bytes > (UINT32_MAX - bytes))) {
		return -EFBIG;
	}

	budget->total_time_ms += time_ms;
	budget->transactions += transactions;
	budget->bytes += bytes;
	budget->operations += 1U;
	return 0;
}

static int opcode_matches_profile(
	const struct spaghetti_device_profile_op *op,
	const struct spaghetti_device_profile *profile)
{
	switch (op->opcode) {
	case SPAGHETTI_DEVICE_PROFILE_OP_W1_WRITE_READ:
		if (profile->transport != SPAGHETTI_PORT_TRANSPORT_W1) {
			return -EINVAL;
		}
		if ((profile->required_capabilities & SPAGHETTI_PORT_CAP_W1) ==
		    0U) {
			return -EINVAL;
		}
		return 0;
	case SPAGHETTI_DEVICE_PROFILE_OP_UART_READ:
		if ((profile->transport != SPAGHETTI_PORT_TRANSPORT_UART) &&
		    ((profile->required_capabilities & SPAGHETTI_PORT_CAP_UART) ==
		     0U)) {
			return -EINVAL;
		}
		return 0;
	case SPAGHETTI_DEVICE_PROFILE_OP_WAIT_GPIO:
		if ((profile->required_capabilities &
		     SPAGHETTI_PORT_CAP_DIGITAL_INPUT) == 0U) {
			return -EINVAL;
		}
		return 0;
	default:
		return 0;
	}
}

static int validate_plan(
	const struct spaghetti_device_profile_op *ops,
	size_t count,
	size_t max_count,
	const struct spaghetti_device_profile *profile,
	struct spaghetti_device_profile_budget *budget,
	bool *saw_emit_field)
{
	if (count > max_count) {
		return -E2BIG;
	}

	for (size_t idx = 0U; idx < count; ++idx) {
		const struct spaghetti_device_profile_op *op = &ops[idx];
		int err;

		if (!opcode_is_known(op->opcode)) {
			return -ENOTSUP;
		}

		err = opcode_matches_profile(op, profile);
		if (err < 0) {
			return err;
		}

		err = accumulate_op_budget(op, budget);
		if (err < 0) {
			return err;
		}

		if (op->opcode == SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD) {
			bool found = false;

			*saw_emit_field = true;
			for (size_t field_idx = 0U;
			     field_idx < profile->sample_field_count;
			     ++field_idx) {
				if (profile->sample_fields[field_idx].field_id ==
				    op->dst) {
					found = true;
					break;
				}
			}
			if (!found) {
				return -EPROTONOSUPPORT;
			}
		}
	}

	return 0;
}

int spaghetti_device_profile_make_schema(
	const struct spaghetti_device_profile *profile,
	struct spaghetti_field_descriptor *fields,
	struct spaghetti_schema_descriptor *out_schema)
{
	if ((profile == NULL) || (fields == NULL) || (out_schema == NULL)) {
		return -EINVAL;
	}
	if (profile->sample_field_count > SPAGHETTI_DEVICE_PROFILE_MAX_FIELDS) {
		return -E2BIG;
	}

	for (size_t idx = 0U; idx < profile->sample_field_count; ++idx) {
		const struct spaghetti_device_profile_field *src =
			&profile->sample_fields[idx];

		if ((src->field_id == 0U) ||
		    ((src->type != SPAGHETTI_VALUE_INT64) &&
		     (src->type != SPAGHETTI_VALUE_UINT64)) ||
		    (src->name[0] == '\0')) {
			return -EINVAL;
		}

		memset(&fields[idx], 0, sizeof(fields[idx]));
		fields[idx].field_id = src->field_id;
		fields[idx].type = src->type;
		fields[idx].semantic = SPAGHETTI_FIELD_SEMANTIC_VALUE;
		fields[idx].flags = SPAGHETTI_FIELD_REQUIRED;
		fields[idx].signed_minimum = INT64_MIN;
		fields[idx].signed_maximum = INT64_MAX;
		fields[idx].unsigned_minimum = 0U;
		fields[idx].unsigned_maximum = UINT64_MAX;
		fields[idx].name = src->name;
		fields[idx].description = "";
		fields[idx].unit = src->unit;
	}

	memset(out_schema, 0, sizeof(*out_schema));
	out_schema->schema_id = profile->sample_schema_id;
	out_schema->version = profile->sample_schema_version;
	out_schema->fields = fields;
	out_schema->field_count = profile->sample_field_count;
	return 0;
}

int spaghetti_device_profile_validate(
	const struct spaghetti_device_profile *profile,
	struct spaghetti_device_profile_budget *out_budget)
{
	struct spaghetti_device_profile_budget budget = { 0 };
	struct spaghetti_field_descriptor fields
		[SPAGHETTI_DEVICE_PROFILE_MAX_FIELDS];
	struct spaghetti_schema_descriptor schema;
	bool saw_emit_field = false;
	int err;

	if (profile == NULL) {
		return -EINVAL;
	}
	if (!profile_id_is_valid(profile->profile_id) ||
	    (profile->version == 0U) ||
	    (profile->required_capabilities == 0U) ||
	    (profile->max_total_time_ms == 0U) ||
	    (profile->sample_schema_id[0] == '\0') ||
	    (profile->sample_schema_version == 0U) ||
	    (profile->sample_field_count == 0U)) {
		return -EINVAL;
	}
	if ((profile->transport == SPAGHETTI_PORT_TRANSPORT_W1) &&
	    ((profile->required_capabilities & SPAGHETTI_PORT_CAP_W1) == 0U)) {
		return -EINVAL;
	}

	err = spaghetti_device_profile_make_schema(profile, fields, &schema);
	if (err < 0) {
		return err;
	}

	err = validate_plan(profile->init_ops, profile->init_count,
			    CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS, profile,
			    &budget, &saw_emit_field);
	if (err < 0) {
		return err;
	}
	err = validate_plan(profile->sample_ops, profile->sample_count,
			    CONFIG_SPAGHETTI_MAX_ACQUISITION_OPERATIONS, profile,
			    &budget, &saw_emit_field);
	if (err < 0) {
		return err;
	}
	err = validate_plan(profile->safe_stop_ops, profile->safe_stop_count,
			    CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS, profile,
			    &budget, &saw_emit_field);
	if (err < 0) {
		return err;
	}

	if (!saw_emit_field) {
		return -EPROTONOSUPPORT;
	}
	if ((budget.total_time_ms > profile->max_total_time_ms) ||
	    (budget.transactions > profile->max_transactions) ||
	    (budget.bytes > profile->max_bytes)) {
		return -EFBIG;
	}
	if (budget.operations > ((uint32_t)CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS +
				 (uint32_t)CONFIG_SPAGHETTI_MAX_ACQUISITION_OPERATIONS +
				 (uint32_t)CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS)) {
		return -E2BIG;
	}

	if (out_budget != NULL) {
		*out_budget = budget;
	}

	return 0;
}

static uint32_t sha256_rotr(uint32_t value, uint32_t bits)
{
	return (value >> bits) | (value << (32U - bits));
}

static void sha256_transform(uint32_t state[8], const uint8_t block[64])
{
	static const uint32_t k[64] = {
		0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
		0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
		0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
		0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
		0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
		0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
		0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
		0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
		0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
		0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
		0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
		0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
		0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
		0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
		0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
		0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
	};
	uint32_t w[64];
	uint32_t a = state[0];
	uint32_t b = state[1];
	uint32_t c = state[2];
	uint32_t d = state[3];
	uint32_t e = state[4];
	uint32_t f = state[5];
	uint32_t g = state[6];
	uint32_t h = state[7];

	for (size_t idx = 0U; idx < 16U; ++idx) {
		w[idx] = ((uint32_t)block[idx * 4U] << 24) |
			 ((uint32_t)block[(idx * 4U) + 1U] << 16) |
			 ((uint32_t)block[(idx * 4U) + 2U] << 8) |
			 (uint32_t)block[(idx * 4U) + 3U];
	}
	for (size_t idx = 16U; idx < 64U; ++idx) {
		const uint32_t s0 = sha256_rotr(w[idx - 15U], 7U) ^
				    sha256_rotr(w[idx - 15U], 18U) ^
				    (w[idx - 15U] >> 3);
		const uint32_t s1 = sha256_rotr(w[idx - 2U], 17U) ^
				    sha256_rotr(w[idx - 2U], 19U) ^
				    (w[idx - 2U] >> 10);

		w[idx] = w[idx - 16U] + s0 + w[idx - 7U] + s1;
	}

	for (size_t idx = 0U; idx < 64U; ++idx) {
		const uint32_t s1 = sha256_rotr(e, 6U) ^ sha256_rotr(e, 11U) ^
				    sha256_rotr(e, 25U);
		const uint32_t ch = (e & f) ^ ((~e) & g);
		const uint32_t temp1 = h + s1 + ch + k[idx] + w[idx];
		const uint32_t s0 = sha256_rotr(a, 2U) ^ sha256_rotr(a, 13U) ^
				    sha256_rotr(a, 22U);
		const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
		const uint32_t temp2 = s0 + maj;

		h = g;
		g = f;
		f = e;
		e = d + temp1;
		d = c;
		c = b;
		b = a;
		a = temp1 + temp2;
	}

	state[0] += a;
	state[1] += b;
	state[2] += c;
	state[3] += d;
	state[4] += e;
	state[5] += f;
	state[6] += g;
	state[7] += h;
}

static int compute_sha256(
	const uint8_t *data,
	size_t size,
	uint8_t out[SPAGHETTI_DEVICE_PROFILE_HASH_SIZE])
{
	uint32_t state[8] = {
		0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
		0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U,
	};
	uint8_t block[64];
	size_t offset = 0U;
	const uint64_t bit_len = ((uint64_t)size) * 8ULL;

	if ((data == NULL) && (size > 0U)) {
		return -EINVAL;
	}

	while ((size - offset) >= 64U) {
		sha256_transform(state, &data[offset]);
		offset += 64U;
	}

	memset(block, 0, sizeof(block));
	if (size > offset) {
		memcpy(block, &data[offset], size - offset);
	}
	block[size - offset] = 0x80U;
	if ((size - offset) >= 56U) {
		sha256_transform(state, block);
		memset(block, 0, sizeof(block));
	}

	block[56] = (uint8_t)(bit_len >> 56);
	block[57] = (uint8_t)(bit_len >> 48);
	block[58] = (uint8_t)(bit_len >> 40);
	block[59] = (uint8_t)(bit_len >> 32);
	block[60] = (uint8_t)(bit_len >> 24);
	block[61] = (uint8_t)(bit_len >> 16);
	block[62] = (uint8_t)(bit_len >> 8);
	block[63] = (uint8_t)bit_len;
	sha256_transform(state, block);

	for (size_t idx = 0U; idx < 8U; ++idx) {
		out[(idx * 4U) + 0U] = (uint8_t)(state[idx] >> 24);
		out[(idx * 4U) + 1U] = (uint8_t)(state[idx] >> 16);
		out[(idx * 4U) + 2U] = (uint8_t)(state[idx] >> 8);
		out[(idx * 4U) + 3U] = (uint8_t)state[idx];
	}

	return 0;
}

static int decode_op(zcbor_state_t *state, struct spaghetti_device_profile_op *op)
{
	uint32_t values[8];

	if (!zcbor_list_start_decode(state)) {
		return -EBADMSG;
	}

	for (size_t idx = 0U; idx < ARRAY_SIZE(values); ++idx) {
		if (!zcbor_uint32_decode(state, &values[idx])) {
			return -EBADMSG;
		}
	}

	if (!zcbor_list_end_decode(state)) {
		return -EBADMSG;
	}

	if ((values[0] > UINT8_MAX) || (values[1] > UINT8_MAX) ||
	    (values[2] > UINT8_MAX) || (values[3] > UINT8_MAX) ||
	    (values[4] > UINT16_MAX) || (values[5] > UINT16_MAX)) {
		return -EINVAL;
	}

	op->opcode = (uint8_t)values[0];
	op->dst = (uint8_t)values[1];
	op->src_a = (uint8_t)values[2];
	op->src_b = (uint8_t)values[3];
	op->imm0 = (uint16_t)values[4];
	op->imm1 = (uint16_t)values[5];
	op->imm2 = values[6];
	op->imm3 = values[7];
	return 0;
}

static int decode_ops(
	zcbor_state_t *state,
	struct spaghetti_device_profile_op *ops,
	size_t max_count,
	size_t *out_count)
{
	size_t count = 0U;

	if (!zcbor_list_start_decode(state)) {
		return -EBADMSG;
	}

	while (!zcbor_array_at_end(state)) {
		int err;

		if (count >= max_count) {
			return -E2BIG;
		}
		err = decode_op(state, &ops[count]);
		if (err < 0) {
			return err;
		}
		count += 1U;
	}

	if (!zcbor_list_end_decode(state)) {
		return -EBADMSG;
	}

	*out_count = count;
	return 0;
}

static int decode_fields(zcbor_state_t *state, struct spaghetti_device_profile *profile)
{
	size_t count = 0U;

	if (!zcbor_list_start_decode(state)) {
		return -EBADMSG;
	}

	while (!zcbor_array_at_end(state)) {
		uint32_t field_id;
		uint32_t type;
		int err;

		if (count >= SPAGHETTI_DEVICE_PROFILE_MAX_FIELDS) {
			return -E2BIG;
		}
		if (!zcbor_list_start_decode(state) ||
		    !zcbor_uint32_decode(state, &field_id) ||
		    !zcbor_uint32_decode(state, &type)) {
			return -EBADMSG;
		}
		if ((field_id == 0U) || (field_id > UINT16_MAX) ||
		    ((type != SPAGHETTI_VALUE_INT64) &&
		     (type != SPAGHETTI_VALUE_UINT64))) {
			return -EINVAL;
		}

		profile->sample_fields[count].field_id = (uint16_t)field_id;
		profile->sample_fields[count].type =
			(enum spaghetti_value_type)type;
		err = decode_text(state, profile->sample_fields[count].name,
				  sizeof(profile->sample_fields[count].name));
		if (err < 0) {
			return err;
		}
		err = decode_text(state, profile->sample_fields[count].unit,
				  sizeof(profile->sample_fields[count].unit));
		if (err < 0) {
			return err;
		}
		if (!zcbor_list_end_decode(state)) {
			return -EBADMSG;
		}
		count += 1U;
	}

	if (!zcbor_list_end_decode(state)) {
		return -EBADMSG;
	}

	profile->sample_field_count = count;
	return 0;
}

static int decode_profile_cbor(
	const uint8_t *cbor,
	size_t size,
	struct spaghetti_device_profile *out)
{
	zcbor_state_t states[8];
	uint32_t wire_version;
	uint32_t version;
	uint32_t transport;
	uint32_t caps;
	uint32_t time_ms;
	uint32_t max_tx;
	uint32_t max_bytes;
	uint32_t schema_version;
	int err;

	memset(out, 0, sizeof(*out));
	zcbor_new_state(states, ARRAY_SIZE(states), cbor, size, 1, NULL, 0);

	if (!zcbor_map_start_decode(states)) {
		return -EBADMSG;
	}

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_WIRE);
	if ((err < 0) || !zcbor_uint32_decode(states, &wire_version)) {
		return -EBADMSG;
	}
	if (wire_version != SPAGHETTI_DEVICE_PROFILE_WIRE_VERSION) {
		return -ENOTSUP;
	}

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_ID);
	if (err < 0) {
		return err;
	}
	err = decode_text(states, out->profile_id, sizeof(out->profile_id));
	if (err < 0) {
		return err;
	}

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_VERSION);
	if ((err < 0) || !zcbor_uint32_decode(states, &version) ||
	    (version == 0U) || (version > UINT16_MAX)) {
		return -EBADMSG;
	}
	out->version = (uint16_t)version;

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_TRANSPORT);
	if ((err < 0) || !zcbor_uint32_decode(states, &transport)) {
		return -EBADMSG;
	}
	out->transport = (enum spaghetti_port_transport)transport;

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_CAPS);
	if ((err < 0) || !zcbor_uint32_decode(states, &caps) || (caps == 0U)) {
		return -EBADMSG;
	}
	out->required_capabilities = caps;

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_TIME);
	if ((err < 0) || !zcbor_uint32_decode(states, &time_ms) ||
	    (time_ms == 0U)) {
		return -EBADMSG;
	}
	out->max_total_time_ms = time_ms;

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_TX);
	if ((err < 0) || !zcbor_uint32_decode(states, &max_tx) ||
	    (max_tx > UINT16_MAX)) {
		return -EBADMSG;
	}
	out->max_transactions = (uint16_t)max_tx;

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_BYTES);
	if ((err < 0) || !zcbor_uint32_decode(states, &max_bytes) ||
	    (max_bytes > UINT16_MAX)) {
		return -EBADMSG;
	}
	out->max_bytes = (uint16_t)max_bytes;

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_INIT);
	if (err < 0) {
		return err;
	}
	err = decode_ops(states, out->init_ops,
			 CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS,
			 &out->init_count);
	if (err < 0) {
		return err;
	}

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_SAMPLE);
	if (err < 0) {
		return err;
	}
	err = decode_ops(states, out->sample_ops,
			 CONFIG_SPAGHETTI_MAX_ACQUISITION_OPERATIONS,
			 &out->sample_count);
	if (err < 0) {
		return err;
	}

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_STOP);
	if (err < 0) {
		return err;
	}
	err = decode_ops(states, out->safe_stop_ops,
			 CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS,
			 &out->safe_stop_count);
	if (err < 0) {
		return err;
	}

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_SCHEMA_ID);
	if (err < 0) {
		return err;
	}
	err = decode_text(states, out->sample_schema_id,
			  sizeof(out->sample_schema_id));
	if (err < 0) {
		return err;
	}

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_SCHEMA_VER);
	if ((err < 0) || !zcbor_uint32_decode(states, &schema_version) ||
	    (schema_version == 0U) || (schema_version > UINT16_MAX)) {
		return -EBADMSG;
	}
	out->sample_schema_version = (uint16_t)schema_version;

	err = expect_key(states, SPAGHETTI_DEVICE_PROFILE_CBOR_KEY_FIELDS);
	if (err < 0) {
		return err;
	}
	err = decode_fields(states, out);
	if (err < 0) {
		return err;
	}

	if (!zcbor_map_end_decode(states)) {
		return -EBADMSG;
	}

	return 0;
}

static void fill_profile_failure(
	struct spaghetti_device_profile_failure *failure,
	enum spaghetti_device_profile_failure_field field,
	enum spaghetti_device_profile_failure_reason reason)
{
	if (failure == NULL) {
		return;
	}
	failure->field = field;
	failure->index = 0U;
	failure->reason = reason;
}

static void fill_decode_failure(
	int err,
	struct spaghetti_device_profile_failure *failure)
{
	switch (err) {
	case -ENOTSUP:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_WIRE,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_UNSUPPORTED);
		break;
	case -EMSGSIZE:
	case -E2BIG:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_WIRE,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_RANGE);
		break;
	case -EINVAL:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_IDENTITY,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_REQUIRED);
		break;
	default:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_WIRE,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_MALFORMED);
		break;
	}
}

static void fill_validate_failure(
	int err,
	struct spaghetti_device_profile_failure *failure)
{
	switch (err) {
	case -ENOTSUP:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_PLAN,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_UNSUPPORTED);
		break;
	case -EPROTONOSUPPORT:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_SCHEMA,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_INCONSISTENT);
		break;
	case -EFBIG:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_BUDGET,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_RANGE);
		break;
	case -E2BIG:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_PLAN,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_RANGE);
		break;
	case -EINVAL:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_IDENTITY,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_REQUIRED);
		break;
	default:
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_PLAN,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_MALFORMED);
		break;
	}
}

int spaghetti_device_profile_validate_cbor(
	const uint8_t *cbor,
	size_t size,
	struct spaghetti_device_profile_failure *failure)
{
	struct spaghetti_device_profile staging;
	int err;

	if ((cbor == NULL) || (size == 0U)) {
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_WIRE,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_REQUIRED);
		return -EINVAL;
	}
	if (size > CONFIG_SPAGHETTI_MAX_DEVICE_PROFILE_BYTES) {
		fill_profile_failure(failure, SPAGHETTI_DEVICE_PROFILE_FAILURE_WIRE,
				     SPAGHETTI_DEVICE_PROFILE_FAILURE_RANGE);
		return -EMSGSIZE;
	}

	err = decode_profile_cbor(cbor, size, &staging);
	if (err < 0) {
		fill_decode_failure(err, failure);
		return err;
	}

	err = spaghetti_device_profile_validate(&staging, NULL);
	if (err < 0) {
		fill_validate_failure(err, failure);
		return err;
	}
	return 0;
}

static const struct spaghetti_device_profile *find_locked(
	const char *id,
	uint16_t version,
	const uint8_t *hash_or_null)
{
	for (size_t idx = 0U; idx < catalog_count; ++idx) {
		const struct spaghetti_device_profile *profile = catalog[idx];

		if ((strcmp(profile->profile_id, id) == 0) &&
		    (profile->version == version)) {
			if ((hash_or_null != NULL) &&
			    (memcmp(profile->hash, hash_or_null,
				    SPAGHETTI_DEVICE_PROFILE_HASH_SIZE) != 0)) {
				return NULL;
			}
			return profile;
		}
	}

	return NULL;
}

static int catalog_add(const struct spaghetti_device_profile *profile)
{
	if (catalog_count >= ARRAY_SIZE(catalog)) {
		return -ENOSPC;
	}

	catalog[catalog_count++] = profile;
	return 0;
}

static struct spaghetti_device_profile_slot *alloc_slot(void)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(slots); ++idx) {
		if (!slots[idx].used) {
			memset(&slots[idx], 0, sizeof(slots[idx]));
			slots[idx].used = true;
			return &slots[idx];
		}
	}

	return NULL;
}

static int commit_decoded(
	const struct spaghetti_device_profile *profile,
	const uint8_t *cbor,
	size_t cbor_size,
	bool persist)
{
	const struct spaghetti_device_profile *existing;
	struct spaghetti_device_profile_slot *slot;
	struct spaghetti_device_profile_budget budget;
	int err;

	err = spaghetti_device_profile_validate(profile, &budget);
	if (err < 0) {
		return err;
	}

	existing = find_locked(profile->profile_id, profile->version, NULL);
	if (existing != NULL) {
		if (memcmp(existing->hash, profile->hash,
			   SPAGHETTI_DEVICE_PROFILE_HASH_SIZE) != 0) {
			return -EEXIST;
		}
		return 0;
	}

	slot = alloc_slot();
	if (slot == NULL) {
		return -ENOSPC;
	}

	slot->decoded = *profile;
	slot->from_builtin = false;
	if (persist && (cbor != NULL) && (cbor_size > 0U)) {
		if (cbor_size > sizeof(slot->cbor)) {
			slot->used = false;
			return -EMSGSIZE;
		}
		memcpy(slot->cbor, cbor, cbor_size);
		slot->cbor_size = cbor_size;
		slot->persisted = true;
	}

	err = catalog_add(&slot->decoded);
	if (err < 0) {
		slot->used = false;
		return err;
	}

	ARG_UNUSED(budget);
	return 0;
}

static int reload_persisted(void)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(slots); ++idx) {
		struct spaghetti_device_profile_slot *slot = &slots[idx];
		struct spaghetti_device_profile decoded;
		uint8_t hash[SPAGHETTI_DEVICE_PROFILE_HASH_SIZE];
		int err;

		if (!slot->persisted || (slot->cbor_size == 0U)) {
			continue;
		}

		err = decode_profile_cbor(slot->cbor, slot->cbor_size, &decoded);
		if (err < 0) {
			return err;
		}
		err = compute_sha256(slot->cbor, slot->cbor_size, hash);
		if (err < 0) {
			return err;
		}
		memcpy(decoded.hash, hash, sizeof(hash));
		slot->decoded = decoded;
		slot->used = true;
		slot->from_builtin = false;
		err = catalog_add(&slot->decoded);
		if (err < 0) {
			return err;
		}
	}

	return 0;
}

int spaghetti_device_profile_init(void)
{
	int err;

	catalog_count = 0U;
	for (size_t idx = 0U; idx < ARRAY_SIZE(slots); ++idx) {
		if (!slots[idx].persisted) {
			memset(&slots[idx], 0, sizeof(slots[idx]));
		} else {
			slots[idx].used = false;
			slots[idx].from_builtin = false;
			memset(&slots[idx].decoded, 0,
			       sizeof(slots[idx].decoded));
		}
	}

	STRUCT_SECTION_FOREACH(spaghetti_device_profile, profile) {
		err = spaghetti_device_profile_validate(profile, NULL);
		if (err < 0) {
			return err;
		}
		err = catalog_add(profile);
		if (err < 0) {
			return err;
		}
	}

	err = reload_persisted();
	if (err < 0) {
		return err;
	}

	catalog_ready = true;
	LOG_INF("ready: profiles=%u", (uint32_t)catalog_count);
	return 0;
}

size_t spaghetti_device_profile_count(void)
{
	return catalog_count;
}

const struct spaghetti_device_profile *spaghetti_device_profile_get(size_t idx)
{
	if (idx >= catalog_count) {
		return NULL;
	}

	return catalog[idx];
}

const struct spaghetti_device_profile *spaghetti_device_profile_find(
	const char *id,
	uint16_t version,
	const uint8_t *hash_or_null)
{
	if (!profile_id_is_valid(id) || (version == 0U)) {
		return NULL;
	}

	return find_locked(id, version, hash_or_null);
}

int spaghetti_device_profile_install(const uint8_t *cbor, size_t size)
{
	struct spaghetti_device_profile staging;
	uint8_t hash[SPAGHETTI_DEVICE_PROFILE_HASH_SIZE];
	int err;

	if ((cbor == NULL) || (size == 0U)) {
		return -EINVAL;
	}
	if (size > CONFIG_SPAGHETTI_MAX_DEVICE_PROFILE_BYTES) {
		return -EMSGSIZE;
	}

	err = decode_profile_cbor(cbor, size, &staging);
	if (err < 0) {
		return err;
	}

	err = compute_sha256(cbor, size, hash);
	if (err < 0) {
		return err;
	}
	memcpy(staging.hash, hash, sizeof(hash));

	return commit_decoded(&staging, cbor, size, true);
}

int spaghetti_device_profile_install_decoded(
	const struct spaghetti_device_profile *profile)
{
	if (profile == NULL) {
		return -EINVAL;
	}

	return commit_decoded(profile, NULL, 0U, false);
}

int spaghetti_device_profile_remove(const char *id, uint16_t version)
{
	size_t catalog_idx;
	struct spaghetti_device_profile_slot *slot = NULL;

	if (!profile_id_is_valid(id) || (version == 0U)) {
		return -EINVAL;
	}

	for (catalog_idx = 0U; catalog_idx < catalog_count; ++catalog_idx) {
		if ((strcmp(catalog[catalog_idx]->profile_id, id) == 0) &&
		    (catalog[catalog_idx]->version == version)) {
			break;
		}
	}
	if (catalog_idx >= catalog_count) {
		return -ENOENT;
	}

	for (size_t idx = 0U; idx < ARRAY_SIZE(slots); ++idx) {
		if (slots[idx].used && (&slots[idx].decoded == catalog[catalog_idx])) {
			slot = &slots[idx];
			break;
		}
	}
	if (slot == NULL) {
		return -EPERM;
	}

	if ((reference_checker != NULL) &&
	    reference_checker(id, version, reference_checker_user_data)) {
		return -EBUSY;
	}

	for (size_t idx = catalog_idx + 1U; idx < catalog_count; ++idx) {
		catalog[idx - 1U] = catalog[idx];
	}
	catalog_count -= 1U;
	memset(slot, 0, sizeof(*slot));
	return 0;
}

void spaghetti_device_profile_set_reference_checker(
	spaghetti_device_profile_reference_checker_t checker,
	void *user_data)
{
	reference_checker = checker;
	reference_checker_user_data = user_data;
}

#if defined(CONFIG_ZTEST) || defined(ZTEST_UNITTEST)
void spaghetti_device_profile_reset_for_test(void)
{
	catalog_count = 0U;
	catalog_ready = false;
	reference_checker = NULL;
	reference_checker_user_data = NULL;

	for (size_t idx = 0U; idx < ARRAY_SIZE(slots); ++idx) {
		if (slots[idx].persisted) {
			slots[idx].used = false;
			slots[idx].from_builtin = false;
			memset(&slots[idx].decoded, 0,
			       sizeof(slots[idx].decoded));
		} else {
			memset(&slots[idx], 0, sizeof(slots[idx]));
		}
	}
}

void spaghetti_device_profile_clear_persisted_for_test(void)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(slots); ++idx) {
		memset(&slots[idx], 0, sizeof(slots[idx]));
	}
	catalog_count = 0U;
	catalog_ready = false;
}
#endif
