import { roundedOrthogonalPath } from "../processing-graph/orthogonal-route.js";
import "./physical-wiring.css";
import { useId, useState } from "react";
import { NFC_INSTALL_META } from "../../lib/nfc-workspace.js";
import { useSession } from "../../state/session-context.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  modulesForBinding,
  parseBackboneSensorModules,
} from "../../lib/backbone-sensor-modules.js";
import {
  derivePortInterfaces,
  formatPinLabel,
  functionPinGrid,
  modeIndexToPinId,
  pinIdToModeIndex,
  type FunctionModuleVariant,
  type PhysicalSignalDef,
} from "../../lib/backbone-physical.js";

type Line = { signal: string; channel?: number; rail?: string };
const wireKey = (line: Line) => line.channel !== undefined ? `channel-${line.channel}` : `rail-${line.rail}`;
type Device = { id: string; name: string; lines: Line[] };
const SIGNAL_COLORS = ["#4e79df", "#198b83", "#9060cf", "#c85b86", "#397eaa", "#a27c24", "#5d8e42", "#9a658e"];
const colorFor = (line: Line) => line.rail === "GND" ? "#626b78"
  : line.rail || /power|vcc|alimentaz|supply/i.test(line.signal) ? "#dc8a2e"
  : SIGNAL_COLORS[(line.channel ?? 0) % SIGNAL_COLORS.length]!;

