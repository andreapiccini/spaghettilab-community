#include <spaghetti/power.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/devicetree.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/util.h>

#include "power_internal.h"

LOG_MODULE_REGISTER(spaghetti_power, CONFIG_SPAGHETTI_POWER_LOG_LEVEL);

#define SPAGHETTI_POWER_MAX_OWNERS CONFIG_SPAGHETTI_MAX_MODULES

#define SPAGHETTI_POWER_RAIL_ASSURANCE(node_id) \
	((enum spaghetti_power_assurance)DT_ENUM_IDX(node_id, assurance))

#define SPAGHETTI_POWER_RAIL_VALIDATE(node_id) \
	BUILD_ASSERT(DT_REG_ADDR(node_id) <= UINT8_MAX, \
		     "Spaghetti power rail ID must fit spaghetti_power_rail_id_t"); \
	BUILD_ASSERT(DT_REG_ADDR(node_id) < 32U, \
		     "Spaghetti power rail ID must fit available_rail_mask");

#define SPAGHETTI_POWER_RAIL_DEFINE(node_id) \
	{ \
		.id = (spaghetti_power_rail_id_t)DT_REG_ADDR(node_id), \
		.assurance = SPAGHETTI_POWER_RAIL_ASSURANCE(node_id), \
		.min_microvolts = DT_PROP_OR(node_id, min_microvolts, 0), \
		.max_microvolts = DT_PROP_OR(node_id, max_microvolts, 0), \
		.max_total_microamps = \
			DT_PROP_OR(node_id, max_total_microamps, 0), \
	},

#define SPAGHETTI_BAY_POWER_VALIDATE(node_id) \
	BUILD_ASSERT(DT_PROP(node_id, bay_id) <= UINT8_MAX, \
		     "Spaghetti bay-id must fit spaghetti_bay_id_t"); \
	BUILD_ASSERT(DT_REG_ADDR(DT_PHANDLE(node_id, flow)) <= UINT8_MAX, \
		     "Spaghetti bay-power flow ID must fit spaghetti_flow_id_t");

#define SPAGHETTI_BAY_POWER_RAIL_BIT(node_id, prop, idx) \
	| BIT(DT_PROP_BY_IDX(node_id, prop, idx))

#define SPAGHETTI_BAY_POWER_MASK(node_id) \
	(0U DT_FOREACH_PROP_ELEM(node_id, available_rails, \
				 SPAGHETTI_BAY_POWER_RAIL_BIT))

#define SPAGHETTI_BAY_POWER_DEFINE(node_id) \
	{ \
		.flow_id = (spaghetti_flow_id_t)DT_REG_ADDR( \
			DT_PHANDLE(node_id, flow)), \
		.bay_id = (spaghetti_bay_id_t)DT_PROP(node_id, bay_id), \
		.available_rail_mask = SPAGHETTI_BAY_POWER_MASK(node_id), \
	},

DT_FOREACH_STATUS_OKAY(spaghettilab_power_rail, SPAGHETTI_POWER_RAIL_VALIDATE)
DT_FOREACH_STATUS_OKAY(spaghettilab_bay_power, SPAGHETTI_BAY_POWER_VALIDATE)

static const struct spaghetti_power_rail_descriptor rail_descriptors[] = {
	DT_FOREACH_STATUS_OKAY(spaghettilab_power_rail, SPAGHETTI_POWER_RAIL_DEFINE)
};

static const struct spaghetti_bay_power_descriptor bay_descriptors[] = {
	DT_FOREACH_STATUS_OKAY(spaghettilab_bay_power, SPAGHETTI_BAY_POWER_DEFINE)
};

#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_power_rail)
BUILD_ASSERT(ARRAY_SIZE(rail_descriptors) <= CONFIG_SPAGHETTI_MAX_POWER_RAILS,
	     "Declared power rails exceed the selected resource profile");
#endif

