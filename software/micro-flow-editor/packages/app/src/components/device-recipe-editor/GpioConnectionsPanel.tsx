import { GPIO_DRIVER_PRESETS, applyGpioPreset } from "../../lib/gpio-driver-presets.js";
import { useRef, useState } from "react";
import type {
  DeviceRecipeDraft,
  GpioHardwareAppearance,
} from "../../lib/device-recipe-draft.js";
import {
  HardwareIllustration,
  type HardwareTerminal,
} from "../hardware/HardwareIllustration.js";
import { GpioGeneralPanel, GpioSignalsPanel } from "./GpioDriverPanels.js";

const kinds: readonly [GpioHardwareAppearance["kind"], string, string][] = [
  ["generic", "Modulo generico", "Generic module"],
  ["button", "Pulsante", "Button"],
  ["led", "LED", "LED"],
  ["rgb", "LED RGB", "RGB LED"],
  ["mosfet", "MOSFET", "MOSFET"],
  ["relay", "Relè", "Relay"],
  ["sensor", "Sensore", "Sensor"],
  ["potentiometer", "Potenziometro", "Potentiometer"],
  ["joystick", "Joystick", "Joystick"],
  ["buzzer", "Cicalino", "Buzzer"],
  ["motor", "Driver motore", "Motor driver"],
];
export function GpioConnectionsPanel({
  draft,
  it,
  onChange,
}: {
  draft: DeviceRecipeDraft;
  it: boolean;
  onChange: (next: DeviceRecipeDraft) => void;
}) {
  const form = useRef<HTMLDivElement>(null);
  const powerSelect = useRef<HTMLSelectElement>(null);
  const groundCheckbox = useRef<HTMLInputElement>(null);
  const contacts = useRef<HTMLDetailsElement>(null);
  const appearance: GpioHardwareAppearance = draft.gpioHardware ?? {
    kind: "generic",
    power: "none",
    ground: false,
    extraTerminals: [],
  };
  function patch(value: Partial<GpioHardwareAppearance>) {
    onChange({ ...draft, gpioHardware: { ...appearance, ...value } });
  }
  const terminals: HardwareTerminal[] = [
    ...draft.binding.gpioSignals.map((s) => ({
      id: s.id,
      label: s.name,
      kind: "signal" as const,
    })),
    ...(appearance.power !== "none"
      ? [
          {
            id: "hardware-vcc",
            label: `VCC · ${appearance.power === "3.3" ? "3,3" : "5"} V`,
            kind: "power" as const,
          },
        ]
      : []),
    ...(appearance.ground
      ? [{ id: "hardware-gnd", label: "GND", kind: "ground" as const }]
      : []),
    ...appearance.extraTerminals.map((label, i) => ({
      id: `hardware-extra-${i}`,
      label,
      kind: "contact" as const,
    })),
  ];
  const canUsePreset =
    draft.binding.gpioSignals.length === 0 &&
    draft.commands.length === 0 &&
    draft.channels.length === 0 &&
    draft.variables.length === 0 &&
    draft.phases.init.length === 0 &&
    !draft.flowInterfaces?.length &&
    !draft.gpioEvents?.length;
  return (
    <div className="gpio-connections">
      <header className="gpio-page-heading">
        <h1>{it ? "Collegamenti" : "Connections"}</h1>
        <p>
          {it
            ? "Definisci i terminali del dispositivo. I pin della Backbone si assegnano quando lo colleghi."
            : "Define the device terminals. Backbone pins are assigned when connecting it."}
        </p>
      </header>
      {canUsePreset && (
        <section className="gpio-preset-picker">
          <h2>{it ? "Parti da un dispositivo" : "Start with a device"}</h2>
          <p>
            {it
              ? "Un modello prepara terminali e azioni. Puoi modificare ogni dettaglio."
              : "A template prepares terminals and actions. Every detail can be edited."}
          </p>
          <div>
            {GPIO_DRIVER_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() => {
                  const next = applyGpioPreset(draft, preset.id);
                  onChange({ ...next, name: it ? preset.name.it : preset.name.en });
                }}
              >
                {it ? preset.name.it : preset.name.en}
              </button>
            ))}
          </div>
        </section>
      )}
      <section
        className="gpio-hardware-card"
        aria-label={it ? "Rappresentazione hardware" : "Hardware representation"}
      >
        <div className="gpio-hardware-toolbar">
          <label>
            {it ? "Dispositivo" : "Device"}
            <select
              value={appearance.kind}
              onChange={(e) =>
                patch({ kind: e.target.value as GpioHardwareAppearance["kind"] })
              }
            >
              {kinds.map(([key, italian, english]) => (
                <option key={key} value={key}>
                  {it ? italian : english}
                </option>
              ))}
            </select>
          </label>
          <label>
            {it ? "Alimentazione VCC" : "VCC supply"}
            <select
              ref={powerSelect}
              value={appearance.power}
              onChange={(e) =>
                patch({ power: e.target.value as GpioHardwareAppearance["power"] })
              }
            >
              <option value="none">{it ? "Non presente" : "Not present"}</option>
              <option value="3.3">3,3 V</option>
              <option value="5">5 V</option>
            </select>
          </label>
          <label className="gpio-ground">
            <input
              type="checkbox"
              ref={groundCheckbox}
              checked={appearance.ground}
              onChange={(e) => patch({ ground: e.target.checked })}
            />
            GND
          </label>
        </div>
        <HardwareIllustration
          kind={appearance.kind}
          name={draft.name}
          terminals={terminals}
          onSelectTerminal={(id) => {
            if (id === "hardware-vcc") {
              powerSelect.current?.focus();
              return;
            }
            if (id === "hardware-gnd") {
              groundCheckbox.current?.focus();
              return;
            }
            if (id.startsWith("hardware-extra-") && contacts.current) {
              contacts.current.open = true;
              contacts.current.querySelector("input")?.focus();
              return;
            }
            const signalIndex = draft.binding.gpioSignals.findIndex((s) => s.id === id);
            if (signalIndex >= 0) {
              const input = form.current?.querySelectorAll<HTMLInputElement>(
                'input[aria-label="Nome terminale"], input[aria-label="Terminal name"]',
              )[signalIndex];
              const card = input?.closest<HTMLDetailsElement>(
                "details.gpio-terminal-card",
              );
              if (card) card.open = true;
              input?.scrollIntoView({ behavior: "smooth", block: "center" });
              input?.focus({ preventScroll: true });
            }
          }}
        />
        {terminals.length === 0 && (
          <p className="gpio-empty-note">
            {it
              ? "Aggiungi i terminali qui sotto: compariranno nel disegno."
              : "Add terminals below to show them in the drawing."}
          </p>
        )}
        {appearance.kind === "rgb" && (
          <label className="gpio-rgb-common">
            {it ? "Comune del LED" : "LED common"}
            <select
              value={appearance.common ?? "cathode"}
              onChange={(e) => patch({ common: e.target.value as "anode" | "cathode" })}
            >
              <option value="cathode">{it ? "Catodo comune" : "Common cathode"}</option>
              <option value="anode">{it ? "Anodo comune" : "Common anode"}</option>
            </select>
            <small>
              {it
                ? "Dichiara il terminale comune nell’alimentazione o nei contatti. Il tipo non cambia automaticamente i segnali."
                : "Declare the common terminal in the supply or contacts. Signal configuration is independent."}
            </small>
          </label>
        )}
      </section>
      <div ref={form}>
        <GpioSignalsPanel draft={draft} it={it} onChange={onChange} />
      </div>
      <details ref={contacts} className="gpio-secondary">
        <summary>
          {it ? "Altri terminali e contatti" : "Other terminals and contacts"}
        </summary>
        <p>
          {it
            ? "Contatti del relè o morsetti del carico: sono collegamenti del dispositivo, non GPIO della Backbone."
            : "Relay contacts or load terminals belong to the device, not to Backbone GPIOs."}
        </p>
        <label>
          {it ? "Nomi separati da virgole" : "Comma-separated names"}
          <ContactNamesInput
            key={draft.id}
            names={appearance.extraTerminals}
            onChange={(extraTerminals) => patch({ extraTerminals })}
          />
        </label>
      </details>
      <details className="gpio-secondary">
        <summary>{it ? "Dettagli dispositivo" : "Device details"}</summary>
        <GpioGeneralPanel draft={draft} it={it} onChange={onChange} />
      </details>
    </div>
  );
}

function ContactNamesInput({
  names,
  onChange,
}: {
  names: readonly string[];
  onChange: (names: readonly string[]) => void;
}) {
  const [text, setText] = useState(names.join(", "));
  return (
    <input
      value={text}
      placeholder="COM, NO, NC"
      onChange={(event) => {
        setText(event.target.value);
        onChange(
          event.target.value
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}
