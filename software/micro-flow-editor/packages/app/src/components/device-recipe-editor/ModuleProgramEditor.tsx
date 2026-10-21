import { createModuleProgramDraft } from "../../lib/new-module-program.js";
import { PortCapability } from "@spaghettilab/device-profile-authoring-model";
import type { DeviceRecipeBus } from "../../lib/device-recipe-draft.js";
import { STEP_CATEGORIES } from "../device-profile-studio/instruction-config.js";
import { useState } from "react";
import { Copy, Plus, Save, X } from "lucide-react";
import type { Instruction } from "@spaghettilab/device-profile-authoring-model";
import { compileRuntimeDriver } from "../../lib/driver-runtime-profile.js";
import {
  synchronizeModuleProgram,
  compileModuleProgram,
  instructionFitsModule,
  programFromRuntime,
  type ModuleProgram,
} from "../../lib/module-program.js";
import {
  createNamedAction,
  type DeviceRecipeDraft,
} from "../../lib/device-recipe-draft.js";
import { InstructionSection } from "../device-profile-studio/InstructionSection.js";
import { OutputTab } from "../device-profile-studio/OutputTab.js";

const button =
  "inline-flex items-center gap-2 rounded-xl border border-border-strong px-4 py-2 text-sm hover:border-brand-blue";
const field =
  "w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm";