struct spaghetti_power_resource {
	spaghetti_power_resource_id_t id;
	enum spaghetti_power_state state;
	spaghetti_power_owner_id_t owners[SPAGHETTI_POWER_MAX_OWNERS];
	uint16_t reference_count;
	uint32_t admitted_microamps;
	uint32_t owner_microamps[SPAGHETTI_POWER_MAX_OWNERS];
	int last_error;
	struct k_mutex lock;
};

#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_power_rail)
static struct spaghetti_power_resource resources[ARRAY_SIZE(rail_descriptors)];
#elif defined(CONFIG_SPAGHETTI_POWER_FAKE_BACKEND)
static struct spaghetti_power_resource resources[1] = {
	{ .id = 0U },
};
#else
static struct spaghetti_power_resource resources[1];
#endif

static atomic_t is_initialized;
K_MUTEX_DEFINE(init_lock);

static size_t resource_count(void)
{
#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_power_rail)
	return ARRAY_SIZE(resources);
#elif defined(CONFIG_SPAGHETTI_POWER_FAKE_BACKEND)
	return 1U;
#else
	return 0U;
#endif
}

static const struct spaghetti_power_rail_descriptor *rail_descriptor_get(
	spaghetti_power_rail_id_t id)
{
#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_power_rail)
	for (size_t idx = 0U; idx < ARRAY_SIZE(rail_descriptors); ++idx) {
		if (rail_descriptors[idx].id == id) {
			return &rail_descriptors[idx];
		}
	}
	return NULL;
#elif defined(CONFIG_SPAGHETTI_POWER_FAKE_BACKEND)
	static const struct spaghetti_power_rail_descriptor fake_rail = {
		.id = 0U,
		.assurance = SPAGHETTI_POWER_SWITCHED,
		.min_microvolts = 0U,
		.max_microvolts = 0U,
		.max_total_microamps = 0U,
	};

	return (id == 0U) ? &fake_rail : NULL;
#else
	ARG_UNUSED(id);
	return NULL;
#endif
}

static int set_resource_enabled(spaghetti_power_resource_id_t id, bool enabled)
{
	const struct spaghetti_power_rail_descriptor *rail =
		rail_descriptor_get(id);

	if ((rail != NULL) && (rail->assurance == SPAGHETTI_POWER_UNMANAGED)) {
		ARG_UNUSED(enabled);
		return 0;
	}

#if defined(CONFIG_SPAGHETTI_POWER_FAKE_BACKEND)
	return spaghetti_power_backend_set(id, enabled);
#else
	ARG_UNUSED(id);
	ARG_UNUSED(enabled);
	return -ENOTSUP;
#endif
}

static struct spaghetti_power_resource *find_resource(
	spaghetti_power_resource_id_t id)
{
	for (size_t resource_idx = 0U; resource_idx < resource_count();
	     ++resource_idx) {
		if (resources[resource_idx].id == id) {
			return &resources[resource_idx];
		}
	}

	return NULL;
}

static int find_owner(const struct spaghetti_power_resource *resource,
		      spaghetti_power_owner_id_t owner)
{
	for (size_t owner_idx = 0U; owner_idx < resource->reference_count;
	     ++owner_idx) {
		if (resource->owners[owner_idx] == owner) {
			return (int)owner_idx;
		}
	}

	return -1;
}

static bool requirement_is_declared(
	const struct spaghetti_module_power_requirement *requirement)
{
	return (requirement != NULL) && requirement->declared;
}

static int validate_limits_locked(
	const struct spaghetti_power_rail_descriptor *rail,
	const struct spaghetti_module_power_requirement *requirement,
	uint32_t already_admitted_microamps,
	enum spaghetti_power_admission_state *out_state)
{
	if ((rail->assurance == SPAGHETTI_POWER_UNMANAGED) ||
	    !requirement_is_declared(requirement)) {
		*out_state = SPAGHETTI_POWER_ADMISSION_UNVERIFIED;
		return 0;
	}

