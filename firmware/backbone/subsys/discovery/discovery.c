#include <spaghetti/discovery.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/iterable_sections.h>
#include <zephyr/sys/util.h>

LOG_MODULE_REGISTER(spaghetti_discovery, CONFIG_SPAGHETTI_DISCOVERY_LOG_LEVEL);

struct spaghetti_discovery_slot {
	bool used;
	struct spaghetti_discovery_candidate candidate;
};

struct spaghetti_discovery_scan_context {
	spaghetti_port_id_t port_id;
	spaghetti_flow_id_t flow_id;
	const struct spaghetti_discovery_provider *provider;
	int emit_error;
};

static struct spaghetti_discovery_slot
	candidates[CONFIG_SPAGHETTI_DISCOVERY_MAX_RESULTS];
static bool is_initialized;
static spaghetti_discovery_candidate_id_t next_candidate_id = 1U;
static uint32_t table_generation = 1U;
K_MUTEX_DEFINE(candidates_lock);

BUILD_ASSERT(CONFIG_SPAGHETTI_DISCOVERY_MAX_RESULTS <=
	     CONFIG_SPAGHETTI_MAX_MODULES);

static size_t bounded_strlen(const char *text, size_t max_len)
{
	const char *terminator = memchr(text, '\0', max_len);

	if (terminator == NULL) {
		return max_len;
	}

	return (size_t)(terminator - text);
}

static bool provider_id_equals(const char *stored, const char *provider_id)
{
	return strncmp(stored, provider_id, SPAGHETTI_DISCOVERY_PROVIDER_ID_SIZE) ==
	       0;
}

static bool identity_equals(const struct spaghetti_discovery_candidate *left,
			    const struct spaghetti_discovery_candidate *right)
{
	if (left->identity_size != right->identity_size) {
		return false;
	}
	if (left->identity_size == 0U) {
		return true;
	}
	return memcmp(left->identity, right->identity, left->identity_size) == 0;
}

static bool type_id_is_present(const char *type_id)
{
	const char *terminator =
		memchr(type_id, '\0', SPAGHETTI_TYPE_ID_MAX);

	return (terminator != NULL) && (terminator != type_id);
}

static bool candidate_has_complete_suggestion(
	const struct spaghetti_discovery_candidate *candidate)
{
	return type_id_is_present(candidate->suggested_type_id);
}

static struct spaghetti_discovery_slot *find_slot_by_id(
	spaghetti_discovery_candidate_id_t candidate_id)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(candidates); ++idx) {
		if (candidates[idx].used &&
		    (candidates[idx].candidate.id == candidate_id)) {
			return &candidates[idx];
		}
	}

	return NULL;
}

static struct spaghetti_discovery_slot *find_duplicate_slot(
	spaghetti_port_id_t port_id,
	const char *provider_id,
	const struct spaghetti_discovery_candidate *candidate)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(candidates); ++idx) {
		if (!candidates[idx].used) {
			continue;
		}
		if (candidates[idx].candidate.port_id != port_id) {
			continue;
		}
		if (!provider_id_equals(candidates[idx].candidate.provider_id,
					provider_id)) {
			continue;
		}
		if (identity_equals(&candidates[idx].candidate, candidate)) {
			return &candidates[idx];
		}
	}

	return NULL;
}

static struct spaghetti_discovery_slot *find_free_slot(void)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(candidates); ++idx) {
		if (!candidates[idx].used) {
			return &candidates[idx];
		}
	}

	return NULL;
}

static void clear_port_candidates(spaghetti_port_id_t port_id)
{
	for (size_t idx = 0U; idx < ARRAY_SIZE(candidates); ++idx) {
		if (candidates[idx].used &&
		    (candidates[idx].candidate.port_id == port_id)) {
			memset(&candidates[idx], 0, sizeof(candidates[idx]));
		}
	}
}

