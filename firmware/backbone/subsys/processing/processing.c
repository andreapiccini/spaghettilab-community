#include <spaghetti/processing.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/block_registry.h>
#include <spaghetti/module.h>
#include <spaghetti/resources.h>

LOG_MODULE_REGISTER(spaghetti_processing, CONFIG_SPAGHETTI_PROCESSING_LOG_LEVEL);

#define SPAGHETTI_PROCESSING_STATE_ARENA_SIZE \
	(CONFIG_SPAGHETTI_MAX_PROCESSING_CONTEXTS * SPAGHETTI_BLOCK_STATE_MAX)

#define SPAGHETTI_PROCESSING_MODULE_CACHE_MAX \
	(CONFIG_SPAGHETTI_MAX_PROCESSING_EDGES)

struct spaghetti_processing_edge {
	uint8_t source_kind;
	uint32_t source_key;
	uint16_t source_port_or_field;
	uint16_t target_block_idx;
	uint16_t target_input_idx;
};

struct spaghetti_processing_block {
	uint32_t key;
	const struct spaghetti_block_driver *driver;
	struct spaghetti_property_set properties;
	void *state;
	uint16_t topo_index;
	uint16_t depth;
};

struct spaghetti_processing_plan {
	size_t block_count;
	size_t edge_count;
	struct spaghetti_processing_block blocks[CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS];
	struct spaghetti_processing_edge edges[CONFIG_SPAGHETTI_MAX_PROCESSING_EDGES];
	uint16_t topo_order[CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS];
};

struct spaghetti_module_value_cache {
	uint32_t module_key;
	uint16_t field_id;
	bool valid;
	struct spaghetti_value value;
};

struct spaghetti_block_output_slot {
	bool valid;
	struct spaghetti_value value;
};

static K_MUTEX_DEFINE(processing_lock);
static bool is_initialized;
static struct spaghetti_processing_plan live_plan;
/*
 * Scratch plan used by validate and configure. The plan is tens of KiB;
 * keep it off small thread stacks (main is 8 KiB on Core V1).
 */
static struct spaghetti_processing_plan work_plan;
static uint8_t state_arena[SPAGHETTI_PROCESSING_STATE_ARENA_SIZE]
	__aligned(8);
static size_t state_arena_used;
static uint8_t scratch_arena[SPAGHETTI_PROCESSING_STATE_ARENA_SIZE]
	__aligned(8);
static uint8_t workspace_buf[SPAGHETTI_BLOCK_WORKSPACE_MAX] __aligned(8);
static struct spaghetti_module_value_cache module_cache[SPAGHETTI_PROCESSING_MODULE_CACHE_MAX];
static size_t module_cache_count;
static struct spaghetti_processing_stats stats;

static bool type_id_is_valid(const char *type_id)
{
	if (type_id == NULL) {
		return false;
	}

	for (size_t char_idx = 0U; char_idx < SPAGHETTI_TYPE_ID_MAX; ++char_idx) {
		if (type_id[char_idx] == '\0') {
			return char_idx > 0U;
		}
	}

	return false;
}

static int find_block_index(const struct spaghetti_block_config *blocks,
			    size_t block_count, uint32_t key)
{
	for (size_t idx = 0U; idx < block_count; ++idx) {
		if (blocks[idx].key == key) {
			return (int)idx;
		}
	}

	return -ENOENT;
}

static int find_module_index(const struct spaghetti_module_config *modules,
			     size_t module_count, uint32_t key)
{
	if (modules == NULL) {
		return (key == 0U) ? -EINVAL : 0;
	}

	for (size_t idx = 0U; idx < module_count; ++idx) {
		if (modules[idx].key == key) {
			return (int)idx;
		}
	}

	return -ENOENT;
}

static int find_port_index(
	const struct spaghetti_block_port_descriptor *ports,
	size_t port_count, uint16_t port_id)
{
	for (size_t idx = 0U; idx < port_count; ++idx) {
		if (ports[idx].port_id == port_id) {
			return (int)idx;
		}
	}

	return -ENOENT;
}

static bool version_is_compatible(const struct spaghetti_block_config *block,
				  const struct spaghetti_block_driver *driver)
{
	if (block->exact_version != 0U) {
		return driver->algorithm_version == block->exact_version;
	}

	return driver->algorithm_version >= block->min_version;
}

