import type { ProjectV1 } from "@spaghettilab/domain";
import { savedDeviceDrivers } from "./device-driver-library.js";
import {
  driverRevision,
  type NfcLibrary,
  type LibraryDriver,
} from "./nfc-workspace.js";
import { compileRuntimeDriver } from "./driver-runtime-profile.js";

/** Combine reusable project drivers with NFC library drivers; unit snapshots are not new models. */
export function availableModuleDrivers(
  project: ProjectV1 | undefined,
  library: NfcLibrary,
): LibraryDriver[] {
  const candidates = new Map(library.drivers.map((driver) => [driver.id, driver]));
  for (const draft of savedDeviceDrivers(project?.authoringMetadata ?? {})) {
    if (draft.id.startsWith("nfc-")) continue;
    const previous = candidates.get(draft.id);
    if (!previous || draft.updatedAt > previous.draft.updatedAt)
      candidates.set(draft.id, driverRevision(draft));
  }
  const builtinOrder = ["uln2003-28byj48", "gpio-relay", "gpio-buzzer-active"];
  return [...candidates.values()]
    .filter((driver) => {
      if (!driver.ready || !["gpio", "i2c"].includes(driver.draft.binding.bus))
        return false;
      if (
        driver.draft.binding.bus === "gpio" &&
        driver.draft.binding.gpioSignals.length > 1 &&
        driver.id !== "uln2003-28byj48" && !driver.draft.rgbModule && !driver.draft.dht22Module
      )
        return false;
      try {
        compileRuntimeDriver(
          driver.draft,
          new Map(),
          new Map(
            driver.draft.binding.gpioSignals.map((signal, index) => [signal.id, index]),
          ),
        );
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      const rank = (id: string) =>
        builtinOrder.includes(id) ? builtinOrder.indexOf(id) : 99;
      return rank(a.id) - rank(b.id) || a.draft.name.localeCompare(b.draft.name);
    });
}
