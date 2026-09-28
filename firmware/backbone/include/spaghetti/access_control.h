/**
 * @file
 * @brief Bounded principals, roles, permissions, and audit ring.
 * @ingroup spaghetti_access_control
 */

#ifndef SPAGHETTI_ACCESS_CONTROL_H
#define SPAGHETTI_ACCESS_CONTROL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <zephyr/sys/util.h>

#include <spaghetti/identity.h>

/** Stable copied principal identifier. Zero is reserved and invalid. */
typedef uint16_t spaghetti_principal_id_t;

/** Firmware-reserved local Maintenance principal; not network-provisionable. */
#define SPAGHETTI_PRINCIPAL_MAINTENANCE_ID ((spaghetti_principal_id_t)1U)

/** Explicit peer role; permissions are derived and never peer-chosen. */
enum spaghetti_role {
	SPAGHETTI_ROLE_OBSERVER, /**< Read-only observation. */
	SPAGHETTI_ROLE_OPERATOR, /**< Read, command, and discover. */
	SPAGHETTI_ROLE_ADMINISTRATOR, /**< Configure and update in addition to operate. */
	SPAGHETTI_ROLE_PROVISIONER, /**< Full permission set including provision. */
};

/** Explicit authorization bits derived from @ref spaghetti_role. */
enum spaghetti_permission {
	SPAGHETTI_PERMISSION_READ = BIT(0), /**< Inspect non-secret state. */
	SPAGHETTI_PERMISSION_CONFIGURE = BIT(1), /**< Change durable Config. */
	SPAGHETTI_PERMISSION_COMMAND = BIT(2), /**< Issue runtime commands. */
	SPAGHETTI_PERMISSION_DISCOVER = BIT(3), /**< Run Discovery operations. */
	SPAGHETTI_PERMISSION_UPDATE = BIT(4), /**< Arm firmware update windows. */
	SPAGHETTI_PERMISSION_PROVISION = BIT(5), /**< Manage principals and factory reset. */
};

/** Caller-owned principal metadata; contains no secrets. */
struct spaghetti_principal {
	spaghetti_principal_id_t id; /**< Stable non-zero identifier. */
	enum spaghetti_role role; /**< Role that owns the permission set. */
	uint32_t permissions; /**< Derived permission bitmask. */
	bool enabled; /**< False after revoke until re-provisioned. */
	char name[SPAGHETTI_DEVICE_NAME_SIZE]; /**< Copied friendly label. */
};

/** Caller-owned audit ring entry; never stores payloads or secrets. */
struct spaghetti_audit_entry {
	uint32_t sequence; /**< Monotonic ring sequence, starting at one. */
	spaghetti_principal_id_t principal_id; /**< Acting principal, or zero. */
	uint16_t operation_id; /**< Transport-independent operation tag. */
	int32_t internal_result; /**< Internal errno/result before public mapping. */
	int64_t uptime_ms; /**< Kernel uptime when the entry was recorded. */
};

/**
 * @brief Initialize the principal table and audit ring.
 *
 * Creates the reserved Maintenance principal when capacity allows.
 *
 * @retval 0 Access control is ready.
 * @retval -EALREADY Access control was already initialized.
 * @retval -ENOSPC @ref CONFIG_SPAGHETTI_MAX_PRINCIPALS is below one.
 */
int spaghetti_access_control_init(void);

/**
 * @brief Copy one principal by identifier.
 *
 * @param[in] id Non-zero principal identifier.
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains a coherent principal copy.
 * @retval -EINVAL @p out is NULL or @p id is zero.
 * @retval -EACCES Access control is not initialized.
 * @retval -ENOENT No principal with that identifier exists.
 */
int spaghetti_principal_get(
	spaghetti_principal_id_t id,
	struct spaghetti_principal *out);

/**
 * @brief Return the number of provisioned principals including Maintenance.
 *
 * @return Bounded count; zero when access control is not initialized.
 */
size_t spaghetti_principal_count(void);

/**
 * @brief Copy one principal by stable table index.
 *
 * @param[in] index Zero-based index below @ref spaghetti_principal_count.
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains a coherent principal copy.
 * @retval -EINVAL @p out is NULL.
 * @retval -EACCES Access control is not initialized.
 * @retval -ENOENT @p index is out of range.
 */
int spaghetti_principal_get_by_index(
	size_t index,
	struct spaghetti_principal *out);

/**
 * @brief Provision or replace one non-Maintenance principal.
 *
 * Allowed only while the local Maintenance link is ACTIVE. Permissions are
 * derived from @p role and are never accepted from the peer.
 *
 * @param[in] id Non-zero identifier distinct from Maintenance.
 * @param[in] role Role that selects the permission set.
 * @param[in] name Caller-owned NUL-terminated label borrowed for this call.
 *
 * @retval 0 The principal metadata was stored.
 * @retval -EINVAL An argument is invalid or @p id is reserved.
 * @retval -EACCES Maintenance is inactive or access control is uninitialized.
 * @retval -EEXIST A different principal already uses @p id.
 * @retval -ENOSPC The bounded principal table is full.
 */
int spaghetti_principal_provision(
	spaghetti_principal_id_t id,
	enum spaghetti_role role,
	const char *name);

/**
 * @brief Authorize an enabled principal for the required permission bits.
 *
 * @param[in] id Principal identifier to authorize.
 * @param[in] required_permissions Permission bitmask that must all be present.
 *
 * @retval 0 The principal is enabled and has every required bit.
 * @retval -EINVAL @p id is zero.
 * @retval -ENOENT The principal does not exist.
 * @retval -EACCES The principal is disabled or lacks a required bit.
 */
int spaghetti_principal_authorize(
	spaghetti_principal_id_t id,
	uint32_t required_permissions);

/**
 * @brief Disable one principal and revoke its bound credentials and sessions.
 *
 * Maintenance cannot be revoked. Other principals remain unchanged.
 *
 * @param[in] id Non-Maintenance principal identifier.
 *
 * @retval 0 The principal is disabled and credential hooks ran.
 * @retval -EINVAL @p id is zero or reserved Maintenance.
 * @retval -EACCES Access control is not initialized.
 * @retval -ENOENT The principal does not exist.
 */
int spaghetti_principal_revoke(spaghetti_principal_id_t id);

/**
 * @brief Append one copied audit entry to the bounded ring.
 *
 * @param[in] principal_id Acting principal, or zero when none applies.
 * @param[in] operation_id Operation tag copied by value.
 * @param[in] internal_result Internal result copied by value.
 *
 * @retval 0 The entry was recorded.
 * @retval -EACCES Access control is not initialized.
 */
int spaghetti_audit_record(
	spaghetti_principal_id_t principal_id,
	uint16_t operation_id,
	int internal_result);

/**
 * @brief Copy one audit entry by sequence number.
 *
 * @param[in] sequence Sequence previously returned by a recorded entry.
 * @param[out] out Caller-owned destination written only on success.
 *
 * @retval 0 @p out contains the matching entry.
 * @retval -EINVAL @p out is NULL or @p sequence is zero.
 * @retval -EACCES Access control is not initialized.
 * @retval -ENOENT The sequence was never recorded or was overwritten.
 */
int spaghetti_audit_get(
	uint32_t sequence,
	struct spaghetti_audit_entry *out);

#endif /* SPAGHETTI_ACCESS_CONTROL_H */