static void deinit_plan(struct spaghetti_processing_plan *plan)
{
	for (size_t idx = 0U; idx < plan->block_count; ++idx) {
		struct spaghetti_processing_block *block = &plan->blocks[idx];

		if ((block->driver != NULL) && (block->state != NULL) &&
		    (block->driver->ops != NULL) &&
		    (block->driver->ops->deinit != NULL)) {
			block->driver->ops->deinit(block->state);
		}
	}

	memset(plan, 0, sizeof(*plan));
}

static void *arena_alloc(uint8_t *arena, size_t arena_size, size_t size,
			 size_t align, size_t *used)
{
	uintptr_t base = (uintptr_t)&arena[*used];
	uintptr_t aligned = (base + (align - 1U)) & ~(uintptr_t)(align - 1U);
	size_t offset = (size_t)(aligned - (uintptr_t)arena);

	if ((size == 0U) || (align == 0U)) {
		return NULL;
	}
	if ((offset + size) > arena_size) {
		return NULL;
	}

	*used = offset + size;
	return &arena[offset];
}

static void relocate_plan_states(struct spaghetti_processing_plan *plan,
				 const uint8_t *from_arena, uint8_t *to_arena)
{
	for (size_t idx = 0U; idx < plan->block_count; ++idx) {
		struct spaghetti_processing_block *block = &plan->blocks[idx];

		if (block->state != NULL) {
			ptrdiff_t offset =
				(const uint8_t *)block->state - from_arena;

			block->state = &to_arena[offset];
		}
	}
}

static int compile_topo(struct spaghetti_processing_plan *plan)
{
	uint16_t indegree[CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS] = { 0 };
	uint16_t queue[CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS];
	size_t queue_head = 0U;
	size_t queue_tail = 0U;
	size_t produced = 0U;

	for (size_t edge_idx = 0U; edge_idx < plan->edge_count; ++edge_idx) {
		const struct spaghetti_processing_edge *edge =
			&plan->edges[edge_idx];

		if (edge->source_kind == SPAGHETTI_EDGE_SOURCE_BLOCK) {
			++indegree[edge->target_block_idx];
		}
	}

	for (size_t idx = 0U; idx < plan->block_count; ++idx) {
		plan->blocks[idx].depth = 0U;
		if (indegree[idx] == 0U) {
			queue[queue_tail++] = (uint16_t)idx;
		}
	}

	while (queue_head < queue_tail) {
		uint16_t block_idx = queue[queue_head++];

		plan->topo_order[produced++] = block_idx;
		plan->blocks[block_idx].topo_index = (uint16_t)(produced - 1U);

		for (size_t edge_idx = 0U; edge_idx < plan->edge_count;
		     ++edge_idx) {
			const struct spaghetti_processing_edge *edge =
				&plan->edges[edge_idx];
			uint16_t target;
			uint16_t next_depth;

			if ((edge->source_kind != SPAGHETTI_EDGE_SOURCE_BLOCK) ||
			    (edge->source_key != plan->blocks[block_idx].key)) {
				continue;
			}

			target = edge->target_block_idx;
			next_depth = (uint16_t)(plan->blocks[block_idx].depth +
						1U);
			if (next_depth > plan->blocks[target].depth) {
				plan->blocks[target].depth = next_depth;
			}
			if (plan->blocks[target].depth >
			    SPAGHETTI_PROCESSING_DEPTH_MAX) {
				return -ENOSPC;
			}

			if (indegree[target] > 0U) {
				--indegree[target];
				if (indegree[target] == 0U) {
					queue[queue_tail++] = target;
				}
			}
		}
	}

	if (produced != plan->block_count) {
		return -ELOOP;
	}

	return 0;
}

