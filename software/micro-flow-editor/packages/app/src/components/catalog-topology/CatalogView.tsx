import type { CapabilityPackIndex, CatalogIndex, ProfileIndex } from "@spaghettilab/catalog-model";
import { Binary, Box, ChevronDown, Cpu, GitBranch, IdCard, Package, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { catalogTopologyCopy } from "../../lib/catalog-topology-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { useLocale } from "../../state/locale-context.js";

type CatalogEntry = { readonly key: string; readonly primary: string; readonly secondary: string; readonly detail: readonly { readonly label: string; readonly value: string }[] };

function bytesToHexShort(bytes: Uint8Array, len = 8): string {
  return Array.from(bytes.slice(0, len))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * `ux/screens/S040-catalog-topology/visual.md` § Vista Catalogo. Categorie in ordine
 * fisso — Rule/Block/Opcode restano sempre vuote: `@spaghettilab/catalog-model`
 * normalizza solo Module Driver/Profile/Capability Pack perché il protocollo non
 * espone ancora le altre tre (S041's documented gap) — mostrate comunque, vuote e
 * dichiarate come tali, mai omesse silenziosamente dall'ordine fisso della spec.
 * Il badge compatibilità ("Compatibile"/"Deprecato"/"Incompatibile") di `visual.md`
 * non è mostrato: nessun tipo lo produce ancora (`@spaghettilab/editor-model`'s
 * compatibility engine restituisce solo un esito per coppia di handle collegati,
 * non uno stato per voce di catalogo) — gap dichiarato, non un valore inventato.
 */
export function CatalogView({ catalog, profiles, packs }: { readonly catalog: CatalogIndex; readonly profiles: ProfileIndex; readonly packs: CapabilityPackIndex | null }) {
  const { locale } = useLocale();
  const copy = catalogTopologyCopy(locale);
  const categories: { readonly key: string; readonly label: string; readonly icon: LucideIcon; readonly colorVar: string; readonly entries: readonly CatalogEntry[]; readonly emptyNote?: string }[] = [
    {
      key: "module-driver",
      label: "Module Driver",
      icon: Cpu,
      colorVar: "var(--color-info)",
      entries: catalog.moduleDrivers.map((d) => ({
        key: d.typeId,
        primary: d.typeId,
        secondary: copy.commands(d.commandCount),
        detail: [
          { label: "typeId", value: d.typeId },
          { label: "commandCount", value: String(d.commandCount) },
          { label: copy.fieldSchema, value: copy.noFieldSchema },
        ],
      })),
    },
    { key: "rule", label: "Rule", icon: GitBranch, colorVar: "var(--color-warning)", entries: [], emptyNote: copy.notExposed },
    { key: "block", label: "Block", icon: Box, colorVar: "var(--color-brand-purple-glow)", entries: [], emptyNote: copy.notExposed },
    { key: "opcode", label: "Opcode", icon: Binary, colorVar: "var(--color-ink-muted)", entries: [], emptyNote: copy.notExposed },
    {
      key: "profile",
      label: "Profile",
      icon: IdCard,
      colorVar: "var(--color-success)",
      entries: profiles.profiles.map((p) => ({
        key: `${p.profileId}@${p.version}`,
        primary: p.profileId,
        secondary: `v${p.version}`,
        detail: [
          { label: "profileId", value: p.profileId },
          { label: "version", value: String(p.version) },
          { label: "hash", value: bytesToHexShort(p.hash, 16) },
        ],
      })),
    },
    {
      key: "capability-pack",
      label: "Capability Pack",
      icon: Package,
      colorVar: "var(--color-brand-cyan-glow)",
      entries: (packs?.packs ?? []).map((p) => ({
        key: p.id,
        primary: p.id,
        secondary: `v${p.version}`,
        detail: [
          { label: "id", value: p.id },
          { label: "version", value: p.version },
          { label: "requiredHwCaps", value: String(p.requiredHwCaps) },
          { label: "moduleTypeCount", value: String(p.moduleTypeCount) },
        ],
      })),
    },
  ];

  return (
    <div className="flex flex-col gap-2 p-6">
      {categories.map(({ key, ...category }) => (
        <Category key={key} {...category} />
      ))}
    </div>
  );
}

function Category({ label, icon: Icon, colorVar, entries, emptyNote }: { readonly label: string; readonly icon: LucideIcon; readonly colorVar: string; readonly entries: readonly CatalogEntry[]; readonly emptyNote?: string }) {
  const { locale } = useLocale();
  const copy = catalogTopologyCopy(locale);
  const [open, setOpen] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  return (
    <div className="rounded-slsm border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 px-3 text-left hover:bg-surface-raised">
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={motionTokens.duration.base}>
          <ChevronDown size={14} className="text-ink-faint" />
        </motion.span>
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorVar }} />
        <span className="font-body text-sm font-semibold text-ink">{label}</span>
        <span className="font-body text-xs text-ink-faint">{entries.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTokens.duration.base} className="overflow-hidden">
            <div className="flex flex-col gap-1 border-t border-border p-2 pl-4">
              {entries.length === 0 ? (
                <p className="px-2 py-2 font-body text-xs text-ink-faint">{emptyNote ?? copy.noEntries}</p>
              ) : (
                entries.map((entry, i) => (
                  <motion.div key={entry.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * motionTokens.stagger.list }}>
                    <button type="button" onClick={() => setExpandedItem((k) => (k === entry.key ? null : entry.key))} className="flex h-11 w-full items-center gap-2 rounded-slsm px-2 text-left hover:bg-surface-raised">
                      <span className="flex h-6 w-6 items-center justify-center rounded-slsm" style={{ backgroundColor: `color-mix(in srgb, ${colorVar} 12%, transparent)` }}>
                        <Icon size={14} style={{ color: colorVar }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-body text-sm text-ink">{entry.primary}</div>
                        <div className="truncate font-mono text-xs text-ink-faint">{entry.secondary}</div>
                      </div>
                      <motion.span animate={{ rotate: expandedItem === entry.key ? 180 : 0 }} transition={motionTokens.duration.base}>
                        <ChevronDown size={14} className="text-ink-faint" />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {expandedItem === entry.key && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTokens.duration.base} className="overflow-hidden">
                          <div className="ml-8 mr-2 mb-2 flex flex-col gap-1 rounded-slsm bg-surface-raised p-3">
                            {entry.detail.map((d) => (
                              <div key={d.label} className="flex gap-2 font-body text-xs">
                                <span className="text-ink-faint">{d.label}</span>
                                <span className="font-mono text-ink">{d.value}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
