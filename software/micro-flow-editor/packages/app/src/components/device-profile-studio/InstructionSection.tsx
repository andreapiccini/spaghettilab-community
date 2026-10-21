import type { Instruction } from "@spaghettilab/device-profile-authoring-model";
import { ChevronDown, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { defaultInstruction, OP_LABEL, STEP_CATEGORIES } from "./instruction-config.js";
import { StepRow } from "./StepRow.js";

/**
 * One of the six fixed sections `visual.md` lists (Identity probe/Init/Sample/
 * Event/Command/Safe-stop). Only three have a real backing array in
 * `DeviceProfileDraft` (Init→`initOps`, Sample→`sampleOps`, Safe-stop→
 * `safeStopOps`) — the real struct has no `event`/`command` op arrays at all
 * (`@spaghettilab/device-profile-authoring-model`'s own doc comment: "no
 * separate event/command op arrays exist, even though the task text... mentions
 * them"), and Identity probe isn't part of `DeviceProfileDraft` either. Those
 * three sections render disabled with an explicit gap note instead of a fake
 * empty list a user could add to and lose their work.
 */
export function InstructionSection({ title, steps, onChange, disabledNote, allowedOps, signalNames }: { readonly signalNames?: readonly string[]; readonly allowedOps?: readonly Instruction["op"][]; readonly title: string; readonly steps?: readonly Instruction[]; readonly onChange?: (next: readonly Instruction[]) => void; readonly disabledNote?: string }) {
  const [open, setOpen] = useState((steps?.length ?? 0) > 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<number | null>(null);
  // `overflow-hidden` is required while the height animation runs (0→auto), but
  // it also clips the "+ Aggiungi step" dropdown once open — switched to visible
  // only after the enter animation settles, matching the AnimatePresence
  // remount (this component unmounts when `open` goes false, so this always
  // starts false again on the next open).
  const [settled, setSettled] = useState(false);

  function move(from: number, to: number) {
    if (!steps || !onChange || to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  }

  return (
    <div className="rounded-slsm border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={!steps} className="flex h-10 w-full items-center gap-2 px-3 text-left hover:bg-surface-raised disabled:opacity-60">
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={motionTokens.duration.base}>
          <ChevronDown size={14} className="text-ink-faint" />
        </motion.span>
        <span className="font-body text-sm font-semibold text-ink">{title}</span>
        <span className="font-body text-xs text-ink-faint">{steps ? `${steps.length} step` : "non disponibile"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTokens.duration.base} onAnimationComplete={() => setSettled(true)} className={settled ? "overflow-visible" : "overflow-hidden"}>
            <div className="border-t border-border p-2">
              {disabledNote ? (
                <p className="p-2 font-body text-xs text-ink-faint">{disabledNote}</p>
              ) : (
                <>
                  {(steps ?? []).map((step, i) => (
                    <StepRow
                      key={i}
                      instruction={step}
                      signalNames={signalNames}
                      index={i}
                      isFirst={i === 0}
                      isLast={i === (steps?.length ?? 1) - 1}
                      startExpanded={justAdded === i}
                      onChange={(next) => {
                        const copy = [...(steps ?? [])];
                        copy[i] = next;
                        onChange?.(copy);
                      }}
                      onMoveUp={() => move(i, i - 1)}
                      onMoveDown={() => move(i, i + 1)}
                      onDelete={() => onChange?.((steps ?? []).filter((_, j) => j !== i))}
                    />
                  ))}
                  <div className="relative">
                    <button type="button" onClick={() => setMenuOpen((m) => !m)} className="flex h-9 w-full items-center gap-1.5 rounded-slsm px-2 font-body text-sm text-brand-blue hover:bg-surface-raised">
                      <Plus size={14} />
                      Aggiungi step
                    </button>
                    <AnimatePresence>
                      {menuOpen && (
                        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={motionTokens.duration.fast} className="absolute left-0 top-9 z-30 max-h-80 w-64 overflow-auto rounded-slmd border border-border bg-surface shadow-e2">
                          {STEP_CATEGORIES.filter(cat => cat.ops.some(op => !allowedOps || allowedOps.includes(op))).map((cat) => (
                            <div key={cat.label}>
                              <div className="bg-surface-sunken px-3 py-1 font-body text-xs font-semibold text-ink-faint">{cat.label}</div>
                              {cat.ops.filter(op => !allowedOps || allowedOps.includes(op)).map((op) => (
                                <button
                                  key={op}
                                  type="button"
                                  onClick={() => {
                                    const list = steps ?? [];
                                    onChange?.([...list, defaultInstruction(op)]);
                                    setJustAdded(list.length);
                                    setMenuOpen(false);
                                  }}
                                  className="block w-full px-3 py-2 text-left font-body text-sm text-ink hover:bg-surface-raised"
                                >
                                  {OP_LABEL[op]}
                                </button>
                              ))}
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
