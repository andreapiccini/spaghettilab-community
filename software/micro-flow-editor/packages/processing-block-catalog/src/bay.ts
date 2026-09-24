import type { BayIoRole, ProcessingBlockFamily, ProcessingCatalogEntry } from "./types.js";

export type BaySide = "input" | "output";

export function blockFamilyOf(entry: ProcessingCatalogEntry): ProcessingBlockFamily {
  return entry.family ?? "functionality";
}

export function isBayEntry(entry: ProcessingCatalogEntry): boolean {
  return blockFamilyOf(entry) === "bay";
}

export function bayFamilyIdOf(entry: ProcessingCatalogEntry): string {
  return entry.bayFamilyId ?? entry.id;
}

/** Concrete sides shown in the palette for a bay catalog row. */
export function baySidesForEntry(entry: ProcessingCatalogEntry): readonly BaySide[] {
  if (!isBayEntry(entry)) return [];
  const role: BayIoRole = entry.bayIo ?? "output";
  switch (role) {
    case "input":
      return ["input"];
    case "output":
      return ["output"];
    case "both":
    case "either":
      return ["input", "output"];
  }
}

export function baySideLabel(side: BaySide): string {
  return side === "input" ? "ingresso" : "uscita";
}

export function bayChoiceHint(entry: ProcessingCatalogEntry): string | undefined {
  if (!isBayEntry(entry)) return undefined;
  if (entry.bayIo === "either") return "scegli ingresso o uscita";
  if (entry.bayIo === "both") return "ingresso e uscita";
  return undefined;
}
