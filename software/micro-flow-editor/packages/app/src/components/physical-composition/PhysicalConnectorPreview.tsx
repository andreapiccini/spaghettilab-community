import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { publicAsset } from "../../lib/public-asset.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import {
  derivePortInterfaces,
  formatPinLabel,
  functionPinGrid,
  isRepeatableSignalBase,
  kindForMode,
  labelForMode,
  modeIndexToPinId,
  numberedPeripheralName,
  PERIPHERAL_ACCENT,
  pinVisualKind,
  placeableSignalsForKind,
  type FunctionModuleVariant,
  type FunctionPinCell,
  type PhysicalBusUnits,
  type PinVisualKind,
  type PhysicalSignalDef,
  type PortInterfaceKind,
} from "../../lib/backbone-physical.js";

/**
 * Normalized hotspot map for `ux-assets/module-function-pcb.png`.
 * Percentages of the image box; centers aligned to the 2×6 header sockets.
 * Silkscreen: top A4…A7 GND 3.3V · bottom A3…A0 GND 5V.
 */
type PcbHotspot = {
  readonly id: string;
  readonly modeIndex?: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/**
 * Silkscreen column X + recess midlines from `module-function-pcb.png`.
 * Hitboxes match the socket opening (not CSS-square) so they don't spill.
 */
const V2_PCB_HOTSPOTS: readonly PcbHotspot[] = [
  { id: "A4", modeIndex: 4, x: 23.7, y: 40.6, w: 5.0, h: 6.0 },
  { id: "A5", modeIndex: 5, x: 34.3, y: 40.6, w: 5.0, h: 6.0 },
  { id: "A6", modeIndex: 6, x: 44.9, y: 40.6, w: 5.0, h: 6.0 },
  { id: "A7", modeIndex: 7, x: 55.55, y: 40.6, w: 5.0, h: 6.0 },
  { id: "GND-T", x: 66.3, y: 40.6, w: 5.0, h: 6.0 },
  { id: "3V3", x: 76.95, y: 40.6, w: 5.0, h: 6.0 },
  { id: "A3", modeIndex: 3, x: 23.7, y: 56.9, w: 5.0, h: 6.0 },
  { id: "A2", modeIndex: 2, x: 34.3, y: 56.9, w: 5.0, h: 6.0 },
  { id: "A1", modeIndex: 1, x: 44.9, y: 56.9, w: 5.0, h: 6.0 },
  { id: "A0", modeIndex: 0, x: 55.55, y: 56.9, w: 5.0, h: 6.0 },
  { id: "GND-B", x: 66.3, y: 56.9, w: 5.0, h: 6.0 },
  { id: "5V", x: 76.95, y: 56.9, w: 5.0, h: 6.0 },
];

function pastelEdge(accent: string): string {
  return `${accent}55`;
}

type PinFumetto = {
  readonly id: string;
  readonly accent: string;
  readonly iface: string;
  readonly signal: string;
  readonly pinLabel: string;
  readonly pinX: number;
  readonly pinY: number;
  readonly side: "top" | "bottom";
};

const POWER_FILL: Record<Exclude<PinVisualKind, "signal">, string> = {
  power: "#DC2626",
  ground: "#3F3F46",
  unused: "#D4D4D8",
  unknown: "#D4D4D8",
};

export type PinPopoverModel = {
  readonly modeIndex: number;
  readonly pinLabel: string;
  readonly currentRole: string;
  readonly occupied: boolean;
};

/**
 * Module Function connector.
 * V2: PCB PNG + click hotspots (illuminate on hover). V1/compact: CSS grid.
 */
export function PhysicalConnectorPreview({
  pins,
  compact = false,
  title,
  variant: variantProp,
  modes,
  busUnits,
  interactive = false,
  pendingSignal = null,
  pendingAccent,
  popoverSignals = [],
  localeIt = true,
  onPinActivate,
  onAssignSignal,
  onClearPin,
}: {
  readonly pins?: readonly string[];
  readonly compact?: boolean;
  readonly title?: string;
  readonly variant?: FunctionModuleVariant;
  readonly modes?: readonly number[];
  readonly busUnits?: PhysicalBusUnits;
  /** Click-to-assign / open popover (replaces drag-and-drop). */
  readonly interactive?: boolean;
  readonly pendingSignal?: PhysicalSignalDef | null;
  readonly pendingAccent?: string;
  /** Signals offered in the pin popover (from the selected peripheral). */
  readonly popoverSignals?: readonly PhysicalSignalDef[];
  readonly localeIt?: boolean;
  readonly onPinActivate?: (modeIndex: number) => void;
  readonly onAssignSignal?: (modeIndex: number, signalMode: number) => void;
  readonly onClearPin?: (modeIndex: number) => void;
}) {
  const variant: FunctionModuleVariant =
    variantProp ?? (pins?.length === 12 || modes?.length === 8 ? "v2" : "v1");

  if (!compact && variant === "v2" && modes !== undefined) {
    return (
      <div className="space-y-2">
        {title && (
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <span>{title}</span>
            <span className="font-mono normal-case tracking-normal text-ink-faint/80">
              2×6 · 12 pin
            </span>
          </div>
        )}
        <PcbConnectorInteractive
          modes={modes}
          busUnits={busUnits}
          interactive={interactive}
          pendingSignal={pendingSignal}
          pendingAccent={pendingAccent}
          popoverSignals={popoverSignals}
          localeIt={localeIt}
          onPinActivate={onPinActivate}
          onAssignSignal={onAssignSignal}
          onClearPin={onClearPin}
        />
      </div>
    );
  }

  let grid: readonly (readonly FunctionPinCell[])[];
  if (modes !== undefined) {
    grid = functionPinGrid(modes, variant);
  } else if (pins !== undefined && variant === "v2" && pins.length === 12) {
    grid = [
      pins.slice(0, 6).map((label) => ({ label })),
      pins.slice(6).map((label) => ({ label })),
    ];
  } else if (pins !== undefined) {
    grid = [pins.map((label) => ({ label }))];
  } else {
    grid = functionPinGrid([], variant);
  }

  return (
    <CssGridFallback
      grid={grid}
      variant={variant}
      compact={compact}
      title={title}
      interactive={interactive}
      pendingSignal={pendingSignal}
      pendingAccent={pendingAccent}
      onPinActivate={onPinActivate}
      onClearPin={onClearPin}
    />
  );
}

function buildPinFumetti(
  modes: readonly number[],
  busUnits?: PhysicalBusUnits,
): readonly PinFumetto[] {
  const interfaces = derivePortInterfaces(modes, "v2");
  const out: PinFumetto[] = [];
  for (const spot of V2_PCB_HOTSPOTS) {
    if (spot.modeIndex === undefined) continue;
    const mode = modes[spot.modeIndex] ?? 0;
    const kind = kindForMode(mode);
    if (!kind || (mode & 15) === 0) continue;
    const pinId = modeIndexToPinId(spot.modeIndex, "v2");
    const instance = interfaces.find((item) =>
      item.signals.some((signal) => signal.pin === pinId),
    );
    const accent = PERIPHERAL_ACCENT[kind as PortInterfaceKind];
    out.push({
      id: spot.id,
      accent,
      iface: instance
        ? numberedPeripheralName(instance.kind, instance.ordinal, busUnits)
        : numberedPeripheralName(kind, 1, busUnits),
      signal: labelForMode(mode),
      pinLabel: formatPinLabel(pinId, "v2"),
      pinX: spot.x,
      pinY: spot.y,
      side: spot.y < 50 ? "top" : "bottom",
    });
  }
  return out.sort((a, b) => a.pinX - b.pinX);
}

function FumettoCard({
  item,
  pointer,
}: {
  readonly item: PinFumetto;
  readonly pointer: "up" | "down";
}) {
  return (
    <div className="relative w-[6.75rem]">
      <div
        className="rounded-lg border bg-white px-2 py-1.5 shadow-e1"
        style={{ borderColor: pastelEdge(item.accent) }}
      >
        <div className="flex items-center gap-1">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: item.accent }}
          />
          <span className="truncate font-mono text-[8px] font-bold text-ink-muted">
            {item.pinLabel}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[10px] font-bold leading-tight text-ink">
          {item.iface}
        </p>
        <p
          className="truncate text-[9px] font-semibold leading-tight"
          style={{ color: item.accent }}
        >
          {item.signal}
        </p>
      </div>
      <span
        className={`absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border bg-white ${
          pointer === "down"
            ? "-bottom-0.5 border-t-0 border-l-0"
            : "-top-0.5 border-b-0 border-r-0"
        }`}
        style={{ borderColor: pastelEdge(item.accent) }}
      />
    </div>
  );
}