static int build_plan(
	const struct spaghetti_block_config *blocks,
	size_t block_count,
	const struct spaghetti_edge_config *edges,
	size_t edge_count,
	const struct spaghetti_module_config *modules,
	size_t module_count,
	struct spaghetti_processing_plan *plan,
	uint8_t *arena,
	size_t arena_size,
	size_t *arena_used)
{
	uint32_t total_cost = 0U;
	size_t context_count = 0U;
	int err;

	memset(plan, 0, sizeof(*plan));
	*arena_used = 0U;
	memset(arena, 0, arena_size);

	if ((blocks == NULL) && (block_count != 0U)) {
		return -EINVAL;
	}
	if ((edges == NULL) && (edge_count != 0U)) {
		return -EINVAL;
	}
	if (block_count > CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS) {
		return -EMSGSIZE;
	}
	if (edge_count > CONFIG_SPAGHETTI_MAX_PROCESSING_EDGES) {
		return -EMSGSIZE;
	}

	for (size_t idx = 0U; idx < block_count; ++idx) {
		const struct spaghetti_block_config *cfg = &blocks[idx];
		const struct spaghetti_block_driver *driver;
		struct spaghetti_processing_block *slot = &plan->blocks[idx];
		void *state = NULL;

		if ((cfg->key == 0U) || !type_id_is_valid(cfg->type_id)) {
			deinit_plan(plan);
			return -EINVAL;
		}
		for (size_t previous = 0U; previous < idx; ++previous) {
			if (blocks[previous].key == cfg->key) {
				deinit_plan(plan);
				return -EEXIST;
			}
		}

		driver = spaghetti_block_registry_find(cfg->type_id);
		if (driver == NULL) {
			deinit_plan(plan);
			return -ENOTSUP;
		}
		if (!version_is_compatible(cfg, driver)) {
			deinit_plan(plan);
			return -ENOTSUP;
		}
		err = driver->ops->validate(&cfg->properties);
		if (err < 0) {
			deinit_plan(plan);
			return err;
		}

		if (driver->state_size > 0U) {
			if (context_count >=
			    CONFIG_SPAGHETTI_MAX_PROCESSING_CONTEXTS) {
				deinit_plan(plan);
				return -ENOSPC;
			}
			state = arena_alloc(arena, arena_size, driver->state_size,
					   driver->state_align, arena_used);
			if (state == NULL) {
				deinit_plan(plan);
				return -ENOMEM;
			}
			memset(state, 0, driver->state_size);
			err = driver->ops->init(&cfg->properties, state);
			if (err < 0) {
				deinit_plan(plan);
				return err;
			}
			++context_count;
		} else {
			err = driver->ops->init(&cfg->properties, NULL);
			if (err < 0) {
				deinit_plan(plan);
				return err;
			}
		}

		slot->key = cfg->key;
		slot->driver = driver;
		slot->properties = cfg->properties;
		slot->state = state;
		total_cost += driver->max_cost_per_record;
		++plan->block_count;
	}

	if ((block_count > 0U) &&
	    (total_cost > SPAGHETTI_PROCESSING_COST_BUDGET)) {
		deinit_plan(plan);
		return -ENOSPC;
	}

	for (size_t idx = 0U; idx < edge_count; ++idx) {
		const struct spaghetti_edge_config *edge = &edges[idx];
		struct spaghetti_processing_edge *slot = &plan->edges[idx];
		int target_idx;
		int port_idx;
		uint16_t fanout = 0U;

		if ((edge->source_key == 0U) || (edge->target_key == 0U) ||
		    ((edge->source_kind != SPAGHETTI_EDGE_SOURCE_MODULE) &&
		     (edge->source_kind != SPAGHETTI_EDGE_SOURCE_BLOCK))) {
			deinit_plan(plan);
			return -EINVAL;
		}

		target_idx = find_block_index(blocks, block_count,
					      edge->target_key);
		if (target_idx < 0) {
			deinit_plan(plan);
			return -ENOENT;
		}

		port_idx = find_port_index(
			plan->blocks[target_idx].driver->inputs,
			plan->blocks[target_idx].driver->input_count,
			edge->target_input);
		if (port_idx < 0) {
			deinit_plan(plan);
			return -EINVAL;
		}

		if (edge->source_kind == SPAGHETTI_EDGE_SOURCE_MODULE) {
			if (find_module_index(modules, module_count,
					      edge->source_key) < 0) {
				deinit_plan(plan);
				return -ENOENT;
			}
		} else {
			int source_idx = find_block_index(blocks, block_count,
							  edge->source_key);
			int out_idx;

			if (source_idx < 0) {
				deinit_plan(plan);
				return -ENOENT;
			}
			out_idx = find_port_index(
				plan->blocks[source_idx].driver->outputs,
				plan->blocks[source_idx].driver->output_count,
				edge->source_port_or_field);
			if (out_idx < 0) {
				deinit_plan(plan);
				return -EINVAL;
			}
		}

		for (size_t previous = 0U; previous < idx; ++previous) {
			const struct spaghetti_edge_config *other = &edges[previous];

			if ((other->source_kind == edge->source_kind) &&
			    (other->source_key == edge->source_key) &&
			    (other->source_port_or_field ==
			     edge->source_port_or_field)) {
				++fanout;
			}
			if ((other->target_key == edge->target_key) &&
			    (other->target_input == edge->target_input)) {
				deinit_plan(plan);
				return -EEXIST;
			}
		}
		if (fanout >= SPAGHETTI_PROCESSING_FANOUT_MAX) {
			deinit_plan(plan);
			return -ENOSPC;
		}

		slot->source_kind = edge->source_kind;
		slot->source_key = edge->source_key;
		slot->source_port_or_field = edge->source_port_or_field;
		slot->target_block_idx = (uint16_t)target_idx;
		slot->target_input_idx = (uint16_t)port_idx;
		++plan->edge_count;
	}

	for (size_t block_idx = 0U; block_idx < plan->block_count; ++block_idx) {
		const struct spaghetti_block_driver *driver =
			plan->blocks[block_idx].driver;

		for (size_t in_idx = 0U; in_idx < driver->input_count; ++in_idx) {
			bool connected = false;

			if (!driver->inputs[in_idx].required) {
				continue;
			}
			for (size_t edge_idx = 0U; edge_idx < plan->edge_count;
			     ++edge_idx) {
				if ((plan->edges[edge_idx].target_block_idx ==
				     block_idx) &&
				    (plan->edges[edge_idx].target_input_idx ==
				     in_idx)) {
					connected = true;
					break;
				}
			}
			if (!connected) {
				deinit_plan(plan);
				return -EINVAL;
			}
		}
	}

	err = compile_topo(plan);
	if (err < 0) {
		deinit_plan(plan);
		return err;
	}

	return 0;
}

