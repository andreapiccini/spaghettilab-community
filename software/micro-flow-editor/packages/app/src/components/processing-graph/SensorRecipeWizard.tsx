import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  CircuitBoard,
  Cpu,
  Droplets,
  Gauge,
  Binary,
  Radio,
  Ruler,
  Sun,
  Thermometer,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import {
  blankSensorRecipe,
  describeStep,
  recipeChannels,
  withChannels,
  type SensorBus,
  type SensorChannel,
  type SensorOutputKind,
  type SensorRecipe,
} from "../../lib/sensor-recipe.js";
import { useLocale } from "../../state/locale-context.js";
import { SensorSequenceEditor } from "./SensorSequenceEditor.js";

type WizardStep = "name" | "bus" | "channels" | "sequence";

const STEPS: readonly WizardStep[] = ["name", "bus", "channels", "sequence"];

type BusChoice = {
  readonly id: SensorBus;
  readonly icon: LucideIcon;
  readonly titleIt: string;
  readonly titleEn: string;
  readonly hintIt: string;
  readonly hintEn: string;
  readonly pins: string;
};

const BUS_CHOICES: readonly BusChoice[] = [
  {
    id: "i2c",
    icon: CircuitBoard,
    titleIt: "I2C",
    titleEn: "I2C",
    hintIt: "Due fili dati · indirizzo (BME, AHT…)",
    hintEn: "Two data wires · address (BME, AHT…)",
    pins: "VCC · GND · SDA · SCL",
  },
  {
    id: "adc",
    icon: Gauge,
    titleIt: "Analogico",
    titleEn: "Analog",
    hintIt: "Un filo segnale · potenziometro, LDR…",
    hintEn: "One signal wire · pot, LDR…",
    pins: "VCC · GND · OUT",
  },
  {
    id: "gpio",
    icon: Binary,
    titleIt: "Digitale",
    titleEn: "Digital",
    hintIt: "GPIO · pulsante, TRIG/ECHO…",
    hintEn: "GPIO · button, TRIG/ECHO…",
    pins: "SIG · GND  (+ TRIG/ECHO)",
  },
  {
    id: "uart",
    icon: Radio,
    titleIt: "UART",
    titleEn: "UART",
    hintIt: "Seriale TX/RX",
    hintEn: "Serial TX/RX",
    pins: "VCC · GND · TX · RX",
  },
];

type QuantityChoice = {
  readonly quantity: SensorOutputKind;
  readonly icon: LucideIcon;
  readonly labelIt: string;
  readonly labelEn: string;
  readonly unit: string;
  readonly id: string;
};

const QUANTITY_CHOICES: readonly QuantityChoice[] = [
  { quantity: "temperature", icon: Thermometer, labelIt: "Temperatura", labelEn: "Temperature", unit: "°C", id: "temp_c" },
  { quantity: "humidity", icon: Droplets, labelIt: "Umidità", labelEn: "Humidity", unit: "%", id: "hum_pct" },
  { quantity: "distance", icon: Ruler, labelIt: "Distanza", labelEn: "Distance", unit: "cm", id: "distance_cm" },
  { quantity: "pressure", icon: Waves, labelIt: "Pressione", labelEn: "Pressure", unit: "hPa", id: "press_hpa" },
  { quantity: "light", icon: Sun, labelIt: "Luce", labelEn: "Light", unit: "lx", id: "light" },
  { quantity: "analog", icon: Gauge, labelIt: "Livello", labelEn: "Level", unit: "%", id: "level" },
  { quantity: "digital", icon: Binary, labelIt: "On / Off", labelEn: "On / Off", unit: "on/off", id: "digital" },
];

/**
 * Graphical sensor-recipe wizard: name → bus cards → quantity chips → sequence.
 */
export function SensorRecipeWizard({
  open,
  onClose,
  onConfirm,
  defaultBus,
  initialStep: _initialStep = "name",
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (recipe: SensorRecipe) => boolean | void;
  readonly defaultBus?: SensorBus;
  /** Kept for callers; wizard always starts on the create flow. */
  readonly initialStep?: "catalog" | "manual" | "name" | "bus" | "channels" | "sequence";
}) {
  return (
    <AnimatePresence>
      {open && (
        <SensorRecipeWizardDialog
          key="sensor-recipe-wizard"
          onClose={onClose}
          onConfirm={onConfirm}
          defaultBus={defaultBus}
        />
      )}
    </AnimatePresence>
  );
}

