import { useSession } from "../../state/session-context.js";
import { useLocale } from "../../state/locale-context.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  modulesForBinding,
  parseBackboneSensorModules,
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
    <section className="rounded-slmd border border-border bg-surface p-4">
      <h3 className="font-heading text-sm font-semibold text-ink">
        {it ? "Dispositivi GPIO" : "GPIO devices"}
      </h3>
      <p className="mt-1 text-xs text-ink-muted">
        {it
          ? "Associa DATA al pin configurato. Applica la configurazione prima di avviare il Flow."
          : "Assign DATA to a configured pin. Apply the configuration before running the Flow."}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {modules.map((module) => {
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
              className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink"
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
