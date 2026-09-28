import type { GetConnectivityStatusResponse, GetStatusResponse, ModuleStatus } from "@spaghettilab/protocol-sdk";
import { coreModeLabel, coreStateLabel, endpointKindLabel, healthStateLabel, imageStateLabel, moduleStateLabel } from "./status-labels.js";

export type ModuleStatusView = {
  readonly key: number;
  readonly id: number;
  readonly portId: number;
  readonly state: string;
  readonly endpointKind: string;
  readonly typeId: string;
};

/**
 * Whether the hardware watchdog is armed cannot be read directly — the
 * firmware computes `hardware_watchdog_armed` internally
 * (`firmware/backbone/subsys/core/health.c`) but never puts it on the
 * `GET_STATUS` wire. `HealthState.HEALTHY` documents "components timely; HW
 * watchdog armed" and `DEGRADED` "components timely, no hardware WDT"
 * (`health.h:24-29`) — this is the only wire-visible signal, and it is an
 * inference, not a direct field. `STARTING`/`STALE` don't distinguish
 * watchdog-armed either way, so they resolve to `"unknown"`.
 */
export type WatchdogInference = "armed" | "not-armed" | "unknown";

export function watchdogInferenceOf(healthState: number): WatchdogInference {
  if (healthState === 1) return "armed"; // HealthState.HEALTHY
  if (healthState === 2) return "not-armed"; // HealthState.DEGRADED
  return "unknown";
}

export type CoreStatusView = {
  readonly state: string;
  readonly mode: string;
  readonly imageState: string;
  readonly activeSlot: number;
  readonly imageConfirmed: boolean;
  readonly version: string;
  readonly portCount: number;
  /**
   * `health.last_reset_cause`, a raw `hwinfo_get_reset_cause()` bitmask
   * (Zephyr `<zephyr/drivers/hwinfo.h>`, `health.c:354`). Left undecoded on
   * purpose: this checkout vendors no Zephyr source tree, so the bit->label
   * table (RESET_PIN/RESET_WATCHDOG/RESET_BROWNOUT/...) cannot be confirmed
   * against real values here. Decoding it with a guessed table would be
   * worse than leaving the raw bitmask, which round-trips correctly
   * regardless of whether the label table is ever added.
   */
  readonly lastResetCauseRaw: number;
  readonly healthState: string;
  readonly watchdog: WatchdogInference;
  readonly modules: readonly ModuleStatusView[];
};

export function describeCoreStatus(r: GetStatusResponse): CoreStatusView {
  return {
    state: coreStateLabel(r.state),
    mode: coreModeLabel(r.mode),
    imageState: imageStateLabel(r.imageState),
    activeSlot: r.activeSlot,
    imageConfirmed: r.imageConfirmed,
    version: r.version,
    portCount: r.portCount,
    lastResetCauseRaw: r.lastResetCause,
    healthState: healthStateLabel(r.healthState),
    watchdog: watchdogInferenceOf(r.healthState),
    modules: r.modules.map(describeModuleStatus),
  };
}

export function describeModuleStatus(m: ModuleStatus): ModuleStatusView {
  return {
    key: m.key,
    id: m.id,
    portId: m.portId,
    state: moduleStateLabel(m.state),
    endpointKind: endpointKindLabel(m.endpointKind),
    typeId: m.typeId,
  };
}

/**
 * `GET_CONNECTIVITY_STATUS`'s `policy`/`activeServices`/`leasedServices` are
 * left as raw numbers, same reasoning as `lastResetCauseRaw`: no confirmed
 * bit->service-name table was found for this operation (distinct from the
 * MQTT=1/BLE=2 record-delivery consumer IDs used elsewhere) — inventing one
 * here would be a guess, not a grounded mapping.
 */
export type ConnectivityStatusView = {
  readonly policyRaw: number;
  readonly activeServicesRaw: number;
  readonly leasedServicesRaw: number;
  readonly leaseExpiresAtMs: bigint;
  readonly hasActiveLease: boolean;
  readonly lastError: bigint;
};

export function describeConnectivityStatus(r: GetConnectivityStatusResponse): ConnectivityStatusView {
  return {
    policyRaw: r.policy,
    activeServicesRaw: r.activeServices,
    leasedServicesRaw: r.leasedServices,
    leaseExpiresAtMs: r.leaseExpiresAtMs,
    hasActiveLease: r.leaseExpiresAtMs > 0n,
    lastError: r.lastError,
  };
}
