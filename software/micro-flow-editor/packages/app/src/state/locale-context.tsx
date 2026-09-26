import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { isDemoOnlyEnabled } from "../lib/demo-only.js";
import { localStorageAdapter } from "../lib/repository.js";
import { readLocaleFromLocalStorage, resolveLocale, saveLocale, type LocaleId } from "../lib/locale.js";

type LocaleContextValue = {
  readonly locale: LocaleId;
  setLocale(locale: LocaleId): void;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { readonly children: ReactNode }) {
  const demoOnly = isDemoOnlyEnabled();
  const [stored, setStored] = useState<LocaleId>(readLocaleFromLocalStorage);
  const locale = resolveLocale(stored, demoOnly);

  const setLocale = useCallback((next: LocaleId) => {
    if (isDemoOnlyEnabled()) return;
    setStored(next);
    void saveLocale(localStorageAdapter, next);
  }, []);

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale() called outside <LocaleProvider>");
  return ctx;
}
