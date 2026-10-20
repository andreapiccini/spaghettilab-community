import { Ds18b20Configuration } from "./Ds18b20Configuration.js";
import {
  functionVariantOf,
  formatPinLabel,
  modeIndexToPinId,
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

  if (module.recipe.deviceDraft?.temperatureSensorModel === "ds18b20")
    return <Ds18b20Configuration key={module.id} module={module} bindingId={bindingId} />;

  const savedPhysical = parsePhysicalProject(
    session?.stack.current.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  const multiPhysical = module.gpioAssignments
    ? savedPhysical.drafts[module.gpioAssignments.boardKey]
    : undefined;
  const draft = module.recipe.deviceDraft;
  const stepper = draft?.commands.some((action) =>
    action.steps.some((step) => step.type === "stepper"),
  );
  const title =
    draft?.temperatureSensorModel === "ds18b20"
      ? draft.ds18b20PowerMode === "gpio"
        ? "DS18B20 · DATA / VCC"
        : "DS18B20 · DATA / alimentazione parassita"
      : draft?.dht22Module
        ? `${draft.name} · DATA / Alimentazione`
        : draft?.rgbModule
          ? "LED RGB · R / G / B"
          : stepper
            ? "ULN2003 · IN1–IN4"
            : `${module.label} · GPIO`;
  const description =
    draft?.temperatureSensorModel === "ds18b20"
      ? draft.ds18b20PowerMode === "gpio"
        ? "DATA A0, VCC A1, GND comune. Il driver mantiene A1 HIGH durante la lettura e lo spegne allo Stop generale."
        : "DATA usa A0 per segnale e alimentazione parassita. VDD e GND vanno a massa; pull-up DATA–3,3 V. Un sensore per pin, conversione 750 ms. Verificare la schedina con LED e R1 prima del cablaggio."
      : draft?.dht22Module
        ? "DATA è il segnale del sensore; POWER alimenta il modulo con un GPIO HIGH fisso. Collega anche GND alla massa comune. Il fronte di salita avvia una lettura; il driver rispetta automaticamente i 2 secondi di avvio e tra acquisizioni."
        : draft?.rgbModule
          ? "Tre uscite PWM per rosso, verde e blu. Il pin comune deve corrispondere alla polarità scelta nell’inizializzazione."
          : stepper
            ? "Posizione 0–360° rispetto allo zero all’avvio. Invia un intero all’ingresso Posizione quando è selezionata «Vai a posizione»."
            : "Collegamenti GPIO del dispositivo. Puoi modificarli in Module Function.";
  if (module.gpioAssignments)
    return (
      <section className="rounded-xl border border-border p-3 font-body text-sm">
        <h3 className="mb-2 font-semibold">{title}</h3>
        <dl>
          {Object.entries(module.gpioAssignments.channels).map(([signal, channel]) => (
            <div key={signal} className="flex justify-between py-1">
              <dt>
                {draft?.binding.gpioSignals.find((item) => item.id === signal)?.name ??
                  signal}
              </dt>
              <dd className="font-mono text-brand-blue">
                {multiPhysical
                  ? formatPinLabel(
                      modeIndexToPinId(channel, functionVariantOf(multiPhysical)),
                      functionVariantOf(multiPhysical),
                    )
                  : `A${channel}`}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-ink-muted">{description}</p>
        <button
          className="mt-2 text-xs text-brand-blue"
          onClick={() => navigate("physical-composition")}
        >
          Apri Module Function
        </button>
      </section>
    );

  const pins = runtimeDigitalOutputPins(
    parsePhysicalProject(
      session?.stack.current.authoringMetadata[PHYSICAL_META_KEY]?.comment,
    ).drafts,
    bindingId,
  );
  const signal =
    module.recipe.deviceDraft?.binding.gpioSignals[0]?.name ??
    module.recipe.pins.find(
      (pin) => pin.role.toUpperCase() !== "VCC" && pin.role.toUpperCase() !== "GND",
    )?.role ??
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
          aria-label={it ? "Pin GPIO del dispositivo" : "Device GPIO pin"}
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
                            current.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]
                              ?.comment,
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
          <option value="">
            {pins.length ? (it ? "Scegli pin" : "Choose pin") : "—"}
          </option>
          {pins.map((pin) => (
            <option
              key={`${pin.boardKey}:${pin.channel}`}
              value={`${pin.boardKey}:${pin.channel}`}
            >
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
