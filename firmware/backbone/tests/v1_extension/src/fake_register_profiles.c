/**
 * @file
 * @brief Two Device Profiles sharing the declarative-device driver.
 */

#include <spaghetti/device_profile.h>
#include <spaghetti/port.h>
#include <spaghetti/schema.h>

enum {
	FIELD_VALUE = 1U,
	REG_A = 0x10U,
	REG_B = 0x20U,
};

SPAGHETTI_DEVICE_PROFILE_DEFINE(fake_register_profile_a) = {
	.profile_id = "fake-register-a",
	.version = 1U,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.max_total_time_ms = 1000U,
	.max_transactions = 8U,
	.max_bytes = 32U,
	.sample_ops = {
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST,
			.dst = 0U,
			.imm0 = 1U,
			.imm2 = REG_A,
		},
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ,
			.dst = 1U,
			.src_a = 0U,
			.imm0 = 2U,
			.imm1 = 1U,
			.imm2 = 100U,
		},
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD,
			.dst = FIELD_VALUE,
			.src_a = 1U,
			.imm0 = 2U,
			.imm1 = 1U,
			.imm3 = 1U,
		},
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD,
		},
	},
	.sample_count = 4U,
	.sample_schema_id = "spaghetti.fake_reg_a.sample",
	.sample_schema_version = 1U,
	.sample_fields = {
		{
			.field_id = FIELD_VALUE,
			.type = SPAGHETTI_VALUE_INT64,
			.name = "value",
			.unit = "raw",
		},
	},
	.sample_field_count = 1U,
};

SPAGHETTI_DEVICE_PROFILE_DEFINE(fake_register_profile_b) = {
	.profile_id = "fake-register-b",
	.version = 1U,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.max_total_time_ms = 1000U,
	.max_transactions = 8U,
	.max_bytes = 32U,
	.sample_ops = {
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_LOAD_CONST,
			.dst = 0U,
			.imm0 = 1U,
			.imm2 = REG_B,
		},
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_I2C_WRITE_READ,
			.dst = 1U,
			.src_a = 0U,
			.imm0 = 2U,
			.imm1 = 1U,
			.imm2 = 100U,
		},
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_EMIT_FIELD,
			.dst = FIELD_VALUE,
			.src_a = 1U,
			.imm0 = 2U,
			.imm1 = 0U,
			.imm3 = 1U,
		},
		{
			.opcode = SPAGHETTI_DEVICE_PROFILE_OP_EMIT_RECORD,
		},
	},
	.sample_count = 4U,
	.sample_schema_id = "spaghetti.fake_reg_b.sample",
	.sample_schema_version = 1U,
	.sample_fields = {
		{
			.field_id = FIELD_VALUE,
			.type = SPAGHETTI_VALUE_INT64,
			.name = "value",
			.unit = "raw",
		},
	},
	.sample_field_count = 1U,
};
