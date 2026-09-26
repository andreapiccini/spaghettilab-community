import { nodeRedResourceId, type CoreBindingId, type CoreBindingRecord } from "@spaghettilab/domain";
import { X } from "lucide-react";
import { useState } from "react";
import { automationsCopy } from "../../lib/automations-copy.js";
import { useLocale } from "../../state/locale-context.js";
import type { CrossCoreNodeData } from "./node-data.js";

type Kind = CrossCoreNodeData["kind"];

/**
 * Nessun catalogo di record field/comandi esiste da cui scegliere (stesso
 * gap già documentato per Runtime & Diagnostics' Comandi tab) — l'utente
 * dichiara manualmente identità wire + type/unit, come per `FieldRegistry`'s
 * doc comment ("always caller-supplied, never invented here").
 */
export function NodeCreateDialog({ bindings, onCreate, onClose }: { readonly bindings: readonly CoreBindingRecord[]; readonly onCreate: (data: CrossCoreNodeData) => void; readonly onClose: () => void }) {
  const { locale } = useLocale();
  const copy = automationsCopy(locale);
  const [kind, setKind] = useState<Kind>("record-field");
  const [coreBinding, setCoreBinding] = useState<CoreBindingId | "">(bindings[0]?.bindingId ?? "");
  const [label, setLabel] = useState("");
  const [sourceKey, setSourceKey] = useState(0);
  const [schemaId, setSchemaId] = useState("");
  const [schemaVersion, setSchemaVersion] = useState(1);
  const [fieldId, setFieldId] = useState(0);
  const [moduleKey, setModuleKey] = useState(0);
  const [commandId, setCommandId] = useState(0);
  const [valueType, setValueType] = useState("");
  const [unit, setUnit] = useState("");

  function handleCreate() {
    if (!label.trim()) return;
    if (kind === "record-field") {
      if (!coreBinding || !valueType.trim()) return;
      onCreate({ kind, coreBinding, sourceKey, schemaId, schemaVersion, fieldId, label, valueType, unit: unit || undefined });
    } else if (kind === "command") {
      if (!coreBinding) return;
      onCreate({ kind, coreBinding, moduleKey, commandId, label, valueType: valueType || undefined, unit: unit || undefined });
    } else {
      const id = nodeRedResourceId(crypto.randomUUID());
      if (!id.ok) return;
      onCreate({ kind, nodeRedResourceId: id.value, label });
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(20, 23, 31, 0.4)" }}>
      <div className="w-[420px] rounded-slmd bg-surface p-5 shadow-e3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-base font-semibold text-ink">{copy.newNode}</h3>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised">
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          {(["record-field", "command", "nodered"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className="flex-1 rounded-slsm px-2 py-1.5 font-body text-xs"
              style={{ border: kind === k ? "2px solid var(--color-brand-blue)" : "1px solid var(--color-border-strong)" }}
            >
              {k}
            </button>
          ))}
        </div>

        <label className="mt-3 flex flex-col gap-1">
          <span className="font-body text-xs text-ink-muted">{copy.label}</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="rounded-slsm border border-border-strong px-2 py-1.5 font-body text-sm outline-none" />
        </label>

        {kind !== "nodered" && (
          <label className="mt-2 flex flex-col gap-1">
            <span className="font-body text-xs text-ink-muted">Core</span>
            <select value={coreBinding} onChange={(e) => setCoreBinding(e.target.value as CoreBindingId)} className="rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-xs outline-none">
              {bindings.map((b) => (
                <option key={b.bindingId} value={b.bindingId}>
                  {b.expectedDeviceId}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === "record-field" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumField label="Source key" value={sourceKey} onChange={setSourceKey} />
            <NumField label="Field id" value={fieldId} onChange={setFieldId} />
            <label className="flex flex-col gap-1">
              <span className="font-body text-xs text-ink-muted">{copy.schemaId}</span>
              <input value={schemaId} onChange={(e) => setSchemaId(e.target.value)} className="rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-xs outline-none" />
            </label>
            <NumField label="Schema version" value={schemaVersion} onChange={setSchemaVersion} />
          </div>
        )}

        {kind === "command" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumField label="Module key" value={moduleKey} onChange={setModuleKey} />
            <NumField label="Command id" value={commandId} onChange={setCommandId} />
          </div>
        )}

        {kind !== "nodered" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-body text-xs text-ink-muted">{copy.valueType}{kind === "record-field" ? "" : copy.optional}</span>
              <input value={valueType} onChange={(e) => setValueType(e.target.value)} placeholder="es. float32" className="rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-xs outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-body text-xs text-ink-muted">{copy.unitOptional}</span>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="es. °C" className="rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-xs outline-none" />
            </label>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-slsm border border-border-strong px-3 py-2 font-body text-sm text-ink hover:bg-surface-raised">
            {copy.cancel}
          </button>
          <button type="button" onClick={handleCreate} className="flex-1 rounded-slsm bg-brand-blue px-3 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
            {copy.create}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { readonly label: string; readonly value: number; readonly onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-body text-xs text-ink-muted">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-xs outline-none" />
    </label>
  );
}
