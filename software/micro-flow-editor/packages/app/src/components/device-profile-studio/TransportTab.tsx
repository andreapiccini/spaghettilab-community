import { PortCapability, PortTransport } from "@spaghettilab/device-profile-authoring-model";
import { Plug, TriangleAlert } from "lucide-react";
import { deviceProfileCopy } from "../../lib/device-profile-copy.js";
import { useLocale } from "../../state/locale-context.js";

const TRANSPORT_OPTIONS: readonly { readonly value: number; readonly label: string }[] = [
  { value: PortTransport.I2C, label: "I2C" },
  { value: PortTransport.SPI, label: "SPI" },
  { value: PortTransport.UART, label: "UART" },
  { value: PortTransport.GPIO, label: "GPIO" },
  { value: PortTransport.ADC, label: "ADC" },
  { value: PortTransport.W1, label: "1-Wire" },
];

const CAPABILITY_OPTIONS: readonly { readonly bit: number; readonly label: string }[] = [
  { bit: PortCapability.I2C, label: "I2C" },
  { bit: PortCapability.SPI, label: "SPI" },
  { bit: PortCapability.UART, label: "UART" },
  { bit: PortCapability.DIGITAL_INPUT, label: "Digital input" },
  { bit: PortCapability.DIGITAL_OUTPUT, label: "Digital output" },
  { bit: PortCapability.ADC, label: "ADC" },
  { bit: PortCapability.W1, label: "1-Wire" },
];

/**
 * `ux/screens/S060-device-profile-studio/visual.md` § Tab Transport & Elettrico.
 * The "Vincoli da Bay" banner (tensione/modalità/frequenza max) is a documented
 * gap: `@spaghettilab/catalog-model`'s `RailEntry`/`FunctionBayEntry` carry only
 * raw `assurance`/`admission`/`maxTotalMicroamps` — no voltage, electrical mode,
 * or max-frequency field exists anywhere in the topology model (same gap already
 * found wiring `UI-S040`/`UI-S050`). A profile isn't tied to a specific Bay while
 * authoring anyway (that happens at "Instanzia come Module" time, in Physical
 * Composition) — so this always shows the honest "not yet associated" state,
 * never a fabricated constraint.
 */
export function TransportTab({ transport, onTransport, requiredCapabilities, onRequiredCapabilities }: { readonly transport: number; readonly onTransport: (v: number) => void; readonly requiredCapabilities: number; readonly onRequiredCapabilities: (v: number) => void }) {
  const { locale } = useLocale();
  const copy = deviceProfileCopy(locale);
  return (
    <div className="flex max-w-xl flex-col gap-4 p-6">
      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">Transport</label>
        <div className="flex flex-wrap gap-1 rounded-slpill border border-border bg-surface p-1">
          {TRANSPORT_OPTIONS.map((t) => (
            <button key={t.value} type="button" onClick={() => onTransport(t.value)} className={`rounded-slpill px-3 py-1.5 font-body text-sm ${transport === t.value ? "bg-brand-blue text-white" : "text-ink-muted"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted">{copy.requiredCapabilities}</label>
        <div className="flex flex-col gap-1">
          {CAPABILITY_OPTIONS.map((c) => (
            <label key={c.bit} className="flex items-center gap-2 font-body text-sm text-ink">
              <input type="checkbox" checked={(requiredCapabilities & c.bit) !== 0} onChange={(e) => onRequiredCapabilities(e.target.checked ? requiredCapabilities | c.bit : requiredCapabilities & ~c.bit)} />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-slsm border-l-4 border-warning bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-3">
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
        <div>
          <p className="font-body text-sm text-ink">{copy.noBayConstraint}</p>
          <p className="font-body text-xs text-ink-muted">{copy.bayConstraintBody}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 font-body text-xs text-ink-faint">
        <Plug size={14} />
        Bitmask capability corrente: {requiredCapabilities} (0b{requiredCapabilities.toString(2).padStart(7, "0")})
      </div>
    </div>
  );
}