	if ((rail->min_microvolts != 0U) &&
	    (requirement->max_microvolts != 0U) &&
	    (requirement->max_microvolts < rail->min_microvolts)) {
		return -ERANGE;
	}
	if ((rail->max_microvolts != 0U) &&
	    (requirement->min_microvolts != 0U) &&
	    (requirement->min_microvolts > rail->max_microvolts)) {
		return -ERANGE;
	}
	if ((rail->max_total_microamps != 0U) &&
	    (requirement->max_microamps != 0U)) {
		const uint64_t total =
			(uint64_t)already_admitted_microamps +
			(uint64_t)requirement->max_microamps;

		if (total > rail->max_total_microamps) {
			return -ENOSPC;
		}
	}

	*out_state = SPAGHETTI_POWER_ADMISSION_ENFORCED;
	return 0;
}

int spaghetti_power_init(void)
{
	int err = k_mutex_lock(&init_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (atomic_get(&is_initialized) != 0) {
		k_mutex_unlock(&init_lock);
		return -EALREADY;
	}

#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_power_rail)
	for (size_t idx = 0U; idx < ARRAY_SIZE(rail_descriptors); ++idx) {
		resources[idx].id = rail_descriptors[idx].id;
	}
#endif

	for (size_t resource_idx = 0U; resource_idx < resource_count();
	     ++resource_idx) {
		struct spaghetti_power_resource *resource = &resources[resource_idx];

		k_mutex_init(&resource->lock);
		memset(resource->owners, SPAGHETTI_POWER_OWNER_INVALID,
		       sizeof(resource->owners));
		memset(resource->owner_microamps, 0,
		       sizeof(resource->owner_microamps));
		resource->reference_count = 0U;
		resource->admitted_microamps = 0U;
		resource->last_error = 0;
		resource->state = SPAGHETTI_POWER_STOPPING;

		err = set_resource_enabled(resource->id, false);
		if (err < 0) {
			resource->state = SPAGHETTI_POWER_ERROR;
			resource->last_error = err;
			k_mutex_unlock(&init_lock);
			return err;
		}

		resource->state = SPAGHETTI_POWER_OFF;
	}

	atomic_set(&is_initialized, 1);
	k_mutex_unlock(&init_lock);
	LOG_INF("ready: resources=%u rails=%u bays=%u",
		(uint32_t)resource_count(),
		(uint32_t)spaghetti_power_rail_count(),
		(uint32_t)ARRAY_SIZE(bay_descriptors));
	return 0;
}

int spaghetti_power_acquire(spaghetti_power_resource_id_t id,
			    spaghetti_power_owner_id_t owner)
{
	struct spaghetti_power_resource *resource;
	int err;

	if (owner == SPAGHETTI_POWER_OWNER_INVALID) {
		return -EINVAL;
	}
	if (atomic_get(&is_initialized) == 0) {
		return -EACCES;
	}

	resource = find_resource(id);
	if (resource == NULL) {
		return -ENOENT;
	}

	err = k_mutex_lock(&resource->lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (find_owner(resource, owner) >= 0) {
		err = -EALREADY;
		goto unlock;
	}
	if (resource->reference_count >= ARRAY_SIZE(resource->owners)) {
		err = -ENOSPC;
		goto unlock;
	}
	if ((resource->state == SPAGHETTI_POWER_STARTING) ||
	    (resource->state == SPAGHETTI_POWER_STOPPING) ||
	    ((resource->state == SPAGHETTI_POWER_ERROR) &&
	     (resource->reference_count > 0U))) {
		err = (resource->last_error < 0) ? resource->last_error : -EBUSY;
		goto unlock;
	}

	if (resource->reference_count == 0U) {
		resource->state = SPAGHETTI_POWER_STARTING;
		err = set_resource_enabled(resource->id, true);
		if (err < 0) {
			resource->state = SPAGHETTI_POWER_ERROR;
			resource->last_error = err;
			goto unlock;
		}
		resource->state = SPAGHETTI_POWER_ON;
		resource->last_error = 0;
	}

	resource->owners[resource->reference_count] = owner;
	resource->owner_microamps[resource->reference_count] = 0U;
	++resource->reference_count;
	err = 0;

unlock:
	k_mutex_unlock(&resource->lock);
	return err;
}

int spaghetti_power_release(spaghetti_power_resource_id_t id,
			    spaghetti_power_owner_id_t owner)
{
	struct spaghetti_power_resource *resource;
	int owner_idx;
	int err;

	if (owner == SPAGHETTI_POWER_OWNER_INVALID) {
		return -EINVAL;
	}
	if (atomic_get(&is_initialized) == 0) {
		return -EACCES;
	}

	resource = find_resource(id);
	if (resource == NULL) {
		return -ENOENT;
	}

	err = k_mutex_lock(&resource->lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (resource->reference_count == 0U) {
		err = -EALREADY;
		goto unlock;
	}

	owner_idx = find_owner(resource, owner);
	if (owner_idx < 0) {
		err = -ENOENT;
		goto unlock;
	}

	if (resource->reference_count == 1U) {
		resource->state = SPAGHETTI_POWER_STOPPING;
		err = set_resource_enabled(resource->id, false);
		if (err < 0) {
			resource->state = SPAGHETTI_POWER_ERROR;
			resource->last_error = err;
			goto unlock;
		}
		resource->state = SPAGHETTI_POWER_OFF;
		resource->last_error = 0;
	}

	if (resource->admitted_microamps >=
	    resource->owner_microamps[owner_idx]) {
		resource->admitted_microamps -=
			resource->owner_microamps[owner_idx];
	} else {
		resource->admitted_microamps = 0U;
	}

	--resource->reference_count;
	resource->owners[owner_idx] =
		resource->owners[resource->reference_count];
	resource->owner_microamps[owner_idx] =
		resource->owner_microamps[resource->reference_count];
	resource->owners[resource->reference_count] =
		SPAGHETTI_POWER_OWNER_INVALID;
	resource->owner_microamps[resource->reference_count] = 0U;
	err = 0;

unlock:
	k_mutex_unlock(&resource->lock);
	return err;
}

int spaghetti_power_get_status(spaghetti_power_resource_id_t id,
			       struct spaghetti_power_status *out)
{
	struct spaghetti_power_resource *resource;
	struct spaghetti_power_status status;
	int err;

	if (out == NULL) {
		return -EINVAL;
	}
	if (atomic_get(&is_initialized) == 0) {
		return -EACCES;
	}

	resource = find_resource(id);
	if (resource == NULL) {
		return -ENOENT;
	}

	err = k_mutex_lock(&resource->lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	status.state = resource->state;
	status.reference_count = resource->reference_count;
	status.last_error = resource->last_error;
	*out = status;
	k_mutex_unlock(&resource->lock);
	return 0;
}

size_t spaghetti_power_rail_count(void)
{
#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_power_rail)
	return ARRAY_SIZE(rail_descriptors);
#elif defined(CONFIG_SPAGHETTI_POWER_FAKE_BACKEND)
	return 1U;
#else
	return 0U;
#endif
}

const struct spaghetti_power_rail_descriptor *spaghetti_power_rail_get(
	spaghetti_power_rail_id_t id)
{
	return rail_descriptor_get(id);
}

int spaghetti_power_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_power_descriptor *out)
{
	if ((out == NULL) || (bay_id == SPAGHETTI_BAY_ID_UNSPECIFIED)) {
		return -EINVAL;
	}

	for (size_t idx = 0U; idx < ARRAY_SIZE(bay_descriptors); ++idx) {
		if ((bay_descriptors[idx].flow_id == flow_id) &&
		    (bay_descriptors[idx].bay_id == bay_id)) {
			*out = bay_descriptors[idx];
			return 0;
		}
	}

	return -ENOENT;
}

int spaghetti_power_validate_binding(
	const struct spaghetti_power_binding *binding,
	const struct spaghetti_module_power_requirement *requirement,
	enum spaghetti_power_admission_state *out_state)
{
	const struct spaghetti_power_rail_descriptor *rail;
	struct spaghetti_bay_power_descriptor bay_power;
	struct spaghetti_bay_descriptor topology_bay;
	struct spaghetti_power_resource *resource;
	enum spaghetti_power_admission_state state;
	uint32_t admitted = 0U;
	int err;

	if ((binding == NULL) || (out_state == NULL) ||
	    (binding->rail_id == SPAGHETTI_POWER_RAIL_UNSPECIFIED) ||
	    (binding->bay_id == SPAGHETTI_BAY_ID_UNSPECIFIED)) {
		return -EINVAL;
	}
	if (atomic_get(&is_initialized) == 0) {
		return -EACCES;
	}

	err = spaghetti_topology_bay_get(binding->flow_id, binding->bay_id,
					 &topology_bay);
	if (err < 0) {
		return err;
	}

	err = spaghetti_power_bay_get(binding->flow_id, binding->bay_id,
				      &bay_power);
	if (err < 0) {
		return err;
	}
	if ((binding->rail_id >= 32U) ||
	    ((bay_power.available_rail_mask & BIT(binding->rail_id)) == 0U)) {
		return -ENOENT;
	}

	rail = rail_descriptor_get(binding->rail_id);
	if (rail == NULL) {
		return -ENOENT;
	}

	resource = find_resource(binding->rail_id);
	if (resource != NULL) {
		err = k_mutex_lock(&resource->lock, K_FOREVER);
		if (err < 0) {
			return err;
		}
		admitted = resource->admitted_microamps;
		k_mutex_unlock(&resource->lock);
	}

	err = validate_limits_locked(rail, requirement, admitted, &state);
	if (err < 0) {
		return err;
	}

	*out_state = state;
	return 0;
}

int spaghetti_power_attach(
	const struct spaghetti_power_binding *binding,
	spaghetti_power_owner_id_t owner,
	const struct spaghetti_module_power_requirement *requirement,
	enum spaghetti_power_admission_state *out_state)
{
	enum spaghetti_power_admission_state state;
	struct spaghetti_power_resource *resource;
	int owner_idx;
	int err;

	err = spaghetti_power_validate_binding(binding, requirement, &state);
	if (err < 0) {
		return err;
	}

	err = spaghetti_power_acquire(binding->rail_id, owner);
	if (err < 0) {
		return err;
	}

	resource = find_resource(binding->rail_id);
	if (resource == NULL) {
		(void)spaghetti_power_release(binding->rail_id, owner);
		return -ENOENT;
	}

	err = k_mutex_lock(&resource->lock, K_FOREVER);
	if (err < 0) {
		(void)spaghetti_power_release(binding->rail_id, owner);
		return err;
	}

	owner_idx = find_owner(resource, owner);
	if (owner_idx < 0) {
		k_mutex_unlock(&resource->lock);
		(void)spaghetti_power_release(binding->rail_id, owner);
		return -ENOENT;
	}

	if ((state == SPAGHETTI_POWER_ADMISSION_ENFORCED) &&
	    requirement_is_declared(requirement) &&
	    (requirement->max_microamps != 0U)) {
		resource->owner_microamps[owner_idx] = requirement->max_microamps;
		resource->admitted_microamps += requirement->max_microamps;
	}

	k_mutex_unlock(&resource->lock);

	if (out_state != NULL) {
		*out_state = state;
	}
	return 0;
}

int spaghetti_power_detach(
	const struct spaghetti_power_binding *binding,
	spaghetti_power_owner_id_t owner)
{
	if ((binding == NULL) ||
	    (binding->rail_id == SPAGHETTI_POWER_RAIL_UNSPECIFIED)) {
		return -EINVAL;
	}

	return spaghetti_power_release(binding->rail_id, owner);
}

#if defined(CONFIG_ZTEST)
void spaghetti_power_reset(void)
{
	atomic_set(&is_initialized, 0);
	memset(resources, 0, sizeof(resources));
#if DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_power_rail)
	for (size_t idx = 0U; idx < ARRAY_SIZE(rail_descriptors); ++idx) {
		resources[idx].id = rail_descriptors[idx].id;
	}
#elif defined(CONFIG_SPAGHETTI_POWER_FAKE_BACKEND)
	resources[0].id = 0U;
#endif
}
#endif
