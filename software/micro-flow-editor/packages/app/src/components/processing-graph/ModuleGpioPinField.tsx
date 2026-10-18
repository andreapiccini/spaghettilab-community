import {
  runtimeDigitalOutputPins,
  parsePhysicalProject,
  PHYSICAL_META_KEY,
} from "../../lib/backbone-physical.js";
import {
  assignModuleGpioPin,
  BACKBONE_SENSOR_MODULES_META_KEY,
  gpioAssignmentValue,
  isGpioModule,
  parseBackboneSensorModules,
  parseGpioAssignment,
  type BackboneSensorModule,
} from "../../lib/backbone-sensor-modules.js";
import { useSession } from "../../state/session-context.js";

export function ModuleGpioPinField({
  module,
  bindingId,
  it,
}: {
  readonly module: BackboneSensorModule;
  readonly bindingId: string;
  readonly it: boolean;
}) {
  const { session, execute, navigate } = useSession();
  if (!isGpioModule(module)) return null;

  const pins = runtimeDigitalOutputPins(
    parsePhysicalProject(session?.stack.current.authoringMetadata[PHYSICAL_META_KEY]?.comment)
      .drafts,
    bindingId,
  );
  const signal =
    module.recipe.deviceDraft?.binding.gpioSignals[0]?.name ??
    module.recipe.pins.find((pin) => pin.role.toUpperCase() !== "VCC" && pin.role.toUpperCase() !== "GND")
      ?.role ??
    "RELAY";

  return (
    <section>
      <h3 className="mb-1.5 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
        {it ? "Pin GPIO" : "GPIO pin"}
      </h3>
      <label className="flex flex-col gap-1.5 font-body text-sm text-ink">
        <span>
          {it ? "Collega" : "Wire"} <span className="font-mono">{signal}</span>{" "}
          {it ? "a" : "to"}
        </span>
        <select
          aria-label={it ? "Pin GPIO del relè" : "Relay GPIO pin"}
          className="rounded-slsm border border-border-strong bg-surface px-2 py-2"
          value={gpioAssignmentValue(module.gpioAssignment)}
          disabled={!execute}
          onChange={(event) => {
            const assignment = parseGpioAssignment(event.target.value);
            execute?.({
              kind: "AssignGpioDriverPin",
              apply: (current) => ({
                ok: true,
                value: {
                  ...current,
                  authoringMetadata: {
                    ...current.authoringMetadata,
                    [BACKBONE_SENSOR_MODULES_META_KEY]: {
                      comment: JSON.stringify(
                        assignModuleGpioPin(
                          parseBackboneSensorModules(
                            current.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
                          ),
                          bindingId,
                          module.id,
                          assignment,
                        ),
                      ),
                    },
                  },
                },
              }),
            });
          }}
        >
          <option value="">{pins.length ? (it ? "Scegli pin" : "Choose pin") : "—"}</option>
          {pins.map((pin) => (
            <option key={`${pin.boardKey}:${pin.channel}`} value={`${pin.boardKey}:${pin.channel}`}>
              {pin.label}
            </option>
          ))}
        </select>
      </label>
      {!pins.length && (
        <p className="mt-2 font-body text-xs text-ink-muted">
          {it
            ? "Nessun GPIO OUT in Module Function. Configura un pin digitale e applica, poi ripeti."
            : "No GPIO OUT in Module Function. Configure a digital pin, apply, then come back."}
        </p>
      )}
      <button
        type="button"
        onClick={() => navigate("physical-composition")}
        className="mt-2 font-body text-xs font-semibold text-brand-blue hover:underline"
      >
        {it ? "Apri Module Function" : "Open Module Function"}
      </button>
    </section>
  );
}