int spaghetti_processing_validate_graph(
	const struct spaghetti_block_config *blocks,
	size_t block_count,
	const struct spaghetti_edge_config *edges,
	size_t edge_count,
	const struct spaghetti_module_config *modules,
	size_t module_count)
{
	size_t arena_used = 0U;
	int err;

	(void)k_mutex_lock(&processing_lock, K_FOREVER);
	err = build_plan(blocks, block_count, edges, edge_count, modules,
			 module_count, &work_plan, scratch_arena,
			 sizeof(scratch_arena), &arena_used);
	deinit_plan(&work_plan);
	k_mutex_unlock(&processing_lock);

	return err;
}

int spaghetti_processing_init(void)
{
	(void)k_mutex_lock(&processing_lock, K_FOREVER);
	if (is_initialized) {
		k_mutex_unlock(&processing_lock);
		return -EALREADY;
	}

	memset(&live_plan, 0, sizeof(live_plan));
	memset(state_arena, 0, sizeof(state_arena));
	memset(module_cache, 0, sizeof(module_cache));
	memset(&stats, 0, sizeof(stats));
	state_arena_used = 0U;
	module_cache_count = 0U;
	is_initialized = true;
	k_mutex_unlock(&processing_lock);
	return 0;
}

int spaghetti_processing_configure(
	const struct spaghetti_block_config *blocks,
	size_t block_count,
	const struct spaghetti_edge_config *edges,
	size_t edge_count)
{
	size_t next_arena_used = 0U;
	int err;

	(void)k_mutex_lock(&processing_lock, K_FOREVER);
	if (!is_initialized) {
		k_mutex_unlock(&processing_lock);
		return -EACCES;
	}

	err = build_plan(blocks, block_count, edges, edge_count, NULL, 0U,
			 &work_plan, scratch_arena, sizeof(scratch_arena),
			 &next_arena_used);
	if (err < 0) {
		k_mutex_unlock(&processing_lock);
		return err;
	}

	deinit_plan(&live_plan);
	memcpy(state_arena, scratch_arena, sizeof(state_arena));
	relocate_plan_states(&work_plan, scratch_arena, state_arena);
	live_plan = work_plan;
	memset(&work_plan, 0, sizeof(work_plan));
	state_arena_used = next_arena_used;
	module_cache_count = 0U;
	memset(module_cache, 0, sizeof(module_cache));
	spaghetti_resources_note_used(
		SPAGHETTI_RESOURCE_OWNER_BLOCKS,
		(uint16_t)MIN(live_plan.block_count, UINT16_MAX));
	spaghetti_resources_note_used(
		SPAGHETTI_RESOURCE_OWNER_WORKSPACE,
		(uint16_t)MIN(state_arena_used, UINT16_MAX));

	k_mutex_unlock(&processing_lock);
	return 0;
}

