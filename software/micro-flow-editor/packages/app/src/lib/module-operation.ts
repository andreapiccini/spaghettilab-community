/** Keep UI cancellation bounded even when a transport or polling task ignores AbortSignal. */
export function abortableModuleOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Operazione interrotta", "AbortError"));
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) {
      cleanup();
      abort();
    }
  });
}

import {
  DEFAULT_PHYSICAL_SETTINGS,
  type PhysicalBackbone,
} from "@spaghettilab/protocol-sdk";
import type { BackbonePhysicalDraft } from "./backbone-physical.js";
/** Acknowledged topology is sufficient when importing a second instance with identical wiring. */
export function modulePinsAlreadyConfigured(
  actual: PhysicalBackbone | undefined,
  planned: BackbonePhysicalDraft,
): boolean {
  if (
    !actual ||
    actual.modes.length !== planned.modes.length ||
    actual.i2cSpeed !== planned.i2cSpeed ||
    actual.modes.some((mode, index) => mode !== planned.modes[index])
  )
    return false;
  if (actual.version === 1) return true;
  const desired = planned.settings ?? DEFAULT_PHYSICAL_SETTINGS;
  return (
    !!actual.settings &&
    (
      Object.keys(
        DEFAULT_PHYSICAL_SETTINGS,
      ) as (keyof typeof DEFAULT_PHYSICAL_SETTINGS)[]
    ).every((key) => actual.settings![key] === desired[key])
  );
}