static int canonicalize_emitted_candidate(
	const struct spaghetti_discovery_provider *provider,
	spaghetti_port_id_t port_id,
	spaghetti_flow_id_t flow_id,
	const struct spaghetti_discovery_candidate *input,
	struct spaghetti_discovery_candidate *output)
{
	size_t provider_id_len;

	if ((provider == NULL) || (input == NULL) || (output == NULL) ||
	    (provider->provider_id == NULL) || (provider->ops == NULL) ||
	    (provider->ops->scan == NULL)) {
		return -EINVAL;
	}

	provider_id_len = bounded_strlen(provider->provider_id,
					 SPAGHETTI_DISCOVERY_PROVIDER_ID_SIZE);
	if ((provider_id_len == 0U) ||
	    (provider_id_len >= SPAGHETTI_DISCOVERY_PROVIDER_ID_SIZE)) {
		return -EINVAL;
	}

	if (input->identity_size > SPAGHETTI_DISCOVERY_IDENTITY_MAX) {
		return -EINVAL;
	}
	if (input->suggested_properties.field_count >
	    SPAGHETTI_PROPERTY_MAX_FIELDS) {
		return -EINVAL;
	}
	if ((input->suggested_type_id[0] != '\0') &&
	    !type_id_is_present(input->suggested_type_id)) {
		return -EINVAL;
	}

	memset(output, 0, sizeof(*output));
	output->port_id = port_id;
	output->flow_id = flow_id;
	output->bay_id = input->bay_id;
	output->power_rail_id = input->power_rail_id;
	memcpy(output->provider_id, provider->provider_id, provider_id_len);
	output->method = provider->method;
	output->confidence = provider->confidence;
	output->probe_flags = provider->probe_flags;
	output->identity_size = input->identity_size;
	if (input->identity_size > 0U) {
		memcpy(output->identity, input->identity, input->identity_size);
	}
	if (type_id_is_present(input->suggested_type_id)) {
		strncpy(output->suggested_type_id, input->suggested_type_id,
			sizeof(output->suggested_type_id) - 1U);
	}
	output->suggested_properties = input->suggested_properties;
	return 0;
}

static int emit_candidate(const struct spaghetti_discovery_candidate *candidate,
			  void *user_data)
{
	struct spaghetti_discovery_scan_context *ctx = user_data;
	struct spaghetti_discovery_candidate canonical;
	struct spaghetti_discovery_slot *slot;
	int err;

	if ((ctx == NULL) || (candidate == NULL)) {
		return -EINVAL;
	}

	err = canonicalize_emitted_candidate(ctx->provider, ctx->port_id,
					     ctx->flow_id, candidate,
					     &canonical);
	if (err < 0) {
		ctx->emit_error = err;
		return err;
	}

	err = k_mutex_lock(&candidates_lock, K_FOREVER);
	if (err < 0) {
		ctx->emit_error = err;
		return err;
	}

	slot = find_duplicate_slot(ctx->port_id, ctx->provider->provider_id,
				   &canonical);
	if (slot == NULL) {
		slot = find_free_slot();
		if (slot == NULL) {
			k_mutex_unlock(&candidates_lock);
			ctx->emit_error = -ENOSPC;
			return -ENOSPC;
		}
		slot->used = true;
		canonical.id = next_candidate_id;
		if (next_candidate_id == UINT32_MAX) {
			next_candidate_id = 1U;
		} else {
			++next_candidate_id;
		}
	} else {
		canonical.id = slot->candidate.id;
	}

	++table_generation;
	if (table_generation == 0U) {
		table_generation = 1U;
	}
	canonical.generation = table_generation;
	slot->candidate = canonical;
	k_mutex_unlock(&candidates_lock);
	return 0;
}

