import { useId } from "react";
import type { GpioHardwareAppearance } from "../../lib/device-recipe-draft.js";

export type HardwareTerminal = {
  id: string;
  label: string;
  kind: "signal" | "power" | "ground" | "contact";
};
/** Shared front-view artwork. Geometry is illustrative; terminal labels are authoritative. */
export function HardwareIllustration({
  kind,
  name,
  terminals,
  onSelectTerminal,
}: {
  kind: GpioHardwareAppearance["kind"] | "connector-v1" | "connector-v2";
  name: string;
  terminals: readonly HardwareTerminal[];
  onSelectTerminal?: (id: string) => void;
}) {
  const id = useId().replaceAll(":", "");
  const bodyHeight = Math.max(132, (terminals.length - 1) * 30 + 58);
  const h = bodyHeight + 70;
  const top = 35;
  return (
    <svg
      className="hardware-illustration"
      viewBox={`0 0 650 ${h}`}
      role="group"
      aria-label={`${name}: ${terminals.map((t) => t.label).join(", ")}`}
    >
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#e4e8ef" />
        </linearGradient>
        <radialGradient id={`${id}-lens`}>
          <stop stopColor={kind === "rgb" ? "#f8edff" : "#fff4ed"} />
          <stop offset="1" stopColor={kind === "rgb" ? "#aab9ec" : "#e9a5a0"} />
        </radialGradient>
      </defs>
      <g
        stroke="#454e5d"
        strokeWidth="2.2"
        strokeLinejoin="round"
        fill={`url(#${id}-body)`}
      >
        <rect x="258" y={top} width="158" height={bodyHeight} rx="13" />
        {[268, 406].flatMap((x) =>
          [top + 10, top + bodyHeight - 10].map((y) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="3.7" fill="#f6f7fa" />
              <path d={`M${x - 2},${y - 2} l4,4`} strokeWidth="1" />
            </g>
          )),
        )}
        <g transform={`translate(0 ${(bodyHeight - 132) / 2})`}>
          {kind === "button" && (
            <>
              <circle cx="337" cy={top + 72} r="29" />
              <circle cx="337" cy={top + 72} r="22" fill="#f9fafc" strokeWidth="3" />
            </>
          )}
          {(kind === "rgb" || kind === "led") && (
            <>
              <path
                d={`M314 ${top + 96} v-36 a23 23 0 0 1 46 0 v36z`}
                fill={`url(#${id}-lens)`}
              />
              <path
                d={`M309 ${top + 97}h56 M323 ${top + 100}v15 M351 ${top + 100}v15`}
              />
              {kind === "rgb" && (
                <>
                  <circle cx="329" cy={top + 73} r="5" fill="#dc9b9b" stroke="none" />
                  <circle cx="345" cy={top + 73} r="5" fill="#9fc5af" stroke="none" />
                  <circle cx="337" cy={top + 60} r="5" fill="#9aade4" stroke="none" />
                </>
              )}
            </>
          )}
          {kind === "relay" && (
            <>
              <rect x="293" y={top + 41} width="88" height="55" rx="5" fill="#d4deef" />
              <path
                d={`M305 ${top + 80}h18 l16,-24 M346 ${top + 58}h24 M346 ${top + 82}h24`}
              />
              <circle cx="322" cy={top + 80} r="3" fill="#fff" />
            </>
          )}
          {kind === "mosfet" && (
            <>
              <rect x="315" y={top + 40} width="44" height="49" rx="4" fill="#626b78" />
              <circle cx="337" cy={top + 50} r="4" fill="#dbe0e8" />
              <path d={`M325 ${top + 89}v22 M337 ${top + 89}v22 M349 ${top + 89}v22`} />
            </>
          )}
          {(kind === "sensor" || kind === "generic") && (
            <>
              <rect x="311" y={top + 49} width="52" height="42" rx="5" fill="#e4eaf5" />
              {[0, 1, 2, 3].map((i) => (
                <path
                  key={i}
                  d={`M${319 + i * 12} ${top + 42}v7 M${319 + i * 12} ${top + 91}v7 M304 ${top + 55 + i * 10}h7 M363 ${top + 55 + i * 10}h7`}
                />
              ))}
              <circle cx="337" cy={top + 70} r="9" fill="#f8faff" stroke="#7795da" />
            </>
          )}
          {(kind === "potentiometer" || kind === "joystick") && (
            <>
              <circle cx="337" cy={top + 73} r="29" fill="#cbd1db" />
              <circle cx="337" cy={top + 73} r="21" fill="#f7f8fb" />
              <path d={`M337 ${top + 73}l-10,-17`} strokeWidth="4" />
              {kind === "joystick" && (
                <circle cx="337" cy={top + 65} r="18" fill="#6a7383" />
              )}
            </>
          )}
          {kind === "buzzer" && (
            <>
              <circle cx="337" cy={top + 73} r="27" fill="#697280" />
              <circle cx="337" cy={top + 73} r="5" fill="#303948" />
            </>
          )}
          {kind === "motor" && (
            <>
              <rect
                x="300"
                y={top + 51}
                width="65"
                height="43"
                rx="13"
                fill="#bfc7d3"
              />
              <path d={`M365 ${top + 72}h16`} strokeWidth="6" />
              <path d={`M308 ${top + 51}v43 M318 ${top + 51}v43`} stroke="#8f99a9" />
            </>
          )}
          {kind.startsWith("connector-") &&
            Array.from({ length: kind === "connector-v1" ? 6 : 12 }, (_, i) => (
              <rect
                key={i}
                x={285 + (i % 6) * 19}
                y={top + 50 + Math.floor(i / 6) * 25}
                width="11"
                height="16"
                rx="2"
                fill="#bac8e1"
              />
            ))}
        </g>
      </g>
      <text
        x="337"
        y={top + 29}
        textAnchor="middle"
        fill="#252e3d"
        fontSize="13"
        fontWeight="650"
      >
        {name.length > 21 ? `${name.slice(0, 20)}…` : name}
      </text>
      {terminals.map((terminal, index) => {
        const y = (h - (terminals.length - 1) * 30) / 2 + index * 30;
        const color =
          terminal.kind === "power"
            ? "#ae795a"
            : terminal.kind === "ground"
              ? "#68717d"
              : terminal.kind === "contact"
                ? "#648875"
                : "#4e75df";
        const anchor = y;
        return (
          <g
            key={terminal.id}
            className={onSelectTerminal ? "is-interactive" : undefined}
            role={onSelectTerminal ? "button" : undefined}
            tabIndex={onSelectTerminal ? 0 : undefined}
            aria-label={terminal.label}
            onClick={() => onSelectTerminal?.(terminal.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectTerminal?.(terminal.id);
              }
            }}
          >
            <path d={`M106 ${y}H258`} fill="none" stroke={color} strokeWidth="2.6" />
            <circle cx="106" cy={y} r="4" fill={color} />
            <rect
              x="253"
              y={anchor - 5}
              width="8"
              height="10"
              rx="2"
              fill={color}
              stroke="#454e5d"
            />
            <text x="114" y={y - 8} fill={color} fontSize="12" fontWeight="550">
              {terminal.label}
            </text>
            <rect x="92" y={y - 23} width="165" height="31" fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}
