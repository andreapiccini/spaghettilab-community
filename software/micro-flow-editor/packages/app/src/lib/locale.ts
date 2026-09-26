import type { Storage } from "@spaghettilab/domain";

/**
 * Host chrome locale — not a `ProjectV1` field. Adding a language is appending
 * to `SUPPORTED_LOCALES` and the matching IT/EN copy dictionaries.
 */
export const LOCALE_STORAGE_KEY = "ui.locale";
export const LOCALE_LOCAL_STORAGE_KEY = `spaghettilab:${LOCALE_STORAGE_KEY}`;

export const SUPPORTED_LOCALES = [
  { id: "it", name: "Italiano", flag: "🇮🇹" },
  { id: "en", name: "English", flag: "🇬🇧" },
] as const;

export type LocaleId = (typeof SUPPORTED_LOCALES)[number]["id"];

export const DEFAULT_LOCALE: LocaleId = "it";

export function parseLocale(raw: string | null | undefined): LocaleId {
  return SUPPORTED_LOCALES.some((locale) => locale.id === raw) ? (raw as LocaleId) : DEFAULT_LOCALE;
}

/** Demo-only locks the host chrome to English; stored locale is left untouched. */
export function resolveLocale(raw: string | null | undefined, demoOnly = false): LocaleId {
  return demoOnly ? "en" : parseLocale(raw);
}

export function localeMeta(id: LocaleId): (typeof SUPPORTED_LOCALES)[number] {
  return SUPPORTED_LOCALES.find((locale) => locale.id === id) ?? SUPPORTED_LOCALES[0];
}

export async function loadLocale(storage: Storage): Promise<LocaleId> {
  return parseLocale(await storage.get(LOCALE_STORAGE_KEY));
}

export async function saveLocale(storage: Storage, locale: LocaleId): Promise<void> {
  await storage.set(LOCALE_STORAGE_KEY, locale);
}

export function readLocaleFromLocalStorage(): LocaleId {
  try {
    if (typeof window === "undefined") return DEFAULT_LOCALE;
    return parseLocale(window.localStorage.getItem(LOCALE_LOCAL_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}
