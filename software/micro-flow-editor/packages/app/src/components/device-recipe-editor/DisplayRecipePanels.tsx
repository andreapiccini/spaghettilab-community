import { Cpu, Monitor, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  addCommand,
  describeDeviceOp,
  insertCommandStep,
  libraryOpsForDisplay,
  moveCommandStep,
  removeCommand,
  removeCommandStep,
  updateCommand,
  updateCommandStep,
  type DeviceCommandParam,
  type DeviceRecipeCommand,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
  type DisplayUpdateMode,
} from "../../lib/device-recipe-draft.js";

const inputClass =
  "w-full rounded-slsm border border-border-strong bg-surface px-1.5 py-1 font-mono text-xs outline-none focus:border-brand-blue";

type Shared = {
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (d: DeviceRecipeDraft) => void;
  readonly selectedCommandId: string | null;
  readonly onSelectCommand: (id: string | null) => void;
  readonly selectedStepId: string | null;
  readonly onSelectStep: (id: string | null) => void;
};

export function DisplayLeftSidebar(props: Shared) {
  const { draft, it, onChange, selectedCommandId, onSelectCommand } = props;
  const display = draft.display!;
  const pins = draft.binding.displayPins;
  const spi = draft.binding.spi;
  const i2c = draft.binding.i2c;

  return (
    <>
      <section className="rounded-slmd border border-border-strong p-3">
        <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          {it ? "Dispositivo" : "Device"}
        </h2>
        <div className="space-y-2 font-body text-xs">
          <Field label={it ? "Categoria" : "Category"}>
            <select value="display" disabled className={`${inputClass} opacity-80`}>
              <option value="display">Display</option>
            </select>
          </Field>
          <Field label={it ? "Collegamento" : "Link"}>
            <select
              value={draft.binding.bus}
              onChange={(e) => {
                const bus = e.target.value as "i2c" | "spi" | "gpio";
                onChange({
                  ...draft,
                  binding: {
                    ...draft.binding,
                    bus,
                    spi:
                      bus === "spi"
                        ? draft.binding.spi ?? {
                            mode: 0,
                            freqHz: 8_000_000,
                            bitOrder: "msb",
                            sckLabel: "GPIO18",
                            mosiLabel: "GPIO23",
                            misoLabel: "",
                            csLabel: "GPIO5",
                            misoRequired: false,
                          }
                        : draft.binding.spi,
                    i2c:
                      bus === "i2c"
                        ? draft.binding.i2c ?? {
                            address: "0x3C",
                            busUnit: "I2C 0",
                            sdaLabel: "GPIO21",
                            sclLabel: "GPIO22",
                          }
                        : draft.binding.i2c,
                  },
                });
              }}
              className={inputClass}
            >
              <option value="spi">SPI</option>
              <option value="i2c">I2C</option>
              <option value="gpio">{it ? "GPIO parallelo" : "Parallel GPIO"}</option>
            </select>
          </Field>
          <p className="font-body text-[10px] text-ink-faint">I2C · SPI · {it ? "GPIO parallelo" : "Parallel GPIO"}</p>

          <Field label={it ? "Profilo controller" : "Controller profile"}>
            <select
              value={display.controllerProfile}
              onChange={(e) =>
                onChange({
                  ...draft,
                  display: {
                    ...display,
                    controllerProfile: e.target.value as typeof display.controllerProfile,
                  },
                })
              }
              className={inputClass}
            >
              <option value="graphic_framebuffer">{it ? "Framebuffer grafico" : "Graphic framebuffer"}</option>
              <option value="character">{it ? "Caratteri (futuro)" : "Character (future)"}</option>
              <option value="segment">{it ? "Segmenti (futuro)" : "Segment (future)"}</option>
            </select>
          </Field>

          {draft.binding.bus === "spi" && spi ? (
            <div className="space-y-1">
              <p className="font-body text-[10px] font-semibold text-ink-muted">{it ? "Pin di collegamento" : "Link pins"}</p>
              {(
                [
                  ["SCK", spi.sckLabel, (v: string) => ({ spi: { ...spi, sckLabel: v } })],
                  ["MOSI", spi.mosiLabel, (v: string) => ({ spi: { ...spi, mosiLabel: v } })],
                  ["CS", pins?.csLabel ?? spi.csLabel, (v: string) => ({
                    spi: { ...spi, csLabel: v },
                    displayPins: { ...(pins ?? { dcLabel: "", resetLabel: "", csLabel: v }), csLabel: v },
                  })],
                  ["DC", pins?.dcLabel ?? "", (v: string) => ({
                    displayPins: { ...(pins ?? { dcLabel: v, resetLabel: "", csLabel: spi.csLabel }), dcLabel: v },
                  })],
                  ["RESET", pins?.resetLabel ?? "", (v: string) => ({
                    displayPins: { ...(pins ?? { dcLabel: "", resetLabel: v, csLabel: spi.csLabel }), resetLabel: v },
                  })],
                ] as const
              ).map(([label, value, patch]) => (
                <label key={label} className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                  <span className="w-12 shrink-0 font-semibold text-ink">{label}</span>
                  <input
                    value={value}
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        binding: { ...draft.binding, ...patch(e.target.value) },
                      })
                    }
                    className={inputClass}
                  />
                </label>
              ))}
            </div>
          ) : null}

          {draft.binding.bus === "i2c" && i2c ? (
            <div className="space-y-1">
              <Field label={it ? "Indirizzo" : "Address"}>
                <input
                  value={i2c.address}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      binding: { ...draft.binding, i2c: { ...i2c, address: e.target.value } },
                    })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="SDA">
                <input
                  value={i2c.sdaLabel}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      binding: { ...draft.binding, i2c: { ...i2c, sdaLabel: e.target.value } },
                    })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="SCL">
                <input
                  value={i2c.sclLabel}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      binding: { ...draft.binding, i2c: { ...i2c, sclLabel: e.target.value } },
                    })
                  }
                  className={inputClass}
                />
              </Field>
            </div>
          ) : null}

          <div className="flex gap-2">
            <Field label={it ? "Larghezza" : "Width"}>
              <input
                type="number"
                min={1}
                value={display.widthPx}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    display: { ...display, widthPx: Math.max(1, Number(e.target.value) || 1) },
                  })
                }
                className={inputClass}
              />
            </Field>
            <Field label={it ? "Altezza" : "Height"}>
              <input
                type="number"
                min={1}
                value={display.heightPx}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    display: { ...display, heightPx: Math.max(1, Number(e.target.value) || 1) },
                  })
                }
                className={inputClass}
              />
            </Field>
          </div>
          <p className="font-body text-[10px] text-ink-faint">
            {it ? "Dimensioni display (px)" : "Display size (px)"} · {display.pixelFormat} · font {display.fontId}
          </p>
        </div>
      </section>

      <section className="rounded-slmd border border-border-strong p-3">
        <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          {it ? "Comandi esposti" : "Exposed commands"}
        </h2>
        <ul className="flex flex-col gap-1">
          {draft.commands.map((cmd) => (
            <li key={cmd.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelectCommand(cmd.id)}
                className={`flex-1 rounded-slsm border px-2 py-1.5 text-left font-body text-xs font-semibold ${
                  selectedCommandId === cmd.id
                    ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
                    : "border-border text-ink hover:border-brand-blue/40"
                }`}
              >
                {cmd.label}
              </button>
              <button
                type="button"
                title={it ? "Rimuovi" : "Remove"}
                onClick={() => {
                  onChange(removeCommand(draft, cmd.id));
                  if (selectedCommandId === cmd.id) onSelectCommand(draft.commands.find((c) => c.id !== cmd.id)?.id ?? null);
                }}
                className="rounded-slsm p-1.5 text-ink-faint hover:bg-error/10 hover:text-error"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            const next = addCommand(draft);
            onChange(next);
            onSelectCommand(next.commands.at(-1)?.id ?? null);
          }}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-slsm border border-dashed border-border-strong px-2 py-1.5 font-body text-[11px] text-ink-muted hover:border-brand-blue hover:text-brand-blue"
        >
          <Plus size={12} />
          {it ? "Aggiungi comando" : "Add command"}
        </button>
      </section>

      <section className="rounded-slmd border border-border-strong p-3">
        <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          {it ? "Libreria di funzioni" : "Function library"}
        </h2>
        <DisplayLibrary
          it={it}
          disabled={!selectedCommandId}
          onAdd={(type) => {
            if (!selectedCommandId) return;
            onChange(insertCommandStep(draft, selectedCommandId, type));
          }}
        />
      </section>
    </>
  );
}