export function ModuleProgramEditor({
  initialDraft,
  onSave,
  onCancel,
  onDuplicate,
}: {
  initialDraft: DeviceRecipeDraft;
  onSave: (draft: DeviceRecipeDraft) => void;
  onCancel: () => void;
  onDuplicate: (draft: DeviceRecipeDraft) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initialDraft));
  const [program, setProgram] = useState<ModuleProgram | null>(() => {
    if (initialDraft.moduleProgram) return structuredClone(initialDraft.moduleProgram);
    try {
      const channels = new Map(
        initialDraft.binding.gpioSignals.map((signal, index) => [signal.id, index]),
      );
      return programFromRuntime(
        initialDraft,
        compileRuntimeDriver(initialDraft, new Map(), channels),
      );
    } catch {
      return null;
    }
  });
  const [tab, setTab] = useState("actions");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(program?.profile.actions?.[0]?.id ?? 1);
  if (!program)
    return (
      <section className="p-6">
        <h1 className="text-xl font-semibold">{draft.name}</h1>
        <p className="my-4">
          La ricetta non è ancora eseguibile. Completa i passi nell’editor del modulo
          prima di modificarne il programma.
        </p>
        <button className={button} onClick={onCancel}>
          Torna ai moduli
        </button>
      </section>
    );
  const profile = program.profile;
  const patch = (values: Partial<ModuleProgram["profile"]>) =>
    setProgram({ ...program, profile: { ...profile, ...values } });
  const allowedOps = STEP_CATEGORIES.flatMap((category) => category.ops).filter((op) =>
    instructionFitsModule(op, profile),
  );
  const rgbRows = [
    ...new Set(
      [...profile.initOps, ...profile.sampleOps, ...profile.safeStopOps].flatMap(
        (op) =>
          op.op === "RGB_PROGRAM"
            ? Array.from({ length: op.length / 6 }, (_, i) => op.offset + i * 6)
            : [],
      ),
    ),
  ];
  const slices = profile.actions ?? [];
  const action = slices.find((item) => item.id === selected);
  function replaceAction(id: number, steps: readonly Instruction[]) {
    const sampleOps: Instruction[] = [];
    const actions = slices.map((item) => {
      const list =
        item.id === id
          ? steps
          : profile.sampleOps.slice(item.first, item.first + item.count);
      const result = { ...item, first: sampleOps.length, count: list.length };
      sampleOps.push(...list);
      return result;
    });
    patch({ sampleOps, actions });
  }
  function save() {
    try {
      const next = synchronizeModuleProgram({
        ...draft,
        moduleProgram: program!,
        status: "ready",
        updatedAt: Date.now(),
        verification: {
          status: "untested" as const,
          note: "Ricetta modificata: da verificare sul dispositivo.",
        },
      });
      compileModuleProgram(
        next,
        new Map(program!.signals.map((signal, index) => [signal, index])),
        new Map(),
      );
      onSave(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-brand-blue">Crea modulo · ricetta eseguibile</p>
          <input
            aria-label="Nome modulo"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="mt-1 bg-transparent text-2xl font-semibold outline-none"
          />
        </div>
        <div className="flex gap-2">
          <button className={button} onClick={onCancel}>
            <X size={16} />
            Annulla
          </button>
          <button
            className={button}
            onClick={() => onDuplicate({ ...draft, moduleProgram: program })}
          >
            <Copy size={16} />
            Duplica
          </button>
          <button className={`${button} bg-brand-blue text-white`} onClick={save}>
            <Save size={16} />
            Salva modulo
          </button>
        </div>
      </header>
      <p className="mb-4 text-sm text-ink-muted">
        Le modifiche salvano la ricetta in libreria. I moduli già nel canvas e i
        programmi caricati mantengono la propria copia.
      </p>
      <nav className="mb-5 flex gap-2" aria-label="Sezioni modulo">
        {[
          ["init", "Inizializzazione"],
          ["actions", "Azioni"],
          ["io", "Input / Output"],
          ["signals", "Segnali hardware"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id!)}
            className={`${button} ${tab === id ? "border-brand-blue bg-brand-blue/10 text-brand-blue" : ""}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <details className="mb-4 rounded-xl border border-border p-3 text-sm">
        <summary>Limiti e dati del programma</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            ["maxTotalTimeMs", "Tempo massimo (ms)"],
            ["maxTransactions", "Transazioni massime"],
            ["maxBytes", "Byte massimi"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                className={field}
                type="number"
                min={1}
                value={profile[key as "maxTotalTimeMs"]}
                onChange={(e) => patch({ [key!]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Massimo 16 istruzioni di inizializzazione, 16 nelle azioni e 8 azioni per
          profilo. I limiti vengono verificati al salvataggio.
        </p>
        {!!profile.messageData?.length && (
          <label className="mt-3 block">
            Dati del protocollo (byte esadecimali)
            <textarea
              className={`${field} font-mono`}
              value={profile.messageData
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join(" ")}
              onChange={(e) => {
                const tokens = e.target.value.trim().split(/\s+/);
                if (tokens.every((token) => /^[0-9a-f]{2}$/i.test(token)))
                  patch({ messageData: tokens.map((token) => parseInt(token, 16)) });
              }}
            />
          </label>
        )}
      </details>
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-error/10 p-3 text-error">
          {error}
        </p>
      )}
      {tab === "init" && (
        <div className="space-y-4">
          <InstructionSection
            signalNames={program.signals.map(
              (id) =>
                draft.binding.gpioSignals.find((signal) => signal.id === id)?.name ??
                id,
            )}
            allowedOps={allowedOps}
            title="All’avvio del modulo"
            steps={profile.initOps}
            onChange={(initOps) => patch({ initOps })}
          />
          <InstructionSection
            signalNames={program.signals.map(
              (id) =>
                draft.binding.gpioSignals.find((signal) => signal.id === id)?.name ??
                id,
            )}
            allowedOps={allowedOps}
            title="Arresto sicuro"
            steps={profile.safeStopOps}
            onChange={(safeStopOps) => patch({ safeStopOps })}
          />
        </div>
      )}
      {tab === "actions" && (
        <div className="grid gap-5 md:grid-cols-[240px_1fr]">
          <aside className="space-y-2">
            {slices.map((item) => {
              const command = draft.commands.find(
                (command) => program.actions[command.id]?.commandId === item.id,
              );
              return (
                <button
                  key={item.id}
                  onClick={() => setSelected(item.id)}
                  className={`${button} w-full text-left ${selected === item.id ? "border-brand-blue bg-brand-blue/10" : ""}`}
                >
                  {command?.label ?? `Ingresso ${item.id}`}
                </button>
              );
            })}
            <button
              className={`${button} w-full`}
              disabled={slices.length >= 8}
              onClick={() => {
                const command = createNamedAction({
                  label: `Azione ${slices.length + 1}`,
                  name: `azione_${slices.length + 1}`,
                });
                const id = Math.max(0, ...slices.map((item) => item.id)) + 1;
                if (id > 8) {
                  setError("Il firmware supporta al massimo 8 azioni.");
                  return;
                }
                const inputId = `trigger-${command.id}`;
                setDraft({
                  ...draft,
                  commands: [...draft.commands, command],
                  ...(draft.rgbModule
                    ? {
                        rgbModule: {
                          ...draft.rgbModule,
                          actions: [
                            ...draft.rgbModule.actions,
                            {
                              id: command.id,
                              name: command.label,
                              steps: [
                                { id: `${command.id}-native`, kind: "off" as const },
                              ],
                            },
                          ],
                          inputs: [
                            ...draft.rgbModule.inputs,
                            {
                              id: inputId,
                              name: command.label,
                              mode: "trigger" as const,
                              actionId: command.id,
                              edge: "rising" as const,
                            },
                          ],
                        },
                        channels: [
                          ...draft.channels,
                          {
                            id: inputId,
                            label: command.label,
                            direction: "write" as const,
                            inputMode: "trigger" as const,
                            dataType: "bool" as const,
                            quantity: "digital" as const,
                            unit: "",
                          },
                        ],
                      }
                    : {}),
                });
                setProgram({
                  ...program,
                  ...(draft.rgbModule
                    ? {
                        rgbInputs: {
                          ...program.rgbInputs,
                          [inputId]: { commandId: id, mode: 1 },
                        },
                      }
                    : {}),
                  actions: {
                    ...program.actions,
                    [command.id]: { commandId: id, inputIds: {}, outputIds: {} },
                  },
                  profile: {
                    ...profile,
                    actions: [
                      ...slices,
                      { id, first: profile.sampleOps.length, count: 1 },
                    ],
                    sampleOps: [...profile.sampleOps, { op: "EMIT_RECORD" }],
                  },
                });
                setSelected(id);
              }}
            >
              <Plus size={16} />
              Aggiungi azione
            </button>
          </aside>
          <section className="min-w-0 space-y-4">
            {action && (
              <>
                {draft.commands
                  .filter(
                    (command) => program.actions[command.id]?.commandId === action.id,
                  )
                  .map((command) => (
                    <input
                      key={command.id}
                      aria-label="Nome azione"
                      value={command.label}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          commands: draft.commands.map((item) =>
                            item.id === command.id
                              ? { ...item, label: e.target.value }
                              : item,
                          ),
                        })
                      }
                      className={field}
                    />
                  ))}
                <InstructionSection
                  signalNames={program.signals.map(
                    (id) =>
                      draft.binding.gpioSignals.find((signal) => signal.id === id)
                        ?.name ?? id,
                  )}
                  allowedOps={allowedOps}
                  key={action.id}
                  title="Passi dell’azione"
                  steps={profile.sampleOps.slice(
                    action.first,
                    action.first + action.count,
                  )}
                  onChange={(steps) => replaceAction(action.id, steps)}
                />
                <p className="text-xs text-ink-muted">
                  Le operazioni con tempi elettrici precisi, come la lettura DS18B20,
                  vengono eseguite in modo atomico dal firmware.
                </p>
              </>
            )}
          </section>
        </div>
      )}
      {tab === "actions" && rgbRows.length > 0 && (
        <section className="mt-5 space-y-3 rounded-xl border border-border p-4">
          <h2 className="font-semibold">Passi colore del modulo</h2>
          <p className="text-sm text-ink-muted">
            Questi passi sono richiamati dalle azioni RGB e dall’inizializzazione.
          </p>
          {rgbRows.map((offset) => {
            const bytes = profile.messageData ?? [];
            const kind = bytes[offset] ?? 0;
            const value =
              (bytes[offset + 2] ?? 0) |
              ((bytes[offset + 3] ?? 0) << 8) |
              ((bytes[offset + 4] ?? 0) << 16);
            return (
              <div
                key={offset}
                className="flex items-center gap-3 rounded-lg bg-surface-raised p-3 text-sm"
              >
                <span className="flex-1">
                  {[
                    "Spegni",
                    "Accendi",
                    "Applica colore",
                    "Applica variabile colore",
                    "Leggi colore dal buffer",
                    "Colore iniziale della variabile",
                    "Imposta canale RGB",
                    "Leggi colore dal parametro",
                  ][kind] ?? "Passo colore"}{" "}
                  · {offset / 6 + 1}
                </span>
                {(kind === 2 || kind === 5) && (
                  <input
                    aria-label={`Colore del passo ${offset / 6 + 1}`}
                    type="color"
                    value={`#${value.toString(16).padStart(6, "0")}`}
                    onChange={(e) => {
                      const next = [...bytes];
                      const color = parseInt(e.target.value.slice(1), 16);
                      for (let i = 0; i < 3; i++)
                        next[offset + 2 + i] = (color >> (i * 8)) & 255;
                      patch({ messageData: next });
                    }}
                  />
                )}
              </div>
            );
          })}
        </section>
      )}
      {tab === "io" && (
        <section className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Ingressi delle azioni</h2>
            <button
              className={button}
              onClick={() => {
                try {
                  const next = synchronizeModuleProgram({
                    ...draft,
                    moduleProgram: program,
                  });
                  setDraft(next);
                  setProgram(next.moduleProgram!);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            >
              Aggiorna porte dai passi
            </button>
          </div>
          {draft.channels.map((channel) => (
            <label key={channel.id} className="my-2 flex items-center gap-3 text-sm">
              <span>
                {channel.direction === "write" ? "Ingresso" : "Uscita"} · {channel.id}
              </span>
              <input
                aria-label={`Nome porta ${channel.id}`}
                className={field}
                value={channel.label}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    channels: draft.channels.map((item) =>
                      item.id === channel.id
                        ? { ...item, label: e.target.value }
                        : item,
                    ),
                  })
                }
              />
            </label>
          ))}
          <p className="my-2 text-sm text-ink-muted">
            Ogni azione espone un’attivazione. I parametri vengono letti dal passo
            “Parametro azione”, usando l’identificatore indicato.
          </p>
          {Object.entries(program.actions).map(([id, entry]) => (
            <div key={id} className="my-3 rounded-lg bg-surface-raised p-3 text-sm">
              <strong>
                {draft.commands.find((item) => item.id === id)?.label ?? id}
              </strong>
              {Object.entries(entry.inputIds).map(([name, key]) => (
                <p key={name}>
                  {name} · parametro {key}
                </p>
              ))}
              {Object.entries(entry.outputIds).map(([name, key]) => (
                <p key={name}>
                  {name} · uscita {key}
                </p>
              ))}
            </div>
          ))}
          <h2 className="mt-5 font-semibold">Uscite pubblicate</h2>
          <OutputTab
            schemaId={profile.sampleSchemaId}
            schemaVersion={profile.sampleSchemaVersion}
            fields={profile.sampleFields}
            onSchemaId={(sampleSchemaId) => patch({ sampleSchemaId })}
            onSchemaVersion={(sampleSchemaVersion) => patch({ sampleSchemaVersion })}
            onFields={(sampleFields) => patch({ sampleFields })}
          />
        </section>
      )}
      {tab === "signals" && (
        <section className="space-y-3 rounded-xl border border-border p-5">
          <label className="block text-sm">
            Periferica
            <select
              aria-label="Periferica del modulo"
              value={draft.binding.bus}
              className={field}
              onChange={(e) => {
                const next = createModuleProgramDraft(
                  e.target.value as DeviceRecipeBus,
                );
                setDraft({ ...next, id: draft.id, name: draft.name });
                setProgram(next.moduleProgram!);
                setSelected(1);
              }}
            >
              {["i2c", "gpio", "spi", "uart", "adc", "w1"].map((bus) => (
                <option key={bus} value={bus}>
                  {bus.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-ink-muted">
            Cambiare periferica prepara una nuova sequenza vuota. Per conservare questa
            ricetta, duplicala prima.
          </p>
          {draft.binding.bus === "i2c" && (
            <label className="block text-sm">
              Indirizzo I²C
              <input
                aria-label="Indirizzo I2C"
                className={field}
                value={draft.binding.i2c?.address ?? "0x48"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    binding: {
                      ...draft.binding,
                      i2c: { ...draft.binding.i2c!, address: e.target.value },
                    },
                  })
                }
              />
            </label>
          )}
          {draft.binding.bus === "w1" && (
            <label className="block text-sm">
              ROM 1-Wire
              <input
                aria-label="ROM 1-Wire"
                className={field}
                value={draft.binding.w1?.rom ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    binding: {
                      ...draft.binding,
                      w1: { ...draft.binding.w1!, rom: e.target.value },
                    },
                  })
                }
              />
            </label>
          )}
          {draft.binding.bus === "gpio" &&
            draft.binding.gpioSignals.map((signal, index) => (
              <label key={signal.id} className="block text-sm">
                {signal.name}
                <select
                  aria-label={`Tipo segnale ${signal.name}`}
                  value={signal.signalType ?? "digital_output"}
                  className={field}
                  onChange={(e) => {
                    const type = e.target.value as
                      "digital_input" | "digital_output" | "pwm_output";
                    const signals = draft.binding.gpioSignals.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            signalType: type,
                            direction:
                              type === "digital_input"
                                ? ("in" as const)
                                : ("out" as const),
                          }
                        : item,
                    );
                    const caps = signals.reduce(
                      (value, item) =>
                        value |
                        (item.signalType === "pwm_output"
                          ? PortCapability.PWM
                          : item.direction === "in"
                            ? PortCapability.DIGITAL_INPUT
                            : PortCapability.DIGITAL_OUTPUT),
                      0,
                    );
                    setDraft({
                      ...draft,
                      binding: { ...draft.binding, gpioSignals: signals },
                    });
                    patch({ requiredCapabilities: caps });
                  }}
                >
                  <option value="digital_input">Ingresso digitale</option>
                  <option value="digital_output">Uscita digitale</option>
                  <option value="pwm_output">Uscita PWM</option>
                </select>
              </label>
            ))}
          {draft.binding.bus === "gpio" && program.signals.length < 4 && (
            <button
              className={button}
              onClick={() => {
                const id = `SIGNAL_${program.signals.length + 1}`;
                setDraft({
                  ...draft,
                  binding: {
                    ...draft.binding,
                    gpioSignals: [
                      ...draft.binding.gpioSignals,
                      {
                        id,
                        name: id,
                        identifier: id,
                        direction: "out",
                        signalType: "digital_output",
                        role: "generic",
                        pinLabel: "",
                        pull: "none",
                        activeLow: false,
                      },
                    ],
                  },
                });
                setProgram({
                  ...program,
                  signals: [...program.signals, id],
                  profile: {
                    ...profile,
                    requiredCapabilities:
                      profile.requiredCapabilities | PortCapability.DIGITAL_OUTPUT,
                  },
                });
              }}
            >
              Aggiungi segnale
            </button>
          )}
          <h2 className="font-semibold">
            {draft.binding.bus.toUpperCase()} · segnali richiesti
          </h2>
          <p className="text-sm text-ink-muted">
            I canali dei passi si riferiscono ai segnali qui sotto. I pin fisici si
            assegnano quando aggiungi il modulo alla Backbone.
          </p>
          {program.signals.map((id, index) => (
            <p key={id} className="rounded-lg bg-surface-raised p-3 text-sm">
              Canale {index} ·{" "}
              {draft.binding.gpioSignals.find((signal) => signal.id === id)?.name ?? id}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