function SensorRecipeWizardDialog({
  onClose,
  onConfirm,
  defaultBus,
}: {
  readonly onClose: () => void;
  readonly onConfirm: (recipe: SensorRecipe) => boolean | void;
  readonly defaultBus?: SensorBus;
}) {
  const { locale } = useLocale();
  const it = locale === "it";
  const [step, setStep] = useState<WizardStep>("name");
  const [chip, setChip] = useState("");
  const [bus, setBus] = useState<SensorBus>(defaultBus ?? "i2c");
  const [selectedQuantities, setSelectedQuantities] = useState<readonly SensorOutputKind[]>(["temperature"]);
  const [draft, setDraft] = useState<SensorRecipe | null>(null);

  const stepIndex = STEPS.indexOf(step);
  const wide = step === "sequence";

  const previewChannels = useMemo(() => channelsFromQuantities(selectedQuantities, it), [selectedQuantities, it]);

  function close() {
    onClose();
  }

  function confirmRecipe(recipe: SensorRecipe) {
    const ok = onConfirm(recipe);
    if (ok === false) return;
    close();
  }

  function goBus() {
    if (!chip.trim()) return;
    setStep("bus");
  }

  function goChannels() {
    setStep("channels");
  }

  function goSequence() {
    const base = blankSensorRecipe(chip.trim() || (it ? "Sensore" : "Sensor"), bus);
    const next = withChannels(base, previewChannels.length > 0 ? previewChannels : base.channels ?? []);
    setDraft(next);
    setStep("sequence");
  }

  function toggleQuantity(quantity: SensorOutputKind) {
    setSelectedQuantities((prev) => {
      if (prev.includes(quantity)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== quantity);
      }
      return [...prev, quantity];
    });
  }

  const titles: Record<WizardStep, string> = {
    name: it ? "Come si chiama?" : "What's it called?",
    bus: it ? "Come si collega?" : "How does it connect?",
    channels: it ? "Cosa misura?" : "What does it measure?",
    sequence: it ? "Come si legge?" : "How do you read it?",
  };

  const subtitles: Record<WizardStep, string> = {
    name: it ? "Il nome che vedrai sul blocco" : "The name you'll see on the block",
    bus: it ? "Tocca il tipo di collegamento" : "Tap the wiring type",
    channels: it ? "Tocca le grandezze — diventano porte del blocco" : "Tap quantities — they become block ports",
    sequence: it ? "Timeline tipo datasheet · poi salva sul canvas" : "Datasheet-style timeline · then save to canvas",
  };

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-ink/30 p-3 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionTokens.duration.fast}
    >
      <button type="button" aria-label={it ? "Chiudi" : "Close"} className="absolute inset-0 cursor-default" onClick={close} />
      <motion.div
        role="dialog"
        aria-modal
        aria-label={it ? "Nuova ricetta sensore" : "New sensor recipe"}
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={motionTokens.spring.smooth}
        className={`relative z-10 flex max-h-[min(92dvh,44rem)] w-full flex-col overflow-hidden rounded-slmd border border-border-strong bg-surface shadow-e2 ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <header className="border-b border-border px-4 pb-3 pt-3">
          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() => setStep(STEPS[stepIndex - 1]!)}
                className="rounded-slsm p-1 text-ink-faint hover:text-ink"
                aria-label={it ? "Indietro" : "Back"}
              >
                <ArrowLeft size={16} />
              </button>
            ) : (
              <Cpu size={16} className="text-brand-blue" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-base font-semibold text-ink">{titles[step]}</h2>
              <p className="truncate font-body text-[11px] text-ink-faint">{subtitles[step]}</p>
            </div>
            <button type="button" className="rounded-slsm p-1 text-ink-faint hover:text-ink" onClick={close} aria-label={it ? "Chiudi" : "Close"}>
              <X size={16} />
            </button>
          </div>
          <ol className="mt-3 flex items-center gap-1.5" aria-label={it ? "Progresso" : "Progress"}>
            {STEPS.map((item, index) => {
              const done = index < stepIndex;
              const active = index === stepIndex;
              return (
                <li key={item} className="flex flex-1 items-center gap-1.5">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                      active
                        ? "bg-brand-blue text-white"
                        : done
                          ? "bg-emerald-500/20 text-emerald-700"
                          : "bg-surface-sunken text-ink-faint"
                    }`}
                  >
                    {done ? <Check size={12} /> : index + 1}
                  </span>
                  {index < STEPS.length - 1 ? (
                    <span className={`h-0.5 flex-1 rounded-full ${done ? "bg-emerald-400/60" : "bg-border"}`} />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === "name" ? (
            <div className="flex flex-col gap-5 p-5">
              <div
                className="relative overflow-hidden rounded-slmd border border-border-strong px-4 py-6"
                style={{
                  background:
                    "linear-gradient(145deg, color-mix(in srgb, var(--color-brand-blue) 10%, var(--color-surface)) 0%, var(--color-surface-sunken) 100%)",
                }}
              >
                <p className="font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                  {it ? "Anteprima blocco" : "Block preview"}
                </p>
                <p className="mt-2 font-heading text-2xl font-semibold text-ink">
                  {chip.trim() || (it ? "Il tuo sensore" : "Your sensor")}
                </p>
                <p className="mt-1 font-body text-sm text-ink-muted">
                  {it ? "Poi scegli come si collega e cosa misura." : "Then pick wiring and what it measures."}
                </p>
              </div>
              <label className="block">
                <span className="mb-1.5 block font-body text-xs font-semibold text-ink-muted">
                  {it ? "Nome" : "Name"}
                </span>
                <input
                  autoFocus
                  value={chip}
                  onChange={(e) => setChip(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") goBus();
                  }}
                  className="w-full rounded-slmd border border-border-strong bg-surface px-4 py-3 font-heading text-lg outline-none focus:border-brand-blue"
                  placeholder={it ? "es. Sensore aula" : "e.g. Classroom sensor"}
                />
              </label>
            </div>
          ) : null}

          {step === "bus" ? (
            <div className="grid grid-cols-2 gap-2.5 p-4">
              {BUS_CHOICES.map((choice) => {
                const Icon = choice.icon;
                const active = bus === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => setBus(choice.id)}
                    className={`flex flex-col items-start gap-2 rounded-slmd border px-3 py-3 text-left transition-shadow ${
                      active
                        ? "border-brand-blue bg-brand-blue/8 shadow-e1 ring-2 ring-brand-blue/30"
                        : "border-border-strong bg-surface hover:border-brand-blue/50"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-slsm ${
                        active ? "bg-brand-blue text-white" : "bg-surface-sunken text-ink-muted"
                      }`}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="font-heading text-sm font-semibold text-ink">
                      {it ? choice.titleIt : choice.titleEn}
                    </span>
                    <span className="font-body text-[11px] leading-snug text-ink-muted">
                      {it ? choice.hintIt : choice.hintEn}
                    </span>
                    <span className="mt-auto font-mono text-[9px] uppercase tracking-wide text-ink-faint">{choice.pins}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {step === "channels" ? (
            <div className="flex flex-col gap-3 p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {QUANTITY_CHOICES.map((choice) => {
                  const Icon = choice.icon;
                  const active = selectedQuantities.includes(choice.quantity);
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => toggleQuantity(choice.quantity)}
                      className={`flex flex-col items-center gap-1.5 rounded-slmd border px-2 py-3 text-center transition-shadow ${
                        active
                          ? "border-brand-blue bg-brand-blue/8 ring-2 ring-brand-blue/25"
                          : "border-border-strong bg-surface hover:border-brand-blue/40"
                      }`}
                    >
                      <Icon size={20} className={active ? "text-brand-blue" : "text-ink-muted"} />
                      <span className="font-body text-xs font-semibold text-ink">
                        {it ? choice.labelIt : choice.labelEn}
                      </span>
                      <span className="font-mono text-[10px] text-ink-faint">{choice.unit}</span>
                    </button>
                  );
                })}
              </div>
              <p className="rounded-slsm bg-surface-sunken px-3 py-2 font-body text-[11px] text-ink-faint">
                {it
                  ? `${previewChannels.length} canale/i → porte sul blocco Flow`
                  : `${previewChannels.length} channel(s) → Flow block ports`}
              </p>
            </div>
          ) : null}

          {step === "sequence" && draft ? (
            <div className="p-4">
              <div className="mb-3 flex flex-wrap gap-1.5">
                <span className="rounded-slpill bg-surface-sunken px-2.5 py-1 font-body text-[11px] font-semibold text-ink">
                  {draft.chip}
                </span>
                <span className="rounded-slpill bg-surface-sunken px-2.5 py-1 font-mono text-[11px] text-ink-muted">
                  {draft.bus.toUpperCase()}
                </span>
                {recipeChannels(draft).map((channel) => (
                  <span key={channel.id} className="rounded-slpill bg-brand-blue/10 px-2.5 py-1 font-body text-[11px] text-brand-blue">
                    ↑ {channel.label}
                  </span>
                ))}
              </div>
              <SensorSequenceEditor recipe={draft} onChange={setDraft} />
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={close} className="rounded-slpill px-3 py-1.5 font-body text-sm text-ink-muted hover:bg-surface-raised">
            {it ? "Annulla" : "Cancel"}
          </button>
          {step === "name" ? (
            <button
              type="button"
              disabled={!chip.trim()}
              onClick={goBus}
              className="inline-flex items-center gap-1.5 rounded-slpill bg-brand-blue px-5 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40"
            >
              {it ? "Avanti" : "Next"}
            </button>
          ) : null}
          {step === "bus" ? (
            <button
              type="button"
              onClick={goChannels}
              className="inline-flex items-center gap-1.5 rounded-slpill bg-brand-blue px-5 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
            >
              {it ? "Avanti" : "Next"}
            </button>
          ) : null}
          {step === "channels" ? (
            <button
              type="button"
              onClick={goSequence}
              className="inline-flex items-center gap-1.5 rounded-slpill bg-brand-blue px-5 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
            >
              {it ? "Disegna sequenza" : "Draw sequence"}
            </button>
          ) : null}
          {step === "sequence" && draft ? (
            <button
              type="button"
              onClick={() => confirmRecipe(draft)}
              className="inline-flex items-center gap-1.5 rounded-slpill bg-brand-blue px-5 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
            >
              <Check size={14} />
              {it ? "Metti sul canvas" : "Place on canvas"}
            </button>
          ) : null}
        </footer>
      </motion.div>
    </motion.div>
  );
}

