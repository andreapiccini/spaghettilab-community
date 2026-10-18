import { encodeConfigCbor, type CanonicalConfig } from "@spaghettilab/config-compiler";
import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import type { GetConfigResponse } from "@spaghettilab/protocol-sdk";

/** Firmware default `CONFIG_SPAGHETTI_CONFIG_MIN_WRITE_INTERVAL_MS` is 1000. */
const CONFIG_WRITE_GAP_MS = 1100;

export type RuntimeStopClient = {
  getConfig(signal?: AbortSignal): Promise<GetConfigResponse>;
  applyConfig(
    req: { readonly expectedGeneration: number; readonly configBytes: Uint8Array },
    signal?: AbortSignal,
  ): Promise<unknown>;
};

export function configHasLiveRuntime(config: CanonicalConfig): boolean {
  return (
    config.modules.length > 0 ||
    config.schedules.some((schedule) => schedule.enabled) ||
    config.rules.length > 0
  );
}

export function configBytesHaveLiveRuntime(bytes: Uint8Array | undefined): boolean {
  if (!bytes?.length) return false;
  const decoded = decodeConfigCbor(bytes);
  return decoded.ok && configHasLiveRuntime(decoded.value);
}

export function clearedRuntimeConfig(config: CanonicalConfig): CanonicalConfig {
  return {
    ...config,
    modules: [],
    schedules: [],
    rules: [],
    blocks: [],
    edges: [],
  };
}

export function isRetryableConfigApply(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { status?: unknown; code?: unknown; message?: unknown };
  if (record.status === 5 || record.status === 8) return true;
  if (record.code === "BUSY") return true;
  return (
    typeof record.message === "string" &&
    /busy|resource_exhausted|enospc/i.test(record.message)
  );
}

export function formatApplyConfigError(error: unknown, it = true): string {
  const record =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown; message?: unknown })
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (record?.status === 8 || /RESOURCE_EXHAUSTED/i.test(message)) {
    return it
      ? "Core saturo (coda o slot pieni). Riprovo da solo; se resta così stacca e riallaccia l’USB, poi Stop."
      : "Core is full (queue or slots). Retrying; if it stays, unplug USB, then Stop.";
  }
  if (record?.status === 5 || /BUSY/i.test(message)) {
    return it
      ? "Core occupato. Riprova tra un secondo."
      : "Core is busy. Try again in a second.";
  }
  return message;
}

export async function applyStoppedRuntime(
  client: RuntimeStopClient,
  signal?: AbortSignal,
): Promise<{ readonly generation: number; readonly config: GetConfigResponse; readonly changed: boolean }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const live = await client.getConfig(signal);
    const decoded = decodeConfigCbor(live.configBytes);
    if (!decoded.ok || !configHasLiveRuntime(decoded.value)) {
      return { generation: live.generation, config: live, changed: false };
    }
    try {
      await client.applyConfig(
        {
          expectedGeneration: live.generation,
          configBytes: encodeConfigCbor(clearedRuntimeConfig(decoded.value)),
        },
        signal,
      );
      const next = await client.getConfig(signal);
      return { generation: next.generation, config: next, changed: true };
    } catch (error) {
      lastError = error;
      if (!isRetryableConfigApply(error) || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, CONFIG_WRITE_GAP_MS));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(formatApplyConfigError(lastError));
}

export async function waitConfigWriteGap(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, CONFIG_WRITE_GAP_MS));
}

export function ownedDriverProfileKey(deviceId: string): string {
  return `spaghettilab.driver-profiles:${deviceId}`;
}

export function readOwnedDriverProfiles(
  deviceId: string,
): { profileId: string; version: number }[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(ownedDriverProfileKey(deviceId)) ?? "[]",
    );
    if (!Array.isArray(saved)) return [];
    return saved.filter(
      (item): item is { profileId: string; version: number } =>
        typeof item?.profileId === "string" && Number.isInteger(item?.version),
    );
  } catch {
    return [];
  }
}

export async function forgetOwnedDriverProfiles(
  deviceId: string,
  remove: (profileId: string, version: number) => Promise<boolean>,
): Promise<void> {
  const kept: { profileId: string; version: number }[] = [];
  for (const entry of readOwnedDriverProfiles(deviceId)) {
    if (!(await remove(entry.profileId, entry.version))) kept.push(entry);
  }
  try {
    localStorage.setItem(ownedDriverProfileKey(deviceId), JSON.stringify(kept));
  } catch {
    /* Ownership tracking is optional. */
  }
}
