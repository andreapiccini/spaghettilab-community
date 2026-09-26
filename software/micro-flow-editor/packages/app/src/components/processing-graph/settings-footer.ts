import { isBlockNodeData, type DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import { NODE_WIDTH } from "./layout-constants.js";
import {
  initialHighFromProperties,
  isDigitalOutToggle,
  isLedBlock,
  isRelayBlock,
  ledColorFromProperties,
  numberFromProperty,
  pulseMsFromProperties,
  toggleModeFromProperties,
} from "./dry-run-preview.js";

export type SettingsFooterTabKind = "select" | "number" | "color";

export type SettingsFooterOption = {
  readonly value: string;
  readonly label: string;
};

export type SettingsFooterTab = {
  readonly id: string;
  readonly label: string;
  readonly display: string;
  readonly kind: SettingsFooterTabKind;
  readonly options?: readonly SettingsFooterOption[];
  readonly min?: number;
  readonly max?: number;
};

export type SettingsFooterModel = {
  readonly color: string;
  readonly tabs: readonly SettingsFooterTab[];
};

const TAB_MIN = 52;

export function footerCardWidth(tabCount: number): number {
  if (tabCount <= 2) return NODE_WIDTH;
  return Math.max(NODE_WIDTH, tabCount * TAB_MIN);
}

export function cycleSelectValue(tab: SettingsFooterTab): string | undefined {
  const options = tab.options;
  if (!options || options.length === 0) return undefined;
  const current = options.findIndex((option) => option.label === tab.display || option.value === tab.display);
  const index = current < 0 ? 0 : (current + 1) % options.length;
  return options[index]?.value;
}

export function settingsFooterFor(data: DeviceProcessingNodeData): SettingsFooterModel | undefined {
  if (!isBlockNodeData(data)) return undefined;
  if (isDigitalOutToggle(data)) return toggleFooter(data.properties);
  if (isLedBlock(data)) return ledFooter(data.properties);
  if (isRelayBlock(data)) return relayFooter(data.properties);
  return undefined;
}

function toggleFooter(properties: Readonly<Record<string, unknown>>): SettingsFooterModel {
  const mode = toggleModeFromProperties(properties);
  const modeOptions: readonly SettingsFooterOption[] = [
    { value: "astable", label: "AST" },
    { value: "pulse_high", label: "P↑" },
    { value: "pulse_low", label: "P↓" },
  ];
  const modeTab: SettingsFooterTab = {
    id: "toggleMode",
    label: "mode",
    display: modeOptions.find((option) => option.value === mode)?.label ?? "AST",
    kind: "select",
    options: modeOptions,
  };
  if (mode === "pulse_high" || mode === "pulse_low") {
    return {
      color: "#EA580C",
      tabs: [
        modeTab,
        {
          id: "pulseMs",
          label: "pulse",
          display: `${pulseMsFromProperties(properties)}ms`,
          kind: "number",
          min: 1,
          max: 60_000,
        },
      ],
    };
  }
  const high = initialHighFromProperties(properties);
  return {
    color: "#EA580C",
    tabs: [
      modeTab,
      {
        id: "initial",
        label: "init",
        display: high ? "HIGH" : "LOW",
        kind: "select",
        options: [
          { value: "high", label: "HIGH" },
          { value: "low", label: "LOW" },
        ],
      },
      {
        id: "lowToHigh",
        label: "on",
        display: String(numberFromProperty(properties.lowToHigh, 1)),
        kind: "number",
        min: 1,
        max: 99,
      },
      {
        id: "highToLow",
        label: "off",
        display: String(numberFromProperty(properties.highToLow, 1)),
        kind: "number",
        min: 1,
        max: 99,
      },
    ],
  };
}

function ledFooter(properties: Readonly<Record<string, unknown>>): SettingsFooterModel {
  const color = ledColorFromProperties(properties, "#F5C518");
  const ms = (id: string, label: string): SettingsFooterTab => ({
    id,
    label,
    display: String(numberFromProperty(properties[id], 0)),
    kind: "number",
    min: 0,
    max: 60_000,
  });
  return {
    color,
    tabs: [
      { id: "color", label: "color", display: color, kind: "color" },
      ms("delayOnMs", "d.on"),
      ms("delayOffMs", "d.off"),
      ms("softOnMs", "s.on"),
      ms("softOffMs", "s.off"),
    ],
  };
}

function relayFooter(properties: Readonly<Record<string, unknown>>): SettingsFooterModel {
  const high = properties.closeWhen !== "low";
  return {
    color: "#0F766E",
    tabs: [
      {
        id: "closeWhen",
        label: "closed if",
        display: high ? "HIGH" : "LOW",
        kind: "select",
        options: [
          { value: "high", label: "HIGH" },
          { value: "low", label: "LOW" },
        ],
      },
    ],
  };
}
