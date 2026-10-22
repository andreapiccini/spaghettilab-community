import { RgbRing } from "../processing-graph/RgbRing.js";
import { useId, type ReactNode } from "react";
import type { GpioHardwareAppearance } from "../../lib/device-recipe-draft.js";

/** Perspective and line weight are shared; each device keeps its physical silhouette. */
export function ModuleArtwork({
  kind = "generic",
  name,
  glyph,
  lightColor,
  active = false,
  intensity = 1,
}: {
  kind?: GpioHardwareAppearance["kind"];
  name: string;
  glyph?: ReactNode;
  lightColor?: string;
  active?: boolean;
  intensity?: number;
}) {
  const id = useId().replaceAll(":", "");
  const face = `url(#${id}-face)`;
  if (kind === "rgb" && !glyph) return <div className="flex h-full w-full items-center justify-center" role="img" aria-label={name}><RgbRing /></div>;
  const lamp = active ? (lightColor ?? "#e7a2a2") : "#e5ebf3";
  return (
    <svg
      viewBox="0 0 96 104"
      className="block h-full w-full"
      role="img"
      aria-label={name}
    >
      <defs>
        <linearGradient id={`${id}-face`} x2="1" y2="1">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#dfe5ee" />
        </linearGradient>
      </defs>
      <g
        stroke="#485362"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {!glyph && kind === "buzzer" ? (
          <>
            <Board />
            <path d="M27 37v29c0 8 46 8 46 0V37Z" fill="#c6cfdb" />
            <path d="M30 63c8 6 32 6 40 0" fill="none" stroke="#929fb0" />
            <ellipse cx="50" cy="37" rx="23" ry="13" fill={face} />
            <ellipse cx="50" cy="36" rx="5" ry="3" fill="#657387" />
            <path d="M35 32q5-4 11-4" fill="none" stroke="#a3aebc" />
            <path d="m37 82-8 5m17-1-8 5m17-1-8 5" />
            {active && (
              <path d="M78 30q8 8 0 16m5-21q13 13 0 26" fill="none" stroke="#7193b2" />
            )}
          </>
        ) : !glyph && kind === "relay" ? (
          <>
            <Board />
            <path d="m25 39 27-15 23 14-28 16Z" fill={active ? "#d5e6df" : "#f3f6fa"} />
            <path d="m25 39 22 15v24L25 64Z" fill={face} />
            <path d="m47 54 28-16v24L47 78Z" fill={active ? "#bed7cd" : "#cbd5e4"} />
            <path
              d="m31 49 10 6m-10-1 10 6m13-1 14-8"
              fill="none"
              stroke="#96a3b3"
              strokeWidth="1.2"
            />
            <path d="m18 69 10-6 15 9-11 6Z" fill="#d8e2eb" />
            <path d="m18 69v8l14 8v-7m0 7 11-6v-7" fill="#c1cdda" />
            {[0, 1].map((n) => (
              <g key={n}>
                <ellipse
                  cx={25 + n * 8}
                  cy={70 + n * 4.5}
                  rx="2.5"
                  ry="1.6"
                  fill="#f9fbfd"
                />
                <path d={`m${23 + n * 8} ${70 + n * 4.5} 4 0`} strokeWidth="1" />
              </g>
            ))}
            <path
              d={active ? "m55 65 6-3 6-4" : "m55 65 6-3 1-7m4 3 3-2"}
              fill="none"
            />
          </>
        ) : !glyph && kind === "motor" ? (
          <>
            <path d="m31 28 12-7 8 9-11 6Zm26 43 13-6 6 10-13 7Z" fill="#d4dce7" />
            <path
              d="M25 37 48 23c12-7 32 9 35 24 2 9-1 16-8 21L51 82Z"
              fill="#c5cfdc"
            />
            <path d="m43 30 23 43m-16-48 23 44" stroke="#9ca9ba" strokeWidth="1.2" />
            <ellipse
              cx="37"
              cy="60"
              rx="22"
              ry="26"
              transform="rotate(-28 37 60)"
              fill={face}
            />
            <ellipse
              cx="37"
              cy="60"
              rx="15"
              ry="18"
              transform="rotate(-28 37 60)"
              fill="#e6ebf2"
            />
            <ellipse
              cx="37"
              cy="60"
              rx="7"
              ry="9"
              transform="rotate(-28 37 60)"
              fill="#bfcada"
            />
            <path d="m36 55-23 15-1 8 6 3 23-16v-7Z" fill="#d9e1ec" />
            <path d="m13 70 5 3 23-15m-23 15v8" fill="none" />
            <circle cx="29" cy="41" r="1.8" fill="#8997a9" />
            <circle cx="48" cy="77" r="1.8" fill="#8997a9" />
            <path d="m70 52 9 6 3-3m-12 3 9 6 3-3" fill="none" stroke="#8799ae" />
          </>
        ) : !glyph && (kind === "led" || kind === "rgb") ? (
          <>
            <path d="M41 65v25l-9 5m25-30v20l-7 4" fill="none" strokeWidth="2.3" />
            <path
              d="M32 48V38c0-26 35-26 35 0v10Z"
              fill={lamp}
              fillOpacity={active ? Math.max(0.15, Math.min(1, intensity)) : 1}
            />
            <ellipse cx="49.5" cy="50" rx="20" ry="11" fill={face} />
            <path
              d="M32 45c1 7 34 7 35 0v12c-1 12-35 12-35 0Z"
              fill={lamp}
              fillOpacity={active ? Math.max(0.15, Math.min(1, intensity)) : 1}
            />
            <path d="M39 34q0-12 9-14" fill="none" stroke="#f9fbfe" strokeWidth="3" />
            {kind === "rgb" && (
              <>
                <circle cx="42" cy="45" r="3" fill="#d5a2a8" stroke="none" />
                <circle cx="57" cy="45" r="3" fill="#9cbca8" stroke="none" />
                <circle cx="50" cy="36" r="3" fill="#95add8" stroke="none" />
              </>
            )}
          </>
        ) : !glyph && kind === "mosfet" ? (
          <>
            <path d="m34 57-2 32m15-27-2 31m15-24-2 29" fill="none" strokeWidth="2.6" />
            <path d="m31 29 23-13 14 8-23 14Z" fill="#e3e9f1" />
            <path d="m45 38 23-14v39L45 77Z" fill="#9caabd" />
            <path d="m31 29 14 9v39l-14-9Z" fill="#d7e0ec" />
            <ellipse
              cx="53"
              cy="33"
              rx="3.3"
              ry="5"
              transform="rotate(28 53 33)"
              fill="#f7f9fc"
            />
            <path
              d="m48 47 14-8m-14 15 14-8m-14 15 14-8"
              stroke="#62758c"
              strokeWidth="1.3"
            />
          </>
        ) : !glyph && kind === "button" ? (
          <>
            <Board />
            <path d="m27 57 23-13 20 12-23 13Z" fill="#d4deea" />
            <path d="m27 57v14l20 12V69m0 14 23-13V56" fill="#bfcbdc" />
            <path d="M35 42v19c0 9 28 9 28 0V42Z" fill="#c5d0df" />
            <ellipse cx="49" cy="42" rx="14" ry="9" fill={active ? "#c4d8d1" : face} />
            <ellipse cx="49" cy="42" rx="10" ry="6" fill="#f8fafc" />
          </>
        ) : !glyph && kind === "sensor" && name.toUpperCase().includes("DS18B20") ? (
          <><path d="M29 39c0-21 39-24 39-3v24c0 14-39 18-39 3Z" fill="#647080"/><path d="M29 39c0-14 39-17 39-3v24c0 14-39 18-39 3Z" fill={face}/><path d="m35 73-1 25m15-23v25m13-27 2 23" fill="none"/><path d="m38 51 19-3m-19 9 19-3" stroke="#8395aa"/></>
        ) : !glyph && kind === "sensor" ? (
          <>
            <path d="m28 29 26-14 15 9-26 14Z" fill="#f7f9fc" />
            <path d="m43 38 26-14v49L43 88Z" fill={name.toUpperCase().includes("DHT11") ? "#a9c6e6" : "#d1dce8"} />
            <path d="m28 29 15 9v50l-15-9Z" fill={face} />
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <path
                key={n}
                d={`m49 ${42 + n * 6} 14-8`}
                stroke="#8395aa"
                strokeWidth="2.2"
              />
            ))}
            <path d="m36 83-1 13m11-8-1 11m11-16-1 12m10-17-1 12" fill="none" />
          </>
        ) : !glyph && (kind === "potentiometer" || kind === "joystick") ? (
          <>
            <Board />
            <path d="M28 59v12c0 14 43 14 43 0V59Z" fill="#bfcbdc" />
            <ellipse cx="49.5" cy="59" rx="21.5" ry="12" fill={face} />
            <path d="M44 55V31l11-6v27" fill="#a9b7ca" />
            {kind === "joystick" ? (
              <ellipse cx="49" cy="28" rx="18" ry="13" fill="#8392a7" />
            ) : (
              <>
                <path d="M41 25v13c0 6 18 6 18 0V25Z" fill="#b8c7db" />
                <ellipse cx="50" cy="25" rx="9" ry="5" fill="#f2f6fa" />
                <path d="M50 21v8" />
              </>
            )}
          </>
        ) : (
          <>
            <path d="M18 34 50 16 79 33 47 52Z" fill="#f5f7fa" />
            <path d="M47 52 79 33V68L47 87Z" fill="#dbe1e9" />
            <path d="M18 34 47 52V87L18 69Z" fill={face} />
            <path
              d="m24 31 27-15M53 21l20 12v32L53 77"
              fill="none"
              stroke="#8b96a5"
              strokeWidth="1.2"
            />
            <g transform="matrix(1 .62 0 1 18 34)">
              {glyph ? (
                <g transform="translate(5 7)">{glyph}</g>
              ) : (
                <>
                  <rect x="8" y="10" width="15" height="16" rx="2" fill="#cbd5e3" />
                  {[12, 18, 24].map((y) => (
                    <path key={y} d={`M4 ${y}h4m15 0h4`} />
                  ))}
                </>
              )}
            </g>
          </>
        )}
      </g>
    </svg>
  );
}
function Board() {
  return (
    <>
      <path d="m12 73 35-20 37 21-36 21Z" fill="#edf2f7" />
      <path d="m12 73v4l36 22v-4m0 4 36-21v-4" fill="#c9d6e5" />
      <ellipse cx="22" cy="74" rx="2" ry="1.2" fill="#fff" />
      <ellipse cx="74" cy="75" rx="2" ry="1.2" fill="#fff" />
    </>
  );
}
