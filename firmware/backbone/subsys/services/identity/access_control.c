#include <spaghetti/access_control.h>

#include <errno.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <spaghetti/maintenance_link.h>
#include <spaghetti/mqtt.h>
#include <spaghetti/ota.h>
#include <spaghetti/ble.h>
#include <spaghetti/remote_console.h>
#include <spaghetti/communication.h>

LOG_MODULE_REGISTER(spaghetti_access_control,
		    CONFIG_SPAGHETTI_ACCESS_CONTROL_LOG_LEVEL);

struct spaghetti_access_control_context {
	struct spaghetti_principal principals[CONFIG_SPAGHETTI_MAX_PRINCIPALS];
	size_t principal_count;
	struct spaghetti_audit_entry audit[CONFIG_SPAGHETTI_MAX_AUDIT_ENTRIES];
	uint32_t next_sequence;
	size_t audit_count;
	size_t audit_head;
	bool ready;
};

static struct spaghetti_access_control_context context;
K_MUTEX_DEFINE(access_control_lock);

static uint32_t permissions_for_role(enum spaghetti_role role)
{
	switch (role) {
	case SPAGHETTI_ROLE_OBSERVER:
		return SPAGHETTI_PERMISSION_READ;
	case SPAGHETTI_ROLE_OPERATOR:
		return SPAGHETTI_PERMISSION_READ |
		       SPAGHETTI_PERMISSION_COMMAND |
		       SPAGHETTI_PERMISSION_DISCOVER;
	case SPAGHETTI_ROLE_ADMINISTRATOR:
		return SPAGHETTI_PERMISSION_READ |
		       SPAGHETTI_PERMISSION_CONFIGURE |
		       SPAGHETTI_PERMISSION_COMMAND |
		       SPAGHETTI_PERMISSION_DISCOVER |
		       SPAGHETTI_PERMISSION_UPDATE;
	case SPAGHETTI_ROLE_PROVISIONER:
		return SPAGHETTI_PERMISSION_READ |
		       SPAGHETTI_PERMISSION_CONFIGURE |
		       SPAGHETTI_PERMISSION_COMMAND |
		       SPAGHETTI_PERMISSION_DISCOVER |
		       SPAGHETTI_PERMISSION_UPDATE |
		       SPAGHETTI_PERMISSION_PROVISION;
	default:
		return 0U;
	}
}

static size_t bounded_name_size(const char *name)
{
	const char *terminator = memchr(name, '\0', SPAGHETTI_DEVICE_NAME_SIZE);

	return (terminator != NULL) ? (size_t)(terminator - name) :
				      SPAGHETTI_DEVICE_NAME_SIZE;
}

static int find_principal_index_locked(spaghetti_principal_id_t id)
{
	for (size_t index = 0U; index < context.principal_count; ++index) {
		if (context.principals[index].id == id) {
			return (int)index;
		}
	}
	return -ENOENT;
}

static void revoke_bound_credentials(spaghetti_principal_id_t id)
{
	(void)spaghetti_ota_delete_credentials_for_principal(id);
	(void)spaghetti_remote_console_delete_credentials_for_principal(id);
	(void)spaghetti_mqtt_delete_credentials_for_principal(id);
	(void)spaghetti_ble_delete_credentials_for_principal(id);
	spaghetti_communication_invalidate_principal(id);
}

