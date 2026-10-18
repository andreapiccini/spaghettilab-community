import { Braces, Plus, Radio, SlidersHorizontal, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type {
  DeviceCommandParam,
  DeviceRecipeDraft,
  DeviceRecipeOp,
  DeviceValueSource,
  GpioEventDefinition,
  GpioSignalConfiguration,
  GpioSignalDef,
  GpioSignalType,
} from "../../lib/device-recipe-draft.js";
import { describeGpioTestSupport } from "../../lib/gpio-capability.js";
import {
  compatibleGpioSignals,
  gpioOperationDefinition,
  gpioSignalType,
  type GpioOperationType,
} from "../../lib/gpio-operation-registry.js";
import type { SensorChannel, SensorChannelTransform } from "../../lib/sensor-recipe.js";
import { EditorSection } from "./EditorSection.js";

const inputClass =
  "w-full rounded-slsm border border-border-strong bg-surface px-2 py-1.5 font-body text-xs text-ink";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function identifier(value: string): string {
  return (
    value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .replace(/^(\d)/, "_$1")
      .slice(0, 32) || "SIGNAL"
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block font-body text-[10px] text-ink-muted">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function GpioGeneralPanel({
  draft,
  it,
  onChange,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (draft: DeviceRecipeDraft) => void;
}) {
  return (
    <EditorSection title={it ? "Generale" : "General"} icon={SlidersHorizontal}>
      <div className="space-y-2">
        <Field label={it ? "Descrizione" : "Description"}>
          <textarea
            value={draft.description ?? ""}
            onChange={(event) =>
              onChange({ ...draft, description: event.target.value })
            }
            rows={3}
            className={inputClass}
            placeholder={
              it
                ? "Cosa fa il dispositivo, senza dettagli del progetto"
                : "What the device does, without project-specific details"
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={it ? "Categoria" : "Category"}>
            <select
              value={draft.deviceCategory ?? "custom"}
              onChange={(event) =>
                onChange({
                  ...draft,
                  deviceCategory: event.target
                    .value as DeviceRecipeDraft["deviceCategory"],
                })
              }
              className={inputClass}
            >
              <option value="input">Input</option>
              <option value="output">Output</option>
              <option value="sensor">{it ? "Sensore" : "Sensor"}</option>
              <option value="actuator">{it ? "Attuatore" : "Actuator"}</option>
              <option value="display">Display</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label={it ? "Icona" : "Icon"}>
            <input
              value={draft.icon ?? ""}
              onChange={(event) => onChange({ ...draft, icon: event.target.value })}
              className={inputClass}
              placeholder={it ? "Nome icona opzionale" : "Optional icon name"}
            />
          </Field>
        </div>
        <p className="font-body text-[10px] leading-relaxed text-ink-faint">
          {it
            ? "La categoria aiuta la ricerca ma non limita segnali, azioni o uscite."
            : "Category helps discovery but does not restrict signals, actions, or outputs."}
        </p>
      </div>
    </EditorSection>
  );
}

function defaultsForSignal(type: GpioSignalType): {
  readonly direction: GpioSignalDef["direction"];
  readonly configuration: GpioSignalConfiguration;
  readonly requirements: NonNullable<GpioSignalDef["requirements"]>;
} {
  switch (type) {
    case "digital_input":
      return {
        direction: "in",
        configuration: {
          debounceMs: 20,
          pollingIntervalMs: 20,
          edge: "none",
        },
        requirements: { readable: true },
      };
    case "digital_output":
      return {
        direction: "out",
        configuration: { initialState: 0, safeState: 0 },
        requirements: { writable: true },
      };
    case "analog_input":
      return {
        direction: "in",
        configuration: {
          adcMode: "single",
          rawMin: 0,
          rawMax: 4095,
          scaleMin: 0,
          scaleMax: 100,
          unit: "%",
          calibrationOffset: 0,
          calibrationMultiplier: 1,
        },
        requirements: { readable: true, adc: true },
      };
    case "pwm_output":
      return {
        direction: "out",
        configuration: {
          pwmFrequencyHz: 1000,
          initialDutyPercent: 0,
          dutyMinPercent: 0,
          dutyMaxPercent: 100,
          stopBehavior: "low",
          safeDutyPercent: 0,
        },
        requirements: { writable: true, pwm: true, dedicatedRoute: true },
      };
  }
}

function SignalConfiguration({
  signal,
  it,
  onPatch,
}: {
  readonly signal: GpioSignalDef;
  readonly it: boolean;
  readonly onPatch: (patch: Partial<GpioSignalDef>) => void;
}) {
  const type = gpioSignalType(signal);
  const config = signal.configuration ?? defaultsForSignal(type).configuration;
  const patchConfig = (patch: Partial<GpioSignalConfiguration>) =>
    onPatch({ configuration: { ...config, ...patch } });
  if (type === "digital_input")
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Pull">
          <select
            value={signal.pull}
            onChange={(event) =>
              onPatch({ pull: event.target.value as GpioSignalDef["pull"] })
            }
            className={inputClass}
          >
            <option value="none">{it ? "Nessuno" : "None"}</option>
            <option value="up">Pull-up</option>
            <option value="down">Pull-down</option>
          </select>
        </Field>
        <Field label={it ? "Livello attivo" : "Active level"}>
          <select
            value={signal.activeLow ? "low" : "high"}
            onChange={(event) => onPatch({ activeLow: event.target.value === "low" })}
            className={inputClass}
          >
            <option value="high">HIGH</option>
            <option value="low">LOW</option>
          </select>
        </Field>
        <details className="gpio-acquisition col-span-2">
          <summary>
            {it ? "Acquisizione e antirimbalzo" : "Acquisition and debounce"}
          </summary>
          <div className="grid grid-cols-2 gap-3">
            <Field label={it ? "Antirimbalzo (ms)" : "Debounce (ms)"}>
              <input
                type="number"
                min={0}
                value={config.debounceMs ?? 0}
                onChange={(event) =>
                  patchConfig({ debounceMs: Math.max(0, Number(event.target.value)) })
                }
                className={inputClass}
              />
            </Field>
            <Field label={it ? "Polling (ms)" : "Polling (ms)"}>
              <input
                type="number"
                min={1}
                value={config.pollingIntervalMs ?? 20}
                onChange={(event) =>
                  patchConfig({
                    pollingIntervalMs: Math.max(1, Number(event.target.value)),
                  })
                }
                className={inputClass}
              />
            </Field>
            <Field label={it ? "Rilevamento fronte" : "Edge detection"}>
              <select
                value={config.edge ?? "none"}
                onChange={(event) =>
                  patchConfig({
                    edge: event.target.value as GpioSignalConfiguration["edge"],
                  })
                }
                className={inputClass}
              >
                <option value="none">{it ? "Nessuno" : "None"}</option>
                <option value="rising">{it ? "Salita" : "Rising"}</option>
                <option value="falling">{it ? "Discesa" : "Falling"}</option>
                <option value="both">{it ? "Entrambi" : "Both"}</option>
              </select>
            </Field>
          </div>
        </details>
      </div>
    );
  if (type === "digital_output")
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label={it ? "Stato iniziale" : "Initial state"}>
          <select
            value={config.initialState ?? 0}
            onChange={(event) =>
              patchConfig({ initialState: Number(event.target.value) as 0 | 1 })
            }
            className={inputClass}
          >
            <option value={0}>LOW</option>
            <option value={1}>HIGH</option>
          </select>
        </Field>
        <Field label={it ? "Stato sicuro" : "Safe state"}>
          <select
            value={config.safeState ?? 0}
            onChange={(event) =>
              patchConfig({ safeState: Number(event.target.value) as 0 | 1 })
            }
            className={inputClass}
          >
            <option value={0}>LOW</option>
            <option value={1}>HIGH</option>
          </select>
        </Field>
        <Field label={it ? "Logica" : "Logic"}>
          <select
            value={signal.activeLow ? "low" : "high"}
            onChange={(event) => onPatch({ activeLow: event.target.value === "low" })}
            className={inputClass}
          >
            <option value="high">{it ? "Attivo HIGH" : "Active HIGH"}</option>
            <option value="low">
              {it ? "Attivo LOW · invertito" : "Active LOW · inverted"}
            </option>
          </select>
        </Field>
      </div>
    );
  if (type === "analog_input")
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label={it ? "Acquisizione" : "Acquisition"}>
          <select
            value={config.adcMode ?? "single"}
            onChange={(event) =>
              patchConfig({
                adcMode: event.target.value as GpioSignalConfiguration["adcMode"],
              })
            }
            className={inputClass}
          >
            <option value="single">{it ? "Singola" : "Single"}</option>
            <option value="continuous">{it ? "Periodica" : "Periodic"}</option>
          </select>
        </Field>
        <Field label={it ? "Unità" : "Unit"}>
          <input
            value={config.unit ?? ""}
            onChange={(event) => patchConfig({ unit: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "ADC minimo" : "ADC minimum"}>
          <input
            type="number"
            value={config.rawMin ?? 0}
            onChange={(event) => patchConfig({ rawMin: Number(event.target.value) })}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "ADC massimo" : "ADC maximum"}>
          <input
            type="number"
            value={config.rawMax ?? 4095}
            onChange={(event) => patchConfig({ rawMax: Number(event.target.value) })}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Scala minima" : "Scale minimum"}>
          <input
            type="number"
            value={config.scaleMin ?? 0}
            onChange={(event) => patchConfig({ scaleMin: Number(event.target.value) })}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Scala massima" : "Scale maximum"}>
          <input
            type="number"
            value={config.scaleMax ?? 100}
            onChange={(event) => patchConfig({ scaleMax: Number(event.target.value) })}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Campionamento (ms)" : "Sampling (ms)"}>
          <input
            type="number"
            min={1}
            value={config.samplingIntervalMs ?? ""}
            onChange={(event) =>
              patchConfig({
                samplingIntervalMs:
                  event.target.value === ""
                    ? undefined
                    : Math.max(1, Number(event.target.value)),
              })
            }
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Moltiplicatore" : "Multiplier"}>
          <input
            type="number"
            value={config.calibrationMultiplier ?? 1}
            onChange={(event) =>
              patchConfig({ calibrationMultiplier: Number(event.target.value) })
            }
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Offset" : "Offset"}>
          <input
            type="number"
            value={config.calibrationOffset ?? 0}
            onChange={(event) =>
              patchConfig({ calibrationOffset: Number(event.target.value) })
            }
            className={inputClass}
          />
        </Field>
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={it ? "Frequenza (Hz)" : "Frequency (Hz)"}>
        <input
          type="number"
          min={1}
          value={config.pwmFrequencyHz ?? 1000}
          onChange={(event) =>
            patchConfig({ pwmFrequencyHz: Math.max(1, Number(event.target.value)) })
          }
          className={inputClass}
        />
      </Field>
      <Field label={it ? "Duty iniziale (%)" : "Initial duty (%)"}>
        <input
          type="number"
          min={0}
          max={100}
          value={config.initialDutyPercent ?? 0}
          onChange={(event) =>
            patchConfig({ initialDutyPercent: Number(event.target.value) })
          }
          className={inputClass}
        />
      </Field>
      <Field label={it ? "Duty minimo (%)" : "Minimum duty (%)"}>
        <input
          type="number"
          min={0}
          max={100}
          value={config.dutyMinPercent ?? 0}
          onChange={(event) =>
            patchConfig({ dutyMinPercent: Number(event.target.value) })
          }
          className={inputClass}
        />
      </Field>
      <Field label={it ? "Duty massimo (%)" : "Maximum duty (%)"}>
        <input
          type="number"
          min={0}
          max={100}
          value={config.dutyMaxPercent ?? 100}
          onChange={(event) =>
            patchConfig({ dutyMaxPercent: Number(event.target.value) })
          }
          className={inputClass}
        />
      </Field>
      <Field label={it ? "Larghezza impulso (µs)" : "Pulse width (µs)"}>
        <input
          type="number"
          min={1}
          value={config.pulseWidthUs ?? ""}
          onChange={(event) =>
            patchConfig({
              pulseWidthUs:
                event.target.value === ""
                  ? undefined
                  : Math.max(1, Number(event.target.value)),
            })
          }
          className={inputClass}
        />
      </Field>
      <Field label={it ? "Arresto" : "Stop behavior"}>
        <select
          value={config.stopBehavior ?? "low"}
          onChange={(event) =>
            patchConfig({
              stopBehavior: event.target
                .value as GpioSignalConfiguration["stopBehavior"],
            })
          }
          className={inputClass}
        >
          <option value="low">LOW</option>
          <option value="high">HIGH</option>
          <option value="hold">{it ? "Mantieni" : "Hold"}</option>
          <option value="high_z">High-Z</option>
        </select>
      </Field>
      <label className="col-span-2 flex gap-2 rounded-slsm bg-warning/10 p-2 font-body text-[10px] text-ink-muted">
        <input
          type="checkbox"
          checked={signal.requirements?.dedicatedRoute ?? true}
          onChange={(event) =>
            onPatch({
              requirements: {
                ...signal.requirements,
                writable: true,
                pwm: true,
                dedicatedRoute: event.target.checked,
              },
            })
          }
        />
        {it
          ? "Richiede una rotta continua dedicata: il multiplexer non può riutilizzarla durante il PWM."
          : "Requires a dedicated continuous route: the multiplexer cannot reuse it while PWM runs."}
      </label>
    </div>
  );
}

