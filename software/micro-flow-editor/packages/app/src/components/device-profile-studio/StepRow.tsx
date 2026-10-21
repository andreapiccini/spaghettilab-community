import type { Instruction } from "@spaghettilab/device-profile-authoring-model";
import { MAX_TEMP_SLOTS } from "@spaghettilab/device-profile-authoring-model";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { fieldsFor, OP_LABEL, type FieldSpec } from "./instruction-config.js";

/** A single field, rendered by `FieldSpec.kind` — no per-opcode bespoke form components (21 opcodes would mean 21 near-identical files); one generic renderer driven by `instruction-config.ts`'s table instead. */
function FieldInput({ spec, value, onChange, signalNames }: { readonly signalNames?: readonly string[]; readonly spec: FieldSpec; readonly value: unknown; readonly onChange: (value: unknown) => void }) {
  if (signalNames?.length && ["channel","dataChannel","powerChannel"].includes(spec.key)) return <label className="block text-sm">{spec.label}<select className="w-full rounded-lg border border-border-strong px-2 py-1.5" value={Number(value??0)} onChange={e=>onChange(Number(e.target.value))}>{signalNames.map((name,index)=><option key={index} value={index}>{name}</option>)}</select></label>;
  if (spec.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 font-body text-sm text-ink">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {spec.label}
      </label>
    );
  }
  if (spec.kind === "direction") {
    return (
      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">{spec.label}</label>
        <select value={String(value)} onChange={(e) => onChange(e.target.value)} className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none">
          <option value="left">left</option>
          <option value="right">right</option>
        </select>
      </div>
    );
  }
  if (spec.kind === "width24") {
    return (
      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">{spec.label}</label>
        <select value={String(value)} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none">
          <option value={2}>2</option>
          <option value={4}>4</option>
        </select>
      </div>
    );
  }
  if (spec.kind === "tempSlot") {
    return (
      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">{spec.label}</label>
        <select value={String(value)} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none">
          {Array.from({ length: MAX_TEMP_SLOTS }, (_, i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div>
      <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">{spec.label}</label>
      <input type="number" value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none" />
    </div>
  );
}

export function StepRow({
  instruction,
  index,
  isFirst,
  isLast,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
  startExpanded,
  signalNames,
}: {
  readonly instruction: Instruction;
  readonly index: number;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onChange: (next: Instruction) => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onDelete: () => void;
  readonly startExpanded?: boolean;
  readonly signalNames?: readonly string[];
}) {
  const [expanded, setExpanded] = useState(Boolean(startExpanded));
  const fields = fieldsFor(instruction.op);

  function patch(key: string, value: unknown) {
    onChange({ ...instruction, [key]: value } as Instruction);
  }

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={motionTokens.spring.bouncy} className="mb-1 rounded-slsm border border-border bg-surface">
      <div className="flex h-10 items-center gap-2 px-2">
        <div className="flex flex-col text-ink-faint">
          <button type="button" onClick={onMoveUp} disabled={isFirst} className="disabled:opacity-30" title="Sposta su">
            <ChevronUp size={12} />
          </button>
          <button type="button" onClick={onMoveDown} disabled={isLast} className="disabled:opacity-30" title="Sposta giù">
            <ChevronDown size={12} />
          </button>
        </div>
        <GripVertical size={14} className="cursor-grab text-ink-faint" />
        <span className="w-6 font-mono text-xs text-ink-faint">{String(index + 1).padStart(2, "0")}</span>
        <span className="min-w-0 flex-1 truncate font-body text-sm text-ink">{OP_LABEL[instruction.op]}</span>
        <button type="button" onClick={() => setExpanded((e) => !e)} className="flex h-7 w-7 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised" title="Modifica">
          <Pencil size={14} />
        </button>
        <button type="button" onClick={onDelete} className="flex h-7 w-7 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised hover:text-error" title="Elimina">
          <Trash2 size={14} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTokens.duration.base} className="overflow-hidden">
            <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
              {fields.length === 0 ? (
                <p className="col-span-2 font-body text-xs text-ink-faint">Nessun campo per questo step.</p>
              ) : (
                fields.map((spec) => <FieldInput signalNames={signalNames} key={spec.key} spec={spec} value={(instruction as unknown as Record<string, unknown>)[spec.key]} onChange={(v) => patch(spec.key, v)} />)
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