int spaghetti_access_control_init(void)
{
	int err = k_mutex_lock(&access_control_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (context.ready) {
		k_mutex_unlock(&access_control_lock);
		return -EALREADY;
	}
	if (CONFIG_SPAGHETTI_MAX_PRINCIPALS < 1) {
		k_mutex_unlock(&access_control_lock);
		return -ENOSPC;
	}

	memset(&context, 0, sizeof(context));
	context.principals[0] = (struct spaghetti_principal) {
		.id = SPAGHETTI_PRINCIPAL_MAINTENANCE_ID,
		.role = SPAGHETTI_ROLE_PROVISIONER,
		.permissions = permissions_for_role(SPAGHETTI_ROLE_PROVISIONER),
		.enabled = true,
		.name = "maintenance",
	};
	context.principal_count = 1U;
	context.next_sequence = 1U;
	context.ready = true;
	k_mutex_unlock(&access_control_lock);
	LOG_INF("access control ready principals=%u",
		(uint32_t)CONFIG_SPAGHETTI_MAX_PRINCIPALS);
	return 0;
}

int spaghetti_principal_get(
	spaghetti_principal_id_t id,
	struct spaghetti_principal *out)
{
	int index;
	int err;

	if ((out == NULL) || (id == 0U)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&access_control_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.ready) {
		k_mutex_unlock(&access_control_lock);
		return -EACCES;
	}

	index = find_principal_index_locked(id);
	if (index < 0) {
		k_mutex_unlock(&access_control_lock);
		return -ENOENT;
	}
	*out = context.principals[index];
	k_mutex_unlock(&access_control_lock);
	return 0;
}

size_t spaghetti_principal_count(void)
{
	size_t count = 0U;

	if (k_mutex_lock(&access_control_lock, K_FOREVER) < 0) {
		return 0U;
	}
	if (context.ready) {
		count = context.principal_count;
	}
	k_mutex_unlock(&access_control_lock);
	return count;
}

int spaghetti_principal_get_by_index(
	size_t index,
	struct spaghetti_principal *out)
{
	int err;

	if (out == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&access_control_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.ready) {
		k_mutex_unlock(&access_control_lock);
		return -EACCES;
	}
	if (index >= context.principal_count) {
		k_mutex_unlock(&access_control_lock);
		return -ENOENT;
	}

	*out = context.principals[index];
	k_mutex_unlock(&access_control_lock);
	return 0;
}

int spaghetti_principal_provision(
	spaghetti_principal_id_t id,
	enum spaghetti_role role,
	const char *name)
{
	size_t name_size;
	uint32_t permissions;
	int existing;
	int err;

	if ((id == 0U) || (id == SPAGHETTI_PRINCIPAL_MAINTENANCE_ID) ||
	    (name == NULL)) {
		return -EINVAL;
	}
	name_size = bounded_name_size(name);
	if ((name_size == 0U) || (name_size >= SPAGHETTI_DEVICE_NAME_SIZE)) {
		return -EINVAL;
	}
	permissions = permissions_for_role(role);
	if (permissions == 0U) {
		return -EINVAL;
	}
	if (spaghetti_maintenance_link_get_state() !=
	    SPAGHETTI_MAINTENANCE_LINK_ACTIVE) {
		return -EACCES;
	}

	err = k_mutex_lock(&access_control_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.ready) {
		k_mutex_unlock(&access_control_lock);
		return -EACCES;
	}

	existing = find_principal_index_locked(id);
	if (existing >= 0) {
		k_mutex_unlock(&access_control_lock);
		return -EEXIST;
	}
	if (context.principal_count >= CONFIG_SPAGHETTI_MAX_PRINCIPALS) {
		k_mutex_unlock(&access_control_lock);
		return -ENOSPC;
	}

	context.principals[context.principal_count] =
		(struct spaghetti_principal) {
			.id = id,
			.role = role,
			.permissions = permissions,
			.enabled = true,
		};
	memcpy(context.principals[context.principal_count].name, name,
	       name_size);
	++context.principal_count;
	k_mutex_unlock(&access_control_lock);
	return 0;
}

int spaghetti_principal_authorize(
	spaghetti_principal_id_t id,
	uint32_t required_permissions)
{
	int index;
	int err;

	if (id == 0U) {
		return -EINVAL;
	}

	err = k_mutex_lock(&access_control_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.ready) {
		k_mutex_unlock(&access_control_lock);
		return -EACCES;
	}

	index = find_principal_index_locked(id);
	if (index < 0) {
		k_mutex_unlock(&access_control_lock);
		return -ENOENT;
	}
	if (!context.principals[index].enabled ||
	    ((context.principals[index].permissions & required_permissions) !=
	     required_permissions)) {
		k_mutex_unlock(&access_control_lock);
		return -EACCES;
	}
	k_mutex_unlock(&access_control_lock);
	return 0;
}

int spaghetti_principal_revoke(spaghetti_principal_id_t id)
{
	int index;
	int err;

	if ((id == 0U) || (id == SPAGHETTI_PRINCIPAL_MAINTENANCE_ID)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&access_control_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.ready) {
		k_mutex_unlock(&access_control_lock);
		return -EACCES;
	}

	index = find_principal_index_locked(id);
	if (index < 0) {
		k_mutex_unlock(&access_control_lock);
		return -ENOENT;
	}
	context.principals[index].enabled = false;
	k_mutex_unlock(&access_control_lock);

	revoke_bound_credentials(id);
	return 0;
}

int spaghetti_audit_record(
	spaghetti_principal_id_t principal_id,
	uint16_t operation_id,
	int internal_result)
{
	struct spaghetti_audit_entry entry;
	int err;

	err = k_mutex_lock(&access_control_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.ready) {
		k_mutex_unlock(&access_control_lock);
		return -EACCES;
	}

	entry = (struct spaghetti_audit_entry) {
		.sequence = context.next_sequence,
		.principal_id = principal_id,
		.operation_id = operation_id,
		.internal_result = internal_result,
		.uptime_ms = k_uptime_get(),
	};
	if (context.next_sequence == UINT32_MAX) {
		context.next_sequence = 1U;
	} else {
		++context.next_sequence;
	}

	context.audit[context.audit_head] = entry;
	context.audit_head =
		(context.audit_head + 1U) % CONFIG_SPAGHETTI_MAX_AUDIT_ENTRIES;
	if (context.audit_count < CONFIG_SPAGHETTI_MAX_AUDIT_ENTRIES) {
		++context.audit_count;
	}
	k_mutex_unlock(&access_control_lock);
	return 0;
}

int spaghetti_audit_get(
	uint32_t sequence,
	struct spaghetti_audit_entry *out)
{
	int err;

	if ((out == NULL) || (sequence == 0U)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&access_control_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!context.ready) {
		k_mutex_unlock(&access_control_lock);
		return -EACCES;
	}

	for (size_t offset = 0U; offset < context.audit_count; ++offset) {
		const size_t index =
			(context.audit_head + CONFIG_SPAGHETTI_MAX_AUDIT_ENTRIES -
			 context.audit_count + offset) %
			CONFIG_SPAGHETTI_MAX_AUDIT_ENTRIES;

		if (context.audit[index].sequence == sequence) {
			*out = context.audit[index];
			k_mutex_unlock(&access_control_lock);
			return 0;
		}
	}
	k_mutex_unlock(&access_control_lock);
	return -ENOENT;
}
