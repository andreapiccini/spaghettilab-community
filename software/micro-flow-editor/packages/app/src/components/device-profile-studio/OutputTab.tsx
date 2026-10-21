import type { SampleField } from "@spaghettilab/device-profile-authoring-model";
import { Plus, Trash2 } from "lucide-react";

/** `ux/screens/S060-device-profile-studio/visual.md` § Tab Output. `SampleField.type` only supports `int64`/`uint64` today — no fixed-point/enum/bool/text schema exists on the type (documented gap), so the type selector offers only those two, honestly. */
export function OutputTab({ schemaId, onSchemaId, schemaVersion, onSchemaVersion, fields, onFields }: { readonly schemaId: string; readonly onSchemaId: (v: string) => void; readonly schemaVersion: number; readonly onSchemaVersion: (v: number) => void; readonly fields: readonly SampleField[]; readonly onFields: (v: readonly SampleField[]) => void }) {
  function update(i: number, patch: Partial<SampleField>) {
    const next = [...fields];
    next[i] = { ...next[i]!, ...patch };
    onFields(next);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="dps-schema-id">
            Sample schema ID
          </label>
          <input id="dps-schema-id" value={schemaId} onChange={(e) => onSchemaId(e.target.value)} className="w-full rounded-slsm border border-border-strong px-3 py-2 font-mono text-sm outline-none" />
        </div>
        <div className="w-32">
          <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="dps-schema-version">
            Versione
          </label>
          <input id="dps-schema-version" type="number" value={schemaVersion} onChange={(e) => onSchemaVersion(Number(e.target.value))} className="w-full rounded-slsm border border-border-strong px-3 py-2 font-mono text-sm outline-none" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {fields.map((field, i) => (
          <div key={i} className="flex items-center gap-2 rounded-slsm border border-border p-2">
            <input value={field.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="nome campo" className="flex-1 rounded-slsm border border-border-strong px-2 py-1 font-body text-sm outline-none" />
            <select value={field.type} onChange={(e) => update(i, { type: e.target.value as SampleField["type"] })} className="rounded-slsm border border-border-strong px-2 py-1 font-mono text-sm outline-none">
              <option value="int64">int64</option>
              <option value="uint64">uint64</option>
              <option value="float">Decimale</option>
              <option value="text">Testo</option>
            </select>
            <input value={field.unit ?? ""} onChange={(e) => update(i, { unit: e.target.value || undefined })} placeholder="unità" className="w-24 rounded-slsm border border-border-strong px-2 py-1 font-mono text-sm outline-none" />
            <input type="number" value={field.fieldId} onChange={(e) => update(i, { fieldId: Number(e.target.value) })} title="fieldId" className="w-16 rounded-slsm border border-border-strong px-2 py-1 font-mono text-sm outline-none" />
            <button type="button" onClick={() => onFields(fields.filter((_, j) => j !== i))} className="flex h-7 w-7 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised hover:text-error">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onFields([...fields, { fieldId: (fields.at(-1)?.fieldId ?? 0) + 1, type: "int64", name: "" }])}
          className="flex h-9 items-center gap-1.5 rounded-slsm px-2 font-body text-sm text-brand-blue hover:bg-surface-raised"
        >
          <Plus size={14} />
          Aggiungi campo
        </button>
      </div>
    </div>
  );
}
