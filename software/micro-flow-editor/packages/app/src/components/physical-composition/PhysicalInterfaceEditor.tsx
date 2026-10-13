import {
  DEFAULT_PHYSICAL_SETTINGS,
  type PhysicalInterfaceSettings,
} from "@spaghettilab/protocol-sdk";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  Binary,
  Cable,
  Check,
  CircuitBoard,
  Info,
  Radio,
  Settings2,
  Waves,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { useLocale } from "../../state/locale-context.js";
import {
  addPortInterface,
  availablePeripheralKinds,
  busUnitLabel,
  clearPinAssignment,
  derivePortInterfaces,
  dropSignalOnPin,
  ESP32_S3_BUS_UNITS,
  formatPinLabel,
  freeConfigurablePinIndices,
  functionPinGrid,
  functionVariantOf,
  interfaceDisplayName,
  isBusPortKind,
  kindForMode,
  modeIndexToPinId,
  pinIdToModeIndex,
  numberedPeripheralName,
  PERIPHERAL_ACCENT,
  peripheralLabel,
  applyGpioSettingsToModes,
  placeableSignalsForKind,
  pinVisualKind,
  selectedBusUnit,
  signalModeIsPlaced,
  validatePhysicalModes,
  type BackbonePhysicalDraft,
  type BusPortKind,
  type PhysicalSignalDef,
  type PortInterfaceKind,
} from "../../lib/backbone-physical.js";
import { publicAsset } from "../../lib/public-asset.js";
import { PhysicalConnectorPreview } from "./PhysicalConnectorPreview.js";

type ActiveSelection =
  | { readonly kind: Exclude<PortInterfaceKind, BusPortKind> }
  | { readonly kind: BusPortKind; readonly unit: number };

const input =
  "w-full rounded-slmd border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand-blue disabled:opacity-50";

function pastelBorder(accent: string): string {
  return `${accent}66`;
}

const GPIO_IN_PULL_OPTIONS = [
  { mode: 1, labelIt: "Nessuno", labelEn: "None" },
  { mode: 17, labelIt: "Pull-up", labelEn: "Pull-up" },
  { mode: 33, labelIt: "Pull-down", labelEn: "Pull-down" },
] as const;

const GPIO_OUT_LEVEL_OPTIONS = [
  { mode: 2, labelIt: "OUT", labelEn: "OUT" },
  { mode: 3, labelIt: "OUT HIGH", labelEn: "OUT HIGH" },
] as const;

const PERIPHERAL_ICON: Record<PortInterfaceKind, LucideIcon> = {
  gpio: Binary,
  adc: Activity,
  i2c: Cable,
  uart: Radio,
  spi: CircuitBoard,
  pwm: Waves,
  w1: Zap,
};

function peripheralBlurb(kind: PortInterfaceKind, it: boolean): string {
  const itMap: Record<PortInterfaceKind, string> = {
    gpio: "Ingresso / Uscita digitale",
    adc: "Ingresso analogico",
    i2c: "SDA / SCL",
    uart: "TX / RX",
    spi: "SCK / MOSI / MISO / CS",
    pwm: "Uscita PWM",
    w1: "Comunicazione 1-Wire",
  };
  const enMap: Record<PortInterfaceKind, string> = {
    gpio: "Digital input / output",
    adc: "Analog input",
    i2c: "SDA / SCL",
    uart: "TX / RX",
    spi: "SCK / MOSI / MISO / CS",
    pwm: "PWM output",
    w1: "1-Wire bus",
  };
  return it ? itMap[kind] : enMap[kind];
}

function kindHasSettings(kind: PortInterfaceKind): boolean {
  return kind === "gpio" || kind === "i2c" || kind === "uart" || kind === "spi" || kind === "pwm";
}

