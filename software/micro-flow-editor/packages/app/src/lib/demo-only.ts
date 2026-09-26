/**
 * Visitor-facing demo: Processing Graph only, English, no Core required.
 * Enabled by `?demo=1` and/or `VITE_DEMO_ONLY=1` at build/dev time.
 */

export const DEMO_QUERY_PARAM = "demo";
export const DEMO_ONLY_SCREEN_ID = "processing-graph";

/** Catalog ids visitors may add in demo-only. The shipped graph already has these. */
export const DEMO_PALETTE_IDS = [
  "native.schedule",
  "appblocks.digital_out_toggle",
  "appblocks.led",
  "appblocks.compare_if",
  "appblocks.relay",
  "appblocks.temperature_sensor",
] as const;

/** Blocks the visitor radial menu can insert. */
export const DEMO_ADD_BLOCK_IDS = [
  "appblocks.compare_if",
  "appblocks.relay",
  "appblocks.temperature_sensor",
] as const;

/** Seeded visitor graph — not deletable. Added IF / Relay / sensor can be removed. */
export const DEMO_SEEDED_NODE_IDS = new Set([
  "demo-schedule",
  "dp-tick-demo-schedule",
  "demo-toggle",
  "demo-led",
]);

export function isTruthyFlag(value: string | boolean | undefined | null): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function isDemoQueryEnabled(search: string | undefined | null): boolean {
  if (!search) return false;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const value = new URLSearchParams(raw).get(DEMO_QUERY_PARAM);
  return value === "1" || value === "true" || value === "yes";
}

export function demoOnlyEnvFlag(): string | undefined {
  return import.meta.env.VITE_DEMO_ONLY;
}

export function isDemoOnlyEnabled(input?: {
  readonly search?: string | null;
  readonly envFlag?: string | boolean | null;
}): boolean {
  const search = input && "search" in input ? input.search : typeof window !== "undefined" ? window.location.search : "";
  const envFlag = input && "envFlag" in input ? input.envFlag : demoOnlyEnvFlag();
  return isDemoQueryEnabled(search) || isTruthyFlag(envFlag);
}

export function isScreenAllowedInDemo(screenId: string): boolean {
  return screenId === DEMO_ONLY_SCREEN_ID;
}
