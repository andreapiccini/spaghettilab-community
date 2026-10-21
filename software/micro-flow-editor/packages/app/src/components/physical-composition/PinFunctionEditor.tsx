import { DEFAULT_PHYSICAL_SETTINGS } from "@spaghettilab/protocol-sdk";
import {
  ensureW1Config,
  formatPinLabel,
  functionVariantOf,
  modeIndexToPinId,
  signalsForInterface,
  PHYSICAL_CAP,
  type BackbonePhysicalDraft,
  type PortInterfaceKind,
} from "../../lib/backbone-physical.js";
import { assignManualPin } from "../../lib/manual-pin-assignment.js";
import { useState, type ReactNode } from "react";

const selectStyle =
  "mt-1.5 w-full min-w-0 rounded-slmd border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-blue disabled:opacity-50";
type Kind = "none" | "din" | "dout" | Exclude<PortInterfaceKind, "gpio">;
function kindOf(mode: number): Kind {
  const base = mode & 15;
  return base === 1
    ? "din"
    : base === 2 || base === 3
      ? "dout"
      : base === 4 || base === 5
        ? "i2c"
        : base === 6 || base === 7
          ? "uart"
          : base >= 8 && base <= 11
            ? "spi"
            : base === 12
              ? "pwm"
              : base === 13
                ? "w1"
                : base === 14
                  ? "adc"
                  : "none";
}
export function PinFunctionEditor({
  draft,
  index,
  owner,
  capabilities,
  disabled,
  it,
  onChange,
  onPendingChange,
}: {
  readonly draft: BackbonePhysicalDraft;
  readonly index: number;
  readonly owner?: string;
  readonly capabilities: number;
  readonly disabled: boolean;
  readonly it: boolean;
  readonly onChange: (draft: BackbonePhysicalDraft) => void;
  readonly onPendingChange: (pending: boolean) => void;
}) {
  const [pendingKind, setPendingKind] = useState<Kind | null>(null);
  const [error, setError] = useState("");
  const mode = draft.modes[index] ?? 0;
  const kind = pendingKind ?? kindOf(mode);
  const variant = functionVariantOf(draft);
  const name = formatPinLabel(modeIndexToPinId(index, variant), variant);
  const upperBank = variant === "v2" && index >= 4;
  const locked = disabled || !!owner;
  const settings = draft.settings ?? DEFAULT_PHYSICAL_SETTINGS;
  const choices: readonly [Kind, string, number][] = [
    ["none", it ? "Non utilizzato" : "Unused", 0],
    ["din", it ? "Ingresso digitale" : "Digital input", PHYSICAL_CAP.DIGITAL_INPUT],
    ["dout", it ? "Uscita digitale" : "Digital output", PHYSICAL_CAP.DIGITAL_OUTPUT],
    ["pwm", "PWM", PHYSICAL_CAP.PWM],
    ["adc", it ? "Ingresso analogico" : "Analog input", PHYSICAL_CAP.ADC],
    ["i2c", "I²C", PHYSICAL_CAP.I2C],
    ["uart", "UART", PHYSICAL_CAP.UART],
    ["spi", "SPI", PHYSICAL_CAP.SPI],
    ["w1", "1-Wire", PHYSICAL_CAP.W1],
  ];
  const bus = kind === "i2c" || kind === "uart" || kind === "spi" || kind === "w1";
  const signals = bus ? signalsForInterface(kind) : [];
  function commit(nextMode: number) {
    try {
      const modes = assignManualPin(draft.modes, index, nextMode);
      onChange(
        ensureW1Config({
          ...draft,
          modes,
          busUnits: { ...draft.busUnits, i2c: 0, uart: 2, spi: 3 },
          applied: false,
        }),
      );
      setPendingKind(null);
      setError("");
      onPendingChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const label = (title: string, content: ReactNode) => (
    <label className="mt-4 block text-xs text-ink-muted">
      {title}
      {content}
    </label>
  );
  return (
    <aside className="min-w-0 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
      <h3 className="font-heading text-base font-semibold text-ink">{name}</h3>
      <p className="mt-1 text-xs text-ink-muted">
        {owner ?? (it ? "Periferica singola" : "Standalone peripheral")}
      </p>
      {owner && (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {it
            ? "Questo pin appartiene a un modulo. Modifica i collegamenti del modulo per riassegnarlo."
            : "This pin belongs to a module. Edit the module connections to reassign it."}
        </p>
      )}
      {upperBank && (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {it
            ? "A4–A7 richiedono il firmware 0.5.39 o successivo. Su questi pin sono disponibili GPIO, I²C, UART e SPI."
            : "A4–A7 require firmware 0.5.39 or later. These pins support GPIO, I²C, UART and SPI."}
        </p>
      )}
      {label(
        it ? "Funzione" : "Function",
        <select
          className={selectStyle}
          aria-label={it ? "Funzione del pin" : "Pin function"}
          value={kind}
          disabled={locked}
          onChange={(event) => {
            const next = event.target.value as Kind;
            if (["i2c", "uart", "spi", "w1"].includes(next)) {
              setPendingKind(next);
              setError("");
              onPendingChange(true);
            } else
              commit(
                next === "none"
                  ? 0
                  : next === "din"
                    ? 1
                    : next === "dout"
                      ? 2
                      : next === "pwm"
                        ? 12
                        : 14,
              );
          }}
        >
          {choices
            .filter(
              ([key, , cap]) =>
                (!upperBank || !["pwm", "adc", "w1"].includes(key)) &&
                (!cap || !!(capabilities & cap) || key === kind),
            )
            .map(([key, title]) => (
              <option key={key} value={key}>
                {title}
              </option>
            ))}
        </select>,
      )}
      {bus && (
        <>
          <p className="mt-4 text-xs text-ink-muted">
            {it ? "Bus" : "Bus"}
            <span className="mt-1 block text-sm font-medium text-ink">
              {kind === "i2c"
                ? "I²C0"
                : kind === "uart"
                  ? "UART2"
                  : kind === "spi"
                    ? "SPI3"
                    : "1-Wire"}
            </span>
          </p>
          {label(
            it ? `Segnale su ${name}` : `Signal on ${name}`,
            <select
              className={selectStyle}
              aria-label={it ? "Segnale del bus" : "Bus signal"}
              value={pendingKind ? "" : String(mode & 15)}
              disabled={locked}
              onChange={(event) => {
                if (event.target.value) commit(Number(event.target.value));
              }}
            >
              <option value="">{it ? "Scegli il segnale…" : "Choose signal…"}</option>
              {signals.map((signal) => {
                const occupied = draft.modes.some(
                  (m, i) => i !== index && (m & 15) === signal.mode,
                );
                return (
                  <option key={signal.id} value={signal.mode} disabled={occupied}>
                    {signal.label}
                    {occupied ? (it ? " · già assegnato" : " · already assigned") : ""}
                  </option>
                );
              })}
            </select>,
          )}
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            {it
              ? "Tutti i segnali di questa interfaccia appartengono allo stesso bus. Un bus per tipo sul connettore."
              : "All interface signals belong to the same bus. One bus of each type per connector."}
          </p>
        </>
      )}
      {kind === "din" &&
        label(
          it ? "Resistenza interna" : "Internal resistor",
          <select
            disabled={locked}
            className={selectStyle}
            value={mode}
            onChange={(event) => commit(Number(event.target.value))}
          >
            <option value={1}>{it ? "Nessuna" : "None"}</option>
            <option value={17}>Pull-up</option>
            <option value={33}>Pull-down</option>
          </select>,
        )}
      {kind === "dout" &&
        label(
          it ? "Stato iniziale" : "Initial state",
          <select
            disabled={locked}
            className={selectStyle}
            value={mode}
            onChange={(event) => commit(Number(event.target.value))}
          >
            <option value={2}>{it ? "Basso" : "Low"}</option>
            <option value={3}>{it ? "Alto" : "High"}</option>
          </select>,
        )}
      {kind === "i2c" &&
        label(
          it ? "Velocità" : "Speed",
          <select
            disabled={locked}
            className={selectStyle}
            value={draft.i2cSpeed}
            onChange={(event) =>
              onChange({
                ...draft,
                i2cSpeed: Number(event.target.value),
                applied: false,
              })
            }
          >
            <option value={0}>100 kHz</option>
            <option value={1}>400 kHz</option>
          </select>,
        )}
      {(kind === "uart" || kind === "spi" || kind === "pwm") &&
        label(
          kind === "uart" ? "Baud" : it ? "Frequenza (Hz)" : "Frequency (Hz)",
          <input
            type="number"
            className={selectStyle}
            disabled={locked}
            min={kind === "uart" ? 1200 : kind === "spi" ? 10000 : 1}
            max={kind === "uart" ? 2000000 : kind === "spi" ? 20000000 : 20000}
            value={
              kind === "uart"
                ? settings.baud
                : kind === "spi"
                  ? settings.spiHz
                  : settings.pwmHz
            }
            onChange={(event) => {
              const value = event.target.valueAsNumber;
              if (Number.isInteger(value))
                onChange({
                  ...draft,
                  settings: {
                    ...settings,
                    [kind === "uart" ? "baud" : kind === "spi" ? "spiHz" : "pwmHz"]:
                      value,
                  },
                  applied: false,
                });
            }}
          />,
        )}
      {kind === "spi" &&
        label(
          it ? "Modalità SPI" : "SPI mode",
          <select
            disabled={locked}
            className={selectStyle}
            value={settings.spiMode}
            onChange={(event) =>
              onChange({
                ...draft,
                settings: {
                  ...settings,
                  spiMode: Number(event.target.value) as 0 | 1 | 2 | 3,
                },
                applied: false,
              })
            }
          >
            {[0, 1, 2, 3].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>,
        )}
      {kind === "uart" && (
        <>
          {label(
            it ? "Bit dati" : "Data bits",
            <select
              className={selectStyle}
              disabled={locked}
              value={settings.dataBits}
              onChange={(e) =>
                onChange({
                  ...draft,
                  settings: { ...settings, dataBits: Number(e.target.value) as 7 | 8 },
                  applied: false,
                })
              }
            >
              <option value={7}>7</option>
              <option value={8}>8</option>
            </select>,
          )}
          {label(
            it ? "Parità" : "Parity",
            <select
              className={selectStyle}
              disabled={locked}
              value={settings.parity}
              onChange={(e) =>
                onChange({
                  ...draft,
                  settings: {
                    ...settings,
                    parity: e.target.value as "none" | "even" | "odd",
                  },
                  applied: false,
                })
              }
            >
              <option value="none">{it ? "Nessuna" : "None"}</option>
              <option value="even">{it ? "Pari" : "Even"}</option>
              <option value="odd">{it ? "Dispari" : "Odd"}</option>
            </select>,
          )}
          {label(
            "Stop bit",
            <select
              className={selectStyle}
              disabled={locked}
              value={settings.stopBits}
              onChange={(e) =>
                onChange({
                  ...draft,
                  settings: { ...settings, stopBits: Number(e.target.value) as 1 | 2 },
                  applied: false,
                })
              }
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>,
          )}
        </>
      )}
      {kind === "spi" &&
        label(
          it ? "Ordine bit" : "Bit order",
          <select
            className={selectStyle}
            disabled={locked}
            value={settings.bitOrder}
            onChange={(e) =>
              onChange({
                ...draft,
                settings: { ...settings, bitOrder: e.target.value as "msb" | "lsb" },
                applied: false,
              })
            }
          >
            <option value="msb">MSB</option>
            <option value="lsb">LSB</option>
          </select>,
        )}
      {kind === "pwm" &&
        label(
          it ? "Polarità" : "Polarity",
          <select
            className={selectStyle}
            disabled={locked}
            value={String(settings.pwmInverted)}
            onChange={(e) =>
              onChange({
                ...draft,
                settings: { ...settings, pwmInverted: e.target.value === "true" },
                applied: false,
              })
            }
          >
            <option value="false">{it ? "Normale" : "Normal"}</option>
            <option value="true">{it ? "Invertita" : "Inverted"}</option>
          </select>,
        )}
      {error && (
        <p className="mt-3 text-xs text-error" role="alert">
          {error}
        </p>
      )}
      {pendingKind && (
        <p className="mt-3 text-xs text-ink-muted" role="status">
          {it
            ? "Scegli un segnale per completare la modifica."
            : "Choose a signal to complete this change."}
        </p>
      )}
    </aside>
  );
}
