import { useState } from "react";
import {
  Lightbulb,
  Play,
  Cable,
  Plus,
  Trash2,
  ChevronDown,
  ArrowRight,
  Check,
} from "lucide-react";
import type { DeviceRecipeDraft } from "../../lib/device-recipe-draft.js";
import {
  rgbModuleDraft,
  rgbActiveInputs,
  validateRgbModule,
  type RgbModuleConfig,
  type RgbAction,
  type RgbStep,
  type RgbInput,
} from "../../lib/rgb-module.js";

const field =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink min-w-0";
const button =
  "rounded-lg border border-border px-3 py-2 text-sm hover:border-brand-blue disabled:opacity-40";
const uid = () => crypto.randomUUID();
function Color({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        aria-label="Scegli colore"
        className="h-11 w-14 cursor-pointer rounded-lg border border-border bg-surface p-1"
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
      <span className="font-mono text-sm text-ink-muted">{value.toUpperCase()}</span>
    </div>
  );
}
export function RgbModuleEditor({
  initialDraft,
  onSave,
  onCancel,
}: {
  initialDraft: DeviceRecipeDraft;
  onSave: (draft: DeviceRecipeDraft) => void;
  onCancel: () => void;
}) {
  const [config, setConfig] = useState<RgbModuleConfig>(initialDraft.rgbModule!);
  const [name, setName] = useState(initialDraft.name);
  const [page, setPage] = useState("init");
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState("");
  const action = config.actions.find((item) => item.id === page);
  const update = (patch: Partial<RgbModuleConfig>) => {
    setConfig((old) => ({ ...old, ...patch }));
    setError("");
  };
  function changeAction(patch: Partial<RgbAction>) {
    update({
      actions: config.actions.map((item) =>
        item.id === page ? { ...item, ...patch } : item,
      ),
    });
  }
  function changeStep(id: string, step: RgbStep) {
    if (action)
      changeAction({
        steps: action.steps.map((item) => (item.id === id ? step : item)),
      });
  }
  function changeInput(input: RgbInput) {
    update({
      inputs: config.inputs.map((item) => (item.id === input.id ? input : item)),
    });
  }
  function save() {
    try {
      validateRgbModule(config);
      if (!name.trim()) throw new Error("Inserisci il nome del modulo.");
      onSave({ ...rgbModuleDraft(config, initialDraft), name: name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const nav = (id: string) =>
    `flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left font-medium ${page === id ? "bg-brand-blue/10 text-brand-blue" : "text-ink hover:bg-surface-raised"}`;
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-ink">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <span className="rounded-xl bg-brand-blue/10 p-3 text-brand-blue">
            <Lightbulb size={25} />
          </span>
          <div>
            <input
              aria-label="Nome modulo"
              className="bg-transparent text-2xl font-semibold outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-muted">LED RGB · tre canali PWM</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className={button} onClick={onCancel}>
            Torna al canvas
          </button>
          <button
            className="flex items-center gap-2 rounded-xl bg-brand-blue px-4 py-2 text-sm font-semibold text-white"
            onClick={save}
          >
            <Check size={17} /> Salva modulo
          </button>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="mx-6 mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] max-md:grid-cols-1">
        <aside className="overflow-auto border-r border-border bg-surface-raised/40 p-3">
          <button className={nav("init")} onClick={() => setPage("init")}>
            <Play size={19} /> Inizializzazione
          </button>
          <div className="my-2 flex items-center">
            <button
              className="flex flex-1 items-center gap-3 px-4 py-3 text-left font-medium"
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronDown size={17} className={expanded ? "" : "-rotate-90"} /> Azioni
            </button>
            <button
              aria-label="Aggiungi azione"
              className="p-2 text-brand-blue"
              onClick={() => {
                const id = uid();
                update({
                  actions: [
                    ...config.actions,
                    {
                      id,
                      name: `Azione ${config.actions.length + 1}`,
                      steps: [{ id: uid(), kind: "on" }],
                    },
                  ],
                });
                setPage(id);
                setExpanded(true);
              }}
            >
              <Plus size={19} />
            </button>
          </div>
          {expanded &&
            config.actions.map((item) => (
              <div className="group flex items-center" key={item.id}>
                <button className={nav(item.id)} onClick={() => setPage(item.id)}>
                  <span className="flex-1 truncate">{item.name}</span>
                  <span className="text-xs text-ink-muted">{item.steps.length}</span>
                </button>
                <button
                  aria-label={`Elimina ${item.name}`}
                  className="p-2 text-ink-muted hover:text-red-600"
                  onClick={() => {
                    if (config.inputs.some((input) => input.actionId === item.id)) {
                      setError(
                        "Questa azione è usata da un ingresso. Cambia prima l’associazione in Input / Output.",
                      );
                      return;
                    }
                    update({ actions: config.actions.filter((a) => a.id !== item.id) });
                    if (page === item.id) setPage("init");
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          <div className="my-3 border-t border-border" />
          <button className={nav("io")} onClick={() => setPage("io")}>
            <Cable size={19} /> Input / Output
          </button>
        </aside>
        <main className="overflow-auto p-6">
          <div className="mx-auto max-w-4xl space-y-5">
            {page === "init" && (
              <>
                <h2 className="text-xl font-semibold">Inizializzazione</h2>
                <p className="text-sm text-ink-muted">
                  Lo stato applicato quando avvii il Flow sulla Backbone.
                </p>
                <section className="space-y-5 rounded-2xl border border-border p-5">
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={config.initialOn}
                      onChange={(e) => update({ initialOn: e.target.checked })}
                    />{" "}
                    LED acceso all’avvio
                  </label>
                  <div>
                    <p className="mb-2 text-sm font-medium">Colore iniziale</p>
                    <Color
                      value={config.initialColor}
                      onChange={(initialColor) => update({ initialColor })}
                    />
                    <p className="mt-2 text-xs text-ink-muted">
                      Se parte spento, questo colore viene ricordato per la prima
                      accensione.
                    </p>
                  </div>
                  <label className="flex flex-wrap items-center gap-3 text-sm">
                    Pin comune
                    <select
                      className={field}
                      value={config.common}
                      onChange={(e) =>
                        update({ common: e.target.value as RgbModuleConfig["common"] })
                      }
                    >
                      <option value="cathode">GND · catodo comune</option>
                      <option value="anode">VCC · anodo comune</option>
                    </select>
                  </label>
                </section>
              </>
            )}
            {action && (
              <>
                <div className="flex items-center justify-between">
                  <input
                    aria-label="Nome azione"
                    className="min-w-0 bg-transparent text-xl font-semibold"
                    value={action.name}
                    onChange={(e) => changeAction({ name: e.target.value })}
                  />
                  <span className="text-xs text-ink-muted">
                    {action.steps.length} passi
                  </span>
                </div>
                <p className="text-sm text-ink-muted">
                  I passi vengono eseguiti in ordine quando ricevi il trigger associato.
                </p>
                {action.steps.map((step, index) => (
                  <section
                    className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4"
                    key={step.id}
                  >
                    <span className="text-sm text-ink-muted">{index + 1}</span>
                    <select
                      aria-label={`Tipo passo ${index + 1}`}
                      className={field}
                      value={step.kind}
                      onChange={(e) =>
                        changeStep(
                          step.id,
                          e.target.value === "color"
                            ? { id: step.id, kind: "color", color: config.initialColor }
                            : { id: step.id, kind: e.target.value as "on" | "off" },
                        )
                      }
                    >
                      <option value="on">On · accendi</option>
                      <option value="off">Off · spegni</option>
                      <option value="color">Imposta colore</option>
                    </select>
                    {step.kind === "color" && (
                      <>
                        <select
                          aria-label={`Sorgente colore ${index + 1}`}
                          className={field}
                          value={step.variableId ?? ""}
                          onChange={(e) =>
                            changeStep(step.id, {
                              ...step,
                              variableId: e.target.value || undefined,
                            })
                          }
                        >
                          <option value="">Colore fisso</option>
                          {config.variables.map((v) => (
                            <option key={v.id} value={v.id}>
                              Variabile · {v.name}
                            </option>
                          ))}
                        </select>
                        {!step.variableId && (
                          <Color
                            value={step.color}
                            onChange={(color) =>
                              changeStep(step.id, { ...step, color })
                            }
                          />
                        )}
                      </>
                    )}
                    <button
                      aria-label={`Elimina passo ${index + 1}`}
                      className="ml-auto p-2 text-ink-muted hover:text-red-600"
                      onClick={() =>
                        changeAction({
                          steps: action.steps.filter((s) => s.id !== step.id),
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </section>
                ))}
                <button
                  className={button}
                  disabled={action.steps.length >= 8}
                  onClick={() =>
                    changeAction({
                      steps: [
                        ...action.steps,
                        { id: uid(), kind: "color", color: config.initialColor },
                      ],
                    })
                  }
                >
                  + Aggiungi passo
                </button>
                <p className="text-xs text-ink-muted">
                  On ripristina l’ultimo colore. Off lo conserva. Imposta colore accende
                  il LED con il nuovo colore.
                </p>
              </>
            )}
            {page === "io" && (
              <>
                <h2 className="text-xl font-semibold">Input / Output</h2>
                <p className="rounded-xl border border-border p-4 text-sm text-ink-muted">
                  Colore e i tre canali RGB sono sempre visibili sul canvas. Il primo
                  collegamento sceglie la modalità: gli ingressi dell’altra diventano
                  grigi e non collegabili. Scollega tutti gli ingressi per cambiare
                  modalità.
                </p>
                <h3 className="font-semibold">Variabili colore</h3>
                {config.variables.map((v) => (
                  <div
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4"
                    key={v.id}
                  >
                    <input
                      aria-label="Nome variabile"
                      className={field}
                      value={v.name}
                      onChange={(e) =>
                        update({
                          variables: config.variables.map((item) =>
                            item.id === v.id ? { ...item, name: e.target.value } : item,
                          ),
                        })
                      }
                    />
                    <Color
                      value={v.color}
                      onChange={(color) =>
                        update({
                          variables: config.variables.map((item) =>
                            item.id === v.id ? { ...item, color } : item,
                          ),
                        })
                      }
                    />
                    <button
                      aria-label={`Elimina variabile ${v.name}`}
                      className="ml-auto p-2 text-ink-muted"
                      onClick={() => {
                        if (
                          config.inputs.some(
                            (i) => i.mode === "variable" && i.variableId === v.id,
                          ) ||
                          config.actions.some((a) =>
                            a.steps.some(
                              (s) => s.kind === "color" && s.variableId === v.id,
                            ),
                          )
                        ) {
                          setError(
                            "La variabile è ancora usata: rimuovi prima i riferimenti nei passi e negli ingressi.",
                          );
                          return;
                        }
                        update({
                          variables: config.variables.filter(
                            (item) => item.id !== v.id,
                          ),
                        });
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button
                  className={button}
                  disabled={config.variables.length >= 8}
                  onClick={() =>
                    update({
                      variables: [
                        ...config.variables,
                        {
                          id: uid(),
                          name: `Colore ${config.variables.length + 1}`,
                          color: "#FFFFFF",
                        },
                      ],
                    })
                  }
                >
                  + Variabile
                </button>
                <p className="text-xs text-ink-muted">
                  Un colore è un intero RGB: rosso = 16711680 (0xFF0000), verde = 65280,
                  blu = 255.
                </p>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Ingressi</h3>
                  <button
                    className={button}
                    disabled={config.inputs.length >= 4 || !config.actions.length}
                    onClick={() =>
                      update({
                        inputs: [
                          ...config.inputs,
                          {
                            id: uid(),
                            name: `Ingresso ${config.inputs.length + 1}`,
                            mode: "trigger",
                            actionId: config.actions[0]!.id,
                            edge: "rising",
                          },
                        ],
                      })
                    }
                  >
                    + Ingresso
                  </button>
                </div>
                {rgbActiveInputs(config).map((input) =>
                  input.mode === "component" ? (
                    <section
                      key={input.id}
                      className="rounded-xl border border-border p-4"
                    >
                      <h3 className="font-semibold">{input.name}</h3>
                      <p className="mt-1 text-sm text-ink-muted">
                        Entrata numerica da 0 a 100%. Aggiorna soltanto questo canale e
                        mantiene gli altri due.
                      </p>
                    </section>
                  ) : (
                    <section
                      key={input.id}
                      className="space-y-3 rounded-xl border border-border p-4"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          aria-label="Nome ingresso"
                          className={`${field} flex-1`}
                          value={input.name}
                          onChange={(e) =>
                            changeInput({ ...input, name: e.target.value })
                          }
                        />
                        <select
                          aria-label={`Modalità ${input.name}`}
                          className={field}
                          value={input.mode}
                          onChange={(e) => {
                            if (
                              e.target.value === "variable" &&
                              !config.variables.length
                            ) {
                              setError("Crea prima una variabile colore.");
                              return;
                            }
                            changeInput(
                              e.target.value === "trigger"
                                ? {
                                    id: input.id,
                                    name: input.name,
                                    mode: "trigger",
                                    actionId: input.actionId,
                                    edge: "rising",
                                  }
                                : {
                                    id: input.id,
                                    name: input.name,
                                    mode: "variable",
                                    actionId: input.actionId,
                                    variableId: config.variables[0]!.id,
                                  },
                            );
                          }}
                        >
                          <option value="trigger">Trigger → azione</option>
                          <option value="variable">Dato → variabile</option>
                        </select>
                        <button
                          aria-label={`Elimina ingresso ${input.name}`}
                          className="p-2 text-ink-muted"
                          onClick={() =>
                            update({
                              inputs: config.inputs.filter((i) => i.id !== input.id),
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {input.mode === "variable" ? (
                          <select
                            aria-label={`Variabile ${input.name}`}
                            className={field}
                            value={input.variableId}
                            onChange={(e) =>
                              changeInput({ ...input, variableId: e.target.value })
                            }
                          >
                            {config.variables.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            aria-label={`Fronte ${input.name}`}
                            className={field}
                            value={input.edge}
                            onChange={(e) =>
                              changeInput({
                                ...input,
                                edge: e.target.value as "rising" | "falling",
                              })
                            }
                          >
                            <option value="rising">Quando passa a HIGH</option>
                            <option value="falling">Quando passa a LOW</option>
                          </select>
                        )}
                        <ArrowRight size={17} className="text-brand-blue" />
                        <select
                          aria-label={`Azione ${input.name}`}
                          className={field}
                          value={input.actionId}
                          onChange={(e) =>
                            changeInput({ ...input, actionId: e.target.value })
                          }
                        >
                          {config.actions.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="text-xs text-ink-muted">
                        {input.mode === "variable"
                          ? "Aggiorna la variabile ed esegue l’azione solo quando cambia il valore in ingresso."
                          : "Esegue una volta l’azione sul fronte selezionato."}
                      </p>
                    </section>
                  ),
                )}
                <h3 className="font-semibold">Uscite · stato attuale</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border p-4 text-sm">
                    <strong>È acceso</strong>
                    <p className="mt-1 text-ink-muted">0 spento · 1 acceso</p>
                  </div>
                  <div className="rounded-xl border border-border p-4 text-sm">
                    <strong>Colore emesso</strong>
                    <p className="mt-1 text-ink-muted">Intero RGB · 0 quando spento</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
