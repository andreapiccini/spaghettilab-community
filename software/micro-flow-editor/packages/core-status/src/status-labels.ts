/**
 * Real integer -> label mappings for `GET_STATUS`'s enum-shaped fields,
 * resolved directly against firmware headers (`firmware/backbone/include/spaghetti/`)
 * for S093 — a follow-up to `protocol-sdk`'s `status.ts` comment noting these
 * fields were previously kept as raw numbers because only the enum *names*,
 * not their integer values, were known at the time.
 */

/** `spaghetti_core_state`, `core.h:19-25`. */
export enum CoreState {
  UNINITIALIZED = 0,
  INITIALIZING = 1,
  READY = 2,
  RUNNING = 3,
  FAILED = 4,
}

/** `spaghetti_core_mode`, `core.h:28-32`. */
export enum CoreMode {
  UNPROVISIONED = 0,
  NORMAL = 1,
  MAINTENANCE = 2,
}

/** `spaghetti_core_image_state`, `core.h:35-38`. */
export enum ImageState {
  CONFIRMED = 0,
  TRIAL = 1,
}

/**
 * `spaghetti_health_state`, `health.h:24-29`. `HEALTHY` vs `DEGRADED`
 * already encodes hardware-watchdog-armed vs not — there is no separate
 * watchdog field on the wire (see `watchdogInferenceOf` in `status-view.ts`).
 */
export enum HealthState {
  STARTING = 0,
  HEALTHY = 1,
  DEGRADED = 2,
  STALE = 3,
}

/** `spaghetti_module_state`, `module.h:40-44`. */
export enum ModuleState {
  UNINITIALIZED = 0,
  READY = 1,
  ERROR = 2,
}

/** `spaghetti_module_endpoint_kind`, `module.h:49-57`. */
export enum EndpointKind {
  PORT_EXCLUSIVE = 0,
  I2C_ADDRESS = 1,
  SPI_CHIP_SELECT = 2,
  UART_EXCLUSIVE = 3,
  GPIO_LINE = 4,
  ADC_CHANNEL = 5,
  W1_ROM = 6,
}

function labelOf<T extends Record<number, string>>(labels: T, value: number): string {
  return labels[value] ?? `UNKNOWN(${value})`;
}

const CORE_STATE_LABELS: Record<number, string> = { 0: "UNINITIALIZED", 1: "INITIALIZING", 2: "READY", 3: "RUNNING", 4: "FAILED" };
const CORE_MODE_LABELS: Record<number, string> = { 0: "UNPROVISIONED", 1: "NORMAL", 2: "MAINTENANCE" };
const IMAGE_STATE_LABELS: Record<number, string> = { 0: "CONFIRMED", 1: "TRIAL" };
const HEALTH_STATE_LABELS: Record<number, string> = { 0: "STARTING", 1: "HEALTHY", 2: "DEGRADED", 3: "STALE" };
const MODULE_STATE_LABELS: Record<number, string> = { 0: "UNINITIALIZED", 1: "READY", 2: "ERROR" };
const ENDPOINT_KIND_LABELS: Record<number, string> = {
  0: "PORT_EXCLUSIVE",
  1: "I2C_ADDRESS",
  2: "SPI_CHIP_SELECT",
  3: "UART_EXCLUSIVE",
  4: "GPIO_LINE",
  5: "ADC_CHANNEL",
  6: "W1_ROM",
};

export const coreStateLabel = (v: number): string => labelOf(CORE_STATE_LABELS, v);
export const coreModeLabel = (v: number): string => labelOf(CORE_MODE_LABELS, v);
export const imageStateLabel = (v: number): string => labelOf(IMAGE_STATE_LABELS, v);
export const healthStateLabel = (v: number): string => labelOf(HEALTH_STATE_LABELS, v);
export const moduleStateLabel = (v: number): string => labelOf(MODULE_STATE_LABELS, v);
export const endpointKindLabel = (v: number): string => labelOf(ENDPOINT_KIND_LABELS, v);