export function PhysicalInterfaceEditor({
  draft,
  capabilities,
  extended,
  disabled,
  automatic,
  onChange,
}: {
  readonly draft: BackbonePhysicalDraft;
  readonly capabilities: number;
  readonly extended: boolean;
  readonly disabled: boolean;
  readonly automatic?: boolean;
  readonly onChange: (draft: BackbonePhysicalDraft) => void;
}) {
  const { locale } = useLocale();
  const it = locale === "it";
  const reducedMotion = useReducedMotion();
  const settings = draft.settings ?? DEFAULT_PHYSICAL_SETTINGS;
  const variant = functionVariantOf(draft);
  const peripherals = availablePeripheralKinds(capabilities, extended);
  const interfaces = derivePortInterfaces(draft.modes, variant);
  const invalid = validatePhysicalModes(draft.modes, draft.i2cSpeed);
  const [active, setActive] = useState<ActiveSelection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gpioInMode, setGpioInMode] = useState(1);
  const [gpioOutMode, setGpioOutMode] = useState(2);
  const [query, setQuery] = useState("");
  const [pendingSignal, setPendingSignal] = useState<PhysicalSignalDef | null>(null);
  const activeKind = active?.kind ?? null;
  const activeSignals = activeKind
    ? placeableSignalsForKind(activeKind, draft.modes, variant, {
        inMode: gpioInMode,
        outMode: gpioOutMode,
      })
    : [];
  const pendingAccent = activeKind ? PERIPHERAL_ACCENT[activeKind] : undefined;

  const commitModes = (modes: readonly number[]) =>
    onChange({ ...draft, modes, variant, settings, applied: false });

  const placeSignal = (signalMode: number, pinId: number) => {
    if (signalModeIsPlaced(draft.modes, signalMode)) {
      const pinIndex = pinIdToModeIndex(pinId, variant);
      const alreadyHere =
        pinIndex >= 0 && (draft.modes[pinIndex]! & 15) === (signalMode & 15);
      if (!alreadyHere) {
        setPendingSignal(null);
        return;
      }
    }
    commitModes(dropSignalOnPin(draft.modes, signalMode, pinId, variant));
    setPendingSignal(null);
  };

  const commitGpioSettings = (nextIn: number, nextOut: number) => {
    setGpioInMode(nextIn);
    setGpioOutMode(nextOut);
    commitModes(applyGpioSettingsToModes(draft.modes, { inMode: nextIn, outMode: nextOut }));
  };

  const updateSettings = (patch: Partial<PhysicalInterfaceSettings>) =>
    onChange({ ...draft, settings: { ...settings, ...patch }, applied: false });

  const selectSimplePeripheral = (kind: Exclude<PortInterfaceKind, BusPortKind>) => {
    setSettingsOpen(false);
    setPendingSignal(null);
    setActive((prev) => (prev?.kind === kind ? null : { kind }));
  };

  const selectBusUnit = (kind: BusPortKind, unit: number) => {
    setSettingsOpen(false);
    setPendingSignal(null);
    setActive((prev) =>
      prev && isBusPortKind(prev.kind) && prev.kind === kind && prev.unit === unit
        ? null
        : { kind, unit },
    );
    onChange({
      ...draft,
      busUnits: { ...draft.busUnits, [kind]: unit },
      applied: false,
    });
  };

  const activeTitle = (() => {
    if (!active) return "";
    if ("unit" in active) return busUnitLabel(active.kind, active.unit);
    return numberedPeripheralName(active.kind, 1);
  })();

  const filteredKinds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return peripherals;
    return peripherals.filter((kind) => {
      const label = peripheralLabel(kind).toLowerCase();
      const blurb = peripheralBlurb(kind, it).toLowerCase();
      if (label.includes(q) || blurb.includes(q)) return true;
      if (isBusPortKind(kind)) {
        return ESP32_S3_BUS_UNITS[kind].some((unit) =>
          busUnitLabel(kind, unit).toLowerCase().includes(q),
        );
      }
      return false;
    });
  }, [peripherals, query, it]);

  const pinRows = useMemo(() => {
    const grid = functionPinGrid(draft.modes, variant);
    return grid.flat().map((cell, flatIndex) => ({ cell, flatIndex }));
  }, [draft.modes, variant]);

  const freeCount = freeConfigurablePinIndices(draft.modes).length;

  const autoAssign = () => {
    if (!activeKind || disabled) return;
    try {
      commitModes(addPortInterface(draft.modes, activeKind));
    } catch {
      /* not enough free pins */
    }
  };

  if (automatic) {
    return (
      <div className="space-y-4">
        <p className="rounded-slmd border border-brand-blue/30 bg-brand-blue/5 px-3 py-2 text-xs leading-relaxed text-ink-muted">
          {it
            ? "Configurazione automatica dal modulo NFC."
            : "Automatic configuration from the NFC module."}
        </p>
        <PhysicalConnectorPreview modes={draft.modes} variant={variant} title="Module Function" />
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[272px_minmax(0,1fr)_300px]">
      {/* Left — peripheral library */}
      <aside className="flex min-h-0 flex-col rounded-slmd border border-border bg-surface shadow-e1">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-heading text-sm font-semibold text-ink">
            {it ? "Periferiche e funzioni" : "Peripherals & functions"}
          </h3>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={it ? "Cerca una funzione…" : "Search a function…"}
            className={`${input} mt-2`}
          />
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {filteredKinds.flatMap((kind) => {
            const accent = PERIPHERAL_ACCENT[kind];
            const Icon = PERIPHERAL_ICON[kind];
            const kindPlaced = interfaces.some((item) => item.kind === kind);
            if (isBusPortKind(kind)) {
              return ESP32_S3_BUS_UNITS[kind].map((unit) => {
                const selected =
                  active !== null &&
                  isBusPortKind(active.kind) &&
                  active.kind === kind &&
                  active.unit === unit;
                const unitActive = selectedBusUnit(draft, kind) === unit && kindPlaced;
                return (
                  <LibraryCard
                    key={`${kind}-${unit}`}
                    selected={selected}
                    accent={accent}
                    icon={Icon}
                    title={busUnitLabel(kind, unit)}
                    subtitle={peripheralBlurb(kind, it)}
                    placed={unitActive}
                    disabled={disabled}
                    onClick={() => selectBusUnit(kind, unit)}
                  />
                );
              });
            }
            return [
              <LibraryCard
                key={kind}
                selected={active?.kind === kind}
                accent={accent}
                icon={Icon}
                title={peripheralLabel(kind)}
                subtitle={peripheralBlurb(kind, it)}
                placed={kindPlaced}
                disabled={disabled}
                onClick={() => selectSimplePeripheral(kind)}
              />,
            ];
          })}
        </div>

        <AnimatePresence initial={false}>
          {activeKind && activeSignals.length > 0 && (
            <motion.div
              key={activeTitle}
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: 6 }}
              transition={motionTokens.duration.fast}
              className="border-t border-border bg-surface-sunken/80 px-3 py-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-ink">
                  {it ? `Segnali ${activeTitle}` : `${activeTitle} signals`}
                </span>
                {kindHasSettings(activeKind) && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setSettingsOpen((open) => !open)}
                    className={`inline-flex items-center gap-1 rounded-slsm px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-40 ${
                      settingsOpen ? "bg-surface text-ink shadow-e1" : "text-ink-muted"
                    }`}
                  >
                    <Settings2 size={11} />
                    {it ? "Impostazioni" : "Settings"}
                  </button>
                )}
                <button
                  type="button"
                  className="ml-auto rounded-slsm p-0.5 text-ink-faint hover:text-ink"
                  onClick={() => {
                    setActive(null);
                    setPendingSignal(null);
                    setSettingsOpen(false);
                  }}
                  aria-label={it ? "Chiudi" : "Close"}
                >
                  <X size={12} />
                </button>
              </div>
              <p className="mb-1.5 text-[10px] text-ink-faint">
                {pendingSignal
                  ? it
                    ? `Selezionato ${pendingSignal.label}: clicca un pin sul connettore.`
                    : `${pendingSignal.label} selected: click a pin on the connector.`
                  : it
                    ? "Clicca un segnale, poi un pin — oppure apri il fumetto sul pin."
                    : "Click a signal then a pin — or open the pin popover."}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {activeSignals.map((signal) => {
                  const accent = PERIPHERAL_ACCENT[activeKind];
                  const placed = signalModeIsPlaced(draft.modes, signal.mode);
                  const selected = pendingSignal?.id === signal.id;
                  return (
                    <button
                      key={signal.id}
                      type="button"
                      disabled={disabled || placed}
                      title={
                        placed
                          ? it
                            ? "Segnale già assegnato — libera il pin per riassegnarlo"
                            : "Signal already assigned — clear the pin to reassign"
                          : undefined
                      }
                      onClick={() => {
                        if (placed) return;
                        setPendingSignal((prev) =>
                          prev?.id === signal.id ? null : signal,
                        );
                      }}
                      className="inline-flex items-center gap-1 rounded-slmd border-2 bg-surface px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40"
                      style={{
                        borderColor: selected ? accent : pastelBorder(accent),
                        color: accent,
                        boxShadow: selected ? `0 0 0 2px ${accent}44` : undefined,
                        backgroundColor: selected
                          ? `${accent}12`
                          : placed
                            ? `${accent}18`
                            : undefined,
                      }}
                    >
                      {signal.label}
                      {placed && (
                        <span
                          className="inline-flex h-3 w-3 items-center justify-center rounded-full text-white"
                          style={{ backgroundColor: accent }}
                        >
                          <Check size={8} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {(activeKind === "i2c" ||
                activeKind === "uart" ||
                activeKind === "spi" ||
                activeKind === "w1") && (
                <button
                  type="button"
                  disabled={disabled || freeCount < activeSignals.length}
                  onClick={autoAssign}
                  className="mt-2 w-full rounded-slsm border border-border bg-surface px-2 py-1.5 text-[10px] font-semibold text-ink-muted hover:bg-surface-raised disabled:opacity-40"
                >
                  {it ? "Assegna automaticamente" : "Auto-assign pins"}
                </button>
              )}
              {settingsOpen && kindHasSettings(activeKind) && (
                <div className="mt-3 grid grid-cols-1 gap-2 border-t border-border pt-3">
                  <PeripheralSettingsFields
                    kind={activeKind}
                    draft={draft}
                    settings={settings}
                    disabled={disabled}
                    it={it}
                    gpioInMode={gpioInMode}
                    gpioOutMode={gpioOutMode}
                    onGpioSettings={commitGpioSettings}
                    onI2cSpeed={(speed) =>
                      onChange({ ...draft, i2cSpeed: speed, settings, applied: false })
                    }
                    onSettings={updateSettings}
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </aside>

      {/* Center — physical connector */}
      <section
        className="relative flex min-h-0 flex-col overflow-hidden rounded-slmd border border-border p-3 shadow-e1 sm:p-4"
        style={{
          backgroundColor: "#ffffff",
          backgroundImage: `url(${publicAsset("ux-assets/physical-configurator-bg.jpg")})`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "top center",
          backgroundSize: "cover",
        }}
      >
        <div className="relative z-[1] mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-heading text-sm font-semibold text-ink">
              {it ? "Configuratore fisico" : "Physical configurator"}
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {it ? "Module Function · Backbone" : "Module Function · Backbone"}
            </p>
          </div>
          <p className="max-w-[16rem] rounded-slmd border border-border bg-white/90 px-2 py-1 text-[9px] leading-snug text-ink-muted backdrop-blur-sm">
            <Info size={10} className="mr-1 inline align-text-top" />
            {it
              ? "Clicca un pin, oppure scegli un segnale a sinistra e poi il pin."
              : "Click a pin, or pick a signal on the left then the pin."}
          </p>
        </div>
        <div className="relative z-[1] flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div className="flex h-full w-full max-w-xl items-center justify-center">
            <PhysicalConnectorPreview
              modes={draft.modes}
              busUnits={draft.busUnits}
              variant={variant}
              interactive={!disabled}
              pendingSignal={pendingSignal}
              pendingAccent={pendingAccent}
              popoverSignals={activeSignals}
              localeIt={it}
              onAssignSignal={(modeIndex, signalMode) => {
                placeSignal(signalMode, modeIndexToPinId(modeIndex, variant));
              }}
              onClearPin={(modeIndex) => {
                commitModes(
                  clearPinAssignment(
                    draft.modes,
                    modeIndexToPinId(modeIndex, variant),
                    variant,
                  ),
                );
              }}
            />
          </div>
        </div>
        {invalid && (
          <p role="status" className="relative z-[1] mt-1 shrink-0 text-xs text-error">
            {invalid}
          </p>
        )}
      </section>

      {/* Right — live summary */}
      <aside className="flex min-h-0 flex-col rounded-slmd border border-border bg-surface shadow-e1">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-heading text-sm font-semibold text-ink">
            {it ? "Configurazione porta" : "Port configuration"}
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            {it
              ? `${freeCount} pin liberi · ${interfaces.length} periferiche`
              : `${freeCount} free pins · ${interfaces.length} peripherals`}
          </p>
        </div>
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {pinRows.map(({ cell, flatIndex }) => {
            const kind = pinVisualKind(cell.label);
            const accentKind = cell.mode !== undefined ? kindForMode(cell.mode) : null;
            const accent =
              accentKind != null
                ? PERIPHERAL_ACCENT[accentKind]
                : kind === "power"
                  ? "#DC2626"
                  : kind === "ground"
                    ? "#3F3F46"
                    : "#A1A1AA";
            const pinId =
              cell.modeIndex !== undefined
                ? modeIndexToPinId(cell.modeIndex, variant)
                : undefined;
            const name =
              pinId !== undefined ? formatPinLabel(pinId, variant) : cell.label;
            const status =
              kind === "unused" || cell.label === "NC"
                ? it
                  ? "Libero"
                  : "Free"
                : kind === "power"
                  ? it
                    ? `Alimentazione ${cell.label}`
                    : `${cell.label} power`
                  : kind === "ground"
                    ? it
                      ? "Massa"
                      : "Ground"
                    : cell.label;
            const clearable =
              !disabled && cell.modeIndex !== undefined && kind === "signal";
            return (
              <li key={`pin-${flatIndex}-${name}`}>
                <button
                  type="button"
                  disabled={!clearable}
                  onClick={() => {
                    if (cell.modeIndex === undefined) return;
                    commitModes(
                      clearPinAssignment(
                        draft.modes,
                        modeIndexToPinId(cell.modeIndex, variant),
                        variant,
                      ),
                    );
                  }}
                  className={`flex w-full items-center gap-2 rounded-slsm px-2 py-1.5 text-left text-xs transition-colors ${
                    clearable
                      ? "hover:bg-surface-raised"
                      : "cursor-default opacity-90"
                  }`}
                  title={
                    clearable
                      ? it
                        ? "Click per rimuovere"
                        : "Click to remove"
                      : undefined
                  }
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                  <span className="w-10 shrink-0 font-mono text-[11px] font-bold text-ink">
                    {name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted">{status}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {interfaces.length > 0 && (
          <div className="border-t border-border px-3 py-2">
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              {it ? "Periferiche attive" : "Active peripherals"}
            </h4>
            <ul className="space-y-1">
              {interfaces.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-slsm bg-surface-sunken px-2 py-1.5 text-[11px]"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: PERIPHERAL_ACCENT[item.kind] }}
                  />
                  <strong className="text-ink">
                    {interfaceDisplayName(item, draft.busUnits)}
                  </strong>
                  <span className="truncate text-ink-faint">
                    {item.signals
                      .map((s) => `${s.label}→${formatPinLabel(s.pin, variant)}`)
                      .join(" · ")}
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    className="ml-auto text-[10px] font-semibold text-ink-faint hover:text-error disabled:opacity-40"
                    onClick={() => {
                      const pin = item.signals[0]?.pin;
                      if (pin === undefined) return;
                      commitModes(clearPinAssignment(draft.modes, pin, variant));
                    }}
                  >
                    {it ? "Rimuovi" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-border px-3 py-2.5 text-[10px] leading-relaxed text-ink-faint">
          <strong className="text-ink-muted">{it ? "Informazioni" : "Notes"}</strong>
          <p className="mt-1">
            {it
              ? "Alimentazione e GND sono fisse. I2C, SPI e UART: un bus per tipo sul Module Function. GPIO, ADC e PWM possono occupare più pin."
              : "Power and GND are fixed. I2C, SPI and UART: one bus of each type on Module Function. GPIO, ADC and PWM may use many pins."}
          </p>
        </div>
      </aside>
    </div>
  );
}

function LibraryCard({
  selected,
  accent,
  icon: Icon,
  title,
  subtitle,
  placed,
  disabled,
  onClick,
}: {
  readonly selected: boolean;
  readonly accent: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly subtitle: string;
  readonly placed: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-slmd border-2 bg-surface px-3 py-2.5 text-left transition-all duration-200 disabled:opacity-40 ${
        selected ? "shadow-e1" : "border-border hover:border-border-strong hover:bg-surface-raised"
      }`}
      style={selected ? { borderColor: pastelBorder(accent) } : undefined}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-slmd"
        style={{ backgroundColor: `${accent}18`, color: accent }}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="block text-xs font-semibold text-ink">{title}</span>
          {placed && (
            <span
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: accent }}
            >
              <Check size={9} strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-ink-muted">{subtitle}</span>
      </span>
    </button>
  );
}

function PeripheralSettingsFields({
  kind,
  draft,
  settings,
  disabled,
  it,
  gpioInMode,
  gpioOutMode,
  onGpioSettings,
  onI2cSpeed,
  onSettings,
}: {
  readonly kind: PortInterfaceKind;
  readonly draft: BackbonePhysicalDraft;
  readonly settings: PhysicalInterfaceSettings;
  readonly disabled: boolean;
  readonly it: boolean;
  readonly gpioInMode: number;
  readonly gpioOutMode: number;
  readonly onGpioSettings: (inMode: number, outMode: number) => void;
  readonly onI2cSpeed: (speed: number) => void;
  readonly onSettings: (patch: Partial<PhysicalInterfaceSettings>) => void;
}): ReactNode {
  if (kind === "gpio") {
    return (
      <>
        <label className="text-xs text-ink-muted">
          {it ? "Pull (GPIO IN)" : "Pull (GPIO IN)"}
          <select
            className={`${input} mt-1`}
            disabled={disabled}
            value={gpioInMode}
            onChange={(event) => onGpioSettings(Number(event.target.value), gpioOutMode)}
          >
            {GPIO_IN_PULL_OPTIONS.map((option) => (
              <option key={option.mode} value={option.mode}>
                {it ? option.labelIt : option.labelEn}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-muted">
          {it ? "Livello (GPIO OUT)" : "Level (GPIO OUT)"}
          <select
            className={`${input} mt-1`}
            disabled={disabled}
            value={gpioOutMode}
            onChange={(event) => onGpioSettings(gpioInMode, Number(event.target.value))}
          >
            {GPIO_OUT_LEVEL_OPTIONS.map((option) => (
              <option key={option.mode} value={option.mode}>
                {it ? option.labelIt : option.labelEn}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  }
  if (kind === "i2c") {
    return (
      <label className="text-xs text-ink-muted">
        I²C {it ? "velocità" : "speed"}
        <select
          className={`${input} mt-1`}
          disabled={disabled}
          value={draft.i2cSpeed}
          onChange={(event) => onI2cSpeed(Number(event.target.value))}
        >
          <option value={0}>100 kHz</option>
          <option value={1}>400 kHz</option>
        </select>
      </label>
    );
  }
  if (kind === "uart") {
    return (
      <>
        <label className="text-xs text-ink-muted">
          Baud
          <input
            type="number"
            className={`${input} mt-1`}
            disabled={disabled}
            value={settings.baud}
            min={1200}
            max={2000000}
            onChange={(event) => onSettings({ baud: Number(event.target.value) })}
          />
        </label>
        <label className="text-xs text-ink-muted">
          Data bits
          <select
            className={`${input} mt-1`}
            disabled={disabled}
            value={settings.dataBits}
            onChange={(event) =>
              onSettings({ dataBits: Number(event.target.value) as 7 | 8 })
            }
          >
            <option value={7}>7</option>
            <option value={8}>8</option>
          </select>
        </label>
        <label className="text-xs text-ink-muted">
          Parity
          <select
            className={`${input} mt-1`}
            disabled={disabled}
            value={settings.parity}
            onChange={(event) =>
              onSettings({
                parity: event.target.value as PhysicalInterfaceSettings["parity"],
              })
            }
          >
            <option value="none">none</option>
            <option value="even">even</option>
            <option value="odd">odd</option>
          </select>
        </label>
        <label className="text-xs text-ink-muted">
          Stop bits
          <select
            className={`${input} mt-1`}
            disabled={disabled}
            value={settings.stopBits}
            onChange={(event) =>
              onSettings({ stopBits: Number(event.target.value) as 1 | 2 })
            }
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      </>
    );
  }
  if (kind === "spi") {
    return (
      <>
        <label className="text-xs text-ink-muted">
          SPI Hz
          <input
            type="number"
            className={`${input} mt-1`}
            disabled={disabled}
            value={settings.spiHz}
            min={10000}
            max={20000000}
            onChange={(event) => onSettings({ spiHz: Number(event.target.value) })}
          />
        </label>
        <label className="text-xs text-ink-muted">
          Mode
          <select
            className={`${input} mt-1`}
            disabled={disabled}
            value={settings.spiMode}
            onChange={(event) =>
              onSettings({ spiMode: Number(event.target.value) as 0 | 1 | 2 | 3 })
            }
          >
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label className="text-xs text-ink-muted">
          Bit order
          <select
            className={`${input} mt-1`}
            disabled={disabled}
            value={settings.bitOrder}
            onChange={(event) =>
              onSettings({
                bitOrder: event.target.value as PhysicalInterfaceSettings["bitOrder"],
              })
            }
          >
            <option value="msb">MSB</option>
            <option value="lsb">LSB</option>
          </select>
        </label>
      </>
    );
  }
  if (kind === "pwm") {
    return (
      <>
        <label className="text-xs text-ink-muted">
          PWM Hz
          <input
            type="number"
            className={`${input} mt-1`}
            disabled={disabled}
            value={settings.pwmHz}
            min={1}
            max={20000}
            onChange={(event) => onSettings({ pwmHz: Number(event.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-brand-blue"
            disabled={disabled}
            checked={settings.pwmInverted}
            onChange={(event) => onSettings({ pwmInverted: event.target.checked })}
          />
          {it ? "Invertito" : "Inverted"}
        </label>
      </>
    );
  }
  return null;
}