function DisplayLibrary({
  it,
  disabled,
  onAdd,
}: {
  it: boolean;
  disabled: boolean;
  onAdd: (type: DeviceRecipeOp["type"]) => void;
}) {
  const lib = libraryOpsForDisplay();
  const groups: { id: "bus" | "gpio" | "buffer" | "data"; label: string }[] = [
    { id: "bus", label: "Bus" },
    { id: "gpio", label: "GPIO" },
    { id: "buffer", label: "Buffer" },
    { id: "data", label: it ? "Dati" : "Data" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {groups.map((g) => (
        <div key={g.id} className="rounded-slsm border border-border p-1.5">
          <p className="mb-1 text-center font-body text-[9px] font-bold uppercase text-ink-faint">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {lib
              .filter((i) => i.group === g.id)
              .map((item) => (
                <li key={item.type}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onAdd(item.type)}
                    className="w-full rounded-sm px-1 py-0.5 text-left font-body text-[10px] text-ink hover:bg-brand-blue/10 disabled:opacity-40"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function DisplayCenter(props: Shared) {
  const { draft, it, selectedCommandId, onSelectCommand, selectedStepId, onSelectStep } = props;
  const [phase, setPhase] = useState<"init" | "command">("command");
  const cmd = draft.commands.find((c) => c.id === selectedCommandId) ?? draft.commands[0] ?? null;
  const [simText, setSimText] = useState("Ciao!");
  const [simX, setSimX] = useState(0);
  const [simY, setSimY] = useState(0);
  const [simPreview, setSimPreview] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(true);
  const display = draft.display;

  const highLevel = cmd
    ? cmd.steps.filter((s) =>
        ["validate_params", "buffer_draw_text", "buffer_clear", "display_flush", "display_power"].includes(s.type),
      )
    : [];
  const transferSteps = cmd
    ? cmd.steps.filter((s) => ["ctrl_pin", "spi_cs", "spi_transfer", "spi_transfer_buffer", "i2c_write"].includes(s.type))
    : [];

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="inline-flex w-fit rounded-slpill border border-border-strong bg-surface p-0.5">
        {(
          [
            { id: "init" as const, label: it ? "Avvio" : "Init" },
            { id: "command" as const, label: it ? "Comandi" : "Commands" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPhase(tab.id)}
            className={`rounded-slpill px-3 py-1 font-body text-xs font-semibold ${
              phase === tab.id ? "bg-brand-blue text-white" : "text-ink-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {phase === "init" ? (
        <section className="rounded-slmd border border-border-strong bg-surface p-3">
          <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
            {it ? "Sequenza di avvio" : "Init sequence"}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {draft.phases.init.map((op, i) => (
              <span key={op.id} className="rounded-slsm border border-border-strong bg-surface-sunken px-2.5 py-2 font-body text-xs">
                <span className="font-mono text-[9px] text-ink-faint">{i + 1}</span> {describeDeviceOp(op)}
              </span>
            ))}
            {draft.phases.init.length === 0 ? (
              <p className="font-body text-xs text-ink-faint">{it ? "Nessun passo di avvio." : "No init steps."}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {phase === "command" && cmd ? (
        <>
          <div>
            <h2 className="font-heading text-base font-semibold text-ink">{cmd.label}</h2>
            <p className="font-body text-[11px] text-ink-faint">{cmd.description}</p>
          </div>

          <section className="rounded-slmd border border-border-strong bg-surface p-3">
            <p className="font-mono text-sm text-ink">
              {cmd.name}({cmd.params.map((p) => p.name).join(", ")})
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cmd.params.map((p) => (
                <span key={p.id} className="rounded-slpill bg-brand-blue/10 px-2.5 py-1 font-body text-[11px] text-brand-blue">
                  {p.name} · {paramTypeLabel(p.type, it)}
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-slmd border border-border-strong bg-surface p-3">
            <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              {it ? "Implementazione del comando" : "Command implementation"}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {highLevel.map((op, index) => (
                <div key={op.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectCommand(cmd.id);
                      onSelectStep(op.id);
                    }}
                    className={`rounded-slsm border px-2.5 py-2 text-left ${
                      selectedStepId === op.id
                        ? "border-brand-blue bg-brand-blue/10"
                        : "border-border-strong bg-surface-sunken"
                    }`}
                  >
                    <span className="block font-mono text-[9px] text-ink-faint">{index + 1}</span>
                    <span className="block font-body text-xs font-semibold">{describeDeviceOp(op)}</span>
                  </button>
                  {index < highLevel.length - 1 ? <span className="text-ink-faint">→</span> : null}
                </div>
              ))}
            </div>

            {transferSteps.length > 0 ? (
              <div className="mt-3 rounded-slsm border border-border bg-surface-sunken p-2">
                <button
                  type="button"
                  onClick={() => setTransferOpen((v) => !v)}
                  className="font-body text-[11px] font-semibold text-ink-muted"
                >
                  {it ? "Trasferimento al display" : "Display transfer"} {transferOpen ? "▾" : "▸"}
                </button>
                {transferOpen ? (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {transferSteps.map((op, i) => (
                        <div key={op.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onSelectStep(op.id)}
                            className={`rounded-sm border px-2 py-1 font-mono text-[10px] ${
                              selectedStepId === op.id ? "border-brand-blue bg-brand-blue/10" : "border-border bg-surface"
                            }`}
                          >
                            {describeDeviceOp(op)}
                          </button>
                          {i < transferSteps.length - 1 ? <span className="text-ink-faint">→</span> : null}
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 font-body text-[10px] text-ink-faint">
                      {it
                        ? "Comandi controller da configurare per il display usato — non un driver completo."
                        : "Controller commands to configure for the display in use — not a full driver."}
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-1">
              {cmd.steps.map((op) => (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => onSelectStep(op.id)}
                  className={`rounded-slpill px-2 py-0.5 font-mono text-[10px] ${
                    selectedStepId === op.id ? "bg-brand-blue text-white" : "bg-surface-sunken text-ink-muted"
                  }`}
                >
                  {op.type}
                </button>
              ))}
            </div>
          </section>

          {display?.controllerProfile === "graphic_framebuffer" ? (
            <section className="rounded-slmd border border-border-strong bg-surface p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                  {it ? "Anteprima display" : "Display preview"}
                </h2>
                <span className="rounded-slpill bg-warning/20 px-2 py-0.5 font-body text-[10px] font-semibold text-ink">
                  {it ? "Simulazione" : "Simulation"}
                </span>
              </div>
              <div
                className="mx-auto flex items-center justify-center rounded-sm border border-ink bg-ink font-mono text-sm text-white"
                style={{
                  width: Math.min(320, display.widthPx * 2),
                  height: Math.min(160, display.heightPx * 2),
                }}
              >
                {simPreview ?? (cmd.name === "scrivi_testo" ? simText : "·")}
              </div>
              {cmd.name === "scrivi_testo" ? (
                <div className="mt-3 grid grid-cols-[1fr_4rem_4rem_auto] items-end gap-2">
                  <Field label="testo">
                    <input value={simText} onChange={(e) => setSimText(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="x">
                    <input
                      type="number"
                      value={simX}
                      onChange={(e) => setSimX(Number(e.target.value) || 0)}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="y">
                    <input
                      type="number"
                      value={simY}
                      onChange={(e) => setSimY(Number(e.target.value) || 0)}
                      className={inputClass}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => {
                      const w = display.widthPx;
                      const h = display.heightPx;
                      if (simX < 0 || simY < 0 || simX >= w || simY >= h) {
                        if (display.clipPolicy === "reject") {
                          setSimPreview(it ? "(fuori area)" : "(out of bounds)");
                          return;
                        }
                      }
                      setSimPreview(simText);
                    }}
                    className="rounded-slpill bg-brand-blue px-3 py-1.5 font-body text-xs font-semibold text-white"
                  >
                    {it ? "Simula" : "Simulate"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSimPreview(cmd.name === "pulisci" ? "" : cmd.label)}
                  className="mt-3 rounded-slpill bg-brand-blue px-3 py-1.5 font-body text-xs font-semibold text-white"
                >
                  {it ? "Simula" : "Simulate"}
                </button>
              )}
              <p className="mt-2 font-body text-[10px] text-ink-faint">
                {it
                  ? "Il comando modifica il display; non emette una misura. La simulazione non esegue hardware."
                  : "The command changes the display; it does not emit a measurement. Simulation does not run hardware."}
              </p>
            </section>
          ) : (
            <p className="rounded-slmd border border-border-strong bg-surface p-3 font-body text-xs text-ink-muted">
              {it
                ? "Anteprima grafica disponibile solo per profilo framebuffer. Caratteri/segmenti: primitive future."
                : "Graphic preview only for framebuffer profile. Character/segment: future primitives."}
            </p>
          )}
        </>
      ) : null}

      {phase === "command" && !cmd ? (
        <p className="font-body text-xs text-ink-faint">{it ? "Aggiungi un comando dalla sidebar." : "Add a command from the sidebar."}</p>
      ) : null}

      {phase === "command" && draft.commands.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {draft.commands.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectCommand(c.id)}
              className={`rounded-slpill px-2.5 py-1 font-body text-[11px] ${
                c.id === cmd?.id ? "bg-brand-blue text-white" : "bg-surface-sunken text-ink-muted"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DisplayInspector(props: Shared & { readonly createBlocked: boolean }) {
  const { draft, it, onChange, selectedCommandId, selectedStepId, onSelectStep } = props;
  const cmd = draft.commands.find((c) => c.id === selectedCommandId) ?? null;
  const step = cmd?.steps.find((s) => s.id === selectedStepId) ?? null;
  const display = draft.display;

  if (!cmd) {
    return <p className="font-body text-xs text-ink-faint">{it ? "Seleziona un comando." : "Select a command."}</p>;
  }

  return (
    <div className="space-y-3">
      <section className="rounded-slmd border border-border-strong p-3">
        <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          {it ? "Interfaccia del comando" : "Command interface"}
        </h2>
        <Field label={it ? "Nome" : "Name"}>
          <input
            value={cmd.name}
            onChange={(e) => onChange(updateCommand(draft, cmd.id, { ...cmd, name: e.target.value.replace(/\s+/g, "_") }))}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Etichetta" : "Label"}>
          <input
            value={cmd.label}
            onChange={(e) => onChange(updateCommand(draft, cmd.id, { ...cmd, label: e.target.value }))}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Descrizione" : "Description"}>
          <input
            value={cmd.description}
            onChange={(e) => onChange(updateCommand(draft, cmd.id, { ...cmd, description: e.target.value }))}
            className={inputClass}
          />
        </Field>

        <p className="mt-2 font-body text-[10px] font-semibold uppercase text-ink-faint">{it ? "Parametri" : "Parameters"}</p>
        <ul className="mt-1 space-y-2">
          {cmd.params.map((p, idx) => (
            <li key={p.id} className="rounded-slsm border border-border p-2">
              <div className="grid grid-cols-2 gap-1">
                <Field label={it ? "Nome" : "Name"}>
                  <input
                    value={p.name}
                    onChange={(e) => {
                      const params = cmd.params.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x));
                      onChange(updateCommand(draft, cmd.id, { ...cmd, params }));
                    }}
                    className={inputClass}
                  />
                </Field>
                <Field label={it ? "Tipo" : "Type"}>
                  <select
                    value={p.type}
                    onChange={(e) => {
                      const params = cmd.params.map((x, i) =>
                        i === idx ? { ...x, type: e.target.value as DeviceCommandParam["type"] } : x,
                      );
                      onChange(updateCommand(draft, cmd.id, { ...cmd, params }));
                    }}
                    className={inputClass}
                  >
                    <option value="string">{it ? "stringa" : "string"}</option>
                    <option value="int">{it ? "intero" : "int"}</option>
                    <option value="float">float</option>
                    <option value="bool">bool</option>
                  </select>
                </Field>
                <Field label="Default">
                  <input
                    value={String(p.defaultValue)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const defaultValue =
                        p.type === "int" || p.type === "float" ? Number(raw) || 0 : p.type === "bool" ? raw === "true" : raw;
                      const params = cmd.params.map((x, i) => (i === idx ? { ...x, defaultValue } : x));
                      onChange(updateCommand(draft, cmd.id, { ...cmd, params }));
                    }}
                    className={inputClass}
                  />
                </Field>
                {p.type === "int" || p.type === "float" ? (
                  <Field label="min–max">
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={p.min ?? ""}
                        placeholder="min"
                        onChange={(e) => {
                          const min = e.target.value === "" ? undefined : Number(e.target.value);
                          const params = cmd.params.map((x, i) => (i === idx ? { ...x, min } : x));
                          onChange(updateCommand(draft, cmd.id, { ...cmd, params }));
                        }}
                        className={inputClass}
                      />
                      <input
                        type="number"
                        value={p.max ?? ""}
                        placeholder="max"
                        onChange={(e) => {
                          const max = e.target.value === "" ? undefined : Number(e.target.value);
                          const params = cmd.params.map((x, i) => (i === idx ? { ...x, max } : x));
                          onChange(updateCommand(draft, cmd.id, { ...cmd, params }));
                        }}
                        className={inputClass}
                      />
                    </div>
                  </Field>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            const p: DeviceCommandParam = {
              id: `p_${Date.now().toString(36)}`,
              name: `param_${cmd.params.length + 1}`,
              type: "int",
              defaultValue: 0,
            };
            onChange(updateCommand(draft, cmd.id, { ...cmd, params: [...cmd.params, p] }));
          }}
          className="mt-2 font-body text-[11px] text-brand-blue hover:underline"
        >
          + {it ? "Parametro" : "Parameter"}
        </button>

        <Field label={it ? "Aggiornamento" : "Update"}>
          <select
            value={cmd.updateMode ?? display?.updateModeDefault ?? "auto"}
            onChange={(e) =>
              onChange(
                updateCommand(draft, cmd.id, { ...cmd, updateMode: e.target.value as DisplayUpdateMode }),
              )
            }
            className={inputClass}
          >
            <option value="auto">{it ? "Automatico" : "Automatic"}</option>
            <option value="explicit">{it ? "Esplicito (solo Aggiorna)" : "Explicit (Update only)"}</option>
          </select>
        </Field>
        <p className="font-body text-[10px] text-ink-faint">
          {(cmd.updateMode ?? "auto") === "auto"
            ? it
              ? "Invia il buffer dopo il disegno (evita invii doppi con flush esplicito)."
              : "Flush buffer after draw (avoid double send with explicit Update)."
            : it
              ? "Modifica solo il buffer; invio con comando Aggiorna."
              : "Buffer only; send with Update command."}
        </p>

        <Field label={it ? "Politica errori" : "Error policy"}>
          <select
            value={cmd.errorPolicy ?? "abort"}
            onChange={(e) =>
              onChange(
                updateCommand(draft, cmd.id, {
                  ...cmd,
                  errorPolicy: e.target.value as DeviceRecipeCommand["errorPolicy"],
                }),
              )
            }
            className={inputClass}
          >
            <option value="abort">{it ? "Interrompi" : "Abort"}</option>
            <option value="clamp">{it ? "Satura / clip" : "Clamp / clip"}</option>
            <option value="ignore">{it ? "Ignora" : "Ignore"}</option>
          </select>
        </Field>
      </section>

      {step ? (
        <section className="rounded-slmd border border-border-strong p-3">
          <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
            {it ? "Passo selezionato" : "Selected step"}
          </h2>
          <p className="mb-2 font-mono text-[11px] text-ink">{step.type}</p>
          <DisplayStepFields
            op={step}
            it={it}
            onChange={(next) => onChange(updateCommandStep(draft, cmd.id, step.id, next))}
          />
          <div className="mt-2 flex gap-1">
            <button
              type="button"
              onClick={() => onChange(moveCommandStep(draft, cmd.id, step.id, -1))}
              className="rounded-slsm border border-border px-2 py-1 font-body text-[10px]"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onChange(moveCommandStep(draft, cmd.id, step.id, 1))}
              className="rounded-slsm border border-border px-2 py-1 font-body text-[10px]"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(removeCommandStep(draft, cmd.id, step.id));
                onSelectStep(null);
              }}
              className="rounded-slsm border border-error/40 px-2 py-1 font-body text-[10px] text-error"
            >
              {it ? "Elimina" : "Delete"}
            </button>
          </div>
        </section>
      ) : null}

      {display ? (
        <section className="rounded-slmd border border-border-strong p-3">
          <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
            {it ? "Limiti display" : "Display limits"}
          </h2>
          <Field label={it ? "Testo fuori area" : "Out-of-bounds text"}>
            <select
              value={display.clipPolicy}
              onChange={(e) =>
                onChange({
                  ...draft,
                  display: { ...display, clipPolicy: e.target.value as typeof display.clipPolicy },
                })
              }
              className={inputClass}
            >
              <option value="clip">clip</option>
              <option value="reject">{it ? "rifiuta" : "reject"}</option>
              <option value="wrap">wrap</option>
            </select>
          </Field>
          <Field label={it ? "Codifica" : "Encoding"}>
            <select
              value={display.encoding}
              onChange={(e) =>
                onChange({
                  ...draft,
                  display: { ...display, encoding: e.target.value as typeof display.encoding },
                })
              }
              className={inputClass}
            >
              <option value="utf8">utf8</option>
              <option value="ascii">ascii</option>
            </select>
          </Field>
        </section>
      ) : null}

      <section className="rounded-slmd border border-border-strong p-3">
        <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          {it ? "Anteprima nel Flow" : "Flow preview"}
        </h2>
        <div className="relative rounded-slmd border border-border-strong bg-surface-sunken p-3">
          {/* execution trigger (left) — omitted in some renders; required by spec */}
          <div className="absolute left-0 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-brand-blue bg-surface" title={it ? "Esegui" : "Run"} />
            <span className="font-body text-[8px] text-ink-faint">{it ? "esegui" : "run"}</span>
          </div>
          <div className="ml-3">
            <div className="flex items-center gap-2">
              <Monitor size={14} className="text-brand-blue" />
              <span className="font-body text-sm font-semibold text-ink">{it ? "Display" : "Display"}</span>
            </div>
            <p className="mt-1 font-body text-xs text-ink-muted">{cmd.label}</p>
            <ul className="mt-2 space-y-1">
              {cmd.params.map((p) => (
                <li key={p.id} className="flex items-center gap-2 font-body text-xs text-ink">
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-brand-blue bg-surface" />
                  {p.name}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 rounded-slsm bg-warning/15 px-2 py-1.5 font-body text-[11px] text-ink-muted">
            {draft.verification.note}
          </p>
          <p className="mt-1 font-body text-[10px] text-ink-faint">
            {it
              ? "Ingresso esecuzione distinto dai dati. Cambiare un parametro non esegue il comando."
              : "Execution input separate from data. Changing a parameter does not run the command."}
          </p>
        </div>
        {draft.runtimeUnavailable.length > 0 ? (
          <p className="mt-2 font-body text-[10px] text-ink-faint">
            {it ? "Runtime non disponibile:" : "Runtime unavailable:"} {draft.runtimeUnavailable.join(", ")}
          </p>
        ) : null}
        <p className="mt-1 flex items-center gap-1 font-body text-[10px] text-ink-faint">
          <Cpu size={10} />
          {it ? "Nessun canale misura / Emetti fittizio." : "No fake measure channels / Emit."}
        </p>
      </section>
    </div>
  );
}

function DisplayStepFields({
  op,
  it,
  onChange,
}: {
  op: DeviceRecipeOp;
  it: boolean;
  onChange: (op: DeviceRecipeOp) => void;
}) {
  if (op.type === "validate_params") {
    return (
      <Field label={it ? "Parametri" : "Params"}>
        <input
          value={op.paramNames.join(", ")}
          onChange={(e) =>
            onChange({
              ...op,
              paramNames: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          className={inputClass}
        />
      </Field>
    );
  }
  if (op.type === "buffer_draw_text") {
    return (
      <div className="space-y-1">
        <Field label="textParam">
          <input value={op.textParam} onChange={(e) => onChange({ ...op, textParam: e.target.value })} className={inputClass} />
        </Field>
        <Field label="xParam">
          <input value={op.xParam} onChange={(e) => onChange({ ...op, xParam: e.target.value })} className={inputClass} />
        </Field>
        <Field label="yParam">
          <input value={op.yParam} onChange={(e) => onChange({ ...op, yParam: e.target.value })} className={inputClass} />
        </Field>
      </div>
    );
  }
  if (op.type === "ctrl_pin") {
    return (
      <div className="flex gap-2">
        <Field label="Pin">
          <select
            value={op.pin}
            onChange={(e) => onChange({ ...op, pin: e.target.value as "DC" | "CS" | "RESET" })}
            className={inputClass}
          >
            <option value="DC">DC</option>
            <option value="CS">CS</option>
            <option value="RESET">RESET</option>
          </select>
        </Field>
        <Field label={it ? "Livello" : "Level"}>
          <select
            value={op.level}
            onChange={(e) => onChange({ ...op, level: Number(e.target.value) as 0 | 1 })}
            className={inputClass}
          >
            <option value={0}>0</option>
            <option value={1}>1</option>
          </select>
        </Field>
      </div>
    );
  }
  if (op.type === "display_power") {
    return (
      <label className="flex items-center gap-2 font-body text-[11px] text-ink-muted">
        <input type="checkbox" checked={op.on} onChange={(e) => onChange({ ...op, on: e.target.checked })} />
        {it ? "Acceso" : "On"}
      </label>
    );
  }
  if (op.type === "wait") {
    return (
      <Field label="ms">
        <input type="number" value={op.ms} onChange={(e) => onChange({ ...op, ms: Number(e.target.value) || 0 })} className={inputClass} />
      </Field>
    );
  }
  return <p className="font-body text-[10px] text-ink-faint">{describeDeviceOp(op)}</p>;
}

function paramTypeLabel(type: DeviceCommandParam["type"], it: boolean): string {
  switch (type) {
    case "string":
      return it ? "stringa" : "string";
    case "int":
      return it ? "intero" : "int";
    case "float":
      return "float";
    case "bool":
      return "bool";
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-1.5 block font-body text-[10px] text-ink-muted">
      <span className="mb-0.5 block">{label}</span>
      {children}
    </label>
  );
}