export function GpioSignalsPanel({
  draft,
  it,
  onChange,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (draft: DeviceRecipeDraft) => void;
}) {
  const signals = draft.binding.gpioSignals;
  const update = (id: string, patch: Partial<GpioSignalDef>) =>
    onChange({
      ...draft,
      binding: {
        ...draft.binding,
        gpioSignals: signals.map((signal) =>
          signal.id === id ? { ...signal, ...patch } : signal,
        ),
      },
    });
  const add = () => {
    const id = uid("sig");
    const type: GpioSignalType = "digital_input";
    const defaults = defaultsForSignal(type);
    const signal: GpioSignalDef = {
      id,
      identifier: `SIGNAL_${signals.length + 1}`,
      name: `${it ? "Segnale" : "Signal"} ${signals.length + 1}`,
      description: "",
      signalType: type,
      role: "generic",
      direction: defaults.direction,
      pinLabel: "",
      pull: "none",
      activeLow: false,
      configuration: defaults.configuration,
      requirements: defaults.requirements,
    };
    onChange({
      ...draft,
      binding: {
        ...draft.binding,
        gpioSignals: [...signals, signal],
      },
    });
  };
  const typeNames = {
    digital_input: it ? "Ingresso digitale" : "Digital input",
    digital_output: it ? "Uscita digitale" : "Digital output",
    analog_input: it ? "Ingresso analogico" : "Analog input",
    pwm_output: it ? "Uscita PWM" : "PWM output",
  };
  return (
    <section
      className="gpio-terminals"
      aria-label={it ? "Terminali del dispositivo" : "Device terminals"}
    >
      {signals.map((signal, index) => (
        <details key={signal.id} className="gpio-terminal-card" open={index === 0}>
          <summary>
            <span className="gpio-terminal-dot" />
            <input
              value={signal.name}
              aria-label={it ? "Nome terminale" : "Terminal name"}
              onChange={(e) => update(signal.id, { name: e.target.value })}
            />
            <span className="gpio-terminal-badge">
              {typeNames[gpioSignalType(signal)]}
            </span>
            <button
              type="button"
              aria-label={
                it
                  ? `Elimina terminale ${signal.name}`
                  : `Delete terminal ${signal.name}`
              }
              onClick={() =>
                onChange({
                  ...draft,
                  binding: {
                    ...draft.binding,
                    gpioSignals: signals.filter((s) => s.id !== signal.id),
                  },
                })
              }
            >
              <Trash2 size={16} />
            </button>
          </summary>
          <div className="gpio-terminal-fields">
            <Field label={it ? "Tipo terminale" : "Terminal type"}>
              <select
                className={inputClass}
                value={gpioSignalType(signal)}
                onChange={(e) => {
                  const signalType = e.target.value as GpioSignalType;
                  const defaults = defaultsForSignal(signalType);
                  update(signal.id, {
                    signalType,
                    direction: defaults.direction,
                    pull: "none",
                    activeLow: false,
                    configuration: defaults.configuration,
                    requirements: defaults.requirements,
                  });
                }}
              >
                {Object.entries(typeNames).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <SignalConfiguration
              signal={signal}
              it={it}
              onPatch={(patch) => update(signal.id, patch)}
            />
          </div>
          <details className="gpio-terminal-advanced">
            <summary>{it ? "Impostazioni avanzate" : "Advanced settings"}</summary>
            <Field label={it ? "Descrizione terminale" : "Terminal description"}>
              <input
                className={inputClass}
                value={signal.description ?? ""}
                onChange={(e) => update(signal.id, { description: e.target.value })}
              />
            </Field>
          </details>
        </details>
      ))}
      <button type="button" className="gpio-add-terminal" onClick={add}>
        <Plus size={16} />
        {it ? "Aggiungi terminale" : "Add terminal"}
      </button>
    </section>
  );
}

function defaultTransform(
  kind: SensorChannelTransform["kind"],
): SensorChannelTransform {
  switch (kind) {
    case "invert_boolean":
      return { kind };
    case "map_range":
      return { kind, inMin: 0, inMax: 4095, outMin: 0, outMax: 100, clamp: true };
    case "offset":
      return { kind, value: 0 };
    case "multiply":
      return { kind, value: 1 };
    case "clamp":
      return { kind, min: 0, max: 100 };
  }
}

function TransformEditor({
  transform,
  it,
  onChange,
}: {
  readonly transform: SensorChannelTransform;
  readonly it: boolean;
  readonly onChange: (transform: SensorChannelTransform) => void;
}) {
  if (transform.kind === "invert_boolean")
    return (
      <span className="font-body text-[10px] text-ink-muted">
        {it ? "TRUE ↔ FALSE" : "TRUE ↔ FALSE"}
      </span>
    );
  if (transform.kind === "offset" || transform.kind === "multiply")
    return (
      <input
        type="number"
        value={transform.value}
        onChange={(event) =>
          onChange({ ...transform, value: Number(event.target.value) })
        }
        className={inputClass}
      />
    );
  if (transform.kind === "clamp")
    return (
      <div className="grid grid-cols-2 gap-1">
        <input
          aria-label="Min"
          type="number"
          value={transform.min}
          onChange={(event) =>
            onChange({ ...transform, min: Number(event.target.value) })
          }
          className={inputClass}
        />
        <input
          aria-label="Max"
          type="number"
          value={transform.max}
          onChange={(event) =>
            onChange({ ...transform, max: Number(event.target.value) })
          }
          className={inputClass}
        />
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-1">
      {(
        [
          ["inMin", it ? "Input min" : "Input min"],
          ["inMax", it ? "Input max" : "Input max"],
          ["outMin", it ? "Output min" : "Output min"],
          ["outMax", it ? "Output max" : "Output max"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="font-body text-[9px] text-ink-faint">
          {label}
          <input
            type="number"
            value={transform[key]}
            onChange={(event) =>
              onChange({ ...transform, [key]: Number(event.target.value) })
            }
            className={inputClass}
          />
        </label>
      ))}
      <label className="col-span-2 flex items-center gap-2 font-body text-[9px] text-ink-muted">
        <input
          type="checkbox"
          checked={transform.clamp}
          onChange={(event) => onChange({ ...transform, clamp: event.target.checked })}
        />
        Clamp
      </label>
    </div>
  );
}

export function GpioOutputsPanel({
  draft,
  it,
  onChange,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (draft: DeviceRecipeDraft) => void;
}) {
  const outputs = draft.channels.filter((channel) => channel.direction === "read");
  const update = (id: string, patch: Partial<SensorChannel>) =>
    onChange({
      ...draft,
      channels: draft.channels.map((channel) =>
        channel.id === id ? { ...channel, ...patch } : channel,
      ),
    });
  return (
    <EditorSection title={it ? "Uscite" : "Outputs"} icon={Braces}>
      <div className="space-y-2">
        {outputs.map((output) => (
          <section
            key={output.id}
            className="space-y-2 rounded-slsm border border-border bg-surface-sunken/45 p-2"
          >
            <div className="flex items-center gap-2">
              <input
                value={output.label}
                onChange={(event) => update(output.id, { label: event.target.value })}
                className="min-w-0 flex-1 rounded-slsm border border-border-strong bg-surface px-2 py-1 font-body text-xs font-semibold text-ink"
              />
              <button
                type="button"
                aria-label={it ? "Elimina uscita" : "Delete output"}
                onClick={() =>
                  onChange({
                    ...draft,
                    channels: draft.channels.filter(
                      (channel) => channel.id !== output.id,
                    ),
                  })
                }
                className="rounded p-1 text-ink-faint hover:text-error"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={it ? "Tipo dati" : "Data type"}>
                <select
                  value={output.dataType ?? "number"}
                  onChange={(event) =>
                    update(output.id, {
                      dataType: event.target.value as SensorChannel["dataType"],
                      quantity: event.target.value === "bool" ? "digital" : "analog",
                    })
                  }
                  className={inputClass}
                >
                  <option value="bool">Boolean</option>
                  <option value="number">Number</option>
                  <option value="int">Integer</option>
                  <option value="string">String</option>
                  <option value="enum">Enum</option>
                </select>
              </Field>
              <Field label={it ? "Unità" : "Unit"}>
                <input
                  value={output.unit}
                  onChange={(event) => update(output.id, { unit: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label={it ? "Sorgente" : "Source"}>
                <input
                  value={output.source ?? ""}
                  onChange={(event) =>
                    update(output.id, { source: event.target.value })
                  }
                  placeholder="$variabile"
                  className={inputClass}
                />
              </Field>
            </div>
            <details>
              <summary className="cursor-pointer font-body text-[10px] font-semibold text-ink-muted">
                {it ? "Trasformazioni" : "Transformations"} ·{" "}
                {output.transforms?.length ?? 0}
              </summary>
              <div className="mt-2 space-y-2">
                {(output.transforms ?? []).map((transform, index) => (
                  <div
                    key={`${transform.kind}-${index}`}
                    className="space-y-1.5 rounded border border-border bg-surface p-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 font-body text-[10px] text-ink">
                        {transform.kind.replaceAll("_", " ")}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          update(output.id, {
                            transforms: output.transforms?.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          })
                        }
                        className="text-ink-faint hover:text-error"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <TransformEditor
                      transform={transform}
                      it={it}
                      onChange={(next) =>
                        update(output.id, {
                          transforms: output.transforms?.map((item, itemIndex) =>
                            itemIndex === index ? next : item,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <select
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    update(output.id, {
                      transforms: [
                        ...(output.transforms ?? []),
                        defaultTransform(
                          event.target.value as SensorChannelTransform["kind"],
                        ),
                      ],
                    });
                    event.target.value = "";
                  }}
                  className={inputClass}
                >
                  <option value="">{it ? "Aggiungi…" : "Add…"}</option>
                  <option value="invert_boolean">
                    {it ? "Inverti booleano" : "Invert boolean"}
                  </option>
                  <option value="map_range">
                    {it ? "Mappa intervallo" : "Map range"}
                  </option>
                  <option value="offset">Offset</option>
                  <option value="multiply">{it ? "Moltiplica" : "Multiply"}</option>
                  <option value="clamp">Clamp</option>
                </select>
              </div>
            </details>
          </section>
        ))}
        <button
          type="button"
          onClick={() => {
            const id = uid("out");
            onChange({
              ...draft,
              channels: [
                ...draft.channels,
                {
                  id,
                  label: `${it ? "Uscita" : "Output"} ${outputs.length + 1}`,
                  unit: "",
                  quantity: "other",
                  direction: "read",
                  dataType: "number",
                  source: "",
                  transforms: [],
                },
              ],
            });
          }}
          className="inline-flex items-center gap-1 rounded-slsm border border-dashed border-border-strong px-2 py-1.5 font-body text-xs text-ink-muted"
        >
          <Plus size={13} />
          {it ? "Aggiungi uscita" : "Add output"}
        </button>
      </div>
    </EditorSection>
  );
}

export function GpioEventsPanel({
  draft,
  it,
  onChange,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (draft: DeviceRecipeDraft) => void;
}) {
  const events = draft.gpioEvents ?? [];
  const update = (id: string, patch: Partial<GpioEventDefinition>) =>
    onChange({
      ...draft,
      gpioEvents: events.map((event) =>
        event.id === id ? { ...event, ...patch } : event,
      ),
    });
  return (
    <EditorSection title={it ? "Eventi" : "Events"} icon={Radio}>
      <div className="space-y-2">
        {events.map((event) => {
          const analog = event.trigger.startsWith("analog_");
          return (
            <details
              key={event.id}
              className="space-y-2 rounded-slsm border border-border bg-surface-sunken/45 p-2"
            >
              <summary className="gpio-event-summary">
                <strong>{event.name}</strong>
                <span>
                  {
                    draft.binding.gpioSignals.find((s) => s.id === event.sourceSignalId)
                      ?.name
                  }
                </span>
              </summary>
              <div className="mt-3 flex items-center gap-2">
                <input
                  value={event.name}
                  onChange={(change) => update(event.id, { name: change.target.value })}
                  className="min-w-0 flex-1 rounded-slsm border border-border-strong bg-surface px-2 py-1 font-body text-xs font-semibold"
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...draft,
                      gpioEvents: events.filter((item) => item.id !== event.id),
                    })
                  }
                  aria-label={
                    it ? `Elimina evento ${event.name}` : `Delete event ${event.name}`
                  }
                  className="text-ink-faint hover:text-error"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={it ? "Segnale sorgente" : "Source signal"}>
                  <select
                    value={event.sourceSignalId}
                    onChange={(change) =>
                      update(event.id, { sourceSignalId: change.target.value })
                    }
                    className={inputClass}
                  >
                    {draft.binding.gpioSignals
                      .filter((signal) => gpioSignalType(signal).endsWith("_input"))
                      .map((signal) => (
                        <option key={signal.id} value={signal.id}>
                          {signal.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label={it ? "Trigger" : "Trigger"}>
                  <select
                    value={event.trigger}
                    onChange={(change) =>
                      update(event.id, {
                        trigger: change.target.value as GpioEventDefinition["trigger"],
                      })
                    }
                    className={inputClass}
                  >
                    <option value="digital_rising">
                      {it ? "Fronte salita" : "Rising edge"}
                    </option>
                    <option value="digital_falling">
                      {it ? "Fronte discesa" : "Falling edge"}
                    </option>
                    <option value="digital_change">
                      {it ? "Cambio stato" : "State change"}
                    </option>
                    <option value="analog_threshold">
                      {it ? "Soglia analogica" : "Analog threshold"}
                    </option>
                    <option value="analog_change">
                      {it ? "Variazione analogica" : "Analog change"}
                    </option>
                  </select>
                </Field>
                <Field label={it ? "Acquisizione" : "Delivery"}>
                  <select
                    value={event.delivery}
                    onChange={(change) =>
                      update(event.id, {
                        delivery: change.target
                          .value as GpioEventDefinition["delivery"],
                      })
                    }
                    className={inputClass}
                  >
                    <option value="auto">Auto</option>
                    <option value="interrupt">Interrupt</option>
                    <option value="polling">Polling</option>
                  </select>
                </Field>
                {event.delivery !== "interrupt" && (
                  <Field label={it ? "Polling (ms)" : "Polling (ms)"}>
                    <input
                      type="number"
                      min={1}
                      value={event.pollingIntervalMs ?? 20}
                      onChange={(change) =>
                        update(event.id, {
                          pollingIntervalMs: Math.max(1, Number(change.target.value)),
                        })
                      }
                      className={inputClass}
                    />
                  </Field>
                )}
                {analog && (
                  <>
                    <Field label={it ? "Confronto" : "Comparison"}>
                      <select
                        value={event.comparison ?? "gte"}
                        onChange={(change) =>
                          update(event.id, {
                            comparison: change.target
                              .value as GpioEventDefinition["comparison"],
                          })
                        }
                        className={inputClass}
                      >
                        <option value="gt">&gt;</option>
                        <option value="gte">≥</option>
                        <option value="lt">&lt;</option>
                        <option value="lte">≤</option>
                      </select>
                    </Field>
                    <Field label={it ? "Soglia" : "Threshold"}>
                      <input
                        type="number"
                        value={event.threshold ?? 0}
                        onChange={(change) =>
                          update(event.id, {
                            threshold: Number(change.target.value),
                          })
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label={it ? "Isteresi" : "Hysteresis"}>
                      <input
                        type="number"
                        min={0}
                        value={event.hysteresis ?? 0}
                        onChange={(change) =>
                          update(event.id, {
                            hysteresis: Math.max(0, Number(change.target.value)),
                          })
                        }
                        className={inputClass}
                      />
                    </Field>
                  </>
                )}
              </div>
              <p className="rounded-slsm bg-warning/10 px-2 py-1.5 font-body text-[10px] text-ink-muted">
                {it
                  ? "Evento definito nel driver. La disponibilità sul dispositivo viene verificata al collegamento."
                  : "Event defined in the driver. Device support is checked when connecting."}
              </p>
            </details>
          );
        })}
        <button
          type="button"
          disabled={
            !draft.binding.gpioSignals.some((signal) =>
              gpioSignalType(signal).endsWith("_input"),
            )
          }
          onClick={() => {
            const source = draft.binding.gpioSignals.find((signal) =>
              gpioSignalType(signal).endsWith("_input"),
            );
            if (!source) return;
            onChange({
              ...draft,
              gpioEvents: [
                ...events,
                {
                  id: uid("event"),
                  name: `${it ? "Evento" : "Event"} ${events.length + 1}`,
                  sourceSignalId: source.id,
                  trigger:
                    gpioSignalType(source) === "analog_input"
                      ? "analog_threshold"
                      : "digital_change",
                  delivery: "auto",
                  pollingIntervalMs: 20,
                },
              ],
            });
          }}
          className="inline-flex items-center gap-1 rounded-slsm border border-dashed border-border-strong px-2 py-1.5 font-body text-xs text-ink-muted disabled:opacity-40"
        >
          <Plus size={13} />
          {it ? "Aggiungi evento" : "Add event"}
        </button>
      </div>
    </EditorSection>
  );
}

function defaultParam(type: DeviceCommandParam["type"]): string | number | boolean {
  if (type === "bool") return false;
  if (type === "int" || type === "float") return 0;
  return "";
}

export function GpioActionParametersPanel({
  draft,
  actionId,
  it,
  onChange,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly actionId: string | null;
  readonly it: boolean;
  readonly onChange: (draft: DeviceRecipeDraft) => void;
}) {
  const action = draft.commands.find((command) => command.id === actionId);
  if (!action) return null;
  const setParams = (params: readonly DeviceCommandParam[]) =>
    onChange({
      ...draft,
      commands: draft.commands.map((command) =>
        command.id === action.id ? { ...command, params } : command,
      ),
    });
  return (
    <EditorSection title={it ? "Parametri azione" : "Action parameters"} icon={Braces}>
      <div className="space-y-2">
        <Field label={it ? "Descrizione azione" : "Action description"}>
          <textarea
            value={action.description}
            onChange={(event) =>
              onChange({
                ...draft,
                commands: draft.commands.map((command) =>
                  command.id === action.id
                    ? { ...command, description: event.target.value }
                    : command,
                ),
              })
            }
            rows={2}
            className={inputClass}
          />
        </Field>
        {action.params.map((parameter, index) => (
          <section
            key={parameter.id}
            className="space-y-2 rounded-slsm border border-border bg-surface-sunken/45 p-2"
          >
            <div className="flex items-center gap-2">
              <input
                value={parameter.name}
                onChange={(event) =>
                  setParams(
                    action.params.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            name: identifier(event.target.value).toLowerCase(),
                          }
                        : item,
                    ),
                  )
                }
                className="min-w-0 flex-1 rounded-slsm border border-border-strong bg-surface px-2 py-1 font-body text-xs font-semibold"
              />
              <button
                type="button"
                onClick={() =>
                  setParams(action.params.filter((_, itemIndex) => itemIndex !== index))
                }
                className="text-ink-faint hover:text-error"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={it ? "Tipo" : "Type"}>
                <select
                  value={parameter.type}
                  onChange={(event) => {
                    const type = event.target.value as DeviceCommandParam["type"];
                    setParams(
                      action.params.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, type, defaultValue: defaultParam(type) }
                          : item,
                      ),
                    );
                  }}
                  className={inputClass}
                >
                  <option value="bool">Boolean</option>
                  <option value="float">Number</option>
                  <option value="int">Integer</option>
                  <option value="string">String</option>
                  <option value="enum">Enum</option>
                </select>
              </Field>
              <Field label={it ? "Unità" : "Unit"}>
                <input
                  value={parameter.unit ?? ""}
                  onChange={(event) =>
                    setParams(
                      action.params.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, unit: event.target.value }
                          : item,
                      ),
                    )
                  }
                  className={inputClass}
                />
              </Field>
              {(parameter.type === "int" || parameter.type === "float") && (
                <>
                  <Field label="Min">
                    <input
                      type="number"
                      value={parameter.min ?? ""}
                      onChange={(event) =>
                        setParams(
                          action.params.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  min:
                                    event.target.value === ""
                                      ? undefined
                                      : Number(event.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Max">
                    <input
                      type="number"
                      value={parameter.max ?? ""}
                      onChange={(event) =>
                        setParams(
                          action.params.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  max:
                                    event.target.value === ""
                                      ? undefined
                                      : Number(event.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                </>
              )}
              {parameter.type === "enum" && (
                <Field label={it ? "Opzioni (virgola)" : "Options (comma)"}>
                  <input
                    value={parameter.options?.join(", ") ?? ""}
                    onChange={(event) =>
                      setParams(
                        action.params.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                options: event.target.value
                                  .split(",")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              }
                            : item,
                        ),
                      )
                    }
                    className={inputClass}
                  />
                </Field>
              )}
              <Field label={it ? "Valore predefinito" : "Default value"}>
                {parameter.type === "bool" ? (
                  <select
                    value={parameter.defaultValue ? "true" : "false"}
                    onChange={(event) =>
                      setParams(
                        action.params.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                defaultValue: event.target.value === "true",
                              }
                            : item,
                        ),
                      )
                    }
                    className={inputClass}
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                ) : (
                  <input
                    type={
                      parameter.type === "int" || parameter.type === "float"
                        ? "number"
                        : "text"
                    }
                    value={String(parameter.defaultValue)}
                    onChange={(event) =>
                      setParams(
                        action.params.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                defaultValue:
                                  parameter.type === "int" || parameter.type === "float"
                                    ? Number(event.target.value)
                                    : event.target.value,
                              }
                            : item,
                        ),
                      )
                    }
                    className={inputClass}
                  />
                )}
              </Field>
            </div>
          </section>
        ))}
        <button
          type="button"
          onClick={() =>
            setParams([
              ...action.params,
              {
                id: uid("param"),
                name: `param${action.params.length + 1}`,
                type: "float",
                defaultValue: 0,
              },
            ])
          }
          className="inline-flex items-center gap-1 rounded-slsm border border-dashed border-border-strong px-2 py-1.5 font-body text-xs text-ink-muted"
        >
          <Plus size={13} />
          {it ? "Aggiungi parametro" : "Add parameter"}
        </button>
      </div>
    </EditorSection>
  );
}

export function GpioTestingPanel({
  draft,
  it,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
}) {
  const support = describeGpioTestSupport(draft);
  return (
    <EditorSection title={it ? "Test GPIO" : "GPIO testing"} icon={Radio}>
      <div className="space-y-2">
        {draft.binding.gpioSignals.map((signal) => {
          const type = gpioSignalType(signal);
          return (
            <div
              key={signal.id}
              className="rounded-slsm border border-border bg-surface-sunken/45 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="font-body text-xs text-ink">{signal.name}</strong>
                <span className="rounded-slpill bg-ink-faint/10 px-2 py-0.5 font-body text-[9px] text-ink-muted">
                  {type.replaceAll("_", " ")}
                </span>
              </div>
              {type === "digital_output" && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {["HIGH", "LOW", "Toggle"].map((label) => (
                    <button
                      key={label}
                      type="button"
                      disabled
                      title={
                        it
                          ? "Esegui l’azione dal pulsante Testa: questi comandi usano il profilo firmware della porta assegnata."
                          : "Run the action from Test: these commands use the firmware profile of the assigned port."
                      }
                      className="rounded-slsm border border-border-strong px-2 py-1 font-body text-[10px] text-ink-faint disabled:opacity-60"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {type === "digital_input" && (
                <p className="mt-1 font-body text-[10px] text-ink-faint">
                  {it
                    ? "Valore logico disponibile dopo una lettura eseguita. Il livello elettrico può essere invertito se Active Low."
                    : "Logical value is available after an executed read. Electrical level may invert when Active Low."}
                </p>
              )}
              {type === "analog_input" && (
                <p className="mt-1 font-body text-[10px] text-ink-faint">
                  {it
                    ? `ADC ${signal.configuration?.rawMin ?? 0}–${signal.configuration?.rawMax ?? 4095} → ${signal.configuration?.scaleMin ?? 0}–${signal.configuration?.scaleMax ?? 100} ${signal.configuration?.unit ?? ""}`
                    : `ADC ${signal.configuration?.rawMin ?? 0}–${signal.configuration?.rawMax ?? 4095} → ${signal.configuration?.scaleMin ?? 0}–${signal.configuration?.scaleMax ?? 100} ${signal.configuration?.unit ?? ""}`}
                </p>
              )}
              {type === "pwm_output" && (
                <label className="mt-2 block font-body text-[10px] text-ink-faint">
                  {it
                    ? "Duty cycle (solo configurato)"
                    : "Duty cycle (configured only)"}
                  <input
                    type="range"
                    min={signal.configuration?.dutyMinPercent ?? 0}
                    max={signal.configuration?.dutyMaxPercent ?? 100}
                    value={signal.configuration?.initialDutyPercent ?? 0}
                    disabled
                    className="mt-1 w-full disabled:opacity-50"
                  />
                </label>
              )}
            </div>
          );
        })}
        {draft.commands.length > 0 && (
          <div className="space-y-1">
            <p className="font-body text-[10px] font-semibold text-ink-muted">
              {it ? "Azioni" : "Actions"}
            </p>
            {draft.commands.map((command) => (
              <div
                key={command.id}
                className="rounded-slsm border border-border px-2 py-1.5 font-body text-[10px] text-ink"
              >
                <strong>{command.label}</strong>
                {command.params.length > 0 && (
                  <span className="ml-1 text-ink-faint">
                    · {command.params.map((parameter) => parameter.name).join(", ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="rounded-slsm bg-brand-blue/8 px-2 py-1.5 font-body text-[10px] text-ink-muted">
          {it
            ? `Eseguibili sul Core: ${support.executable.length ? support.executable.join(", ") : "nessuna"}. Usa «Testa azione» con hardware collegato e rotta assegnata.`
            : `Executable on Core: ${support.executable.length ? support.executable.join(", ") : "none"}. Use “Test action” with connected hardware and an assigned route.`}
        </p>
        {support.notes.map((note) => (
          <p
            key={note}
            className="rounded-slsm bg-warning/10 px-2 py-1.5 font-body text-[10px] text-ink-muted"
          >
            {note}
          </p>
        ))}
      </div>
    </EditorSection>
  );
}

type ExtendedGpioOp = Extract<
  DeviceRecipeOp,
  {
    type:
      | "gpio_toggle"
      | "gpio_pulse"
      | "gpio_read_analog"
      | "gpio_set_pwm"
      | "gpio_set_pwm_pulse"
      | "gpio_stop_pwm";
  }
>;

export function ValueSourceField({
  label,
  value,
  draft,
  it,
  onChange,
}: {
  readonly label: string;
  readonly value: DeviceValueSource;
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (value: DeviceValueSource) => void;
}) {
  const parameters = draft.commands.flatMap((command) => command.params);
  return (
    <div className="space-y-1">
      <span className="block font-body text-[10px] text-ink-muted">{label}</span>
      <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
        <select
          value={value.kind}
          onChange={(event) => {
            const kind = event.target.value as DeviceValueSource["kind"];
            if (kind === "fixed") onChange({ kind, value: 0 });
            else if (kind === "parameter")
              onChange({ kind, parameterId: parameters[0]?.id ?? "" });
            else onChange({ kind, name: draft.variables[0]?.name ?? "" });
          }}
          className={inputClass}
        >
          <option value="fixed">{it ? "Valore" : "Value"}</option>
          <option value="parameter">{it ? "Parametro" : "Parameter"}</option>
          <option value="variable">{it ? "Variabile" : "Variable"}</option>
        </select>
        {value.kind === "fixed" ? (
          <input
            type="number"
            value={typeof value.value === "number" ? value.value : 0}
            onChange={(event) =>
              onChange({ kind: "fixed", value: Number(event.target.value) })
            }
            className={inputClass}
          />
        ) : value.kind === "parameter" ? (
          <select
            value={value.parameterId}
            onChange={(event) =>
              onChange({ kind: "parameter", parameterId: event.target.value })
            }
            className={inputClass}
          >
            <option value="">{it ? "Seleziona…" : "Select…"}</option>
            {parameters.map((parameter) => (
              <option key={parameter.id} value={parameter.id}>
                {parameter.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={value.name}
            onChange={(event) =>
              onChange({ kind: "variable", name: event.target.value })
            }
            className={inputClass}
          >
            <option value="">{it ? "Seleziona…" : "Select…"}</option>
            {draft.variables.map((variable) => (
              <option key={variable.id} value={variable.name}>
                ${variable.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

export function GpioOperationFields({
  op,
  draft,
  it,
  onChange,
}: {
  readonly op: ExtendedGpioOp;
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (op: DeviceRecipeOp) => void;
}) {
  const definition = gpioOperationDefinition(op.type)!;
  const signals = compatibleGpioSignals(draft, op.type as GpioOperationType);
  return (
    <div className="space-y-2">
      <div
        className={`rounded-slsm px-2 py-1.5 font-body text-[10px] ${
          definition.runtime === "supported"
            ? "bg-success/10 text-ink-muted"
            : "bg-warning/12 text-ink-muted"
        }`}
      >
        <strong>{it ? definition.label.it : definition.label.en}</strong>
        <span className="ml-1">
          · {it ? definition.description.it : definition.description.en}
        </span>
        {definition.runtime === "representation_only" && (
          <span className="mt-1 block font-semibold text-warning">
            {it
              ? (definition.runtimeNote?.it ?? "Backend firmware non disponibile")
              : (definition.runtimeNote?.en ?? "Firmware backend unavailable")}
          </span>
        )}
      </div>
      <Field label={it ? "Segnale compatibile" : "Compatible signal"}>
        <select
          value={op.signalId}
          onChange={(event) => onChange({ ...op, signalId: event.target.value })}
          className={inputClass}
        >
          {!signals.length && (
            <option value="">
              {it ? "Nessun segnale compatibile" : "No compatible signal"}
            </option>
          )}
          {signals.map((signal) => (
            <option key={signal.id} value={signal.id}>
              {signal.name}
            </option>
          ))}
        </select>
      </Field>
      {op.type === "gpio_pulse" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label={it ? "Stato attivo" : "Active state"}>
              <select
                value={op.activeState}
                onChange={(event) =>
                  onChange({
                    ...op,
                    activeState: Number(event.target.value) as 0 | 1,
                  })
                }
                className={inputClass}
              >
                <option value={1}>HIGH</option>
                <option value={0}>LOW</option>
              </select>
            </Field>
            <Field label={it ? "Ripristina" : "Restore"}>
              <select
                value={op.restoreState}
                onChange={(event) =>
                  onChange({
                    ...op,
                    restoreState: Number(event.target.value) as 0 | 1,
                  })
                }
                className={inputClass}
              >
                <option value={0}>LOW</option>
                <option value={1}>HIGH</option>
              </select>
            </Field>
          </div>
          <ValueSourceField
            label={it ? "Durata (ms)" : "Duration (ms)"}
            value={op.durationMs}
            draft={draft}
            it={it}
            onChange={(durationMs) => onChange({ ...op, durationMs })}
          />
        </>
      )}
      {op.type === "gpio_read_analog" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={it ? "Valore grezzo in" : "Raw value into"}>
            <input
              value={op.into}
              onChange={(event) => onChange({ ...op, into: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Convertito in" : "Converted into"}>
            <input
              value={op.convertedInto ?? ""}
              onChange={(event) =>
                onChange({ ...op, convertedInto: event.target.value || undefined })
              }
              className={inputClass}
            />
          </Field>
        </div>
      )}
      {op.type === "gpio_set_pwm" && (
        <>
          <ValueSourceField
            label={it ? "Frequenza (Hz)" : "Frequency (Hz)"}
            value={op.frequencyHz}
            draft={draft}
            it={it}
            onChange={(frequencyHz) => onChange({ ...op, frequencyHz })}
          />
          <ValueSourceField
            label={it ? "Duty cycle (%)" : "Duty cycle (%)"}
            value={op.dutyPercent}
            draft={draft}
            it={it}
            onChange={(dutyPercent) => onChange({ ...op, dutyPercent })}
          />
        </>
      )}
      {op.type === "gpio_set_pwm_pulse" && (
        <ValueSourceField
          label={it ? "Larghezza impulso (µs)" : "Pulse width (µs)"}
          value={op.pulseWidthUs}
          draft={draft}
          it={it}
          onChange={(pulseWidthUs) => onChange({ ...op, pulseWidthUs })}
        />
      )}
      {op.type === "gpio_stop_pwm" && (
        <Field label={it ? "Comportamento arresto" : "Stop behavior"}>
          <select
            value={op.behavior}
            onChange={(event) =>
              onChange({
                ...op,
                behavior: event.target.value as typeof op.behavior,
              })
            }
            className={inputClass}
          >
            <option value="configured">
              {it ? "Configurato nel segnale" : "Signal default"}
            </option>
            <option value="low">LOW</option>
            <option value="high">HIGH</option>
            <option value="hold">{it ? "Mantieni" : "Hold"}</option>
            <option value="high_z">High-Z</option>
          </select>
        </Field>
      )}
    </div>
  );
}
