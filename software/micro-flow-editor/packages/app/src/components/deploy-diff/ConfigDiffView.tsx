import type { ConfigDiff } from "@spaghettilab/config-deployment";
import { ChevronDown, Minus, PenLine, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { changedConfigFields, formatConfigDiffValue } from "../../lib/config-diff-values.js";
import { motionTokens } from "../../lib/motion-tokens.js";

const SECTIONS: readonly { readonly key: keyof Pick<ConfigDiff, "modules" | "schedules" | "rules" | "blocks" | "edges">; readonly label: string; readonly nameOf: (item: unknown) => string }[] = [
  { key: "modules", label: "Module", nameOf: (m) => `Module #${(m as { key: number }).key}` },
  { key: "schedules", label: "Schedule", nameOf: (s) => `Schedule (source #${(s as { sourceKey: number }).sourceKey})` },
  { key: "rules", label: "Rule", nameOf: (r) => `Rule #${(r as { key: number }).key} (${(r as { typeId: string }).typeId})` },
  { key: "blocks", label: "Block", nameOf: (b) => `Block #${(b as { key: number }).key} (${(b as { typeId: string }).typeId})` },
  { key: "edges", label: "Edge", nameOf: (e) => `${(e as { sourceKey: number }).sourceKey} → ${(e as { targetKey: number }).targetKey}` },
];

/** `ux/screens/S080-deploy-diff/visual.md` § Diff semantico — accordion per tipo entità, righe Aggiunto/Rimosso/Modificato, sezioni senza modifiche non compaiono. */
export function ConfigDiffView({ diff }: { readonly diff: ConfigDiff }) {
  return (
    <div className="flex flex-col gap-2">
      {SECTIONS.map(({ key, label, nameOf }) => {
        const section = diff[key];
        const total = section.added.length + section.removed.length + section.changed.length;
        if (total === 0) return null;
        return <DiffSection key={key} label={label} added={section.added} removed={section.removed} changed={section.changed} nameOf={nameOf} />;
      })}
      {diff.policyChanged && (
        <div className="flex flex-col gap-1 rounded-slsm border-l-[3px] border-warning bg-[color-mix(in_srgb,var(--color-warning)_4%,transparent)] px-2 py-2 font-body text-sm text-ink">
          <div className="flex items-center gap-2">
            <PenLine size={14} className="shrink-0 text-warning" />
            Policy (MQTT/connettività/energy) modificata
          </div>
          <p className="pl-[22px] font-body text-xs text-ink-faint">
            Nessuna schermata gestisce ancora queste impostazioni per progetto — il confronto usa MQTT disattivato come riferimento fisso, quindi questa riga compare ogni volta che il Core ha MQTT configurato, anche senza modifiche reali nel progetto.
          </p>
        </div>
      )}
    </div>
  );
}

function DiffSection({ label, added, removed, changed, nameOf }: { readonly label: string; readonly added: readonly unknown[]; readonly removed: readonly unknown[]; readonly changed: readonly { readonly before: unknown; readonly after: unknown }[]; readonly nameOf: (item: unknown) => string }) {
  const [open, setOpen] = useState(true);
  const total = added.length + removed.length + changed.length;

  return (
    <div className="rounded-slsm border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 px-3 text-left hover:bg-surface-raised">
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={motionTokens.duration.base}>
          <ChevronDown size={14} className="text-ink-faint" />
        </motion.span>
        <span className="font-body text-sm font-semibold text-ink">
          {label} ({[added.length > 0 && `${added.length} aggiunti`, removed.length > 0 && `${removed.length} rimossi`, changed.length > 0 && `${changed.length} modificati`].filter(Boolean).join(", ")})
        </span>
        <span className="ml-auto font-body text-xs text-ink-faint">{total}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTokens.duration.base} className="overflow-hidden">
            <div className="flex flex-col gap-1 border-t border-border p-2">
              {added.map((item, i) => (
                <div key={`add-${i}`} className="flex h-11 items-center gap-2 rounded-slsm border-l-[3px] border-success bg-[color-mix(in_srgb,var(--color-success)_4%,transparent)] px-2 font-body text-sm text-ink">
                  <Plus size={14} className="text-success" />
                  {nameOf(item)}
                </div>
              ))}
              {removed.map((item, i) => (
                <div key={`rem-${i}`} className="flex h-11 items-center gap-2 rounded-slsm border-l-[3px] border-error bg-[color-mix(in_srgb,var(--color-error)_4%,transparent)] px-2 font-body text-sm text-ink-faint line-through">
                  <Minus size={14} className="shrink-0 text-error no-underline" />
                  <span className="no-underline">{nameOf(item)}</span>
                </div>
              ))}
              {changed.map((pair, i) => (
                <ChangedRow key={`chg-${i}`} before={pair.before} after={pair.after} nameOf={nameOf} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChangedRow({ before, after, nameOf }: { readonly before: unknown; readonly after: unknown; readonly nameOf: (item: unknown) => string }) {
  const [expanded, setExpanded] = useState(false);
  const beforeObj = before as Record<string, unknown>;
  const afterObj = after as Record<string, unknown>;
  const changedFields = changedConfigFields(beforeObj, afterObj);

  return (
    <div>
      <div className="flex h-11 items-center gap-2 rounded-slsm border-l-[3px] border-warning bg-[color-mix(in_srgb,var(--color-warning)_4%,transparent)] px-2 font-body text-sm text-ink">
        <PenLine size={14} className="text-warning" />
        {nameOf(after)}
        <button type="button" onClick={() => setExpanded((e) => !e)} className="ml-auto font-body text-xs font-semibold text-brand-blue">
          Vedi campi
        </button>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTokens.duration.base} className="overflow-hidden">
            <div className="ml-6 mt-1 flex flex-col gap-1 rounded-slsm bg-surface-raised p-2 font-mono text-xs">
              {changedFields.map((field) => (
                <div key={field} className="flex gap-2">
                  <span className="text-ink-faint">{field}:</span>
                  <span className="text-ink-faint line-through">{formatConfigDiffValue(beforeObj[field])}</span>
                  <span className="text-ink">→ {formatConfigDiffValue(afterObj[field])}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
