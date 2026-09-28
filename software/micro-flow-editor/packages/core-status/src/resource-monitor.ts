import type { GetCapabilitiesResponse, GetResourcesResponse, ResourcePool } from "@spaghettilab/protocol-sdk";

/** One resource pool's capacity/used/peak, kept distinct — never summed with any other pool or with flash/RAM (S093 § Verifiche). */
export type ResourcePoolView = ResourcePool;

/**
 * `allocationFailures` is a monotonic, sticky counter
 * (`firmware/backbone/subsys/resources/resources.c`'s `spaghetti_resources_note_failure`
 * only ever increments it; `spaghetti_resources_reset_high_water` explicitly
 * leaves it untouched, per `resources.h:96`'s own doc comment). It is
 * cleared only by a full reboot (`spaghetti_resources_init()`, which itself
 * refuses to run twice). So "a past allocation failure remains visible even
 * after the condition has cleared" (S093 § Verifiche) holds by construction —
 * this view exposes the raw sticky value with that behavior documented,
 * rather than trying to "clear" it client-side, which firmware has no
 * operation for either.
 */
export type ResourceMonitorView = {
  readonly featureSetHash: Uint8Array;
  readonly pools: {
    readonly modules: ResourcePoolView;
    readonly rules: ResourcePoolView;
    readonly blocks: ResourcePoolView;
    readonly profiles: ResourcePoolView;
    readonly records: ResourcePoolView;
    readonly workspace: ResourcePoolView;
  };
  readonly allocationFailures: {
    readonly count: number;
    readonly hasEverFailed: boolean;
    readonly note: string;
  };
  /**
   * `flash_slot_bytes`/`flash_image_budget_bytes`/`flash_headroom_bytes`/
   * `static_ram_budget_bytes` — real wire fields as of Firmware roadmap
   * phase 392 (`resources_ops.c`'s `execute_get_resources` now serializes
   * `struct spaghetti_resources_snapshot`'s flash/RAM fields onto keys 8-11
   * of `GET_RESOURCES`'s response map). Kept as four distinct numbers here
   * too, matching the same "never summed into one number" rule as the
   * `pools` above — flash headroom and static RAM budget answer different
   * questions and must stay legible as such.
   */
  readonly flashAndStaticRam: {
    readonly flashSlotBytes: number;
    readonly flashImageBudgetBytes: number;
    readonly flashHeadroomBytes: number;
    readonly staticRamBudgetBytes: number;
  };
  readonly configLimits: {
    readonly maxModules: number;
    readonly maxPrincipals: number;
  };
};

export function describeResourceMonitor(resources: GetResourcesResponse, capabilities: GetCapabilitiesResponse): ResourceMonitorView {
  return {
    featureSetHash: resources.featureSetHash,
    pools: {
      modules: resources.modules,
      rules: resources.rules,
      blocks: resources.blocks,
      profiles: resources.profiles,
      records: resources.records,
      workspace: resources.workspace,
    },
    allocationFailures: {
      count: resources.allocationFailures,
      hasEverFailed: resources.allocationFailures > 0,
      note: "Monotonic since boot — only a reboot clears this counter, not the condition that caused it recovering.",
    },
    flashAndStaticRam: {
      flashSlotBytes: resources.flashSlotBytes,
      flashImageBudgetBytes: resources.flashImageBudgetBytes,
      flashHeadroomBytes: resources.flashHeadroomBytes,
      staticRamBudgetBytes: resources.staticRamBudgetBytes,
    },
    configLimits: {
      maxModules: capabilities.maxModules,
      maxPrincipals: capabilities.maxPrincipals,
    },
  };
}

/**
 * True when a pool's `peak` is not the maximum a caller has ever observed —
 * i.e. the high-water mark went backwards, which should never happen since
 * firmware only raises `peak`, never lowers it except via an explicit
 * `spaghetti_resources_reset_high_water()` (a distinct operation this
 * package does not call). Exposed so a caller can assert "resource
 * high-water increases correctly" (S093 § Verifiche) across successive
 * observations.
 */
export function highWaterRegressed(previousPeak: number, currentPeak: number): boolean {
  return currentPeak < previousPeak;
}
