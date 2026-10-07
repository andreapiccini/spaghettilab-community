import type { Storage } from "@spaghettilab/domain";

/**
 * Machine/browser UI chrome mode — not a `ProjectV1` field.
 * Spec: `ux/screens/S125-simple-advanced-mode/backend-behavior.md`.
 */
export type UiMode = "base" | "advanced";

/** Logical key for `Storage` / `LocalStorageAdapter` (becomes `spaghettilab:ui.mode`). */
export const UI_MODE_STORAGE_KEY = "ui.mode";

/** Raw `localStorage` key — same namespace `LocalStorageAdapter` uses. Needed for a sync first paint. */
export const UI_MODE_LOCAL_STORAGE_KEY = `spaghettilab:${UI_MODE_STORAGE_KEY}`;

export const DEFAULT_UI_MODE: UiMode = "base";

export const ADVANCED_ONLY_SCREEN_IDS = [
  "catalog-topology",
  "device-profile-studio",
  "capability-marketplace",
  "cross-core-automation",
] as const;

/** Missing, corrupt, empty, or unknown → `base`. Only the exact string `advanced` is advanced. */
export function parseUiMode(raw: string | null | undefined): UiMode {
  return raw === "advanced" ? "advanced" : DEFAULT_UI_MODE;
}

export function isScreenVisibleInMode(screenId: string, mode: UiMode): boolean {
  if (mode === "advanced") return true;
  return !(ADVANCED_ONLY_SCREEN_IDS as readonly string[]).includes(screenId);
}

export async function loadUiMode(storage: Storage): Promise<UiMode> {
  return parseUiMode(await storage.get(UI_MODE_STORAGE_KEY));
}

export async function saveUiMode(storage: Storage, mode: UiMode): Promise<void> {
  await storage.set(UI_MODE_STORAGE_KEY, mode);
}

/**
 * Synchronous first-paint read so the rail never flashes advanced when the key
 * is missing (first launch). Private-mode / missing `window` → `base`.
 */
export function readUiModeFromLocalStorage(): UiMode {
  try {
    if (typeof window === "undefined") return DEFAULT_UI_MODE;
    return parseUiMode(window.localStorage.getItem(UI_MODE_LOCAL_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_MODE;
  }
}