static bool provider_matches_policy(
	const struct spaghetti_discovery_provider *provider,
	const struct spaghetti_discovery_scan_policy *policy)
{
	bool is_state_changing =
		(provider->probe_flags &
		 SPAGHETTI_DISCOVERY_PROBE_MAY_CHANGE_STATE) != 0U;
	bool is_read_only =
		(provider->probe_flags & SPAGHETTI_DISCOVERY_PROBE_READ_ONLY) !=
		0U;

	if (is_state_changing && !policy->allow_state_changing) {
		return false;
	}
	if (is_read_only && !is_state_changing && !policy->allow_read_only) {
		return false;
	}
	if (!is_read_only && !is_state_changing) {
		/* Providers must declare at least one probe class. */
		return false;
	}

	return true;
}

static int validate_provider(const struct spaghetti_discovery_provider *provider)
{
	size_t provider_id_len;

	if ((provider == NULL) || (provider->provider_id == NULL) ||
	    (provider->ops == NULL) || (provider->ops->scan == NULL)) {
		return -EINVAL;
	}
	if (provider->api_version != SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION) {
		return -ENOTSUP;
	}

	provider_id_len = bounded_strlen(provider->provider_id,
					 SPAGHETTI_DISCOVERY_PROVIDER_ID_SIZE);
	if ((provider_id_len == 0U) ||
	    (provider_id_len >= SPAGHETTI_DISCOVERY_PROVIDER_ID_SIZE)) {
		return -EINVAL;
	}

	return 0;
}

int spaghetti_discovery_init(void)
{
	int err = k_mutex_lock(&candidates_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}

	if (is_initialized) {
		k_mutex_unlock(&candidates_lock);
		return -EALREADY;
	}

	memset(candidates, 0, sizeof(candidates));
	next_candidate_id = 1U;
	table_generation = 1U;
	is_initialized = true;
	k_mutex_unlock(&candidates_lock);

	LOG_INF("ready: capacity=%u", (uint32_t)ARRAY_SIZE(candidates));
	return 0;
}

int spaghetti_discovery_scan_port(
	spaghetti_port_id_t port_id,
	const struct spaghetti_discovery_scan_policy *policy)
{
	const struct spaghetti_port *port;
	const struct spaghetti_flow_descriptor *flow;
	int err;

	if (policy == NULL) {
		return -EINVAL;
	}
	if (!policy->allow_read_only && !policy->allow_state_changing) {
		return -EINVAL;
	}

	port = spaghetti_port_get(port_id);
	if (port == NULL) {
		return -ENOENT;
	}

	flow = spaghetti_topology_flow_for_port(port_id);

	err = k_mutex_lock(&candidates_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!is_initialized) {
		k_mutex_unlock(&candidates_lock);
		return -EACCES;
	}
	clear_port_candidates(port_id);
	k_mutex_unlock(&candidates_lock);

	STRUCT_SECTION_FOREACH(spaghetti_discovery_provider, provider) {
		struct spaghetti_discovery_scan_context ctx = {
			.port_id = port_id,
			.flow_id = (flow != NULL) ? flow->id : 0U,
			.provider = provider,
			.emit_error = 0,
		};

		err = validate_provider(provider);
		if (err < 0) {
			return err;
		}
		if (!provider_matches_policy(provider, policy)) {
			continue;
		}
		if ((provider->required_capabilities != 0U) &&
		    !spaghetti_port_has_capability(
			    port, provider->required_capabilities)) {
			continue;
		}

		err = provider->ops->scan(port, emit_candidate, &ctx,
					  policy->timeout_per_provider);
		if (err < 0) {
			return err;
		}
		if (ctx.emit_error < 0) {
			return ctx.emit_error;
		}
	}

	LOG_INF("scan complete: port=%u", (uint32_t)port_id);
	return 0;
}