static void cache_module_field(uint32_t module_key, uint16_t field_id,
			       const struct spaghetti_value *value)
{
	for (size_t idx = 0U; idx < module_cache_count; ++idx) {
		if ((module_cache[idx].module_key == module_key) &&
		    (module_cache[idx].field_id == field_id)) {
			module_cache[idx].value = *value;
			module_cache[idx].valid = true;
			return;
		}
	}

	if (module_cache_count >= ARRAY_SIZE(module_cache)) {
		return;
	}

	module_cache[module_cache_count].module_key = module_key;
	module_cache[module_cache_count].field_id = field_id;
	module_cache[module_cache_count].value = *value;
	module_cache[module_cache_count].valid = true;
	++module_cache_count;
}

static bool lookup_module_field(uint32_t module_key, uint16_t field_id,
				struct spaghetti_value *out)
{
	for (size_t idx = 0U; idx < module_cache_count; ++idx) {
		if (module_cache[idx].valid &&
		    (module_cache[idx].module_key == module_key) &&
		    (module_cache[idx].field_id == field_id)) {
			*out = module_cache[idx].value;
			return true;
		}
	}

	return false;
}

static int publish_wrapper(const struct spaghetti_record *record,
			   void *user_data)
{
	spaghetti_processing_publish_cb_t publish =
		((struct {
			 spaghetti_processing_publish_cb_t cb;
			 void *user;
		 } *)user_data)
			->cb;
	void *user =
		((struct {
			 spaghetti_processing_publish_cb_t cb;
			 void *user;
		 } *)user_data)
			->user;
	int err;

	if (publish == NULL) {
		return -ENOTSUP;
	}

	err = publish(record, user);
	if (err == 0) {
		++stats.publishes;
	}

	return err;
}

