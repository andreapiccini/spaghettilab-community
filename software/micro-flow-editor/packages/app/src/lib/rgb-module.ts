import type { DeviceRecipeDraft, DeviceRecipeOp } from "./device-recipe-draft.js";
import { createGpioRgbLedPreset } from "./gpio-driver-presets.js";

export const RGB_MODULE_ID = "gpio-rgb-led";
export const RGB_STATE_FIELD = 65531;
export const RGB_COLOR_FIELD = 65532;
export type RgbStep =
  | { id: string; kind: "on" | "off" }
  | { id: string; kind: "color"; color: string; variableId?: string };
export type RgbAction = { id: string; name: string; steps: readonly RgbStep[] };
export type RgbVariable = { id: string; name: string; color: string };
export type RgbInput = { id: string; name: string } & (
  | { mode: "trigger"; actionId: string; edge: "rising" | "falling" }
  | { mode: "variable"; variableId: string; actionId: string }
);
export type RgbModuleConfig = {
  initialOn: boolean;
  initialColor: string;
  common: "cathode" | "anode";
  actions: readonly RgbAction[];
  variables: readonly RgbVariable[];
  inputs: readonly RgbInput[];
};
export function rgbColor(value: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(value))
    throw new Error("Il colore deve essere nel formato #RRGGBB.");
  return Number.parseInt(value.slice(1), 16);
}
export function defaultRgbModule(): RgbModuleConfig {
  return {
    initialOn: false,
    initialColor: "#FF3366",
    common: "cathode",
    variables: [{ id: "color", name: "Colore", color: "#FF3366" }],
    actions: [
      { id: "on", name: "Accendi", steps: [{ id: "on-step", kind: "on" }] },
      { id: "off", name: "Spegni", steps: [{ id: "off-step", kind: "off" }] },
      {
        id: "color",
        name: "Imposta colore",
        steps: [
          { id: "color-step", kind: "color", color: "#FF3366", variableId: "color" },
        ],
      },
      {
        id: "red",
        name: "Imposta rosso",
        steps: [{ id: "red-step", kind: "color", color: "#FF0000" }],
      },
      {
        id: "orange",
        name: "Imposta arancione",
        steps: [{ id: "orange-step", kind: "color", color: "#FF8000" }],
      },
      {
        id: "blue",
        name: "Imposta blu",
        steps: [{ id: "blue-step", kind: "color", color: "#0000FF" }],
      },
    ],
    inputs: [
      {
        id: "color-input",
        name: "Ricevi colore",
        mode: "variable",
        variableId: "color",
        actionId: "color",
      },
      {
        id: "red-trigger",
        name: "Imposta rosso",
        mode: "trigger",
        actionId: "red",
        edge: "rising",
      },
      {
        id: "orange-trigger",
        name: "Imposta arancione",
        mode: "trigger",
        actionId: "orange",
        edge: "rising",
      },
      {
        id: "blue-trigger",
        name: "Imposta blu",
        mode: "trigger",
        actionId: "blue",
        edge: "rising",
      },
    ],
  };
}
export function validateRgbModule(config: RgbModuleConfig): void {
  rgbColor(config.initialColor);
  if (
    config.actions.length * 2 +
      config.inputs.filter((input) => input.mode === "variable").length * 3 >
    16
  )
    throw new Error(
      "Troppe azioni e ingressi variabile per questo Core: riduci il numero prima di salvare.",
    );
  if (
    !config.actions.length ||
    config.actions.length +
      config.inputs.filter((input) => input.mode === "variable").length >
      8
  )
    throw new Error(
      "Sono disponibili 8 comandi complessivi fra azioni e ingressi variabile.",
    );
  if (config.variables.length > 8 || config.inputs.length > 4)
    throw new Error("Sono disponibili fino a 8 variabili e 4 ingressi sul Core.");
  for (const list of [config.actions, config.variables, config.inputs])
    if (
      new Set(list.map((item) => item.id)).size !== list.length ||
      list.some((item) => !item.id || !item.name.trim())
    )
      throw new Error("Ogni elemento deve avere un nome e un riferimento distinti.");
  config.variables.forEach((variable) => rgbColor(variable.color));
  for (const action of config.actions) {
    if (!action.steps.length || action.steps.length > 8)
      throw new Error(`${action.name}: inserisci da 1 a 8 passi.`);
    for (const step of action.steps)
      if (step.kind === "color") {
        rgbColor(step.color);
        if (
          step.variableId &&
          !config.variables.some((variable) => variable.id === step.variableId)
        )
          throw new Error(`${action.name}: la variabile non esiste più.`);
      }
  }
  for (const input of config.inputs) {
    if (!config.actions.some((action) => action.id === input.actionId))
      throw new Error(`${input.name}: scegli un’azione esistente.`);
    if (
      input.mode === "variable" &&
      !config.variables.some((variable) => variable.id === input.variableId)
    )
      throw new Error(`${input.name}: scegli una variabile esistente.`);
  }
}
export function rgbModuleDraft(
  config: RgbModuleConfig = defaultRgbModule(),
  previous?: DeviceRecipeDraft,
): DeviceRecipeDraft {
  const base = previous ?? createGpioRgbLedPreset("LED RGB");
  const op = (step: RgbStep): DeviceRecipeOp => ({
    id: step.id,
    type: "rgb_led",
    command: step.kind,
    ...(step.kind === "color"
      ? { color: step.color, variableId: step.variableId }
      : {}),
  });
  return {
    ...base,
    id: previous?.id ?? RGB_MODULE_ID,
    name: previous?.name ?? "LED RGB",
    status: "ready",
    rgbModule: config,
    description:
      "Modulo RGB a tre canali PWM: inizializzazione, azioni e ingressi variabile o trigger.",
    gpioHardware: {
      kind: "rgb",
      common: config.common,
      ground: config.common === "cathode",
      power: config.common === "anode" ? "3.3" : "none",
      extraTerminals: [],
    },
    variables: config.variables.map((variable) => ({
      id: variable.id,
      name: variable.id,
      label: variable.name,
      valueType: "number",
      defaultValue: String(rgbColor(variable.color)),
    })),
    commands: config.actions.map((action) => ({
      id: action.id,
      name: action.id,
      label: action.name,
      description: "",
      params: [],
      steps: action.steps.map(op),
      trigger: { edge: "rising", level: "high" },
    })),
    phases: {
      init: [
        {
          id: "rgb-init",
          type: "rgb_led",
          command: "color",
          color: config.initialColor,
        },
        ...(config.initialOn
          ? []
          : [
              { id: "rgb-init-off", type: "rgb_led" as const, command: "off" as const },
            ]),
      ],
      sample: [],
      command: [],
    },
    channels: [
      ...config.inputs.map((input) => ({
        id: input.id,
        label: rgbInputLabel(input),
        unit: "",
        quantity: input.mode === "trigger" ? ("digital" as const) : ("analog" as const),
        direction: "write" as const,
        dataType: "number" as const,
        inputMode: input.mode === "trigger" ? ("trigger" as const) : ("data" as const),
      })),
      {
        id: "state",
        label: "È acceso",
        direction: "read",
        quantity: "digital",
        dataType: "bool",
        unit: "",
      },
      {
        id: "color",
        label: "Colore emesso",
        direction: "read",
        quantity: "analog",
        dataType: "number",
        unit: "RGB",
      },
    ],
    flowInterfaces: [],
    runtimeUnavailable: [],
    updatedAt: previous ? Date.now() : 1792281600000,
  };
}

export function rgbInputLabel(input: RgbInput): string {
  const legacy: Record<string, string> = {
    Colore: "Ricevi colore",
    Rosso: "Imposta rosso",
    Arancione: "Imposta arancione",
    Blu: "Imposta blu",
  };
  return legacy[input.name] ?? input.name;
}
