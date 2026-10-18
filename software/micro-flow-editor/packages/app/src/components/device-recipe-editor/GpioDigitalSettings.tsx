import {
  renameRecipeVariable,
  type DeviceRecipeDraft,
} from "../../lib/device-recipe-draft.js";
import { createGpioDigitalDriver } from "../../lib/gpio-driver-presets.js";
import { gpioSignalType } from "../../lib/gpio-operation-registry.js";
import { GpioSignalsPanel } from "./GpioDriverPanels.js";

export function GpioDigitalSettings({
  draft,
  it,
  onChange,
}: {
  draft: DeviceRecipeDraft;
  it: boolean;
  onChange: (draft: DeviceRecipeDraft) => void;
}) {
  const signal = draft.binding.gpioSignals[0];
  if (draft.binding.gpioSignals.length > 1 || (signal && !["digital_input", "digital_output"].includes(gpioSignalType(signal))))
    return <GpioSignalsPanel draft={draft} it={it} onChange={onChange} />;
  const output = signal && gpioSignalType(signal) === "digital_output";
  const initialize = (direction: "in" | "out") =>
    onChange({ ...createGpioDigitalDriver(draft.name, direction), id: draft.id });
  const startup = draft.phases.init.find(
    (op) => op.type === "gpio_write" && op.signalId === signal?.id,
  );
  return (
    <section className="mb-4 rounded-slmd border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3 font-body text-xs text-ink">
        <strong>{it ? "GPIO digitale" : "Digital GPIO"}</strong>
        {!signal ? (
          <>
            <button type="button" onClick={() => initialize("out")}>
              {it ? "+ Uscita digitale" : "+ Digital output"}
            </button>
            <button type="button" onClick={() => initialize("in")}>
              {it ? "+ Ingresso digitale" : "+ Digital input"}
            </button>
          </>
        ) : (
          <>
            <label>
              {it ? "Modalità" : "Mode"}{" "}
              <select
                aria-label={it ? "Modalità GPIO" : "GPIO mode"}
                value={output ? "out" : "in"}
                className="rounded-slsm border border-border-strong bg-surface px-2 py-1.5"
                onChange={(event) => {
                  const direction = event.target.value as "in" | "out";
                  if (
                    signal.id === "DATA" &&
                    draft.commands.every((command) =>
                      ["high", "low", "follow", "read"].includes(command.name),
                    )
                  ) {
                    let next = createGpioDigitalDriver(draft.name, direction);
                    const variable = draft.variables[0];
                    if (variable)
                      next = renameRecipeVariable(
                        next,
                        next.variables[0]!.id,
                        variable.name,
                      );
                    onChange({
                      ...next,
                      id: draft.id,
                      variables: variable ? draft.variables : next.variables,
                      commands: next.commands.map((command) => ({
                        ...command,
                        id:
                          draft.commands.find((item) => item.name === command.name)
                            ?.id ?? command.id,
                      })),
                      channels: next.channels.map(
                        (channel) =>
                          draft.channels.find((item) => item.id === channel.id) ??
                          channel,
                      ),
                    });
                    return;
                  }
                  // Custom actions remain visible, including any writes requiring correction.
                  onChange({
                    ...draft,
                    binding: {
                      ...draft.binding,
                      gpioSignals: [
                        {
                          ...signal,
                          direction,
                          signalType:
                            direction === "out" ? "digital_output" : "digital_input",
                          activeLow: false,
                          requirements:
                            direction === "out"
                              ? { writable: true, readable: true }
                              : { readable: true },
                        },
                      ],
                    },
                    phases: {
                      ...draft.phases,
                      init:
                        direction === "in"
                          ? draft.phases.init.filter((op) => op.type !== "gpio_write")
                          : draft.phases.init,
                    },
                  });
                }}
              >
                <option value="out">{it ? "Uscita digitale" : "Digital output"}</option>
                <option value="in">{it ? "Ingresso digitale" : "Digital input"}</option>
              </select>
            </label>
            {output && (
              <label>
                {it ? "All’avvio" : "At startup"}{" "}
                <select
                  aria-label={it ? "Stato iniziale GPIO" : "Initial GPIO state"}
                  className="rounded-slsm border border-border-strong bg-surface px-2 py-1.5"
                  value={startup?.type === "gpio_write" ? startup.level : 0}
                  onChange={(event) => {
                    const level = Number(event.target.value) as 0 | 1;
                    const op = {
                      id: startup?.id ?? `op-${crypto.randomUUID()}`,
                      type: "gpio_write" as const,
                      signalId: signal.id,
                      level,
                    };
                    onChange({
                      ...draft,
                      binding: {
                        ...draft.binding,
                        gpioSignals: [
                          {
                            ...signal,
                            configuration: {
                              ...signal.configuration,
                              initialState: level,
                            },
                          },
                        ],
                      },
                      phases: {
                        ...draft.phases,
                        init: startup
                          ? draft.phases.init.map((item) =>
                              item.id === startup.id ? op : item,
                            )
                          : [op, ...draft.phases.init],
                      },
                    });
                  }}
                >
                  <option value={0}>LOW · 0</option>
                  <option value={1}>HIGH · 1</option>
                </select>
              </label>
            )}
            <span className="text-ink-muted">
              {it
                ? "Pin e alimentazione si assegnano nel Module Function."
                : "Assign pins and power in Module Function."}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