function PcbConnectorInteractive({
  modes,
  busUnits,
  interactive,
  pendingSignal,
  pendingAccent,
  popoverSignals,
  localeIt,
  onPinActivate,
  onAssignSignal,
  onClearPin,
}: {
  readonly modes: readonly number[];
  readonly busUnits?: PhysicalBusUnits;
  readonly interactive: boolean;
  readonly pendingSignal: PhysicalSignalDef | null;
  readonly pendingAccent?: string;
  readonly popoverSignals: readonly PhysicalSignalDef[];
  readonly localeIt: boolean;
  readonly onPinActivate?: (modeIndex: number) => void;
  readonly onAssignSignal?: (modeIndex: number, signalMode: number) => void;
  readonly onClearPin?: (modeIndex: number) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenIndex(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openIndex]);

  const openSpot = V2_PCB_HOTSPOTS.find((s) => s.modeIndex === openIndex);
  const fumetti = useMemo(
    () => buildPinFumetti(modes, busUnits),
    [modes, busUnits],
  );
  const topFumetti = fumetti.filter((f) => f.side === "top");
  const bottomFumetti = fumetti.filter((f) => f.side === "bottom");

  return (
    <div
      ref={rootRef}
      className="relative mx-auto flex w-fit max-w-full select-none flex-col"
    >
      {/* Width tracks the PCB image so left:% matches pin centers */}
      <div className="relative h-[3.35rem] w-full shrink-0">
        {topFumetti.map((item) => (
          <div
            key={item.id}
            className="pointer-events-none absolute bottom-0 z-[5] -translate-x-1/2"
            style={{ left: `${item.pinX}%` }}
          >
            <FumettoCard item={item} pointer="down" />
          </div>
        ))}
      </div>

      <div className="relative w-fit max-w-full shrink">
      <img
        src={publicAsset("ux-assets/module-function-pcb.png")}
        alt="Module Function · connettore 2×6"
        className="pointer-events-none relative z-[1] block h-auto max-h-[min(34vh,280px)] w-auto max-w-full bg-transparent"
        draggable={false}
      />

      {fumetti.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 z-[2] h-full w-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {topFumetti.map((f) => (
            <path
              key={`w-${f.id}`}
              d={`M ${f.pinX} ${f.pinY} V 0`}
              fill="none"
              stroke={f.accent}
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {bottomFumetti.map((f) => (
            <path
              key={`w-${f.id}`}
              d={`M ${f.pinX} ${f.pinY} V 100`}
              fill="none"
              stroke={f.accent}
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}

      <div className="absolute inset-0 z-[3]">
        {V2_PCB_HOTSPOTS.map((spot) => {
          const configurable = spot.modeIndex !== undefined;
          const mode = configurable ? (modes[spot.modeIndex!] ?? 0) : 0;
          const role = configurable
            ? labelForMode(mode)
            : spot.id.startsWith("GND")
              ? "GND"
              : spot.id === "3V3"
                ? "3.3V"
                : "5V";
          const accentKind = configurable ? kindForMode(mode) : null;
          const accent = accentKind
            ? PERIPHERAL_ACCENT[accentKind]
            : spot.id === "3V3" || spot.id === "5V"
              ? "#DC2626"
              : spot.id.startsWith("GND")
                ? "#3F3F46"
                : null;
          const occupied = configurable && (mode & 15) !== 0;
          const powerLit = !configurable && (spot.id === "3V3" || spot.id === "5V");
          const lit = occupied || powerLit;
          const isHover = hoverIndex === spot.modeIndex;
          const isOpen = openIndex === spot.modeIndex;
          const pendingHere = Boolean(pendingSignal && configurable);
          const pinId =
            spot.modeIndex !== undefined
              ? modeIndexToPinId(spot.modeIndex, "v2")
              : undefined;

          return (
            <button
              key={spot.id}
              type="button"
              disabled={!interactive || !configurable}
              className={`absolute rounded-[4px] transition-all duration-150 disabled:cursor-default ${
                configurable && interactive ? "cursor-pointer" : ""
              } ${isHover || isOpen ? "z-20" : "z-10"}`}
              style={{
                left: `${spot.x}%`,
                top: `${spot.y}%`,
                width: `${spot.w}%`,
                height: `${spot.h}%`,
                transform: "translate(-50%, -50%)",
              }}
              onMouseEnter={() => configurable && setHoverIndex(spot.modeIndex!)}
              onMouseLeave={() =>
                setHoverIndex((prev) => (prev === spot.modeIndex ? null : prev))
              }
              onClick={() => {
                if (!configurable || !interactive) return;
                if (pendingSignal && onAssignSignal) {
                  onAssignSignal(spot.modeIndex!, pendingSignal.mode);
                  setOpenIndex(null);
                  onPinActivate?.(spot.modeIndex!);
                  return;
                }
                setOpenIndex(spot.modeIndex!);
                onPinActivate?.(spot.modeIndex!);
              }}
              title={
                configurable && pinId !== undefined
                  ? `${formatPinLabel(pinId, "v2")} · ${role}${
                      interactive
                        ? pendingSignal
                          ? localeIt
                            ? ` — assegna ${pendingSignal.label}`
                            : ` — assign ${pendingSignal.label}`
                          : localeIt
                            ? " — click per configurare"
                            : " — click to configure"
                        : ""
                    }`
                  : role
              }
            >
              <span
                className={`pointer-events-none absolute inset-[12%] rounded-[2px] border transition-all duration-150 ${
                  isHover || isOpen ? "scale-110 border-white" : "border-white/80"
                }`}
                style={
                  isHover || isOpen
                    ? {
                        backgroundColor: "rgba(103, 232, 249, 0.4)",
                        boxShadow: "0 0 14px rgba(34,211,238,0.75)",
                      }
                    : lit && accent
                      ? {
                          backgroundColor: `${accent}55`,
                          borderColor: "rgba(255,255,255,0.75)",
                          boxShadow: `0 0 10px ${accent}88, 0 0 16px ${accent}55`,
                        }
                      : pendingHere && pendingAccent
                        ? {
                            backgroundColor: `${pendingAccent}33`,
                            borderColor: `${pendingAccent}aa`,
                            boxShadow: `0 0 10px ${pendingAccent}66`,
                          }
                        : {
                            backgroundColor: "rgba(255,255,255,0.55)",
                            boxShadow:
                              "0 0 8px rgba(255,255,255,0.55), inset 0 0 2px rgba(0,0,0,0.12)",
                          }
                }
              />
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {openIndex !== null && openSpot && interactive && (
          <motion.div
            key={`pop-${openIndex}`}
            initial={reducedMotion ? false : { opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 4, scale: 0.96 }}
            transition={motionTokens.duration.fast}
            className="absolute z-50 w-52 -translate-x-1/2 rounded-slmd border border-border bg-surface p-2.5 shadow-e2"
            style={{
              left: `${openSpot.x}%`,
              top: openSpot.y < 50 ? `${openSpot.y + 10}%` : undefined,
              bottom: openSpot.y >= 50 ? `${100 - openSpot.y + 10}%` : undefined,
            }}
            role="dialog"
            aria-label={localeIt ? "Configura pin" : "Configure pin"}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] font-bold text-ink">
                {formatPinLabel(modeIndexToPinId(openIndex, "v2"), "v2")}
              </span>
              <span className="truncate text-[10px] text-ink-muted">
                {labelForMode(modes[openIndex] ?? 0)}
              </span>
            </div>
            {(() => {
              const gpioSignals = placeableSignalsForKind("gpio", modes, "v2");
              const seen = new Set<string>();
              const offered = [...gpioSignals, ...popoverSignals].filter((signal) => {
                if (seen.has(signal.id)) return false;
                seen.add(signal.id);
                return true;
              });
              return offered.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
                  {localeIt ? "Assegna segnale" : "Assign signal"}
                </p>
                {offered.map((signal) => {
                  const accent =
                    PERIPHERAL_ACCENT[kindForMode(signal.mode) ?? "gpio"];
                  const placedElsewhere =
                    !isRepeatableSignalBase(signal.mode & 15) &&
                    modes.some(
                      (mode, index) =>
                        index !== openIndex &&
                        (mode & 15) === (signal.mode & 15) &&
                        (signal.mode & 15) !== 0,
                    );
                  return (
                    <button
                      key={signal.id}
                      type="button"
                      disabled={placedElsewhere}
                      title={
                        placedElsewhere
                          ? localeIt
                            ? "Segnale già assegnato su un altro pin"
                            : "Signal already assigned on another pin"
                          : undefined
                      }
                      className="rounded-slsm border-2 bg-surface px-2 py-1.5 text-left text-[11px] font-bold transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ borderColor: `${accent}66`, color: accent }}
                      onClick={() => {
                        if (placedElsewhere) return;
                        onAssignSignal?.(openIndex, signal.mode);
                        setOpenIndex(null);
                      }}
                    >
                      {signal.label}
                      {placedElsewhere
                        ? localeIt
                          ? " · già usato"
                          : " · in use"
                        : ""}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[10px] leading-relaxed text-ink-muted">
                {localeIt
                  ? "Seleziona una periferica a sinistra, oppure libera questo pin."
                  : "Select a peripheral on the left, or clear this pin."}
              </p>
            );
            })()}
            {(modes[openIndex]! & 15) !== 0 && (
              <button
                type="button"
                className="mt-2 w-full rounded-slsm border border-border px-2 py-1.5 text-[10px] font-semibold text-error hover:bg-error/5"
                onClick={() => {
                  onClearPin?.(openIndex);
                  setOpenIndex(null);
                }}
              >
                {localeIt ? "Rimuovi assegnazione" : "Clear assignment"}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      <div className="relative h-[3.35rem] w-full shrink-0">
        {bottomFumetti.map((item) => (
          <div
            key={item.id}
            className="pointer-events-none absolute top-0 z-[5] -translate-x-1/2"
            style={{ left: `${item.pinX}%` }}
          >
            <FumettoCard item={item} pointer="up" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CssGridFallback({
  grid,
  variant,
  compact,
  title,
  interactive,
  pendingSignal,
  pendingAccent,
  onPinActivate,
  onClearPin,
}: {
  readonly grid: readonly (readonly FunctionPinCell[])[];
  readonly variant: FunctionModuleVariant;
  readonly compact: boolean;
  readonly title?: string;
  readonly interactive: boolean;
  readonly pendingSignal: PhysicalSignalDef | null;
  readonly pendingAccent?: string;
  readonly onPinActivate?: (modeIndex: number) => void;
  readonly onClearPin?: (modeIndex: number) => void;
}) {
  const cols = grid[0]?.length ?? 6;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const sizeLabel = variant === "v2" ? "2×6 · 12 pin" : "1×6 · 6 pin";

  return (
    <div className={compact ? "" : "space-y-2"}>
      {title && !compact && (
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          <span>{title}</span>
          <span className="font-mono normal-case tracking-normal text-ink-faint/80">
            {sizeLabel}
          </span>
        </div>
      )}
      <div
        className={`relative overflow-hidden ${
          compact ? "rounded-[14px] px-3 py-3" : "rounded-[28px] px-6 py-7 shadow-e2"
        }`}
        style={{
          background: "linear-gradient(145deg, #4A8AE8 0%, #3F77DA 42%, #2E5FBD 100%)",
        }}
      >
        <div
          className={`relative rounded-2xl border border-black/20 bg-zinc-950/90 ${
            compact ? "px-2 py-2" : "px-4 py-5"
          }`}
        >
          <div className={`grid gap-2 ${variant === "v2" ? "gap-y-5" : "gap-y-2"}`}>
            {grid.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {row.map((cell, index) => {
                  const kind = pinVisualKind(cell.label);
                  const accentKind =
                    cell.mode !== undefined ? kindForMode(cell.mode) : null;
                  const accent = accentKind ? PERIPHERAL_ACCENT[accentKind] : null;
                  const configurable = cell.modeIndex !== undefined;
                  const pinId =
                    cell.modeIndex !== undefined
                      ? modeIndexToPinId(cell.modeIndex, variant)
                      : undefined;
                  const isHover = hoverIndex === cell.modeIndex;
                  const occupied = configurable && kind === "signal";
                  const contactColor =
                    kind === "signal" ? (accent ?? "#3F77DA") : POWER_FILL[kind];
                  return (
                    <button
                      key={`${rowIndex}-${index}-${cell.modeIndex ?? cell.label}`}
                      type="button"
                      disabled={!interactive || !configurable}
                      className={`min-w-0 text-center disabled:cursor-default ${
                        interactive && configurable ? "cursor-pointer" : ""
                      } ${isHover ? "scale-105" : ""}`}
                      onMouseEnter={() =>
                        configurable && setHoverIndex(cell.modeIndex!)
                      }
                      onMouseLeave={() =>
                        setHoverIndex((prev) =>
                          prev === cell.modeIndex ? null : prev,
                        )
                      }
                      onClick={() => {
                        if (!configurable || !interactive) return;
                        if (occupied && !pendingSignal && onClearPin) {
                          onClearPin(cell.modeIndex!);
                          return;
                        }
                        onPinActivate?.(cell.modeIndex!);
                      }}
                    >
                      <div
                        className={`mx-auto flex items-center justify-center rounded-full border transition-all ${
                          compact ? "h-7 w-7" : "h-10 w-10"
                        } ${
                          isHover
                            ? "border-cyan-200 bg-cyan-300/30 shadow-[0_0_12px_rgba(34,211,238,0.7)]"
                            : "border-zinc-600 bg-zinc-800"
                        }`}
                        style={
                          occupied && accent && !isHover
                            ? { boxShadow: `inset 0 0 0 2px ${accent}` }
                            : pendingSignal && pendingAccent && configurable
                              ? { boxShadow: `0 0 0 2px ${pendingAccent}66` }
                              : undefined
                        }
                      >
                        <span
                          className={`rounded-full ${compact ? "h-2.5 w-2.5" : "h-3 w-3"}`}
                          style={{ backgroundColor: contactColor }}
                        />
                      </div>
                      <span className="mt-1 block font-mono text-[9px] font-bold text-white/90">
                        {configurable && pinId !== undefined
                          ? formatPinLabel(pinId, variant)
                          : cell.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
