import {
  encodePhysicalSettings,
  DEFAULT_PHYSICAL_SETTINGS,
} from "@spaghettilab/protocol-sdk";
import type { BackbonePhysicalDraft } from "./backbone-physical.js";
import { isRepeatableSignalBase } from "./backbone-physical.js";

/** Change one pin without removing the other signals of a partially edited bus. */
export function assignManualPin(
  modes: readonly number[],
  index: number,
  mode: number,
): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= modes.length)
    throw new Error("Pin non valido");
  const base = mode & 15;
  if (
    !Number.isInteger(mode) ||
    mode < 0 ||
    mode > 255 ||
    base > 14 ||
    mode & 0xc0 ||
    (mode & 0x30) === 0x30 ||
    (base !== 1 && mode & 0x30)
  )
    throw new Error("Segnale non valido");
  if (
    base &&
    !isRepeatableSignalBase(base) &&
    modes.some((value, i) => i !== index && (value & 15) === base)
  )
    throw new Error("Questo segnale è già assegnato a un altro pin");
  return modes.map((value, i) => (i === index ? mode : value));
}

export function manualSettingsError(draft: BackbonePhysicalDraft): string | null {
  try {
    encodePhysicalSettings(draft.settings ?? DEFAULT_PHYSICAL_SETTINGS);
    return null;
  } catch {
    return "Controlla i parametri: UART 1.200–2.000.000 baud, SPI 10.000–20.000.000 Hz, PWM 1–20.000 Hz.";
  }
}