/** Connector geometry and wire origins share the authoritative V1/V2 pin grid. */
export function PhysicalWiringDiagram({
  modes,
  variant,
  bindingId,
  boardKey,
  disabled,
  pendingSignal,
  selected = null,
  onSelect = () => {},
  signals,
  it,
  onAssign,
  onClear,
}: {
  modes: readonly number[];
  variant: FunctionModuleVariant;
  bindingId?: string;
  boardKey?: string;
  disabled: boolean;
  pendingSignal: PhysicalSignalDef | null;
  selected?: number | null;
  onSelect?: (channel: number | null) => void;
  signals: readonly PhysicalSignalDef[];
  it: boolean;
  onAssign: (channel: number, mode: number) => void;
  onClear: (channel: number) => void;
}) {
  const { session } = useSession();
  const gradient = useId().replaceAll(":", "");
  const [hoveredWire, setHoveredWire] = useState<string | null>(null);
  const activeWire = hoveredWire ?? (selected !== null ? `channel-${selected}` : null);
  const interfaces = derivePortInterfaces(modes, variant);
  const modules = modulesForBinding(
    parseBackboneSensorModules(
      session?.stack.current.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]
        ?.comment,
    ),
    bindingId,
  );
  let installations: Record<
    string,
    { moduleId?: string; boardKey?: string; voltage?: string }
  > = {};
  try {
    installations = JSON.parse(
      session?.stack.current.authoringMetadata[NFC_INSTALL_META]?.comment ?? "{}",
    );
  } catch {
    /* Legacy projects may omit installation metadata. */
  }
  const devices: Device[] = [];
  for (const module of modules) {
    const installation = Object.values(installations).find(
      (entry) => entry?.moduleId === module.id,
    );
    if (
      installation?.boardKey &&
      installation.boardKey !== bindingId &&
      installation.boardKey !== boardKey
    )
      continue;
    const recipe = module.recipe.deviceDraft;
    const lines: Line[] = [];
    if (module.bus === "gpio") {
      const assignment =
        module.gpioAssignments ??
        (module.gpioAssignment
          ? {
              boardKey: module.gpioAssignment.boardKey,
              channels: {
                [recipe?.binding.gpioSignals[0]?.id ?? "data"]:
                  module.gpioAssignment.channel,
              },
            }
          : undefined);
      if (!assignment || assignment.boardKey !== boardKey) continue;
      for (const [id, channel] of Object.entries(assignment.channels)) {
        if (!((modes[channel] ?? 0) & 15)) continue;
        lines.push({
          signal:
            recipe?.binding.gpioSignals.find((signal) => signal.id === id)?.name ?? id,
          channel,
        });
      }
    } else {
      const bus = interfaces.find((item) => item.kind === module.bus);
      if (bus)
        for (const signal of bus.signals)
          lines.push({
            signal: signal.label,
            channel: pinIdToModeIndex(signal.pin, variant),
          });
    }
    if (!lines.length) continue;
    const hardware = recipe?.gpioHardware;
    if (hardware?.ground || installation?.voltage)
      lines.push({ signal: "GND", rail: "GND" });
    if (hardware && hardware.power !== "none")
      lines.push({ signal: "VCC", rail: hardware.power === "3.3" ? "3.3V" : "5V" });
    devices.push({ id: module.id, name: module.label, lines });
  }
  // Only installed external modules are wiring destinations. A configured
  // GPIO/PWM channel alone is not an external device.
  const grid = functionPinGrid(modes, variant);
  const contacts = grid.flatMap((row, r) =>
    row.map((cell, c) => ({ ...cell, x: 62 + c * 40, y: 100 + r * 48 })),
  );
  let nextY = 48;
  const boxes = devices.map((device) => {
    const y = nextY;
    const height = 54 + device.lines.length * 28;
    nextY += height + 30;
    return { ...device, y, height };
  });
  const wireCount = boxes.reduce((count, box) => count + box.lines.length, 0);
  const laneSpacing = Math.min(16, 200 / Math.max(1, wireCount));
  const routeBaseY = variant === "v2" ? 220 : 175;
  const height = Math.max(240, nextY, routeBaseY + wireCount * 12 + 24);
  const pinLabel = (channel: number) =>
    formatPinLabel(modeIndexToPinId(channel, variant), variant);
  const origin = (line: Line) =>
    contacts.find((pin) =>
      line.channel !== undefined
        ? pin.modeIndex === line.channel
        : pin.modeIndex === undefined && pin.label === line.rail,
    );
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-col gap-2">
      <div className="min-h-[220px] flex-1 overflow-hidden lg:min-h-0">
        <svg
          viewBox={`0 0 ${devices.length ? 800 : 360} ${height}`}
          className={`block h-full max-h-full w-full ${devices.length ? "" : "mx-auto max-w-md"}`}
          role="group"
          aria-label={it ? "Schema dei collegamenti" : "Wiring diagram"}
        >
          <defs>
            <linearGradient id={gradient} x2="1" y2="1">
              <stop stopColor="#fff" />
              <stop offset="1" stopColor="#e9ecf1" />
            </linearGradient>
          </defs>
          <text x="30" y="35" fontSize="15" fontWeight="650" fill="#252e3d">
            Module Function {variant.toUpperCase()}
          </text>
          <rect
            x="25"
            y="52"
            width="280"
            height={variant === "v2" ? 137 : 90}
            rx="12"
            fill={`url(#${gradient})`}
            stroke="#939ba8"
          />
          {grid.map((_, r) => (
            <rect
              key={r}
              x="42"
              y={82 + r * 48}
              width="246"
              height="36"
              rx="9"
              fill="none"
              stroke="#b4bac4"
            />
          ))}
          <path d="M25 88 l8 7 -8 7z" fill="#626b78" />
          <text x="12" y="97" fontSize="11" fill="#626b78">
            1
          </text>
          {boxes.flatMap(box => box.lines.map((line, i) => ({ box, line, i, start: origin(line) })))
            .filter(wire => wire.start !== undefined)
            .sort((a, b) => b.start!.x - a.start!.x || a.box.y - b.box.y || a.i - b.i)
            .map(({ box, line, i, start }, index) => {
              const endY = box.y + 48 + i * 28;
              const laneY = routeBaseY + index * 12;
              const laneX = 330 + index * laneSpacing;
              const path = roundedOrthogonalPath([
                { x: start!.x, y: start!.y }, { x: start!.x, y: laneY },
                { x: laneX, y: laneY }, { x: laneX, y: endY }, { x: 574, y: endY },
              ], 9);
              return <g key={`${box.id}-${i}`} className="physical-wire" data-muted={activeWire !== null && activeWire !== wireKey(line)} data-active={activeWire === wireKey(line)}
                onMouseEnter={() => setHoveredWire(wireKey(line))} onMouseLeave={() => setHoveredWire(null)}
                onFocus={() => setHoveredWire(wireKey(line))} onBlur={() => setHoveredWire(null)}
                tabIndex={0} role="group" aria-label={`${line.channel !== undefined ? pinLabel(line.channel) : line.rail} → ${box.name} · ${line.signal}`}>
                <title>{`${line.channel !== undefined ? pinLabel(line.channel) : line.rail} → ${box.name} · ${line.signal}`}</title>
                <path d={path} stroke="var(--color-surface, white)" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path className="physical-wire-line" d={path} stroke={colorFor(line)} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <g className="physical-wire-tracer" style={{ color: colorFor(line) }} pointerEvents="none" aria-hidden="true">
                  <circle r="4" fill={colorFor(line)} opacity=".75" />
                  <circle r="1.8" fill="white" />
                  <animateMotion path={path} dur="3.4s" begin={`${-index * 0.45}s`} repeatCount="indefinite" calcMode="paced" />
                </g>
                <path d={path} stroke="transparent" strokeWidth="12" fill="none" pointerEvents="stroke" />
              </g>;
            })}
          {contacts.map((pin, i) => {
            const connected = boxes.some((box) =>
              box.lines.some((line) => origin(line) === pin),
            );
            const label =
              pin.modeIndex !== undefined ? pinLabel(pin.modeIndex) : pin.label;
            const connectedLine = boxes.flatMap(box => box.lines).find(line => origin(line) === pin);
            const color = connectedLine ? colorFor(connectedLine) : pin.label === "GND" ? "#626b78" : pin.modeIndex !== undefined ? SIGNAL_COLORS[pin.modeIndex % SIGNAL_COLORS.length]! : "#dc8a2e";
            const activate = () => {
              if (disabled || pin.modeIndex === undefined) return;
              if (pendingSignal) onAssign(pin.modeIndex, pendingSignal.mode);
              else onSelect(pin.modeIndex);
            };
            return (
              <g
                key={i}
                className="physical-wiring-pin"
                onMouseEnter={() => setHoveredWire(pin.modeIndex !== undefined ? `channel-${pin.modeIndex}` : `rail-${pin.label}`)}
                onMouseLeave={() => setHoveredWire(null)}
                onFocus={() => setHoveredWire(pin.modeIndex !== undefined ? `channel-${pin.modeIndex}` : `rail-${pin.label}`)}
                onBlur={() => setHoveredWire(null)}
                data-selected={
                  pin.modeIndex !== undefined && selected === pin.modeIndex
                }
                aria-pressed={
                  pin.modeIndex !== undefined ? selected === pin.modeIndex : undefined
                }
                role={pin.modeIndex !== undefined ? "button" : undefined}
                tabIndex={!disabled && pin.modeIndex !== undefined ? 0 : undefined}
                aria-label={`${label}${pin.modeIndex !== undefined ? ` · ${pin.label}` : ""}`}
                onClick={activate}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                  }
                }}
                style={{
                  cursor:
                    !disabled && pin.modeIndex !== undefined ? "pointer" : undefined,
                }}
              >
                {pin.modeIndex !== undefined && (
                  <rect
                    className="physical-pin-halo"
                    x={pin.x - 13}
                    y={pin.y - 13}
                    width="26"
                    height="26"
                    rx="5"
                    fill="#4e79df"
                    fillOpacity="0.08"
                    stroke="#4e79df"
                    strokeWidth="1.2"
                    pointerEvents="none"
                  />
                )}
                <rect
                  x={pin.x - 9}
                  y={pin.y - 9}
                  width="18"
                  height="18"
                  rx="2"
                  fill={connected ? color : "#e3e6eb"}
                  stroke={selected === pin.modeIndex ? "#4e79df" : "#a3abb7"}
                  strokeWidth={selected === pin.modeIndex ? 2 : 1}
                />
                <text
                  x={pin.x}
                  y={pin.y + (grid.length > 1 && i >= 6 ? 30 : -24)}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#454e5d"
                >
                  {label}
                </text>
              </g>
            );
          })}
          {boxes.map((box) => (
            <g key={box.id}>
              <text
                x="574"
                y={box.y - 10}
                fontSize="14"
                fontWeight="650"
                fill="#252e3d"
              >
                {box.name.length > 28 ? `${box.name.slice(0, 27)}…` : box.name}
              </text>
              <rect
                x="574"
                y={box.y}
                width="205"
                height={box.height}
                rx="12"
                fill={`url(#${gradient})`}
                stroke="#939ba8"
              />
              {box.lines.map((line, i) => (
                <g key={i} className="physical-wire-terminal" data-active={activeWire === wireKey(line)}
                  onMouseEnter={() => setHoveredWire(wireKey(line))} onMouseLeave={() => setHoveredWire(null)}>
                  <title>{`${line.channel !== undefined ? pinLabel(line.channel) : line.rail} → ${box.name} · ${line.signal}`}</title>
                  <rect
                    x="565"
                    y={box.y + 39 + i * 28}
                    width="18"
                    height="18"
                    rx="3"
                    fill={colorFor(line)}
                  />
                  <text x="619" y={box.y + 53 + i * 28} fontSize="12" fill="#454e5d">
                    {line.signal}
                  </text>
                </g>
              ))}
            </g>
          ))}
        </svg>
      </div>
      {selected !== null && !disabled && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-xs">
          <strong>{pinLabel(selected)}</strong>
          {signals.length > 0 && (
            <select
              aria-label={it ? "Assegna segnale" : "Assign signal"}
              value=""
              onChange={(event) => {
                if (event.target.value) onAssign(selected, Number(event.target.value));
              }}
              className="rounded border border-border bg-surface p-1"
            >
              <option value="">{it ? "Scegli segnale…" : "Choose signal…"}</option>
              {signals.map((signal) => (
                <option key={signal.id} value={signal.mode}>
                  {signal.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => onClear(selected)}
            className="text-error"
          >
            {it ? "Libera pin" : "Clear pin"}
          </button>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="ml-auto text-ink-muted"
          >
            {it ? "Chiudi" : "Close"}
          </button>
        </div>
      )}
      {devices.length > 0 && <p className="text-[10px] text-ink-muted">{it ? "Animazione guida dei collegamenti · passa su un filo o un contatto per seguirne il percorso." : "Wiring guide animation · hover a wire or contact to trace its path."}</p>}
      {devices.length > 0 && (
        <details className="shrink-0 rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-ink-muted">
            {it ? "Tabella dei collegamenti" : "Wiring table"}
          </summary>
          <div className="max-h-44 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="bg-surface-sunken text-ink-muted">
                  <th className="p-2">{it ? "Segnale" : "Signal"}</th>
                  <th className="p-2">Backbone</th>
                  <th className="p-2">{it ? "Modulo" : "Module"}</th>
                </tr>
              </thead>
              <tbody>
                {devices.flatMap((device) =>
                  device.lines.map((line, i) => (
                    <tr key={`${device.id}-${i}`} className="border-t border-border">
                      <td className="p-2">{line.signal}</td>
                      <td className="p-2" style={{ color: colorFor(line) }}>
                        {line.channel !== undefined
                          ? pinLabel(line.channel)
                          : origin(line)
                            ? line.rail
                            : `${line.rail} · ${it ? "esterna" : "external"}`}
                      </td>
                      <td className="p-2">
                        {device.name} · {line.signal}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