int spaghetti_processing_on_record(
	const struct spaghetti_record *record,
	spaghetti_processing_publish_cb_t publish,
	void *publish_user_data)
{
	struct spaghetti_block_output_slot
		outputs[CONFIG_SPAGHETTI_MAX_PROCESSING_BLOCKS]
		       [SPAGHETTI_BLOCK_MAX_PORTS];
	struct {
		spaghetti_processing_publish_cb_t cb;
		void *user;
	} publish_ctx = {
		.cb = publish,
		.user = publish_user_data,
	};
	uint32_t spent_cost = 0U;
	bool any_source = false;

	if (record == NULL) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&processing_lock, K_FOREVER);
	if (!is_initialized) {
		k_mutex_unlock(&processing_lock);
		return -EACCES;
	}

	if (live_plan.block_count == 0U) {
		k_mutex_unlock(&processing_lock);
		return 0;
	}

	++stats.evaluations;
	memset(outputs, 0, sizeof(outputs));

	for (size_t field_idx = 0U;
	     field_idx < record->payload.values.field_count; ++field_idx) {
		cache_module_field(record->source_key,
				   record->payload.values.fields[field_idx]
					   .field_id,
				   &record->payload.values.fields[field_idx]);
	}

	for (size_t edge_idx = 0U; edge_idx < live_plan.edge_count; ++edge_idx) {
		if ((live_plan.edges[edge_idx].source_kind ==
		     SPAGHETTI_EDGE_SOURCE_MODULE) &&
		    (live_plan.edges[edge_idx].source_key ==
		     record->source_key)) {
			any_source = true;
			break;
		}
	}
	if (!any_source) {
		k_mutex_unlock(&processing_lock);
		return 0;
	}

	for (size_t order_idx = 0U; order_idx < live_plan.block_count;
	     ++order_idx) {
		uint16_t block_idx = live_plan.topo_order[order_idx];
		struct spaghetti_processing_block *block =
			&live_plan.blocks[block_idx];
		const struct spaghetti_block_driver *driver = block->driver;
		struct spaghetti_value inputs[SPAGHETTI_BLOCK_MAX_PORTS];
		bool input_valid[SPAGHETTI_BLOCK_MAX_PORTS] = { false };
		struct spaghetti_value out_values[SPAGHETTI_BLOCK_MAX_PORTS];
		bool out_valid[SPAGHETTI_BLOCK_MAX_PORTS] = { false };
		bool missing_required = false;
		int err;

		memset(inputs, 0, sizeof(inputs));
		memset(out_values, 0, sizeof(out_values));

		for (size_t edge_idx = 0U; edge_idx < live_plan.edge_count;
		     ++edge_idx) {
			const struct spaghetti_processing_edge *edge =
				&live_plan.edges[edge_idx];
			struct spaghetti_value value;
			bool have = false;

			if (edge->target_block_idx != block_idx) {
				continue;
			}

			if (edge->source_kind == SPAGHETTI_EDGE_SOURCE_MODULE) {
				have = lookup_module_field(
					edge->source_key,
					edge->source_port_or_field, &value);
			} else {
				int source_idx = -1;

				for (size_t idx = 0U; idx < live_plan.block_count;
				     ++idx) {
					if (live_plan.blocks[idx].key ==
					    edge->source_key) {
						source_idx = (int)idx;
						break;
					}
				}
				if (source_idx >= 0) {
					int out_idx = find_port_index(
						live_plan.blocks[source_idx]
							.driver->outputs,
						live_plan.blocks[source_idx]
							.driver->output_count,
						edge->source_port_or_field);

					if ((out_idx >= 0) &&
					    outputs[source_idx][out_idx].valid) {
						value = outputs[source_idx][out_idx]
								.value;
						have = true;
					}
				}
			}

			if (have) {
				const struct spaghetti_block_port_descriptor
					*port =
						&driver->inputs[edge->target_input_idx];

				if ((port->accepted_types &
				     BIT(value.type)) == 0U) {
					++stats.block_errors;
					k_mutex_unlock(&processing_lock);
					return 0;
				}
				inputs[edge->target_input_idx] = value;
				input_valid[edge->target_input_idx] = true;
			}
		}

		for (size_t in_idx = 0U; in_idx < driver->input_count; ++in_idx) {
			if (driver->inputs[in_idx].required &&
			    !input_valid[in_idx]) {
				missing_required = true;
				break;
			}
		}
		if (missing_required) {
			++stats.skipped;
			continue;
		}

		if ((spent_cost + driver->max_cost_per_record) >
		    SPAGHETTI_PROCESSING_COST_BUDGET) {
			++stats.block_errors;
			break;
		}

		err = driver->ops->process(
			block->state,
			(driver->workspace_size > 0U) ? workspace_buf : NULL,
			inputs, input_valid, driver->input_count, out_values,
			out_valid, driver->output_count, record, publish_wrapper,
			&publish_ctx);
		spent_cost += driver->max_cost_per_record;
		if (err < 0) {
			++stats.block_errors;
			LOG_WRN("block process failed: key=%u err=%d",
				block->key, err);
			break;
		}

		for (size_t out_idx = 0U; out_idx < driver->output_count;
		     ++out_idx) {
			if (out_valid[out_idx]) {
				outputs[block_idx][out_idx].valid = true;
				outputs[block_idx][out_idx].value =
					out_values[out_idx];
			}
		}
	}

	k_mutex_unlock(&processing_lock);
	return 0;
}

void spaghetti_processing_reset(void)
{
	(void)k_mutex_lock(&processing_lock, K_FOREVER);
	if (!is_initialized) {
		k_mutex_unlock(&processing_lock);
		return;
	}

	for (size_t idx = 0U; idx < live_plan.block_count; ++idx) {
		struct spaghetti_processing_block *block = &live_plan.blocks[idx];

		if ((block->driver != NULL) && (block->driver->ops != NULL) &&
		    (block->driver->ops->reset != NULL)) {
			block->driver->ops->reset(block->state);
		}
	}
	module_cache_count = 0U;
	memset(module_cache, 0, sizeof(module_cache));
	k_mutex_unlock(&processing_lock);
}

int spaghetti_processing_get_stats(struct spaghetti_processing_stats *out)
{
	if (out == NULL) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&processing_lock, K_FOREVER);
	if (!is_initialized) {
		k_mutex_unlock(&processing_lock);
		return -EACCES;
	}
	*out = stats;
	k_mutex_unlock(&processing_lock);
	return 0;
}