function channelsFromQuantities(quantities: readonly SensorOutputKind[], it: boolean): readonly SensorChannel[] {
  return quantities.map((quantity) => {
    const choice = QUANTITY_CHOICES.find((item) => item.quantity === quantity)!;
    return {
      id: choice.id,
      label: it ? choice.labelIt : choice.labelEn,
      unit: choice.unit,
      quantity,
      direction: "read" as const,
    };
  });
}

export function SensorRecipeCard({
  recipe,
  it,
  editable,
  onRecipeChange,
}: {
  readonly recipe: SensorRecipe;
  readonly it: boolean;
  readonly editable?: boolean;
  readonly onRecipeChange?: (next: SensorRecipe) => void;
}) {
  const [showSequence, setShowSequence] = useState(false);
  const output = recipe.outputs.find((item) => item.id === recipe.tryNow.outputId) ?? recipe.outputs[0];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-heading text-base font-semibold text-ink">{recipe.chip}</p>
        <p className="mt-1 font-body text-sm text-ink-muted">{recipe.oneLiner}</p>
        {recipe.confidence !== "high" && (
          <p className="mt-2 rounded-slsm bg-warning/15 px-2 py-1 font-body text-[11px] text-ink">
            {it ? "Bozza — completa i passi della ricetta." : "Draft — finish the recipe steps."}
          </p>
        )}
      </div>

      <section>
        <h3 className="mb-1.5 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          {it ? "Come si collega" : "How to wire"}
        </h3>
        <ul className="rounded-slmd border border-border bg-surface-sunken px-3 py-2 font-body text-sm text-ink">
          <li>
            {it ? "Bus" : "Bus"}: <span className="font-mono">{recipe.bus.toUpperCase()}</span>
            {recipe.address ? (
              <>
                {" · "}
                {it ? "indirizzo" : "address"} <span className="font-mono">{recipe.address}</span>
              </>
            ) : null}
          </li>
          <li>
            {it ? "Alimentazione" : "Power"}: {recipe.voltage}
          </li>
          <li className="text-ink-muted">{recipe.pins.map((pin) => pin.role).join(" · ")}</li>
        </ul>
      </section>

      <section>
        <h3 className="mb-1.5 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          {it ? "Canali per i blocchi" : "Channels for blocks"}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {recipeChannels(recipe).map((channel) => (
            <span
              key={channel.id}
              className={`rounded-slpill px-2.5 py-1 font-body text-xs ${
                channel.id === output?.id ? "bg-brand-blue text-white" : "bg-surface-sunken text-ink"
              }`}
              title={channel.direction === "write" ? (it ? "Scrittura" : "Write") : it ? "Lettura" : "Read"}
            >
              {channel.label}
              {channel.unit ? ` (${channel.unit})` : ""}
              <span className="ml-1 opacity-70">{channel.direction === "write" ? "↓" : "↑"}</span>
            </span>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
            {it ? "Ricetta (passi)" : "Recipe (steps)"}
          </h3>
          {editable && onRecipeChange ? (
            <button
              type="button"
              onClick={() => setShowSequence((v) => !v)}
              className="ml-auto rounded-slpill border border-border-strong px-2 py-0.5 font-body text-[11px] font-semibold text-ink hover:border-brand-blue hover:text-brand-blue"
            >
              {showSequence
                ? it
                  ? "Nascondi sequenza"
                  : "Hide sequence"
                : it
                  ? "Modifica sequenza"
                  : "Edit sequence"}
            </button>
          ) : null}
        </div>
        {showSequence && editable && onRecipeChange ? (
          <SensorSequenceEditor recipe={recipe} onChange={onRecipeChange} />
        ) : (
          <ol className="list-decimal space-y-1.5 pl-4 font-body text-sm text-ink">
            {recipe.recipe.sample.map((sampleStep, index) => (
              <li key={`${sampleStep.type}-${index}`}>{describeStep(sampleStep)}</li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
