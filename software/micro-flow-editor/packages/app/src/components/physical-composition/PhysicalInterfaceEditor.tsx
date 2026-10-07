import {
  DEFAULT_PHYSICAL_SETTINGS,
  type PhysicalInterfaceSettings,
} from "@spaghettilab/protocol-sdk";
import { Cpu, Info, LockKeyhole } from "lucide-react";
import {
  pinsForModes,
  validatePhysicalModes,
  type BackbonePhysicalDraft,
} from "../../lib/backbone-physical.js";

const input =
  "w-full rounded-slmd border border-border-strong bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-brand-blue disabled:opacity-50";
export function PhysicalInterfaceEditor({
  draft,
  capabilities,
  extended,
  disabled,
  onChange,
}: {
  readonly draft: BackbonePhysicalDraft;
  readonly capabilities: number;
  readonly extended: boolean;
  readonly disabled: boolean;
  readonly onChange: (draft: BackbonePhysicalDraft) => void;
}) {
  const settings = draft.settings ?? DEFAULT_PHYSICAL_SETTINGS;
  const updateSettings = (patch: Partial<PhysicalInterfaceSettings>) =>
    onChange({ ...draft, settings: { ...settings, ...patch } });
  const base = draft.modes.map((mode) => mode & 15);
  const kind = base.includes(8)
    ? "spi"
    : base.includes(6)
      ? "uart"
      : base.includes(4)
        ? "i2c"
        : base.includes(12)
          ? "pwm"
          : "gpio";
  const presets: Record<string, readonly number[]> = {
    gpio: [0, 0, 0, 0],
    i2c: [4, 5, 0, 0],
    uart: [6, 7, 0, 0],
    spi: [8, 9, 10, 11],
    pwm: [12, 0, 0, 0],
  };
  const modes = [
    0,
    1,
    17,
    33,
    2,
    ...(capabilities & 1 ? [4, 5] : []),
    ...(extended && capabilities & 4 ? [6, 7] : []),
    ...(extended && capabilities & 2 ? [8, 9, 10, 11] : []),
    ...(extended && capabilities & 128 ? [12] : []),
  ];
  const number = (
    label: string,
    key: "baud" | "spiHz" | "pwmHz",
    min: number,
    max: number,
  ) => (
    <label className="block text-xs text-ink-muted">
      {label}
      <input
        className={`${input} mt-1`}
        type="number"
        min={min}
        max={max}
        value={settings[key]}
        disabled={disabled}
        onChange={(event) => updateSettings({ [key]: Number(event.target.value) })}
      />
    </label>
  );
  const invalid = validatePhysicalModes(draft.modes, draft.i2cSpeed);
  return (
    <div className="space-y-4">
      <label className="block text-xs text-ink-muted">
        Interfaccia
        <select
          className={`${input} mt-2`}
          value={kind}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, modes: presets[event.target.value]!, settings })
          }
        >
          <option value="gpio">GPIO · ingressi / uscite</option>
          <option value="i2c" disabled={!(capabilities & 1)}>
            I²C
          </option>
          <option value="uart" disabled={!extended || !(capabilities & 4)}>
            UART
          </option>
          <option value="spi" disabled={!extended || !(capabilities & 2)}>
            SPI
          </option>
          <option value="pwm" disabled={!extended || !(capabilities & 128)}>
            PWM
          </option>
          <option disabled>ADC · questi GPIO non hanno ingressi analogici</option>
          <option disabled>CAN · controller occupato dalla rete backbone</option>
        </select>
      </label>
      {!extended && (
        <p className="rounded-slmd bg-brand-orange/10 p-3 text-xs text-ink-muted">
          Aggiorna il firmware a 0.3.1 per UART, SPI, PWM e assegnazione libera dei
          segnali.
        </p>
      )}
      <div className="space-y-2">
        <Fixed pin={1} label="5V" />
        {draft.modes.map((mode, index) => (
          <div key={index} className="rounded-slmd border border-border px-3 py-2">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex-1 text-xs font-semibold text-ink">
                Pin {index + 2}
              </span>
              <Cpu size={11} className="text-ink-faint" />
              <span className="font-mono text-[10px] text-ink-faint">
                GPIO {38 - index}
              </span>
            </div>
            <select
              className={input}
              value={mode === 3 ? 2 : mode}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...draft,
                  modes: draft.modes.map((current, i) =>
                    i === index ? Number(event.target.value) : current,
                  ),
                  settings,
                })
              }
            >
              {modes.map((value) => (
                <option key={value} value={value}>
                  {value === 0 ? "Non utilizzato" : pinsForModes([value])[1]}
                </option>
              ))}
            </select>
          </div>
        ))}
        <Fixed pin={6} label="GND" />
      </div>
      <p className="flex gap-2 rounded-slmd bg-surface-sunken p-3 text-[11px] leading-relaxed text-ink-muted">
        <Info size={14} className="shrink-0" />
        Il cablaggio GPIO ↔ pin del modulo è fisso. Qui scegli il segnale assegnato a
        ciascun pin. GPIO OUT e PWM vengono comandati dai blocchi durante l’esecuzione;
        al collegamento partono nello stato sicuro.
      </p>
      {base.includes(4) && (
        <label className="block text-xs text-ink-muted">
          Clock I²C
          <select
            className={`${input} mt-1`}
            disabled={disabled}
            value={draft.i2cSpeed}
            onChange={(event) =>
              onChange({ ...draft, i2cSpeed: Number(event.target.value), settings })
            }
          >
            <option value={0}>100 kHz</option>
            <option value={1}>400 kHz</option>
          </select>
        </label>
      )}
      {base.includes(6) && (
        <div className="grid grid-cols-2 gap-3">
          {number("Baud rate", "baud", 1200, 2000000)}
          <label className="text-xs text-ink-muted">
            Bit dati
            <select
              className={`${input} mt-1`}
              disabled={disabled}
              value={settings.dataBits}
              onChange={(event) =>
                updateSettings({ dataBits: Number(event.target.value) as 7 | 8 })
              }
            >
              <option>7</option>
              <option>8</option>
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            Parità
            <select
              className={`${input} mt-1`}
              disabled={disabled}
              value={settings.parity}
              onChange={(event) =>
                updateSettings({
                  parity: event.target.value as PhysicalInterfaceSettings["parity"],
                })
              }
            >
              <option value="none">Nessuna</option>
              <option value="even">Pari</option>
              <option value="odd">Dispari</option>
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            Stop bit
            <select
              className={`${input} mt-1`}
              disabled={disabled}
              value={settings.stopBits}
              onChange={(event) =>
                updateSettings({ stopBits: Number(event.target.value) as 1 | 2 })
              }
            >
              <option>1</option>
              <option>2</option>
            </select>
          </label>
        </div>
      )}
      {base.includes(8) && (
        <div className="grid grid-cols-2 gap-3">
          {number("Clock SPI (Hz)", "spiHz", 10000, 20000000)}
          <label className="text-xs text-ink-muted">
            Modo SPI
            <select
              className={`${input} mt-1`}
              disabled={disabled}
              value={settings.spiMode}
              onChange={(event) =>
                updateSettings({ spiMode: Number(event.target.value) as 0 | 1 | 2 | 3 })
              }
            >
              {[0, 1, 2, 3].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            Ordine dei bit
            <select
              className={`${input} mt-1`}
              disabled={disabled}
              value={settings.bitOrder}
              onChange={(event) =>
                updateSettings({ bitOrder: event.target.value as "msb" | "lsb" })
              }
            >
              <option value="msb">MSB prima</option>
              <option value="lsb">LSB prima</option>
            </select>
          </label>
        </div>
      )}
      {base.includes(12) && (
        <div className="grid grid-cols-2 gap-3">
          {number("Frequenza PWM (Hz)", "pwmHz", 1, 20000)}
          <label className="text-xs text-ink-muted">
            Polarità
            <select
              className={`${input} mt-1`}
              disabled={disabled}
              value={settings.pwmInverted ? "inverted" : "normal"}
              onChange={(event) =>
                updateSettings({ pwmInverted: event.target.value === "inverted" })
              }
            >
              <option value="normal">Normale</option>
              <option value="inverted">Invertita</option>
            </select>
          </label>
        </div>
      )}
      {invalid && (
        <p role="status" className="text-xs text-error">
          {invalid}
        </p>
      )}
    </div>
  );
}
function Fixed({ pin, label }: { readonly pin: number; readonly label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-slmd bg-surface-sunken px-3 py-2 text-xs">
      <span className="flex-1 text-ink-muted">Pin {pin}</span>
      <strong>{label}</strong>
      <LockKeyhole size={12} className="text-ink-faint" />
    </div>
  );
}