int spaghetti_discovery_list(struct spaghetti_discovery_candidate *out,
			     size_t capacity, size_t *out_count)
{
	size_t count = 0U;
	int err;

	if (out_count == NULL) {
		return -EINVAL;
	}
	if ((out == NULL) && (capacity != 0U)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&candidates_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!is_initialized) {
		k_mutex_unlock(&candidates_lock);
		return -EACCES;
	}

	for (size_t idx = 0U; idx < ARRAY_SIZE(candidates); ++idx) {
		if (candidates[idx].used) {
			++count;
		}
	}

	if (out == NULL) {
		*out_count = count;
		k_mutex_unlock(&candidates_lock);
		return 0;
	}
	if (capacity < count) {
		*out_count = count;
		k_mutex_unlock(&candidates_lock);
		return -ENOSPC;
	}

	count = 0U;
	for (size_t idx = 0U; idx < ARRAY_SIZE(candidates); ++idx) {
		if (!candidates[idx].used) {
			continue;
		}
		out[count] = candidates[idx].candidate;
		++count;
	}
	*out_count = count;
	k_mutex_unlock(&candidates_lock);
	return 0;
}

int spaghetti_discovery_accept(
	spaghetti_discovery_candidate_id_t candidate_id,
	spaghetti_module_key_t key,
	uint32_t expected_generation,
	struct spaghetti_module_config *out_module)
{
	struct spaghetti_discovery_slot *slot;
	struct spaghetti_discovery_candidate candidate;
	int err;

	if ((out_module == NULL) || (key == 0U) || (expected_generation == 0U) ||
	    (candidate_id == 0U)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&candidates_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!is_initialized) {
		k_mutex_unlock(&candidates_lock);
		return -EACCES;
	}

	slot = find_slot_by_id(candidate_id);
	if (slot == NULL) {
		k_mutex_unlock(&candidates_lock);
		return -ENOENT;
	}
	if (slot->candidate.generation != expected_generation) {
		k_mutex_unlock(&candidates_lock);
		return -ESTALE;
	}

	candidate = slot->candidate;

	if (candidate.confidence == SPAGHETTI_DISCOVERY_AUTHORITATIVE) {
		if (!candidate_has_complete_suggestion(&candidate)) {
			k_mutex_unlock(&candidates_lock);
			return -EINVAL;
		}
	} else if (candidate.confidence != SPAGHETTI_DISCOVERY_HEURISTIC) {
		k_mutex_unlock(&candidates_lock);
		return -EINVAL;
	} else if (!candidate_has_complete_suggestion(&candidate)) {
		/* Heuristic accept still needs a concrete type to configure. */
		k_mutex_unlock(&candidates_lock);
		return -EINVAL;
	}

	memset(out_module, 0, sizeof(*out_module));
	out_module->key = key;
	out_module->port_id = candidate.port_id;
	out_module->bay_id = candidate.bay_id;
	out_module->power_rail_id = candidate.power_rail_id;
	strncpy(out_module->type_id, candidate.suggested_type_id,
		sizeof(out_module->type_id) - 1U);
	out_module->properties = candidate.suggested_properties;

	memset(slot, 0, sizeof(*slot));
	k_mutex_unlock(&candidates_lock);

	LOG_INF("accept: candidate=%u key=%u port=%u", candidate_id, key,
		(uint32_t)candidate.port_id);
	return 0;
}

int spaghetti_discovery_reject(spaghetti_discovery_candidate_id_t candidate_id,
			       uint32_t expected_generation)
{
	struct spaghetti_discovery_slot *slot;
	int err;

	if ((candidate_id == 0U) || (expected_generation == 0U)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&candidates_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!is_initialized) {
		k_mutex_unlock(&candidates_lock);
		return -EACCES;
	}

	slot = find_slot_by_id(candidate_id);
	if (slot == NULL) {
		k_mutex_unlock(&candidates_lock);
		return -ENOENT;
	}
	if (slot->candidate.generation != expected_generation) {
		k_mutex_unlock(&candidates_lock);
		return -ESTALE;
	}

	memset(slot, 0, sizeof(*slot));
	k_mutex_unlock(&candidates_lock);

	LOG_INF("reject: candidate=%u", candidate_id);
	return 0;
}
