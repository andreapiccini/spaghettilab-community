import { useSession } from "../../state/session-context.js";
import { useLocale } from "../../state/locale-context.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  modulesForBinding,
  parseBackboneSensorModules,
  reassignGpioSignal,
} from "../../lib/backbone-sensor-modules.js";
import {
  PHYSICAL_META_KEY,
  parsePhysicalProject,
  formatPinLabel,
  modeIndexToPinId,
  functionVariantOf,
} from "../../lib/backbone-physical.js";
import { gpioSignalType } from "../../lib/gpio-operation-registry.js";

export function GpioDriverAssignments({
  bindingId,
  boardKey,
}: {
  bindingId: string;
  boardKey: string;
}) {
  const { session, execute } = useSession();
  const { locale } = useLocale();
  const it = locale === "it";
  const project = session?.stack.current;
  const physical = parsePhysicalProject(
    project?.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  const config = physical.drafts[boardKey];
  const stored = parseBackboneSensorModules(
    project?.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
  );
  const modules = modulesForBinding(stored, bindingId).filter(
    (module) => module.recipe.deviceDraft?.binding.bus === "gpio",
  );
  if (!modules.length || !config) return null;
  return (
    <section className="border-b border-border bg-surface px-3 py-2">
      <h3 className="font-heading text-sm font-semibold text-ink">
        {it ? "Dispositivi GPIO" : "GPIO devices"}
      </h3>
      <p className="mt-1 text-[10px] text-ink-muted">
        {it
          ? "Associa i segnali ai pin configurati."
          : "Assign signals to configured pins."}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {modules.map((module) => {
          if (module.gpioAssignments) {
            if (module.gpioAssignments.boardKey !== boardKey) return null;
            return (
              <div
                key={module.id}
                className="rounded-xl border border-border bg-surface-sunken/40 p-2 text-[11px] text-ink"
              >
                <strong>
                  {module.label} · {Object.keys(module.gpioAssignments.channels).length}{" "}
                  {it ? "segnali" : "signals"}
                </strong>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {Object.entries(module.gpioAssignments.channels).map(
                    ([signal, channel]) => (
                      <div key={signal} className="flex justify-between">
                        <dt>{signal}</dt>
                        <dd className="font-mono text-brand-blue">
                          <select
                            aria-label={`${module.label} ${signal}`}
                            className="rounded-md border border-border-strong bg-surface px-2 py-1 font-mono text-brand-blue"
                            value={channel}
                            onChange={(event) => {
                              const nextChannel = Number(event.target.value);
                              execute?.({
                                kind: "AssignGpioDriverSignalPin",
                                apply: (current) => {
                                  const latest = parseBackboneSensorModules(
                                    current.authoringMetadata[
                                      BACKBONE_SENSOR_MODULES_META_KEY
                                    ]?.comment,
                                  );
                                  const next = {
                                    ...latest,
                                    byBinding: {
                                      ...latest.byBinding,
                                      [bindingId]: modulesForBinding(
                                        latest,
                                        bindingId,
                                      ).map((item) =>
                                        item.id === module.id && item.gpioAssignments
                                          ? {
                                              ...item,
                                              gpioAssignments: {
                                                ...item.gpioAssignments,
                                                channels: reassignGpioSignal(
                                                  item.gpioAssignments.channels,
                                                  signal,
                                                  nextChannel,
                                                ),
                                              },
                                            }
                                          : item,
                                      ),
                                    },
                                  };
                                  return {
                                    ok: true,
                                    value: {
                                      ...current,
                                      authoringMetadata: {
                                        ...current.authoringMetadata,
                                        [BACKBONE_SENSOR_MODULES_META_KEY]: {
                                          comment: JSON.stringify(next),
                                        },
                                      },
                                    },
                                  };
                                },
                              });
                            }}
                          >
                            {config.modes.slice(0, 4).map((mode, candidate) => {
                              const compatible = module.recipe.deviceDraft?.rgbModule
                                ? (mode & 15) === 12
                                : module.recipe.deviceDraft?.dht22Module && signal === "DATA" ? (mode & 15) === 1 : [2, 3].includes(mode & 15);
                              const reserved = modules.some(
                                (other) =>
                                  other.id !== module.id &&
                                  ((other.gpioAssignment?.boardKey === boardKey &&
                                    other.gpioAssignment.channel === candidate) ||
                                    (other.gpioAssignments?.boardKey === boardKey &&
                                      Object.values(
                                        other.gpioAssignments.channels,
                                      ).includes(candidate))),
                              );
                              if (!compatible && candidate !== channel) return null;
                              return (
                                <option
                                  key={candidate}
                                  value={candidate}
                                  disabled={reserved || !compatible}
                                >
                                  {formatPinLabel(
                                    modeIndexToPinId(
                                      candidate,
                                      functionVariantOf(config),
                                    ),
                                    functionVariantOf(config),
                                  )}
                                </option>
                              );
                            })}
                          </select>
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </div>
            );
          }
          const signal = module.recipe.deviceDraft!.binding.gpioSignals[0];
          if (!signal) return null;
          const output = gpioSignalType(signal) === "digital_output";
          const selected =
            module.gpioAssignment?.boardKey === boardKey
              ? String(module.gpioAssignment.channel)
              : "";
          return (
            <label
              key={module.id}
              className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink"
            >
              <span>
                {module.label} · {signal.name}
              </span>
              <select
                aria-label={`${module.label} DATA`}
                className="rounded-slsm border border-border-strong bg-surface px-2 py-2"
                value={selected}
                onChange={(event) => {
                  const channel =
                    event.target.value === "" ? undefined : Number(event.target.value);
                  execute?.({
                    kind: "AssignGpioDriverPin",
                    apply: (current) => {
                      const latest = parseBackboneSensorModules(
                        current.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]
                          ?.comment,
                      );
                      const next = {
                        ...latest,
                        byBinding: {
                          ...latest.byBinding,
                          [bindingId]: modulesForBinding(latest, bindingId).map(
                            (item) =>
                              item.id === module.id
                                ? {
                                    ...item,
                                    gpioAssignment:
                                      channel === undefined
                                        ? undefined
                                        : { boardKey, channel },
                                  }
                                : item,
                          ),
                        },
                      };
                      return {
                        ok: true,
                        value: {
                          ...current,
                          authoringMetadata: {
                            ...current.authoringMetadata,
                            [BACKBONE_SENSOR_MODULES_META_KEY]: {
                              comment: JSON.stringify(next),
                            },
                          },
                        },
                      };
                    },
                  });
                }}
              >
                <option value="">
                  {it ? "Automatico (se univoco)" : "Automatic (if unique)"}
                </option>
                {config.modes.slice(0, 4).map(
                  (mode, channel) =>
                    (output ? [2, 3].includes(mode & 15) : (mode & 15) === 1) && (
                      <option key={channel} value={channel}>
                        {formatPinLabel(
                          modeIndexToPinId(channel, functionVariantOf(config)),
                          functionVariantOf(config),
                        )}{" "}
                        · {output ? "OUT" : "IN"}
                      </option>
                    ),
                )}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}
