import { AnimatePresence, motion } from "motion/react";
import { Package, Search, X } from "lucide-react";
import { useState } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { blockLibraryChrome, localizedBlockPreset } from "../../lib/block-presets-copy.js";
import { physicalCompositionCopy } from "../../lib/physical-composition-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { BLOCK_PRESETS, type BlockPreset } from "./block-presets.js";

/**
 * Reference library panel — starting points for "Dispositivo esterno" nodes, not
 * something any Core ever declares (see `block-presets.ts`'s own doc comment).
 * Every entry always lands as a plain `external-device` node the user then wires
 * and refines by hand; nothing here is presented as verified against a real
 * project's topology.
 */
export function BlockLibraryPanel({ open, onPick, onClose }: { readonly open: boolean; readonly onPick: (preset: BlockPreset) => void; readonly onClose: () => void }) {
  const { locale } = useLocale();
  const copy = physicalCompositionCopy(locale);
  const chrome = blockLibraryChrome(locale);
  const [query, setQuery] = useState("");
  const localized = BLOCK_PRESETS.map((preset) => localizedBlockPreset(preset, locale));
  const filtered = localized.filter((e) => `${e.name} ${e.description} ${e.category}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ x: 360 }} animate={{ x: 0 }} exit={{ x: 360 }} transition={motionTokens.spring.smooth} className="flex h-full w-[360px] flex-col border-l border-border bg-surface shadow-e2">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <h2 className="font-heading text-sm font-semibold text-ink">{chrome.title}</h2>
            <button type="button" onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised">
              <X size={16} />
            </button>
          </div>
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
            <Search size={14} className="text-ink-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={copy.searchLibrary} className="w-full bg-transparent font-body text-sm outline-none placeholder:text-ink-faint" />
          </div>
          <p className="border-b border-border bg-surface-sunken px-3 py-2 font-body text-xs text-ink-faint">
            {chrome.hint}
          </p>
          <div className="flex-1 overflow-auto p-2">
            {filtered.length === 0 ? (
              <p className="p-4 text-center font-body text-sm text-ink-faint">{copy.noResults}</p>
            ) : (
              <div className="flex flex-col gap-1">
                {filtered.map((preset) => (
                  <button key={preset.code} type="button" onClick={() => onPick(preset)} className="flex items-start gap-2 rounded-slsm p-2 text-left hover:bg-surface-raised">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-slsm" style={{ backgroundColor: "color-mix(in srgb, var(--color-brand-blue) 12%, transparent)" }}>
                      <Package size={13} style={{ color: "var(--color-brand-blue)" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-body text-sm text-ink">{preset.name}</div>
                      <div className="truncate font-body text-xs text-ink-faint">
                        {preset.category} · {preset.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
